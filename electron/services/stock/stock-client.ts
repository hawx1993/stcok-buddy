import type {
  AgentResultCard,
  IChipDistributionResult,
  KlinePoint,
  MarketBoardRow,
  MarketQuoteRow,
  MarketSearchResult,
  StockDetail,
} from '../../../src/shared/types.js';
import { listDailyBars, upsertDailyBars } from '../market-data/market-data-store.js';
import type { AdjustType, DailyBarRecord } from '../market-data/types.js';
import { queryHistoricalBars, queryLatestQuote } from '../market-data/market-data-query.js';
import { formatMoney, formatNumber, formatPercent } from './format.js';
import {
  aggregateKline,
  getCachedMarketBoardRows,
  hasValue,
  marketBoardsCache,
  parseEastmoneyKline,
  parseMarketTime,
  searchBoardNameCache,
  toKlinePoint,
  withTimeoutReject,
  sdk,
} from './shared.js';
import type { IndexKlinePeriod } from './shared.js';

import { analyzeIndicators } from './indicators.js';
import { calculateChipDistribution, chipRowsToResult } from './chip-distribution.js';
import { getStoredQuoteRows } from './quote-store.js';
import { extractSymbolCandidate, normalizeASymbol, inferExchange, toQuoteSymbol } from './symbols.js';
import { getBoardDetail, getBaiduStockKline } from './board-detail.js';
import {
  getMarketPageSnapshot,
  onMarketPageSnapshotUpdated,
  refreshQuoteCache,
  getAllMarketQuoteRows,
} from './market-page.js';

export { getBoardDetail, getMarketPageSnapshot, onMarketPageSnapshotUpdated };
import {
  fetchMarketIndex,
  normalizeIndexSymbol,
  isIndexKlinePeriod,
  formatTencentMinuteTimestamp,
} from './market-indices.js';

const chipDistributionCache = new Map<
  string,
  { result?: IChipDistributionResult; updatedAt: number; promise?: Promise<IChipDistributionResult> }
>();
const CHIP_DISTRIBUTION_CACHE_TTL_MS = 5 * 60_000;

import { deriveStockRating, toStockDetail } from './stock-rating.js';

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
    if (!isIndexKlinePeriod(period)) return [];
    // Daily/weekly/monthly: persist to local DB for offline access
    if (period === '1d' || period === '1w' || period === '1mo') {
      return getCachedIndexKline(indexCode, period, limit, beforeTimestamp);
    }
    // Intraday (15m/1h/4h): remote-only, too granular for daily_bars table
    const snapshot = await fetchMarketIndex(indexCode, period, limit, beforeTimestamp);
    return (snapshot?.minutes ?? []).slice(-limit);
  }

  const symbol = normalizeASymbol(symbolInput);
  if (period === '1d') {
    // Remote-first (fastest path), fallback to DuckDB, persist remote data for offline
    let data = await fetchDailyKlineDirect(symbol, limit, beforeTimestamp);
    if (!data.length) {
      try {
        const result = await queryHistoricalBars(symbol, {
          limit,
          period: '1d',
          adjustType: 'qfq',
          ...(beforeTimestamp ? { endDate: timestampToDate(beforeTimestamp) } : {}),
        });
        data = result.data;
      } catch {
        /* DB also failed */
      }
    } else {
      // Cache remote data to DuckDB for offline access (fire-and-forget)
      persistDailyKlineToDb(symbol, data);
    }
    return data;
  }
  if (period === '1w' || period === '1mo') {
    const wmAdjust = (period === '1w' ? 'qfq_weekly' : 'qfq_monthly') as AdjustType;
    // Local DB first
    try {
      const cached = await listDailyBars(symbol, { limit, adjustType: wmAdjust });
      if (cached.length >= limit) return cached.map(dailyBarToKline);
    } catch { /* DB read failed, fall through to remote */ }
    // Fetch remote and persist
    try {
      const remote = await fetchWeeklyMonthlyRemote(symbol, period, limit, beforeTimestamp);
      if (remote.length) {
        const bars: DailyBarRecord[] = remote
          .filter((p) => p.time && /^\d{4}-?\d{2}-?\d{2}/.test(p.time))
          .map((p) => ({
            symbol,
            tradeDate: p.time.slice(0, 10),
            open: p.open,
            high: p.high,
            low: p.low,
            close: p.close,
            volume: p.volume,
            amount: p.amount,
            change: p.change,
            changePercent: p.changePercent,
            turnoverRate: p.turnoverRate,
            adjustType: wmAdjust,
            source: 'stock-sdk:tencent',
            fetchedAt: new Date().toISOString(),
          }));
        if (bars.length) upsertDailyBars(bars).catch((err) => console.warn('[stock-client] weekly/monthly persist failed', err));
        return remote;
      }
    } catch (err) {
      console.warn('[stock-client] weekly/monthly remote failed', err);
    }
    // Last resort: partial local data
    try {
      const cached = await listDailyBars(symbol, { limit, adjustType: wmAdjust });
      return cached.map(dailyBarToKline);
    } catch { return []; }
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

function timestampToDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function persistDailyKlineToDb(symbol: string, points: KlinePoint[]): void {
  const bars: DailyBarRecord[] = points
    .filter((p) => p.time && /^\d{4}-?\d{2}-?\d{2}/.test(p.time))
    .map((p) => ({
      symbol,
      tradeDate: p.time.slice(0, 10),
      open: p.open,
      high: p.high,
      low: p.low,
      close: p.close,
      volume: p.volume,
      amount: p.amount,
      change: p.change,
      changePercent: p.changePercent,
      turnoverRate: p.turnoverRate,
      adjustType: 'qfq' as AdjustType,
      source: 'stock-sdk:tencent',
      fetchedAt: new Date().toISOString(),
    }));
  if (bars.length) upsertDailyBars(bars).catch((err) => console.warn('[stock-client] daily kline persist failed', err));
}

function dailyBarToKline(bar: DailyBarRecord): KlinePoint {
  return {
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
  };
}

async function fetchWeeklyMonthlyRemote(
  symbol: string,
  period: '1w' | '1mo',
  limit: number,
  beforeTimestamp?: number,
): Promise<KlinePoint[]> {
  const tencent = await getTencentHistoryKline(symbol, limit, period, beforeTimestamp);
  if (tencent.length) return tencent;
  const data = await sdk.kline.cn(symbol, { period: toSdkKlinePeriod(period), adjust: 'qfq' as const });
  return data
    .slice(-limit)
    .map(toKlinePoint)
    .filter((p): p is KlinePoint => Boolean(p));
}

/** Cache index K-line to DuckDB so it's available offline. Reads local DB first, fetches remote on miss. */
async function getCachedIndexKline(
  indexCode: 'sh000001' | 'sz399001',
  period: IndexKlinePeriod,
  limit: number,
  beforeTimestamp?: number,
): Promise<KlinePoint[]> {
  const dbSymbol = indexCode.replace(/^(sh|sz)/, '');

  // Try local DB first
  try {
    const local = await listDailyBars(dbSymbol, { limit, adjustType: 'qfq' });
    if (local.length >= limit) {
      return local.map((bar) => ({
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
    }
  } catch {
    // DB read failed, continue to remote fetch
  }

  // Fetch from remote and persist
  try {
    const snapshot = await fetchMarketIndex(indexCode, period, limit, beforeTimestamp);
    if (snapshot?.minutes?.length) {
      // Persist to local DB for offline access (fire-and-forget, don't block UI)
      const bars: DailyBarRecord[] = snapshot.minutes
        .filter((p) => p.time && /^\d{4}-?\d{2}-?\d{2}/.test(p.time))
        .map((p) => ({
          symbol: dbSymbol,
          tradeDate: normalizeIndexDate(p.time),
          open: p.open,
          high: p.high,
          low: p.low,
          close: p.close,
          volume: p.volume,
          amount: p.amount,
          change: p.change,
          changePercent: p.changePercent,
          turnoverRate: p.turnoverRate,
          adjustType: 'qfq' as const,
          source: 'stock-sdk:tencent-index',
          fetchedAt: new Date().toISOString(),
        }));
      if (bars.length) {
        upsertDailyBars(bars).catch((err) =>
          console.warn('[market-data] index kline persist failed', err),
        );
      }
      return snapshot.minutes.slice(-limit);
    }
  } catch (err) {
    console.warn('[market-data] index kline remote fetch failed', err);
  }

  // Last resort: return whatever partial data is in local DB
  try {
    const local = await listDailyBars(dbSymbol, { limit, adjustType: 'qfq' });
    return local.map((bar) => ({
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
  } catch {
    return [];
  }
}

/** Normalize Tencent compact dates ("20240722") to ISO ("2024-07-22") for DuckDB DATE columns. */
function normalizeIndexDate(time: string): string {
  const compact = time.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(time)) return time;
  return time.slice(0, 10);
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

export { getStockFundFlowSnapshot } from './fund-flow.js';

export async function getChipDistribution(symbolInput: string): Promise<IChipDistributionResult> {
  const symbol = normalizeASymbol(symbolInput);
  const cached = chipDistributionCache.get(symbol);
  const now = Date.now();
  if (cached?.result && now - cached.updatedAt < CHIP_DISTRIBUTION_CACHE_TTL_MS) return cached.result;
  if (cached?.promise) return cached.promise;

  // Try DuckDB first
  const { getStockChip, upsertStockChip } = await import('../market-data/market-data-store.js');
  const dbResult = await getStockChip(symbol).catch(() => undefined);
  if (dbResult) {
    chipDistributionCache.set(symbol, { result: dbResult as IChipDistributionResult, updatedAt: Date.now() });
    return dbResult as IChipDistributionResult;
  }

  const promise = loadChipDistribution(symbol)
    .then(async (result) => {
      chipDistributionCache.set(symbol, { result, updatedAt: Date.now() });
      void upsertStockChip(symbol, result).catch((err) => console.warn('[chip] upsert failed', err));
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
  const result = await queryHistoricalBars(symbolInput, { limit: 140, adjustType: 'qfq' });
  return analyzeIndicators(result.data);
}

export {
  clearSurgeCache,
  listHotFocus,
  listDailyDragonTiger,
  listStockSurgeEvents,
  listEastmoneySurgeByDate,
  getBoardSnapshot,
} from './hot-focus.js';
export type { DailyDragonTigerItem } from './hot-focus.js';
