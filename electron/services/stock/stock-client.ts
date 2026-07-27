import { EventEmitter } from 'node:events';
import type {
  AgentResultCard,
  BoardDetail,
  IChipDistributionResult,
  KlinePoint,
  MarketBoardRow,
  MarketIndexPeriod,
  MarketIndexSnapshot,
  MarketPageSnapshot,
  MarketQuoteRow,
  MarketSearchResult,
  MarketTab,
  StockDetail,
} from '../../../src/shared/types.js';
import {
  listDailyBars,
  listLatestMarketRows,
  listSecurities,
  readBoardDetail,
  writeBoardDetail,
} from '../market-data/market-data-store.js';
import { queryHistoricalBars, queryLatestQuote } from '../market-data/market-data-query.js';
import { formatMoney, formatNumber, formatPercent, pickString } from './format.js';
import {
  BOARD_CONSTITUENT_SCAN_LIMIT,
  BOARD_DETAIL_TIMEOUT,
  BOARD_SCAN_BUDGET_MS,
  BOARD_SCAN_CONCURRENCY,
  BOARD_SDK_OUTER_TIMEOUT,
  BOARD_SDK_REQUEST_TIMEOUT,
  type BoardKind,
  type BoardApi,
  type IndexKlinePeriod,
  aggregateKline,
  boardKindCache,
  boardNamesMatch,
  compactRow,
  fetchEastmoneyClist,
  fetchEastmoneyQuoteRowsByCodes,
  getCachedMarketBoardRows,
  hasValue,
  marketBoardsCache,
  mergeByCode,
  normalizeAmount,
  normalizeBoardName,
  normalizeIndustryName,
  orderBoardApis,
  parseEastmoneyKline,
  parseMarketTime,
  searchBoardNameCache,
  shouldUseRemoteMarketData,
  toKlinePoint,
  toMarketQuoteRow,
  warnEastmoneyFallback,
  withTimeoutReject,
  sdk,
} from './shared.js';

import { analyzeIndicators } from './indicators.js';
import { calculateChipDistribution, chipRowsToResult } from './chip-distribution.js';
import { getStoredQuoteRows, upsertQuoteRows } from './quote-store.js';
import { extractSymbolCandidate, normalizeASymbol, inferExchange, toQuoteSymbol } from './symbols.js';

let quoteCache: { rows: MarketQuoteRow[]; updatedAt: number; promise?: Promise<MarketQuoteRow[]> } = {
  rows: [],
  updatedAt: 0,
};
const marketPageEvents = new EventEmitter();
const marketPageCache = new Map<string, { snapshot?: MarketPageSnapshot; refreshing?: Promise<MarketPageSnapshot> }>();
const marketPageIndustryRefreshes = new Map<string, Promise<void>>();
const marketIndexCache = new Map<
  MarketIndexPeriod,
  { rows?: MarketIndexSnapshot[]; refreshing?: Promise<MarketIndexSnapshot[]> }
>();
let boardApisLoadingPromise: Promise<void> | undefined;
const chipDistributionCache = new Map<
  string,
  { result?: IChipDistributionResult; updatedAt: number; promise?: Promise<IChipDistributionResult> }
>();
let securitiesIndustryMapPromise: Promise<Map<string, string>> | undefined;
let localSecuritiesIndustryCache: { rows: Map<string, string>; updatedAt: number } | undefined;
const CHIP_DISTRIBUTION_CACHE_TTL_MS = 5 * 60_000;

import { deriveStockRating, toStockDetail } from './stock-rating.js';
import type { StockRating } from './stock-rating.js';

type AnyRecord = Record<string, unknown>;

export async function resolveASymbol(input: string): Promise<{ symbol: string; name?: string }> {
  const candidate = extractSymbolCandidate(input);
  if (/^\d{6}$/.test(candidate)) {
    const result = (await sdk.search(candidate)).find(
      (item: { code?: string; name?: string; category?: string }) => item.category === 'stock' && item.code,
    );
    return { symbol: candidate, name: result?.name };
  }
  const result = (await sdk.search(candidate)).find(
    (item: { code?: string; name?: string; category?: string }) => item.category === 'stock' && item.code,
  );
  if (result) return { symbol: result.code!.replace(/^\D+/, ''), name: result.name };
  return { symbol: normalizeASymbol(candidate) };
}

export async function isUnsupportedStockMarketQuery(input: string) {
  const query = input.trim();
  if (!query || query.length > 40) return false;
  const results = await sdk.search(query);
  const stockResults = results.filter((item) => item.category === 'stock');
  return (
    stockResults.some((item) => item.market === 'hk' || item.market === 'us') &&
    !stockResults.some((item) => item.market === 'sh' || item.market === 'sz' || item.market === 'bj')
  );
}

export async function getQuote(symbolInput: string): Promise<StockDetail> {
  return (await queryLatestQuote(symbolInput)).data;
}

export async function getBatchQuotes(codes: string[]): Promise<StockDetail[]> {
  // ponytail: lightweight batch — no DuckDB, no kline, just real-time quotes
  const results = await Promise.all(codes.map((code) => getQuote(code).catch(() => undefined)));
  return results.filter((r): r is StockDetail => Boolean(r));
}

export async function getKline(
  symbolInput: string,
  limit = 120,
  period = '1d',
  beforeTimestamp?: number,
): Promise<KlinePoint[]> {
  const indexCode = normalizeIndexSymbol(symbolInput);
  if (indexCode) {
    const snapshot = isIndexKlinePeriod(period)
      ? await fetchMarketIndex(indexCode, period, limit, beforeTimestamp)
      : undefined;
    return (snapshot?.minutes ?? []).slice(-limit);
  }

  const symbol = normalizeASymbol(symbolInput);
  if (period === '1d') {
    // ponytail: DuckDB may hang on IO error — try direct APIs first, use DB as cache only
    const direct = await fetchDailyKlineDirect(symbol, limit, beforeTimestamp);
    if (direct.length) return direct;
    // Last resort: try DB (may hang, but we already have data from direct)
    try {
      const fromDb = await queryHistoricalBars(symbol, { limit, period: '1d', adjustType: 'qfq' });
      if (fromDb.data.length) return fromDb.data;
    } catch {
      /* DB broken, already returned direct data or empty */
    }
    return [];
  }
  try {
    if (period === '15m') return getTencentMinuteKline(symbol, limit, '15', beforeTimestamp);
    if (period === '1h') return getTencentMinuteKline(symbol, limit, '60', beforeTimestamp);
    if (period === '4h')
      return aggregateKline(await getTencentMinuteKline(symbol, limit * 4, '60', beforeTimestamp), 4).slice(-limit);
    const tencent = await getTencentHistoryKline(symbol, limit, period, beforeTimestamp);
    if (tencent.length) return tencent;
    const data = await sdk.kline.cn(symbol, { period: toSdkKlinePeriod(period), adjust: 'qfq' as const });
    return data
      .slice(-limit)
      .map(toKlinePoint)
      .filter((point): point is KlinePoint => Boolean(point));
  } catch {
    const klt = toEastmoneyKlt(period);
    try {
      return period === '4h'
        ? aggregateKline(await getEastmoneyKline(symbol, limit * 4, '60'), 4).slice(-limit)
        : getEastmoneyKline(symbol, limit, klt);
    } catch {
      return [];
    }
  }
}

async function fetchDailyKlineDirect(symbol: string, limit: number, beforeTimestamp?: number): Promise<KlinePoint[]> {
  // Try Tencent first (faster), Eastmoney as fallback
  try {
    const tencent = await getTencentHistoryKline(symbol, limit, '1d', beforeTimestamp);
    if (tencent.length) return tencent;
  } catch {
    /* continue */
  }
  try {
    return await getEastmoneyKline(symbol, limit, '101');
  } catch {
    return [];
  }
}

function toSdkKlinePeriod(period: string): 'daily' | 'weekly' | 'monthly' {
  return period === '1w' ? 'weekly' : period === '1mo' ? 'monthly' : 'daily';
}

function toEastmoneyKlt(period: string) {
  return (
    ({ '15m': '15', '1h': '60', '4h': '60', '1d': '101', '1w': '102', '1mo': '103' } as Record<string, string>)[
      period
    ] ?? '101'
  );
}

async function getEastmoneyKline(symbol: string, limit: number, klt = '101'): Promise<KlinePoint[]> {
  const market = symbol.startsWith('6') ? '1' : '0';
  const url = new URL('https://push2his.eastmoney.com/api/qt/stock/kline/get');
  url.search = new URLSearchParams({
    secid: `${market}.${symbol}`,
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    klt,
    fqt: '1',
    beg: '0',
    end: '20500101',
    lmt: String(limit),
  }).toString();
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://quote.eastmoney.com/' },
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { data?: { klines?: string[] } };
    return (payload.data?.klines ?? []).map(parseEastmoneyKline).filter((point): point is KlinePoint => Boolean(point));
  } catch {
    return [];
  }
}

async function getTencentHistoryKline(
  symbol: string,
  limit: number,
  period: string,
  beforeTimestamp?: number,
): Promise<KlinePoint[]> {
  const quoteSymbol = toQuoteSymbol(symbol);
  const type = period === '1w' ? 'week' : period === '1mo' ? 'month' : 'day';
  const key = `qfq${type}`;
  const url = new URL('https://ifzq.gtimg.cn/appstock/app/fqkline/get');
  const endDate = beforeTimestamp === undefined ? '' : formatTencentHistoryDate(beforeTimestamp);
  url.search = new URLSearchParams({ param: `${quoteSymbol},${type},,${endDate},${limit},qfq` }).toString();
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: `https://gu.qq.com/${quoteSymbol}/gp` },
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { data?: Record<string, Record<string, unknown[]>> };
    const rows = payload.data?.[quoteSymbol]?.[key] ?? [];
    return rows.map(parseTencentKline).filter((point): point is KlinePoint => Boolean(point));
  } catch {
    return [];
  }
}

function formatTencentHistoryDate(timestamp: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(timestamp));
}

async function getTencentMinuteKline(
  symbol: string,
  limit: number,
  period: '15' | '60',
  beforeTimestamp?: number,
): Promise<KlinePoint[]> {
  const quoteSymbol = toQuoteSymbol(symbol);
  const before = beforeTimestamp === undefined ? '' : formatTencentMinuteTimestamp(beforeTimestamp);
  const url = new URL('https://ifzq.gtimg.cn/appstock/app/kline/mkline');
  url.search = new URLSearchParams({ param: `${quoteSymbol},m${period},${before},${limit}` }).toString();
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: `https://gu.qq.com/${quoteSymbol}/gp` },
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { data?: Record<string, Record<string, unknown[]>> };
    const rows = payload.data?.[quoteSymbol]?.[`m${period}`] ?? [];
    return rows.map(parseTencentKline).filter((point): point is KlinePoint => Boolean(point));
  } catch {
    return [];
  }
}

function parseTencentKline(row: unknown): KlinePoint | undefined {
  if (!Array.isArray(row)) return undefined;
  const [time, open, close, high, low, volume, , amount] = row;
  const point = {
    time: String(time ?? ''),
    timestamp: parseMarketTime(String(time ?? '')),
    open: Number(open),
    close: Number(close),
    high: Number(high),
    low: Number(low),
    volume: Number(volume),
    amount: amount === undefined ? undefined : Number(amount) * 10000,
  };
  return [point.open, point.close, point.high, point.low].every(Number.isFinite) ? point : undefined;
}

export async function searchStocks(query: string): Promise<MarketSearchResult[]> {
  const text = query.trim();
  if (!text) return [];
  const q = text.toLowerCase();
  const isPureNumeric = /^\d+$/.test(text);
  const isBoardKeyword = /^板块|行业|概念$/.test(text);

  // ponytail: "板块/行业/概念" → show full board list from cache
  if (isBoardKeyword) {
    const boards = marketBoardsCache.rows.length
      ? marketBoardsCache.rows
      : await getCachedMarketBoardRows(false).catch(() => []);
    return boards.slice(0, 50).map((row) => {
      searchBoardNameCache.set(row.code, row.name);
      return { ...row, kind: 'board' as const, minutes: row.minutes ?? [] };
    });
  }

  const [sdkRows, boardRows] = await Promise.all([
    withTimeoutReject(sdk.search(text), 900, 'search timeout').catch(() => []) as Promise<
      Array<{ code?: string; name?: string; category?: string; type?: string }>
    >,
    searchMarketBoards(q, text),
  ]);
  const fromSdk = sdkRows
    .filter((item) => item.code && item.name)
    .map((item) => {
      const isBoard = /board|industry|concept|板块|行业|概念/i.test(String(item.category ?? item.type ?? ''));
      const codeLooksLikeBoard = /^BK\d+/i.test(String(item.code ?? ''));
      const kind = isBoard || codeLooksLikeBoard ? ('board' as const) : ('stock' as const);
      return {
        code: kind === 'board' ? String(item.code).toUpperCase() : normalizeSearchCode(item.code),
        name: item.name ?? '',
        kind,
      };
    })
    .filter(
      (item) =>
        item.code.includes(q) || item.name.toLowerCase().includes(q) || item.code.replace(/^BK/i, '').includes(q),
    );
  const stockRows = fromSdk.filter((item) => item.kind === 'stock');
  const sdkBoardRows = fromSdk.filter((item) => item.kind === 'board');
  const mergedBoardRows = dedupeSearchRows([...sdkBoardRows, ...boardRows]).slice(0, 20);
  const mergedStockRows = stockRows.length
    ? dedupeSearchRows(stockRows).slice(0, 50)
    : await searchFallbackStocks(text, q);
  const results = [...mergedBoardRows, ...mergedStockRows].slice(0, 50);
  if (results.length) return results;

  // ponytail: no results from SDK or cache — try raw Eastmoney board/fund search for pure numeric codes
  if (isPureNumeric) {
    const [eastmoneyBoards, eastmoneyFunds] = await Promise.all([
      searchEastmoneyBoards(text).catch(() => []),
      searchEastmoneyFunds(text).catch(() => []),
    ]);
    const fundRows = eastmoneyFunds.map((row) => ({ ...row, kind: 'stock' as const }));
    return [
      ...eastmoneyBoards.map((row) => ({ ...row, kind: 'board' as const, minutes: [] as KlinePoint[] })),
      ...fundRows,
    ].slice(0, 50);
  }
  return [];
}

async function searchFallbackStocks(text: string, q: string): Promise<MarketSearchResult[]> {
  const marketRows = await getAllMarketQuoteRows().catch(() => []);
  const local = marketRows
    .filter((row) => row.code.includes(q) || row.name.toLowerCase().includes(q))
    .slice(0, 50)
    .map((row) => ({ ...row, kind: 'stock' as const }));
  if (local.length) return local;

  const suggested = await searchEastmoneyStocks(text);
  return suggested.map((row) => ({ ...row, kind: 'stock' as const }));
}

async function searchMarketBoards(q: string, raw = q): Promise<MarketSearchResult[]> {
  // ponytail: use cache to avoid full board list refresh on every keystroke
  const rows = marketBoardsCache.rows.length
    ? marketBoardsCache.rows
    : await getCachedMarketBoardRows(false).catch(() => []);
  const bareQ = q.replace(/^bk/i, '');
  const matches = rows
    .filter((row) => {
      const bareCode = row.code.replace(/^BK/i, '');
      return (
        row.code.toLowerCase().includes(q) ||
        bareCode.includes(bareQ) ||
        bareQ.includes(bareCode) ||
        row.name.toLowerCase().includes(q)
      );
    })
    .slice(0, 20)
    .map((row) => {
      searchBoardNameCache.set(row.code, row.name);
      return { ...row, kind: 'board' as const, minutes: row.minutes ?? [] };
    });
  if (matches.length) return matches;

  const suggested = await searchEastmoneyBoards(raw);
  return suggested.map((row) => {
    searchBoardNameCache.set(row.code, row.name);
    return { ...row, kind: 'board' as const, minutes: row.minutes ?? [] };
  });
}

function dedupeSearchRows(rows: MarketQuoteRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => row.code && !seen.has(row.code) && seen.add(row.code));
}

function normalizeSearchCode(value?: string) {
  return String(value ?? '')
    .replace(/^(sh|sz|bj)/i, '')
    .replace(/^\D+/, '');
}

async function searchEastmoneyBoards(query: string): Promise<MarketBoardRow[]> {
  const url = new URL('https://searchapi.eastmoney.com/api/suggest/get');
  url.search = new URLSearchParams({ input: query, type: '14' }).toString();
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(4_000),
      headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: 'https://www.eastmoney.com/' },
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      QuotationCodeTable?: { Data?: Array<{ Code?: string; Name?: string; Classify?: string }> };
    };
    return (payload.QuotationCodeTable?.Data ?? [])
      .filter((item) => /^BK\d+$/i.test(String(item.Code)) && item.Name)
      .slice(0, 20)
      .map((item) => ({ code: String(item.Code).toUpperCase(), name: String(item.Name), minutes: [] }));
  } catch {
    return [];
  }
}

async function searchEastmoneyFunds(query: string): Promise<MarketQuoteRow[]> {
  const url = new URL('https://searchapi.eastmoney.com/api/suggest/get');
  url.search = new URLSearchParams({ input: query, type: '14' }).toString();
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(4_000),
      headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: 'https://www.eastmoney.com/' },
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      QuotationCodeTable?: { Data?: Array<{ Code?: string; Name?: string; Classify?: string }> };
    };
    return (payload.QuotationCodeTable?.Data ?? [])
      .filter((item) => item.Code && item.Name && /Fund|ETF|LOF|fund/i.test(String(item.Classify ?? '')))
      .slice(0, 20)
      .map((item) => ({ code: String(item.Code), name: String(item.Name) }));
  } catch {
    return [];
  }
}
async function searchEastmoneyStocks(query: string): Promise<MarketQuoteRow[]> {
  const url = new URL('https://searchapi.eastmoney.com/api/suggest/get');
  url.search = new URLSearchParams({ input: query, type: '14' }).toString();
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(4_000),
      headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: 'https://www.eastmoney.com/' },
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      QuotationCodeTable?: { Data?: Array<{ Code?: string; Name?: string; Classify?: string }> };
    };
    return (payload.QuotationCodeTable?.Data ?? [])
      .filter((item) => item.Classify === 'AStock' && item.Code)
      .slice(0, 50)
      .map((item) => ({ code: String(item.Code), name: item.Name || String(item.Code) }));
  } catch {
    return [];
  }
}

export async function getStockDetail(symbolInput: string): Promise<StockDetail> {
  const local = await getLocalStockDetail(symbolInput).catch(() => undefined);
  if (local) {
    void refreshQuoteCache();
    if (!hasLimitedRating(local.rating)) return local;
    const enriched = await getRemoteStockDetail(symbolInput).catch(() => undefined);
    return enriched ? { ...enriched, kline: local.kline?.length ? local.kline : enriched.kline } : local;
  }

  const remote: StockDetail = await getRemoteStockDetail(symbolInput).catch((error: unknown): StockDetail => {
    const code = normalizeASymbol(symbolInput);
    return {
      code,
      name: code,
      exchange: inferExchange(code),
      price: '--',
      changePercent: '--',
      summary: `暂时无法从 stock-sdk 获取 ${code} 的实时详情：${error instanceof Error ? error.message : '未知错误'}`,
    };
  });
  // ponytail: always include kline data even from remote path
  if (!remote.kline?.length) {
    try {
      remote.kline = await getKline(symbolInput, 140);
    } catch {
      /* keep existing */
    }
  }
  return remote;
}

async function getRemoteStockDetail(symbolInput: string): Promise<StockDetail> {
  const quote = await getQuote(symbolInput);
  try {
    const technical = await analyzeTechnical(symbolInput);
    return {
      ...quote,
      rating: deriveStockRating({
        quote,
        technical,
        previous: quote.rating,
      }),
      summary: `${quote.summary ?? ''} ${technical.narrative ?? ''}`.trim(),
    };
  } catch {
    return quote;
  }
}

function hasLimitedRating(rating: StockDetail['rating']) {
  return rating?.fundamental === '数据有限' || rating?.valuation === '数据有限';
}

async function getLocalStockDetail(symbolInput: string): Promise<StockDetail | undefined> {
  const code = normalizeASymbol(symbolInput);
  const quote = getStoredQuoteRows().find((row) => row.code === code);
  const bars = await listDailyBars(code, { limit: 120, adjustType: 'qfq' }).catch(() => []);
  const latest = bars.at(-1);
  if (!quote && !latest) return undefined;

  const detail = quote
    ? toStockDetail(quote, code)
    : ({
        code,
        name: code,
        exchange: inferExchange(code),
        price: latest?.close ?? '--',
        change: latest?.change === undefined ? '--' : `${latest.change >= 0 ? '+' : ''}${formatNumber(latest.change)}`,
        changePercent: latest?.changePercent === undefined ? '--' : formatPercent(latest.changePercent),
        open: latest?.open === undefined ? '--' : formatNumber(latest.open),
        high: latest?.high === undefined ? '--' : formatNumber(latest.high),
        low: latest?.low === undefined ? '--' : formatNumber(latest.low),
        prevClose:
          latest?.change === undefined || latest?.close === undefined
            ? '--'
            : formatNumber(latest.close - latest.change),
        volume: latest?.volume === undefined ? '--' : `${(latest.volume / 10000).toFixed(1)}万手`,
        turnover: latest?.amount === undefined ? '--' : formatMoney(latest.amount),
        turnoverRate: latest?.turnoverRate === undefined ? '--' : `${formatNumber(latest.turnoverRate)}%`,
        rating: deriveStockRating({
          changePercent: latest?.changePercent,
          turnoverRate: latest?.turnoverRate,
        }),
        summary: latest ? `${code} 本地历史行情，最近交易日 ${latest.tradeDate}。` : undefined,
      } satisfies StockDetail);

  return {
    ...detail,
    open: hasValue(detail.open) ? detail.open : latest?.open,
    high: hasValue(detail.high) ? detail.high : latest?.high,
    low: hasValue(detail.low) ? detail.low : latest?.low,
    prevClose: hasValue(detail.prevClose)
      ? detail.prevClose
      : latest?.change === undefined || latest?.close === undefined
        ? detail.prevClose
        : formatNumber(latest.close - latest.change),
    kline: bars.map((bar) => ({
      time: bar.tradeDate,
      timestamp: parseMarketTime(bar.tradeDate),
      open: bar.open,
      close: bar.close,
      high: bar.high,
      low: bar.low,
      volume: bar.volume,
      amount: bar.amount,
      change: bar.change,
      changePercent: bar.changePercent,
      turnoverRate: bar.turnoverRate,
    })),
  };
}

export async function getBoardDetail(symbol: string, forceRefresh = false, boardName?: string): Promise<BoardDetail> {
  const cacheKey = normalizeBoardCode(symbol);
  const refreshRemote = async (localFallback?: BoardDetail) => {
    const detail = await getRemoteBoardDetail(symbol, !localFallback, boardName, localFallback);
    if (detail.kline?.length || detail.constituents?.length)
      void writeBoardDetail({ detail, updatedAt: new Date().toISOString() });
    return detail;
  };

  if (forceRefresh) {
    const detail = await refreshRemote();
    if (!detail.kline?.length && !detail.constituents?.length) throw new Error('板块接口暂无数据');
    return detail;
  }

  const cached =
    (await readBoardDetail(cacheKey).catch(() => undefined)) ?? (await readBoardDetail(symbol).catch(() => undefined));
  const cachedName = cached?.detail.name;
  // ponytail: timeout local scan — scanBoardMembership can run 8s+
  const localDetail = await withTimeoutReject(
    getLocalBoardDetail(cacheKey, cachedName ?? boardName),
    6_000,
    '本地板块详情加载超时',
  ).catch(() => undefined);
  if (cached?.detail.constituents?.length) {
    void refreshRemote().catch((error) =>
      console.warn(
        '[market] board detail background refresh failed',
        symbol,
        error instanceof Error ? error.message : error,
      ),
    );
    return cached.detail;
  }

  if (localDetail?.constituents?.length) {
    void refreshRemote(localDetail).catch((error) =>
      console.warn(
        '[market] board detail background refresh failed',
        symbol,
        error instanceof Error ? error.message : error,
      ),
    );
    return localDetail;
  }

  try {
    return await refreshRemote(localDetail);
  } catch (error) {
    console.warn('[market] board detail unavailable', symbol, error instanceof Error ? error.message : error);
    return cached?.detail ?? localDetail ?? { code: cacheKey, name: boardName ?? symbol, kline: [], constituents: [] };
  }
}

async function completeBoardDetail(detail: BoardDetail): Promise<BoardDetail> {
  const constituents = shouldUseRemoteMarketData()
    ? await enrichBoardConstituents(detail.constituents ?? [])
    : (detail.constituents ?? []);
  const kline = detail.kline?.length
    ? detail.kline
    : constituents.length
      ? await aggregateRemoteBoardKline(constituents.map((row) => row.code)).catch(() => [])
      : [];
  return { ...detail, kline, constituents };
}

async function enrichBoardConstituents(
  rows: NonNullable<BoardDetail['constituents']>,
): Promise<NonNullable<BoardDetail['constituents']>> {
  if (!rows.length) return rows;
  const latestRows = await listLatestMarketRows().catch(() => []);
  const byCode = new Map(latestRows.map((row) => [row.code, row]));
  return rows.map((row) => {
    const latest = byCode.get(row.code);
    if (!latest) return row;
    return {
      ...row,
      price: latest.price ?? row.price ?? '--',
      changePercent:
        latest.changePercent === undefined ? (row.changePercent ?? '--') : formatPercent(latest.changePercent),
      amount: latest.amount === undefined ? row.amount : formatMoney(latest.amount),
      turnover: latest.turnoverRate === undefined ? row.turnover : `${formatNumber(latest.turnoverRate)}%`,
    };
  });
}

async function getRemoteBoardDetail(
  symbol: string,
  skipLocalFallback = false,
  boardName?: string,
  precomputedLocal?: BoardDetail,
): Promise<BoardDetail> {
  const canonicalSymbol = normalizeBoardCode(symbol);

  // ponytail: use cached boards; fall back to remote only if cache is empty
  const boards = marketBoardsCache.rows.length
    ? marketBoardsCache.rows
    : await withTimeoutReject(getCachedMarketBoardRows(), BOARD_SDK_REQUEST_TIMEOUT, '板块列表加载超时').catch(
        () => [],
      );
  const searchName = searchBoardNameCache.get(symbol) ?? searchBoardNameCache.get(canonicalSymbol);
  const board = boards.find(
    (item) =>
      item.code === canonicalSymbol ||
      item.code === symbol ||
      item.name === symbol ||
      item.name === searchName ||
      item.name === boardName,
  ) ?? { code: canonicalSymbol, name: searchName ?? boardName ?? symbol, changePercent: undefined };
  const targets = getBoardDetailTargets(canonicalSymbol, board.name, boards, symbol, boardName);
  // ponytail: longer outer timeout so SDK loop has time to try each target
  const [kline, sdkRows] = await Promise.all([
    withTimeoutReject(
      fetchSdkBoardSeries(board.code, '1d', board.name, targets),
      BOARD_SDK_OUTER_TIMEOUT,
      '板块K线加载超时',
    ).catch(() => []),
    withTimeoutReject(
      getSdkBoardConstituents(board.code, board.name, targets),
      BOARD_SDK_OUTER_TIMEOUT,
      '板块成分股加载超时',
    ).catch(() => []),
  ]);
  const fallbackRows = sdkRows.length ? [] : await firstBoardConstituentsFromTargets(targets).catch(() => []);
  const fallbackKline = kline.length ? [] : await firstBoardKlineFromTargets(targets).catch(() => []);
  const baseConstituents = (sdkRows.length ? sdkRows : fallbackRows).slice(0, 200);
  // ponytail: reuse precomputed local detail instead of re-running expensive scan
  const localDetail = skipLocalFallback
    ? undefined
    : (precomputedLocal ??
      (await withTimeoutReject(getLocalBoardDetail(board.code), 5_000, '本地板块详情加载超时').catch(() => undefined)));
  const constituents = baseConstituents.length ? await enrichBoardConstituents(baseConstituents) : [];
  const mergedConstituents = constituents.length ? constituents : (localDetail?.constituents ?? []);
  const mergedKline = kline.length ? kline : fallbackKline.length ? fallbackKline : (localDetail?.kline ?? []);
  return {
    code: board.code,
    name: board.name,
    changePercent:
      board.changePercent === undefined ? (localDetail?.changePercent ?? '--') : formatPercent(board.changePercent),
    kline: mergedKline,
    constituents: mergedConstituents,
  };
}

function getBoardDetailTargets(
  symbol: string,
  boardName?: string,
  boards = marketBoardsCache.rows,
  ...aliases: Array<string | undefined>
): string[] {
  const canonicalSymbol = normalizeBoardCode(symbol);
  const selected = boards.find(
    (item) =>
      item.code === canonicalSymbol ||
      item.code === symbol ||
      item.name === symbol ||
      item.name === boardName ||
      aliases.includes(item.code) ||
      aliases.includes(item.name),
  );
  const normalized = normalizeBoardName(boardName ?? selected?.name ?? symbol);
  const siblings = normalized ? boards.filter((item) => normalizeBoardName(item.name) === normalized) : [];
  return [
    ...new Set(
      [
        selected?.code,
        selected?.name,
        canonicalSymbol,
        symbol,
        boardName,
        ...aliases,
        ...siblings.flatMap((item) => [item.code, item.name]),
      ].filter(Boolean),
    ),
  ] as string[];
}

function normalizeBoardCode(value: string) {
  const code = value.trim().toUpperCase();
  return /^\d{4}$/.test(code) ? `BK${code}` : code;
}

async function firstBoardConstituentsFromTargets(targets: string[]): Promise<NonNullable<BoardDetail['constituents']>> {
  for (const target of targets) {
    const rows = await getEastmoneyBoardConstituents(target).catch(() => []);
    if (rows.length) return rows;
  }
  return [];
}

async function firstBoardKlineFromTargets(targets: string[]): Promise<KlinePoint[]> {
  for (const target of targets) {
    const rows = await getAStockBoardKline(target, '1d').catch(() => []);
    if (rows.length) return rows;
  }
  return [];
}

async function getAStockBoardKline(symbol: string, period: MarketIndexPeriod): Promise<KlinePoint[]> {
  if (!/^BK\d+/i.test(symbol)) return [];
  const klt = ({ '15m': '15', '1h': '60', '4h': '60', '1d': '101' } as const)[period];
  const limit = period === '4h' ? 80 : period === '1d' ? 120 : 60;
  const params = new URLSearchParams({
    secid: `90.${symbol.toUpperCase()}`,
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    klt,
    fqt: '1',
    beg: '0',
    end: '20500101',
    lmt: String(limit),
  });
  const payload = await fetchFirstJson<{ data?: { klines?: string[] } }>(
    [
      `https://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`,
      `https://7.push2his.eastmoney.com/api/qt/stock/kline/get?${params}`,
    ],
    'https://quote.eastmoney.com/',
    3_000,
  );
  const rows = (payload.data?.klines ?? [])
    .map(parseEastmoneyKline)
    .filter((point): point is KlinePoint => Boolean(point));
  return period === '4h' ? aggregateKline(rows, 4) : rows;
}

async function fetchFirstJson<T>(urls: string[], referer: string, timeout = 12_000): Promise<T> {
  let lastError: unknown;
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeout),
        headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: referer },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('a-stock-data board request failed');
}

async function aggregateRemoteBoardKline(codes: string[]): Promise<KlinePoint[]> {
  const topCodes = codes.slice(0, 20);
  const series = await Promise.all(
    topCodes.map((code) => listDailyBars(code, { limit: 120, adjustType: 'qfq' }).catch(() => [])),
  );
  return averageKlineSeries(
    series.map((rows) =>
      rows.map((row) => ({
        time: row.tradeDate,
        timestamp: parseMarketTime(row.tradeDate),
        open: row.open,
        close: row.close,
        high: row.high,
        low: row.low,
        volume: row.volume,
        amount: row.amount,
        change: row.change,
        changePercent: row.changePercent,
        turnoverRate: row.turnoverRate,
      })),
    ),
  );
}

function averageKlineSeries(series: KlinePoint[][]): KlinePoint[] {
  const byDate = new Map<
    string,
    { open: number; close: number; high: number; low: number; volume: number; amount: number; count: number }
  >();
  for (const rows of series) {
    for (const row of rows) {
      const group = byDate.get(row.time) ?? { open: 0, close: 0, high: 0, low: 0, volume: 0, amount: 0, count: 0 };
      group.open += row.open;
      group.close += row.close;
      group.high += row.high;
      group.low += row.low;
      group.volume += row.volume;
      group.amount += row.amount ?? 0;
      group.count += 1;
      byDate.set(row.time, group);
    }
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, group]) => ({
      time,
      timestamp: parseMarketTime(time),
      open: group.open / group.count,
      close: group.close / group.count,
      high: group.high / group.count,
      low: group.low / group.count,
      volume: group.volume,
      amount: group.amount,
    }));
}

async function getSdkBoardConstituents(
  symbol: string,
  boardName: string,
  targets = getBoardDetailTargets(symbol, boardName),
): Promise<NonNullable<BoardDetail['constituents']>> {
  const apis = await getBoardApis(symbol, boardName);
  const kind = boardKindCache.get(symbol);

  // ponytail: kind unknown — try both APIs in parallel on first target to discover fast
  if (!kind && targets.length) {
    const firstTarget = targets[0];
    const [industryRows, conceptRows] = await Promise.all([
      withTimeoutReject(
        sdk.board.industry.constituents(firstTarget),
        BOARD_SDK_REQUEST_TIMEOUT,
        '行业成分股加载超时',
      ).catch(() => []),
      withTimeoutReject(
        sdk.board.concept.constituents(firstTarget),
        BOARD_SDK_REQUEST_TIMEOUT,
        '概念成分股加载超时',
      ).catch(() => []),
    ]);
    const rows = industryRows.length ? industryRows : conceptRows;
    const discoveredKind: BoardKind = industryRows.length ? 'industry' : 'concept';
    if (rows.length) {
      boardKindCache.set(symbol, discoveredKind);
      return rows.map(toBoardConstituent);
    }
    // ponytail: first target failed with both APIs — try remaining targets with the preferred order
    const orderedApis = orderBoardApis(undefined);
    for (const target of targets.slice(1)) {
      for (const board of orderedApis) {
        try {
          const result = await withTimeoutReject(
            board.constituents(target),
            BOARD_SDK_REQUEST_TIMEOUT,
            '板块成分股加载超时',
          );
          if (result.length) {
            const resultKind = board === sdk.board.industry ? 'industry' : 'concept';
            boardKindCache.set(symbol, resultKind);
            return result.map(toBoardConstituent);
          }
        } catch {
          /* try next */
        }
      }
    }
    return [];
  }

  // ponytail: kind known — try preferred API first for each target
  for (const board of apis) {
    for (const target of targets) {
      try {
        const rows = await withTimeoutReject(
          board.constituents(target),
          BOARD_SDK_REQUEST_TIMEOUT,
          '板块成分股加载超时',
        );
        if (rows.length) return rows.map(toBoardConstituent);
      } catch {
        // Try name/code and the other board namespace, then the real-data HTTP fallback.
      }
    }
  }
  return [];
}

async function getBoardApis(symbol: string, boardName?: string): Promise<BoardApi[]> {
  // ponytail: check cache first — downloading all boards just to find one board's type is wasteful
  const cachedKind = boardKindCache.get(symbol);
  if (cachedKind) return orderBoardApis(cachedKind);

  // Try to infer kind from already-cached board rows
  const knownBoard = marketBoardsCache.rows.find((row) => row.code === symbol || row.name === boardName);
  const inferredKind = (knownBoard as unknown as AnyRecord)?.kind as BoardKind | undefined;
  if (inferredKind) {
    boardKindCache.set(symbol, inferredKind);
    return orderBoardApis(inferredKind);
  }

  // ponytail: dedup concurrent calls — only one full list download at a time
  if (boardApisLoadingPromise) await boardApisLoadingPromise;
  const cachedAfterWait = boardKindCache.get(symbol);
  if (cachedAfterWait) return orderBoardApis(cachedAfterWait);

  boardApisLoadingPromise = (async () => {
    const [industries, concepts] = await Promise.allSettled([
      withTimeoutReject(sdk.board.industry.list(), BOARD_SDK_REQUEST_TIMEOUT, '行业板块列表加载超时'),
      withTimeoutReject(sdk.board.concept.list(), BOARD_SDK_REQUEST_TIMEOUT, '概念板块列表加载超时'),
    ]);
    const industryRows = industries.status === 'fulfilled' ? industries.value : [];
    const conceptRows = concepts.status === 'fulfilled' ? concepts.value : [];
    for (const item of industryRows) boardKindCache.set(item.code, 'industry');
    for (const item of conceptRows) boardKindCache.set(item.code, 'concept');
  })();

  try {
    await boardApisLoadingPromise;
  } finally {
    boardApisLoadingPromise = undefined;
  }

  const kind =
    boardKindCache.get(symbol) ??
    ((marketBoardsCache.rows.find((row) => row.code === symbol || row.name === boardName) as unknown as AnyRecord)
      ?.kind as BoardKind | undefined);
  if (kind) boardKindCache.set(symbol, kind);
  return orderBoardApis(kind);
}

async function getEastmoneyBoardConstituents(symbol: string): Promise<NonNullable<BoardDetail['constituents']>> {
  if (!/^BK\d+/i.test(symbol)) return [];
  // ponytail: force=true bypasses rate-limit cooldown for user-initiated fetches; try primary then CDN
  for (const endpoint of [
    'https://push2.eastmoney.com/api/qt/clist/get',
    'https://29.push2.eastmoney.com/api/qt/clist/get',
  ]) {
    try {
      const rows = await fetchEastmoneyClist(`b:${symbol}`, 500, endpoint, true);
      return rows.map((row) => toBoardConstituent(toMarketQuoteRow(row))).filter((row) => row.code && row.name);
    } catch {
      /* try next endpoint */
    }
  }
  return [];
}

function toBoardConstituent(item: {
  code?: string;
  symbol?: string;
  name?: string;
  price?: unknown;
  changePercent?: unknown;
  amount?: unknown;
  turnover?: unknown;
  turnoverRate?: unknown;
}): NonNullable<BoardDetail['constituents']>[number] {
  const code = String(item.code ?? item.symbol ?? '')
    .replace(/^(sh|sz|bj)/i, '')
    .replace(/^\D+/, '');
  return {
    code,
    name: String(item.name ?? code),
    price: item.price === null || item.price === undefined ? '--' : formatNumber(item.price),
    changePercent:
      item.changePercent === null || item.changePercent === undefined ? '--' : formatPercent(item.changePercent),
    amount: item.amount === null || item.amount === undefined ? '--' : formatMoney(item.amount),
    turnover:
      item.turnoverRate === null || item.turnoverRate === undefined
        ? item.turnover === undefined
          ? '--'
          : String(item.turnover)
        : `${formatNumber(item.turnoverRate)}%`,
  };
}

async function getLocalBoardDetail(symbol: string, fallbackName?: string): Promise<BoardDetail> {
  const remoteBoard = marketBoardsCache.rows.find((item) => item.code === symbol);
  const searchName = searchBoardNameCache.get(symbol);
  const board = remoteBoard ?? {
    code: symbol,
    name: fallbackName ?? searchName ?? symbol,
    changePercent: undefined,
    minutes: [],
  };
  const rows = await getLocalBoardConstituents(board.name);
  const kline = await aggregateLocalBoardKline(rows.map((row) => row.code))
    .then((items) => (items.length ? items : aggregateBaiduBoardKline(rows.map((row) => row.code))))
    .catch(() => []);
  return {
    code: board.code,
    name: board.name,
    changePercent: formatPercent(board.changePercent ?? 0),
    kline,
    constituents: rows.slice(0, 80).map((item) => ({
      code: item.code,
      name: item.name,
      price: item.price ?? '--',
      changePercent: item.changePercent === undefined ? '--' : formatPercent(item.changePercent),
      amount: item.amount === undefined ? '--' : formatMoney(item.amount),
      turnover: item.turnoverRate === undefined ? '--' : `${formatNumber(item.turnoverRate)}%`,
    })),
  };
}

async function getLocalBoardConstituents(boardName: string): Promise<MarketQuoteRow[]> {
  const rows = await listLatestMarketRows().catch(() => []);
  const securities = await listSecurities().catch(() => []);
  const localName = normalizeBoardName(boardName);
  const industryByCode = new Map(
    securities.map((item) => [item.symbol, item.industry]).filter((item): item is [string, string] => Boolean(item[1])),
  );
  const byIndustry = rows.filter((row) => {
    const industry = industryByCode.get(row.code);
    return industry && boardNamesMatch(industry, localName);
  });
  if (byIndustry.length)
    return byIndustry.sort(
      (a, b) =>
        Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0) || String(a.code).localeCompare(String(b.code)),
    );

  const byMembership = await scanBoardMembership(boardName).catch(() => []);
  if (byMembership.length) return byMembership;
  return rows
    .filter((row) => boardNamesMatch(row.name, localName))
    .sort(
      (a, b) =>
        Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0) || String(a.code).localeCompare(String(b.code)),
    );
}

async function scanBoardMembership(boardName: string): Promise<MarketQuoteRow[]> {
  const localName = normalizeBoardName(boardName);
  if (!localName) return [];
  const symbols = prioritizeBoardScanSymbols(await sdk.codes.cn({ simple: true }));
  const matched: string[] = [];
  const deadline = Date.now() + BOARD_SCAN_BUDGET_MS;
  for (
    let index = 0;
    index < Math.min(symbols.length, BOARD_CONSTITUENT_SCAN_LIMIT) && Date.now() < deadline;
    index += BOARD_SCAN_CONCURRENCY
  ) {
    const batch = symbols.slice(index, index + BOARD_SCAN_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (code) => ({ code, boards: await getStockBoardMembership(code).catch(() => []) })),
    );
    for (const result of results) {
      if (
        result.boards.some(
          (item) => item.code === normalizeBoardCode(boardName) || boardNamesMatch(item.name, localName),
        )
      )
        matched.push(result.code);
    }
    if (matched.length >= 200) break;
  }
  const quotes = matched.length ? await sdk.quotes.cn(matched).catch(() => []) : [];
  return quotes
    .map((quote) =>
      toMarketQuoteRow({
        code: quote.code,
        name: quote.name,
        price: quote.price,
        changePercent: quote.changePercent,
        volume: quote.volume,
        amount: normalizeAmount(quote.amount),
        open: quote.open,
        high: quote.high,
        low: quote.low,
        prevClose: quote.prevClose,
        turnoverRate: quote.turnoverRate,
        marketCap: quote.totalMarketCap,
      }),
    )
    .filter((row) => row.code && row.name)
    .sort(
      (a, b) =>
        Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0) || String(a.code).localeCompare(String(b.code)),
    );
}

function prioritizeBoardScanSymbols(symbols: string[]) {
  const main = symbols.filter((code) => /^(60|00|30|68)/.test(code));
  const rest = symbols.filter((code) => !/^(60|00|30|68)/.test(code));
  return [...main, ...rest];
}

async function getStockBoardMembership(code: string): Promise<Array<{ code: string; name: string }>> {
  const secid = `${code.startsWith('6') ? 1 : 0}.${code}`;
  const url = new URL('https://push2delay.eastmoney.com/api/qt/slist/get');
  url.search = new URLSearchParams({
    fltt: '2',
    invt: '2',
    secid,
    spt: '3',
    pi: '0',
    pz: '200',
    po: '1',
    fields: 'f12,f14,f3,f128',
  }).toString();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(4_000),
    headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: 'https://quote.eastmoney.com/' },
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as { data?: { diff?: AnyRecord[] | Record<string, AnyRecord> } };
  const diff = payload.data?.diff ?? [];
  const items = Array.isArray(diff) ? diff : Object.values(diff);
  return items
    .map((item) => ({ code: String(item.f12 ?? ''), name: String(item.f14 ?? '') }))
    .filter((item) => item.code && item.name);
}

async function aggregateBaiduBoardKline(codes: string[]): Promise<KlinePoint[]> {
  const series = await Promise.all(codes.slice(0, 12).map((code) => getBaiduStockKline(code).catch(() => [])));
  return averageKlineSeries(series);
}

async function getBaiduStockKline(code: string, limit = 240): Promise<KlinePoint[]> {
  const url = new URL('https://finance.pae.baidu.com/selfselect/getstockquotation');
  url.search = new URLSearchParams({
    all: '1',
    isIndex: 'false',
    isBk: 'false',
    isBlock: 'false',
    isFutures: 'false',
    isStock: 'true',
    newFormat: '1',
    group: 'quotation_kline_ab',
    finClientType: 'pc',
    code,
    ktype: '1',
  }).toString();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(8_000),
    headers: {
      'User-Agent': 'Mozilla/5.0 StockBuddy/0.2',
      Accept: 'application/vnd.finance-web.v1+json',
      Origin: 'https://gushitong.baidu.com',
      Referer: 'https://gushitong.baidu.com/',
    },
  });
  if (!response.ok) throw new Error(`百度股市通日 K 请求失败：HTTP ${response.status}`);
  const payload = (await response.json()) as {
    ResultCode?: number | string;
    Result?: { newMarketData?: { keys?: string[]; marketData?: string } };
  };
  if (String(payload.ResultCode ?? '0') !== '0') throw new Error(`百度股市通返回错误码 ${payload.ResultCode}`);
  const keys = payload.Result?.newMarketData?.keys ?? [];
  const rows = payload.Result?.newMarketData?.marketData?.split(';').filter(Boolean) ?? [];
  const data = rows
    .map((line) => parseBaiduKline(line, keys))
    .filter((item): item is KlinePoint => Boolean(item))
    .slice(-limit);
  if (!data.length) throw new Error(`${code} 暂无百度股市通日 K 数据`);
  return data;
}

function parseBaiduKline(line: string, keys: string[]): KlinePoint | undefined {
  const values = line.split(',');
  const at = (name: string) => values[keys.indexOf(name)];
  const point = {
    time: at('time') ?? '',
    timestamp: Number(at('timestamp')) || parseMarketTime(at('time') ?? ''),
    open: Number(at('open')),
    close: Number(at('close')),
    high: Number(at('high')),
    low: Number(at('low')),
    volume: Number(at('volume')) || 0,
    amount: Number(at('amount')) || undefined,
    change: Number(at('ratioamount')) || undefined,
    changePercent: Number(at('ratioprice')) || undefined,
    turnoverRate: Number(at('turnoverratio') ?? at('turnover')) || undefined,
  };
  return [point.open, point.close, point.high, point.low].every(Number.isFinite) ? point : undefined;
}

async function aggregateLocalBoardKline(codes: string[]): Promise<KlinePoint[]> {
  const topCodes = codes.slice(0, 20);
  const series = await Promise.all(
    topCodes.map((code) => listDailyBars(code, { limit: 120, adjustType: 'qfq' }).catch(() => [])),
  );
  const byDate = new Map<
    string,
    { open: number; close: number; high: number; low: number; volume: number; amount: number; count: number }
  >();
  for (const rows of series) {
    for (const row of rows) {
      const group = byDate.get(row.tradeDate) ?? { open: 0, close: 0, high: 0, low: 0, volume: 0, amount: 0, count: 0 };
      group.open += row.open;
      group.close += row.close;
      group.high += row.high;
      group.low += row.low;
      group.volume += row.volume;
      group.amount += row.amount ?? 0;
      group.count += 1;
      byDate.set(row.tradeDate, group);
    }
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, group]) => ({
      time,
      timestamp: parseMarketTime(time),
      open: group.open / group.count,
      close: group.close / group.count,
      high: group.high / group.count,
      low: group.low / group.count,
      volume: group.volume,
      amount: group.amount,
    }));
}

export function onMarketPageSnapshotUpdated(listener: (snapshot: MarketPageSnapshot) => void) {
  marketPageEvents.on('updated', listener);
  return () => marketPageEvents.off('updated', listener);
}

const INDUSTRY_CONSTITUENT_BATCH = 32;
const LOCAL_SECURITIES_INDUSTRY_CACHE_TTL_MS = 10 * 60_000;
const EASTMONEY_INDUSTRY_CACHE_TTL_MS = 10 * 60_000;
const FAST_INDUSTRY_ENRICH_TIMEOUT_MS = 1_200;
const eastmoneyIndustryCache = new Map<MarketTab, { rows: Map<string, string>; updatedAt: number }>();

async function loadIndustryMapFromBoardApi(): Promise<Map<string, string>> {
  const industries = await sdk.board.industry.list().catch(() => []);
  if (!industries.length) return new Map();

  const map = new Map<string, string>();
  for (let start = 0; start < industries.length; start += INDUSTRY_CONSTITUENT_BATCH) {
    const batch = industries.slice(start, start + INDUSTRY_CONSTITUENT_BATCH);
    const results = await Promise.allSettled(
      batch.map(async (board) => {
        const constituents = await sdk.board.industry.constituents(board.code).catch(() => []);
        return { name: board.name, constituents };
      }),
    );
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      for (const item of result.value.constituents) {
        const code = item.code?.trim();
        if (code && !map.has(code)) map.set(code, result.value.name);
      }
    }
  }
  return map;
}

async function loadSecuritiesIndustryMap(): Promise<Map<string, string>> {
  const cached = localSecuritiesIndustryCache;
  if (cached && Date.now() - cached.updatedAt < LOCAL_SECURITIES_INDUSTRY_CACHE_TTL_MS) return cached.rows;
  if (!securitiesIndustryMapPromise) {
    securitiesIndustryMapPromise = listSecurities()
      .then((securities) => {
        const rows = new Map(
          securities
            .map((item): [string, string] | undefined => {
              const industry = normalizeIndustryName(item.industry);
              return industry ? [item.symbol, industry] : undefined;
            })
            .filter((item): item is [string, string] => Boolean(item)),
        );
        localSecuritiesIndustryCache = { rows, updatedAt: Date.now() };
        return rows;
      })
      .finally(() => {
        securitiesIndustryMapPromise = undefined;
      });
  }
  return securitiesIndustryMapPromise;
}

async function loadBoardConstituentIndustryMap(): Promise<Map<string, string>> {
  return loadIndustryMapFromBoardApi();
}

async function loadEastmoneyIndustryMap(tab: MarketTab): Promise<Map<string, string>> {
  const cached = eastmoneyIndustryCache.get(tab);
  if (cached && Date.now() - cached.updatedAt < EASTMONEY_INDUSTRY_CACHE_TTL_MS) return cached.rows;
  const fs = marketTabFs(tab);
  if (!fs) return new Map();
  const rows = await fetchEastmoneyClist(fs, 5000, undefined, true);
  const mapped = new Map(
    rows
      .map((row): [string, string] | undefined => {
        const code = pickString(row, ['f12', 'code', 'symbol'])
          ?.replace(/^(sh|sz|bj)/i, '')
          .replace(/^\D+/, '');
        const industry = normalizeIndustryName(pickString(row, ['f100', 'industry']));
        return code && industry ? [code, industry] : undefined;
      })
      .filter((item): item is [string, string] => Boolean(item)),
  );
  eastmoneyIndustryCache.set(tab, { rows: mapped, updatedAt: Date.now() });
  return mapped;
}

async function loadEastmoneyIndustryMapForRows(rows: MarketQuoteRow[]): Promise<Map<string, string>> {
  const codes = rows.filter((row) => !normalizeIndustryName(row.industry)).map((row) => row.code);
  if (!codes.length) return new Map();
  const payloadRows = await fetchEastmoneyQuoteRowsByCodes(codes);
  return new Map(
    payloadRows
      .map((row): [string, string] | undefined => {
        const code = pickString(row, ['f12', 'code', 'symbol'])
          ?.replace(/^(sh|sz|bj)/i, '')
          .replace(/^\D+/, '');
        const industry = normalizeIndustryName(pickString(row, ['f100', 'industry']));
        return code && industry ? [code, industry] : undefined;
      })
      .filter((item): item is [string, string] => Boolean(item)),
  );
}

async function enrichMarketPageRows(rows: MarketQuoteRow[], tab: MarketTab): Promise<MarketQuoteRow[]> {
  if (!rows.length || rows.every((row) => normalizeIndustryName(row.industry))) return rows;
  const [localIndustryMap, eastmoneyIndustryMap, rowIndustryMap, boardIndustryMap] = await Promise.all([
    loadSecuritiesIndustryMap().catch(() => new Map<string, string>()),
    loadEastmoneyIndustryMap(tab).catch(() => new Map<string, string>()),
    loadEastmoneyIndustryMapForRows(rows).catch(() => new Map<string, string>()),
    loadBoardConstituentIndustryMap().catch(() => new Map<string, string>()),
  ]);
  return mergeMarketPageIndustries(rows, [rowIndustryMap, eastmoneyIndustryMap, localIndustryMap, boardIndustryMap]);
}

function mergeMarketPageIndustries(rows: MarketQuoteRow[], industryMaps: Array<Map<string, string>>): MarketQuoteRow[] {
  if (!industryMaps.some((map) => map.size)) return rows;
  let changed = false;
  const enriched = rows.map((row) => {
    const currentIndustry = normalizeIndustryName(row.industry);
    if (currentIndustry) {
      if (currentIndustry !== row.industry) changed = true;
      return currentIndustry === row.industry ? row : { ...row, industry: currentIndustry };
    }
    const industry = industryMaps.map((map) => map.get(row.code)).find((value): value is string => Boolean(value));
    if (!industry) return row;
    changed = true;
    return { ...row, industry };
  });
  return changed ? enriched : rows;
}

function hasMissingMarketPageIndustries(rows: MarketQuoteRow[]) {
  return rows.some((row) => !normalizeIndustryName(row.industry));
}

async function enrichMarketPageRowsFast(rows: MarketQuoteRow[], tab: MarketTab): Promise<MarketQuoteRow[]> {
  if (!rows.length || rows.every((row) => normalizeIndustryName(row.industry))) return rows;
  const [localIndustryMap, rowIndustryMap, eastmoneyIndustryMap] = await Promise.all([
    loadSecuritiesIndustryMap().catch(() => new Map<string, string>()),
    withTimeoutReject(
      loadEastmoneyIndustryMapForRows(rows),
      FAST_INDUSTRY_ENRICH_TIMEOUT_MS,
      '快速个股行业映射加载超时',
    ).catch(() => new Map<string, string>()),
    withTimeoutReject(loadEastmoneyIndustryMap(tab), FAST_INDUSTRY_ENRICH_TIMEOUT_MS, '快速行业映射加载超时').catch(
      () => new Map<string, string>(),
    ),
  ]);
  return mergeMarketPageIndustries(rows, [rowIndustryMap, eastmoneyIndustryMap, localIndustryMap]);
}

function scheduleMarketPageIndustryRefresh(snapshot: MarketPageSnapshot) {
  if (!hasMissingMarketPageIndustries(snapshot.rows)) return;
  const key = marketPageKey(snapshot.tab, snapshot.period ?? '1d');
  if (marketPageIndustryRefreshes.has(key)) return;
  const refreshing = enrichMarketPageRows(snapshot.rows, snapshot.tab)
    .then((rows) => {
      if (rows === snapshot.rows) return;
      const latest = marketPageCache.get(key)?.snapshot;
      const nextSnapshot: MarketPageSnapshot = {
        ...(latest ?? snapshot),
        rows: mergeByCode(latest?.rows ?? snapshot.rows, rows),
      };
      marketPageCache.set(key, { snapshot: nextSnapshot });
      marketPageEvents.emit('updated', nextSnapshot);
    })
    .catch((error) => console.warn('[market] industry refresh failed', error))
    .finally(() => {
      marketPageIndustryRefreshes.delete(key);
    });
  marketPageIndustryRefreshes.set(key, refreshing);
}

async function getMarketPageSnapshotCore(
  tab: MarketTab,
  period: MarketIndexPeriod = '1d',
): Promise<MarketPageSnapshot> {
  if (!shouldUseRemoteMarketData()) {
    const snapshot = getCachedMarketPageSnapshot(tab, period);
    if (!snapshot.rows.length || hasSparseQuoteRows(snapshot.rows))
      return getRemoteMarketPageSnapshot(tab, period)
        .then((remote) => {
          marketPageCache.set(marketPageKey(tab, period), { snapshot: remote });
          return remote.rows.length ? remote : snapshot;
        })
        .catch(() => {
          setTimeout(() => void hydrateLocalMarketPageSnapshot(tab, period), 0);
          return snapshot;
        });
    setTimeout(() => void hydrateLocalMarketPageSnapshot(tab, period), 0);
    return snapshot;
  }
  const snapshot = await getLocalMarketPageSnapshot(tab, period);
  if (!snapshot.rows.length || hasSparseQuoteRows(snapshot.rows))
    return getRemoteMarketPageSnapshot(tab, period)
      .then((remote) => {
        if (remote.rows.length) marketPageCache.set(marketPageKey(tab, period), { snapshot: remote });
        return remote.rows.length ? remote : snapshot;
      })
      .catch(() => snapshot);
  void refreshMarketPageSnapshot(tab, period).catch((error) =>
    console.warn('[market] background refresh failed', error),
  );
  return snapshot;
}

export async function getMarketPageSnapshot(
  tab: MarketTab,
  period: MarketIndexPeriod = '1d',
): Promise<MarketPageSnapshot> {
  const snapshot = await getMarketPageSnapshotCore(tab, period);
  const rows = await enrichMarketPageRowsFast(snapshot.rows, tab);
  const enrichedSnapshot = rows === snapshot.rows ? snapshot : { ...snapshot, rows };
  if (rows !== snapshot.rows) marketPageCache.set(marketPageKey(tab, period), { snapshot: enrichedSnapshot });
  scheduleMarketPageIndustryRefresh(enrichedSnapshot);
  return enrichedSnapshot;
}

function getCachedMarketPageSnapshot(tab: MarketTab, period: MarketIndexPeriod): MarketPageSnapshot {
  const cached = marketPageCache.get(marketPageKey(tab, period))?.snapshot;
  return {
    tab,
    period,
    updatedAt: cached?.updatedAt ?? new Date().toISOString(),
    indices: marketIndexCache.get(period)?.rows ?? cached?.indices ?? fallbackIndices(period),
    rows: cached?.rows?.length ? cached.rows : cachedQuoteRows(tab),
    boards: [],
  };
}

async function hydrateLocalMarketPageSnapshot(tab: MarketTab, period: MarketIndexPeriod) {
  const snapshot = await getLocalMarketPageSnapshot(tab, period).catch(() => getCachedMarketPageSnapshot(tab, period));
  const rows = await enrichMarketPageRowsFast(snapshot.rows, tab);
  const enrichedSnapshot = rows === snapshot.rows ? snapshot : { ...snapshot, rows };
  marketPageCache.set(marketPageKey(tab, period), { snapshot: enrichedSnapshot });
  scheduleMarketPageIndustryRefresh(enrichedSnapshot);
  marketPageEvents.emit('updated', enrichedSnapshot);
}

async function getLocalMarketIndices(period: MarketIndexPeriod): Promise<MarketIndexSnapshot[]> {
  const symbols = [
    { db: '000001', code: '000001', name: '上证指数' },
    { db: '399001', code: '399001', name: '深证成指' },
  ];
  const rows = await Promise.all(
    symbols.map(async (item) => {
      const bars = await listDailyBars(item.db, { limit: period === '1d' ? 120 : 60, adjustType: 'qfq' }).catch(
        () => [],
      );
      const minutes = bars.map((bar) => ({
        time: bar.tradeDate,
        timestamp: parseMarketTime(bar.tradeDate),
        open: bar.open,
        close: bar.close,
        high: bar.high,
        low: bar.low,
        volume: bar.volume,
        amount: bar.amount,
        change: bar.change,
        changePercent: bar.changePercent,
        turnoverRate: bar.turnoverRate,
      }));
      const latest = bars.at(-1);
      return latest
        ? {
            code: item.code,
            name: item.name,
            price: latest.close,
            change: latest.change,
            changePercent: latest.changePercent,
            open: latest.open,
            prevClose: latest.change === undefined ? undefined : Number((latest.close - latest.change).toFixed(2)),
            high: latest.high,
            low: latest.low,
            volume: latest.volume,
            amount: latest.amount,
            minutes,
          }
        : fallbackIndex(item.code, period);
    }),
  );
  if (rows.some((row) => row.minutes.length)) marketIndexCache.set(period, { rows });
  else void getCachedMarketIndices(period).then((indices) => emitIndexSnapshots(period, indices));
  return rows;
}

function emitIndexSnapshots(period: MarketIndexPeriod, indices: MarketIndexSnapshot[]) {
  for (const tab of tabsWithCachedSnapshots(period)) {
    const key = marketPageKey(tab, period);
    const cached = marketPageCache.get(key)?.snapshot ?? getCachedMarketPageSnapshot(tab, period);
    const snapshot = { ...cached, indices };
    marketPageCache.set(key, { snapshot });
    marketPageEvents.emit('updated', snapshot);
  }
}

function tabsWithCachedSnapshots(period: MarketIndexPeriod): MarketTab[] {
  const prefix = `:${period}`;
  return [...marketPageCache.keys()]
    .filter((key) => key.endsWith(prefix))
    .map((key) => key.slice(0, -prefix.length) as MarketTab);
}

async function getRemoteMarketPageSnapshot(tab: MarketTab, period: MarketIndexPeriod): Promise<MarketPageSnapshot> {
  const indices = await getMarketIndices(period)
    .then((fresh) => {
      if (fresh.length) marketIndexCache.set(period, { rows: fresh });
      return fresh;
    })
    .catch(() => []);
  const rows = await getRemoteMarketQuotes(tab);
  if (rows.length) upsertQuoteRows(rows, `market:${tab}`);
  return {
    tab,
    period,
    updatedAt: new Date().toISOString(),
    indices: indices.length ? indices : (marketIndexCache.get(period)?.rows ?? fallbackIndices(period)),
    rows,
    boards: [],
  };
}

async function getLocalMarketPageSnapshot(tab: MarketTab, period: MarketIndexPeriod): Promise<MarketPageSnapshot> {
  const cached = marketPageCache.get(marketPageKey(tab, period))?.snapshot;
  const localRows = (
    await listLatestMarketRows()
      .then((rows) => rows.map(toMarketQuoteRow))
      .catch(() => [])
  )
    .filter((row) => quoteMatchesTab(row.code, tab))
    .sort(
      (a, b) =>
        Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0) || String(a.code).localeCompare(String(b.code)),
    );
  const persistedRows = cachedQuoteRows(tab);
  const rows = localRows.length
    ? mergeQuoteRows(localRows, quoteCache.rows.length ? quoteCache.rows : getStoredQuoteRows())
    : cached?.rows?.length
      ? cached.rows
      : persistedRows;
  if (hasSparseQuoteRows(rows)) return getRemoteMarketPageSnapshot(tab, period);
  const indices = marketIndexCache.get(period)?.rows ?? cached?.indices ?? (await getLocalMarketIndices(period));
  return {
    tab,
    period,
    updatedAt: cached?.updatedAt ?? new Date().toISOString(),
    indices,
    rows,
    boards: [],
  };
}

async function refreshMarketPageSnapshot(tab: MarketTab, period: MarketIndexPeriod) {
  const key = marketPageKey(tab, period);
  const entry = marketPageCache.get(key) ?? {};
  if (entry.refreshing) return entry.refreshing;
  const refreshing = getRemoteMarketPageSnapshot(tab, period)
    .then(async (snapshot) => {
      const rows = await enrichMarketPageRowsFast(snapshot.rows, tab);
      const enrichedSnapshot = rows === snapshot.rows ? snapshot : { ...snapshot, rows };
      marketPageCache.set(key, { snapshot: enrichedSnapshot });
      scheduleMarketPageIndustryRefresh(enrichedSnapshot);
      marketPageEvents.emit('updated', enrichedSnapshot);
      return enrichedSnapshot;
    })
    .finally(() => {
      const latest = marketPageCache.get(key);
      if (latest?.refreshing === refreshing) marketPageCache.set(key, { snapshot: latest.snapshot });
    });
  marketPageCache.set(key, entry.snapshot ? { ...entry, refreshing } : { refreshing });
  return refreshing;
}

function marketPageKey(tab: MarketTab, period: MarketIndexPeriod) {
  return `${tab}:${period}`;
}

function cachedQuoteRows(tab: MarketTab) {
  const rows = quoteCache.rows.length ? quoteCache.rows : getStoredQuoteRows();
  return rows
    .filter((row) => quoteMatchesTab(row.code, tab))
    .sort(
      (a, b) =>
        Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0) || String(a.code).localeCompare(String(b.code)),
    );
}

let eastmoneyClistWarned = false;
const eastmoneyClistDisabledUntil = new Map<string, number>();

async function getRemoteMarketQuotes(tab: MarketTab): Promise<MarketQuoteRow[]> {
  const cachedRows = quoteCache.rows.filter((row) => quoteMatchesTab(row.code, tab));
  if (needsSpotQuotePatch(tab) && (!cachedRows.length || hasSparseQuoteRows(cachedRows))) {
    const rows = await fetchSpecialMarketQuoteRows([tab]).catch(() => []);
    if (rows.length) {
      quoteCache = { rows: mergeByCode(quoteCache.rows, rows), updatedAt: Date.now() };
      upsertQuoteRows(rows, `market:${tab}`);
    }
    return quoteCache.rows
      .filter((row) => quoteMatchesTab(row.code, tab))
      .sort(
        (a, b) =>
          Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0) || String(a.code).localeCompare(String(b.code)),
      );
  }
  const quotes = await refreshQuoteCache();
  return quotes
    .filter((row) => quoteMatchesTab(row.code, tab))
    .sort(
      (a, b) =>
        Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0) || String(a.code).localeCompare(String(b.code)),
    );
}

async function getMarketQuotes(tab: MarketTab): Promise<MarketQuoteRow[]> {
  const quotes = await getAllMarketQuoteRows();
  return quotes
    .filter((row) => quoteMatchesTab(row.code, tab))
    .sort(
      (a, b) =>
        Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0) || String(a.code).localeCompare(String(b.code)),
    );
}

async function getAllMarketQuoteRows(): Promise<MarketQuoteRow[]> {
  const local = await listLatestMarketRows()
    .then((rows) => rows.map(toMarketQuoteRow))
    .catch(() => []);
  if (local.length) {
    void refreshQuoteCache();
    return mergeQuoteRows(local, quoteCache.rows.length ? quoteCache.rows : getStoredQuoteRows());
  }
  if (quoteCache.rows.length) {
    void refreshQuoteCache();
    return quoteCache.rows;
  }
  const stored = getStoredQuoteRows();
  if (stored.length) {
    void refreshQuoteCache();
    return stored;
  }
  return refreshQuoteCache();
}

async function refreshQuoteCache() {
  if (quoteCache.promise) return quoteCache.promise;
  if (quoteCache.rows.length && Date.now() - quoteCache.updatedAt < 4_500) return quoteCache.rows;
  quoteCache.promise = fetchRemoteQuoteRows()
    .then((rows) => {
      quoteCache = { rows: mergeByCode(quoteCache.rows, rows), updatedAt: Date.now() };
      upsertQuoteRows(quoteCache.rows, 'stock-sdk');
      return quoteCache.rows;
    })
    .catch(() => quoteCache.rows)
    .finally(() => {
      quoteCache.promise = undefined;
    }) as Promise<MarketQuoteRow[]>;
  return quoteCache.promise;
}

async function fetchRemoteQuoteRows() {
  const sdkRows = await withTimeoutReject(
    (
      sdk as unknown as { quoteService: { getAllAShareQuotes(): Promise<unknown[]> } }
    ).quoteService.getAllAShareQuotes(),
    10_000,
    'Tencent quotes timeout',
  )
    .then((rows) =>
      mergeByCode(
        quoteCache.rows,
        (rows as AnyRecord[]).map(toMarketQuoteRow).filter((row) => row.code),
      ),
    )
    .catch(() => quoteCache.rows);
  const sparseTabs = (['sh-main', 'sz-main', 'bj', 'gem', 'star'] as const).filter((tab) =>
    hasSparseQuoteRows(sdkRows.filter((row) => quoteMatchesTab(row.code, tab))),
  );
  if (!sparseTabs.length) return sdkRows;

  const eastmoneyRows = await fetchSpecialMarketQuoteRows(sparseTabs).catch(() => []);
  return mergeByCode(sdkRows, eastmoneyRows);
}

async function fetchSpecialMarketQuoteRows(tabs: MarketTab[]) {
  const sdkRows = await Promise.all(tabs.map(fetchSdkMarketQuoteRows))
    .then((rows) => rows.flat())
    .catch(() => []);
  if (sdkRows.length && !hasSparseQuoteMetrics(sdkRows)) return sdkRows;
  return fetchEastmoneyQuoteRows(tabs);
}

async function fetchSdkMarketQuoteRows(tab: MarketTab) {
  const market = marketTabSdkMarket(tab);
  if (!market) return [];
  if (tab === 'sz-main') {
    const service = (
      sdk as unknown as {
        quoteService: {
          getAShareCodeList(options?: { market?: string }): Promise<string[]>;
          getAllQuotesByCodes(
            codes: string[],
            options?: { batchSize?: number; concurrency?: number },
          ): Promise<unknown[]>;
        };
      }
    ).quoteService;
    const codes = (
      await withTimeoutReject(service.getAShareCodeList({ market }), 5_000, `${market} code list timeout`)
    ).filter((code) => quoteMatchesTab(code.replace(/^(sh|sz|bj)/i, ''), tab));
    return withTimeoutReject(
      service.getAllQuotesByCodes(codes, { batchSize: 500, concurrency: 6 }),
      5_000,
      `${market} quotes timeout`,
    ).then((rows) => (rows as AnyRecord[]).map(toMarketQuoteRow).filter((row) => row.code));
  }
  return withTimeoutReject(
    (
      sdk as unknown as {
        quoteService: {
          getAllAShareQuotes(options?: {
            market?: string;
            batchSize?: number;
            concurrency?: number;
          }): Promise<unknown[]>;
        };
      }
    ).quoteService.getAllAShareQuotes({ market, batchSize: 500, concurrency: 6 }),
    5_000,
    `${market} quotes timeout`,
  ).then((rows) => (rows as AnyRecord[]).map(toMarketQuoteRow).filter((row) => row.code));
}

async function fetchEastmoneyQuoteRows(tabs: MarketTab[]) {
  const rows = await Promise.all(
    tabs.map(async (tab) => {
      const fs = marketTabFs(tab);
      if (!fs) return [];
      return fetchEastmoneyClist(fs, 5000).then((items) => items.map(toMarketQuoteRow).filter((row) => row.code));
    }),
  );
  if (rows.some((items) => items.length))
    warnEastmoneyFallback('quotes', new Error('stock-sdk sparse market quote metrics'));
  return rows.flat();
}

function marketTabFs(tab: MarketTab) {
  if (tab === 'sh-main') return 'm:1 t:2,m:1 t:1';
  if (tab === 'sz-main') return 'm:0 t:6,m:0 t:13';
  if (tab === 'bj') return 'm:0 t:81 s:2048';
  if (tab === 'gem') return 'm:0 t:80';
  if (tab === 'star') return 'm:1 t:23';
  return '';
}

function marketTabSdkMarket(tab: MarketTab) {
  if (tab === 'sh-main') return 'sh';
  if (tab === 'sz-main') return 'sz';
  if (tab === 'bj') return 'bj';
  if (tab === 'gem') return 'cy';
  if (tab === 'star') return 'kc';
  return undefined;
}

function needsSpotQuotePatch(_tab: MarketTab) {
  return true;
}

function mergeQuoteRows(local: MarketQuoteRow[], live: MarketQuoteRow[]) {
  if (!live.length) return local;
  return mergeByCode(local, live);
}

async function warmBoardDetailCache(rows: MarketBoardRow[]) {
  for (const row of rows) {
    const cached = await readBoardDetail(row.code).catch(() => undefined);
    if (cached?.detail.kline?.length && cached.detail.constituents?.length) continue;
    void getBoardDetail(row.code).catch(() => undefined);
    break;
  }
}

function quoteMatchesTab(code: string, tab: MarketTab) {
  if (tab === 'star') return code.startsWith('688');
  if (tab === 'gem') return code.startsWith('300') || code.startsWith('301');
  if (tab === 'bj') return code.startsWith('4') || code.startsWith('8') || code.startsWith('92');
  if (tab === 'sh-main') return code.startsWith('6') && !code.startsWith('688');
  if (tab === 'sz-main') return /^(000|001|002|003)/.test(code);
  return true;
}

function hasQuoteMetrics(row: MarketQuoteRow | MarketBoardRow) {
  return (
    hasValue(row.price) &&
    hasValue(row.changePercent) &&
    hasValue(row.turnoverRate) &&
    hasValue(row.volume) &&
    hasValue(row.amount)
  );
}

function hasSparseQuoteMetrics(rows: MarketQuoteRow[]) {
  return rows.length > 0 && rows.filter(hasQuoteMetrics).length / rows.length < 0.8;
}

function hasSparseQuoteRows(rows: MarketQuoteRow[]) {
  return hasSparseQuoteMetrics(rows) || rows.some((row) => !row.name || row.name === row.code);
}

async function getMarketIndices(period: MarketIndexPeriod): Promise<MarketIndexSnapshot[]> {
  const result = await Promise.all(['sh000001', 'sz399001'].map((code) => fetchMarketIndex(code, period)));
  return result.filter((item): item is MarketIndexSnapshot => Boolean(item));
}

function normalizeIndexSymbol(input: string): 'sh000001' | 'sz399001' | undefined {
  const text = input.trim().toLowerCase();
  if (text === '上证指数' || text === 'sh000001') return 'sh000001';
  if (text === '深证成指' || text === 'sz399001') return 'sz399001';
  return undefined;
}

function isIndexKlinePeriod(period: string): period is IndexKlinePeriod {
  return (
    period === '15m' || period === '1h' || period === '4h' || period === '1d' || period === '1w' || period === '1mo'
  );
}

async function getCachedMarketIndices(period: MarketIndexPeriod) {
  const entry = marketIndexCache.get(period) ?? {};
  if (entry.refreshing) return entry.refreshing;
  if (entry.rows?.length) return entry.rows;
  const refreshing = getMarketIndices(period)
    .then((rows) => {
      const merged = mergeByCode(entry.rows ?? [], rows);
      marketIndexCache.set(period, { rows: merged });
      return merged;
    })
    .catch(() => entry.rows ?? [])
    .finally(() => {
      const latest = marketIndexCache.get(period);
      if (latest?.refreshing === refreshing) marketIndexCache.set(period, { rows: latest.rows });
    }) as Promise<MarketIndexSnapshot[]>;
  marketIndexCache.set(period, { ...entry, refreshing });
  return refreshing;
}

async function fetchSdkBoardSeries(
  code: string,
  period: MarketIndexPeriod,
  name?: string,
  targets = getBoardDetailTargets(code, name),
): Promise<KlinePoint[]> {
  const limit = period === '4h' ? 80 : period === '1d' ? 120 : 60;
  const load = async (board: BoardApi, target: string) => {
    const rows =
      period === '1d'
        ? await withTimeoutReject(
            board.kline(target, { period: 'daily', adjust: 'qfq' }),
            BOARD_SDK_REQUEST_TIMEOUT,
            '板块K线加载超时',
          )
        : await withTimeoutReject(
            board.minuteKline(target, { period: period === '15m' ? '15' : '60' }),
            BOARD_SDK_REQUEST_TIMEOUT,
            '板块分钟K线加载超时',
          );
    const points = rows
      .map(toKlinePoint)
      .filter((point): point is KlinePoint => Boolean(point))
      .slice(-limit);
    return period === '4h' ? aggregateKline(points, 4) : points;
  };

  const apis = await getBoardApis(code, name);
  const kind = boardKindCache.get(code);

  // ponytail: kind unknown — try both APIs in parallel on first target
  if (!kind && targets.length) {
    const firstTarget = targets[0];
    const [industryRows, conceptRows] = await Promise.all([
      load(sdk.board.industry, firstTarget).catch(() => []),
      load(sdk.board.concept, firstTarget).catch(() => []),
    ]);
    const rows = industryRows.length ? industryRows : conceptRows;
    const discoveredKind: BoardKind = industryRows.length ? 'industry' : 'concept';
    if (rows.length) {
      boardKindCache.set(code, discoveredKind);
      return rows;
    }
    for (const target of targets.slice(1)) {
      for (const board of orderBoardApis(undefined)) {
        try {
          const result = await load(board, target);
          if (result.length) {
            boardKindCache.set(code, board === sdk.board.industry ? 'industry' : 'concept');
            return result;
          }
        } catch {
          /* try next */
        }
      }
    }
    return [];
  }

  for (const board of apis) {
    for (const target of targets) {
      try {
        const rows = await load(board, target);
        if (rows.length) return rows;
      } catch {
        // Try name/code and the other board namespace, then the real-data HTTP fallback.
      }
    }
  }
  return [];
}

async function fetchMarketIndex(
  code: string,
  period: IndexKlinePeriod,
  limit?: number,
  beforeTimestamp?: number,
): Promise<MarketIndexSnapshot | undefined> {
  try {
    const [quote, series] = await Promise.all([
      fetchIndexQuote(code),
      fetchIndexSeries(code, period, limit, beforeTimestamp),
    ]);
    return quote ? { ...quote, minutes: patchLatestIndexBar(series, quote) } : undefined;
  } catch {
    return undefined;
  }
}

async function fetchIndexQuote(code: string): Promise<Omit<MarketIndexSnapshot, 'minutes'> | undefined> {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${code}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(4_000),
    headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: 'https://gu.qq.com/' },
  });
  if (!response.ok) return undefined;
  const payload = (await response.json()) as { data?: Record<string, AnyRecord> };
  return toMarketIndexSnapshot(code, payload.data?.[code]);
}

async function fetchIndexSeries(code: string, period: IndexKlinePeriod, limit?: number, beforeTimestamp?: number) {
  if (period === '1d' || period === '1w' || period === '1mo')
    return fetchIndexHistorySeries(
      code,
      period,
      limit ?? (period === '1d' ? 120 : period === '1w' ? 240 : 120),
      beforeTimestamp,
    );
  const k = period === '15m' ? '15' : '60';
  const count = limit ?? (period === '4h' ? 80 : 60);
  const rows = await fetchIndexMinuteSeries(code, k, period === '4h' ? count * 4 : count, beforeTimestamp);
  return period === '4h' ? aggregateIndexSeries(rows, 4).slice(-count) : rows;
}

async function fetchIndexMinuteSeries(code: string, k: '15' | '60', limit: number, beforeTimestamp?: number) {
  const before = beforeTimestamp ? formatTencentMinuteTimestamp(beforeTimestamp) : '';
  const url = new URL('https://ifzq.gtimg.cn/appstock/app/kline/mkline');
  url.search = new URLSearchParams({ param: `${code},m${k},${before},${limit}` }).toString();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(4_000),
    headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: 'https://gu.qq.com/' },
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as { data?: Record<string, Record<string, unknown[]>> };
  return ((payload.data?.[code]?.[`m${k}`] ?? []) as unknown[])
    .map(parseIndexKlinePoint)
    .filter((item): item is NonNullable<ReturnType<typeof parseIndexKlinePoint>> => Boolean(item));
}

function formatTencentMinuteTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}${pick('month')}${pick('day')}${pick('hour')}${pick('minute')}`;
}

function aggregateIndexSeries(data: KlinePoint[], size: number) {
  return aggregateKline(data, size);
}

function patchLatestIndexBar(data: KlinePoint[], quote: Omit<MarketIndexSnapshot, 'minutes'>): KlinePoint[] {
  const latest = data.at(-1);
  if (!latest || typeof quote.price !== 'number') return data;
  return [
    ...data.slice(0, -1),
    {
      ...latest,
      close: quote.price,
      high: Math.max(latest.high, quote.price),
      low: Math.min(latest.low, quote.price),
      change: typeof quote.prevClose === 'number' ? Number((quote.price - quote.prevClose).toFixed(2)) : latest.change,
      changePercent:
        typeof quote.prevClose === 'number' && quote.prevClose
          ? Number((((quote.price - quote.prevClose) / quote.prevClose) * 100).toFixed(2))
          : latest.changePercent,
    },
  ];
}

async function fetchIndexHistorySeries(
  code: string,
  period: '1d' | '1w' | '1mo',
  limit = 120,
  beforeTimestamp?: number,
) {
  const type = period === '1w' ? 'week' : period === '1mo' ? 'month' : 'day';
  const url = new URL('https://ifzq.gtimg.cn/appstock/app/fqkline/get');
  const endDate = beforeTimestamp === undefined ? '' : formatTencentHistoryDate(beforeTimestamp);
  url.search = new URLSearchParams({ param: `${code},${type},,${endDate},${limit},qfq` }).toString();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(4_000),
    headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: 'https://gu.qq.com/' },
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as { data?: Record<string, Record<string, unknown[]>> };
  return (payload.data?.[code]?.[type] ?? [])
    .map(parseIndexKlinePoint)
    .filter((item): item is NonNullable<ReturnType<typeof parseIndexKlinePoint>> => Boolean(item));
}

function toMarketIndexSnapshot(code: string, raw?: AnyRecord): MarketIndexSnapshot | undefined {
  const qt = (raw?.qt as Record<string, unknown[]> | undefined)?.[code];
  if (!qt) return undefined;
  return {
    code: code.replace(/^(sh|sz)/, ''),
    name: String(qt[1] ?? code),
    price: Number(qt[3]),
    open: Number(qt[5]),
    prevClose: Number(qt[4]),
    volume: Number(qt[36]),
    amount: Number(qt[37]) * 10_000,
    change: Number(qt[31]),
    changePercent: Number(qt[32]),
    high: Number(qt[33]),
    low: Number(qt[34]),
    minutes: [],
  };
}

function parseIndexKlinePoint(row: unknown): KlinePoint | undefined {
  if (!Array.isArray(row)) return undefined;
  const [time, open, close, high, low, volume, , amount] = row;
  const point = {
    time: String(time ?? ''),
    timestamp: parseMarketTime(String(time ?? '')),
    open: Number(open),
    close: Number(close),
    high: Number(high),
    low: Number(low),
    volume: Number(volume),
    amount: amount === undefined ? undefined : Number(amount) * 10_000,
  };
  return [point.open, point.close, point.high, point.low].every(Number.isFinite) ? point : undefined;
}

function fallbackIndices(period: MarketIndexPeriod): MarketIndexSnapshot[] {
  return [fallbackIndex('sh000001', period), fallbackIndex('sz399001', period)];
}

function fallbackIndex(code: string, _period: MarketIndexPeriod): MarketIndexSnapshot {
  const symbol = code === '399001' || code === 'sz399001' ? '399001' : '000001';
  const name = symbol === '399001' ? '深证成指' : '上证指数';
  return { code: symbol, name, price: '--', change: '--', changePercent: '--', minutes: [] };
}

export { getStockFundFlowSnapshot } from './fund-flow.js';

export async function getChipDistribution(symbolInput: string): Promise<IChipDistributionResult> {
  const symbol = normalizeASymbol(symbolInput);
  const cached = chipDistributionCache.get(symbol);
  const now = Date.now();
  if (cached?.result && now - cached.updatedAt < CHIP_DISTRIBUTION_CACHE_TTL_MS) return cached.result;
  if (cached?.promise) return cached.promise;
  const promise = loadChipDistribution(symbol)
    .then((result) => {
      chipDistributionCache.set(symbol, { result, updatedAt: Date.now() });
      return result;
    })
    .catch((error: unknown) => {
      chipDistributionCache.delete(symbol);
      throw error;
    });
  chipDistributionCache.set(symbol, { result: cached?.result, updatedAt: cached?.updatedAt ?? 0, promise });
  return promise;
}

async function loadChipDistribution(symbol: string): Promise<IChipDistributionResult> {
  try {
    const rows = await sdk.chips.cn(symbol, { days: 360, range: 120, includeHistogram: 'all' });
    return chipRowsToResult(rows, 'stock-sdk');
  } catch (stockSdkError) {
    const stockSdkMessage = stockSdkError instanceof Error ? stockSdkError.message : String(stockSdkError);
    try {
      const klines = await getBaiduStockKline(symbol, 360);
      return calculateChipDistribution(klines, 'a-stock-data', [`stock-sdk 筹码数据获取失败：${stockSdkMessage}`]);
    } catch (fallbackError) {
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`筹码分布数据获取失败。stock-sdk：${stockSdkMessage}；a-stock-data 百度日 K：${fallbackMessage}`);
    }
  }
}

export async function analyzeTechnical(symbolInput: string): Promise<AgentResultCard> {
  const klines = await getKline(symbolInput, 140);
  return analyzeIndicators(klines);
}

export {
  listHotFocus,
  listDailyDragonTiger,
  listStockSurgeEvents,
  listEastmoneySurgeByDate,
  getBoardSnapshot,
} from './hot-focus.js';
export type { DailyDragonTigerItem } from './hot-focus.js';
