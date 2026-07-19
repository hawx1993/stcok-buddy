import { EventEmitter } from 'node:events';
import StockSDK from 'stock-sdk';
import type { AgentResultCard, BoardDetail, ChipDistribution, ChipPoint, HotFocusItem, HotFocusTab, IStockFundFlowSnapshot, KlinePoint, MarketBoardRow, MarketIndexPeriod, MarketIndexSnapshot, MarketPageSnapshot, MarketQuoteRow, MarketSearchResult, MarketTab, StockDetail } from '../../../src/shared/types.js';
import { getLatestDailyBar, listDailyBars, listLatestMarketRows, listSecurities, readBoardDetail, readBoardSnapshot, writeBoardDetail, writeBoardSnapshot } from '../market-data/market-data-store.js';
import { queryHistoricalBars, queryLatestQuote } from '../market-data/market-data-query.js';
import { remoteMarketStatus } from '../market-data/providers.js';
import { formatNumber, formatPercent, pickNumber, pickString } from './format.js';
import { analyzeIndicators } from './indicators.js';
import { getStoredQuoteRows, getStoredQuoteRowsByTab, upsertQuoteRows } from './quote-store.js';
import { extractSymbolCandidate, normalizeASymbol, inferExchange, toQuoteSymbol } from './symbols.js';

const sdk = new StockSDK({ timeout: 12_000, retry: { maxRetries: 1 } });
let quoteCache: { rows: MarketQuoteRow[]; updatedAt: number; promise?: Promise<MarketQuoteRow[]> } = { rows: [], updatedAt: 0 };
const marketPageEvents = new EventEmitter();
const marketPageCache = new Map<string, { snapshot?: MarketPageSnapshot; refreshing?: Promise<MarketPageSnapshot> }>();
const marketIndexCache = new Map<MarketIndexPeriod, { rows?: MarketIndexSnapshot[]; refreshing?: Promise<MarketIndexSnapshot[]> }>();
let marketBoardsCache: { rows: MarketBoardRow[]; updatedAt: number; promise?: Promise<MarketBoardRow[]>; loadedFromDb?: boolean } = { rows: [], updatedAt: 0 };
let marketBoardsLastPersistedAt = 0;
type BoardKind = 'industry' | 'concept';
type IndexKlinePeriod = MarketIndexPeriod | '1w' | '1mo';
type BoardApi = typeof sdk.board.industry;
const boardKindCache = new Map<string, BoardKind>();
const searchBoardNameCache = new Map<string, string>();
let boardApisLoadingPromise: Promise<void> | undefined;
const BOARD_DETAIL_TIMEOUT = 8_000;
const BOARD_SDK_REQUEST_TIMEOUT = 2_500;
const BOARD_SDK_OUTER_TIMEOUT = 7_000;
const BOARD_CONSTITUENT_SCAN_LIMIT = 2_400;
const BOARD_SCAN_CONCURRENCY = 32;
const BOARD_SCAN_BUDGET_MS = 5_500;

type AnyRecord = Record<string, unknown>;
type StockRating = NonNullable<StockDetail['rating']>;

function toStockDetail(raw: unknown, fallbackCode: string): StockDetail {
  const record = (raw ?? {}) as AnyRecord;
  const code = pickString(record, ['code', '代码', 'symbol', 'f12']) ?? fallbackCode;
  const name = pickString(record, ['name', '名称', 'f14']) ?? code;
  const price = pickNumber(record, ['price', '最新价', 'lastPrice', 'close', 'f2']);
  const changePercent = pickNumber(record, ['changePercent', '涨跌幅', 'pctChg', 'f3']);
  const change = pickNumber(record, ['change', '涨跌额', 'f4']);
  const volume = pickNumber(record, ['volume', '成交量', 'f5']);
  const turnover = pickNumber(record, ['turnover', '成交额', 'amount', 'f6']);
  const pe = pickNumber(record, ['pe', 'PE', '市盈率', 'f9']);
  const pb = pickNumber(record, ['pb', 'PB', '市净率', 'f23']);
  const marketCap = pickNumber(record, ['marketCap', 'totalMarketCap', '总市值', 'f20']);
  const open = pickNumber(record, ['open', '今开', '开盘价', 'f17']);
  const high = pickNumber(record, ['high', '最高', '最高价', 'f15']);
  const low = pickNumber(record, ['low', '最低', '最低价', 'f16']);
  const prevClose = pickNumber(record, ['prevClose', '昨收', '昨收价', 'f18']);
  const turnoverRate = pickNumber(record, ['turnoverRate', '换手率', 'f8']);

  return {
    code,
    name,
    exchange: inferExchange(code),
    price: price === undefined ? '--' : price,
    change: change === undefined ? '--' : `${change >= 0 ? '+' : ''}${formatNumber(change)}`,
    changePercent: changePercent === undefined ? '--' : formatPercent(changePercent),
    open: open === undefined ? '--' : formatNumber(open),
    high: high === undefined ? '--' : formatNumber(high),
    low: low === undefined ? '--' : formatNumber(low),
    prevClose: prevClose === undefined ? '--' : formatNumber(prevClose),
    pe: pe === undefined ? '--' : formatNumber(pe),
    pb: pb === undefined ? '--' : formatNumber(pb),
    marketCap: marketCap === undefined ? '--' : `${(marketCap / 100000000).toFixed(1)}亿`,
    volume: volume === undefined ? '--' : `${(volume / 10000).toFixed(1)}万手`,
    turnover: turnover === undefined ? '--' : `${(turnover / 100000000).toFixed(2)}亿`,
    turnoverRate: turnoverRate === undefined ? '--' : `${formatNumber(turnoverRate)}%`,
    rating: deriveStockRating({ pe, pb, changePercent, turnoverRate }),
    summary: `${name}（${code}）实时行情来自 stock-sdk。当前价格 ${price === undefined ? '--' : price}，涨跌幅 ${changePercent === undefined ? '--' : formatPercent(changePercent)}。`,
  };
}

function deriveStockRating(input: {
  quote?: StockDetail;
  technical?: AgentResultCard;
  previous?: StockRating;
  pe?: number;
  pb?: number;
  changePercent?: number;
  turnoverRate?: number;
}): StockRating {
  const pe = input.pe ?? numericValue(input.quote?.pe);
  const pb = input.pb ?? numericValue(input.quote?.pb);
  const changePercent = input.changePercent ?? numericValue(input.quote?.changePercent);
  const turnoverRate = input.turnoverRate ?? numericValue(input.quote?.turnoverRate);
  return {
    fundamental: pe !== undefined || pb !== undefined ? rateFundamental(pe, pb) : keepResolvedRating(input.previous?.fundamental) ?? '数据有限',
    valuation: pe !== undefined || pb !== undefined ? rateValuation(pe, pb) : keepResolvedRating(input.previous?.valuation) ?? '数据有限',
    tech: rateTechnical(input.technical, changePercent),
    risk: rateRisk(pe, changePercent, turnoverRate),
  };
}

function keepResolvedRating(value: string | undefined) {
  return value && !['待评估', '需核查', '待分析'].includes(value) ? value : undefined;
}

function rateFundamental(pe?: number, pb?: number) {
  if (pe !== undefined && pe < 0) return '盈利承压';
  if (pe !== undefined && pe <= 25 && (pb === undefined || pb <= 4)) return '盈利稳健';
  if (pe !== undefined && pe <= 60) return '盈利正常';
  if (pb !== undefined && pb > 8) return '资产溢价高';
  return '数据有限';
}

function rateValuation(pe?: number, pb?: number) {
  if (pe !== undefined && pe < 0) return '亏损估值';
  if (pe !== undefined && pe <= 20 && (pb === undefined || pb <= 3)) return '相对合理';
  if (pe !== undefined && pe <= 45 && (pb === undefined || pb <= 6)) return '估值适中';
  if ((pe !== undefined && pe > 60) || (pb !== undefined && pb > 8)) return '估值偏高';
  return '数据有限';
}

function rateTechnical(technical?: AgentResultCard, changePercent?: number) {
  const text = `${technical?.subtitle ?? ''} ${technical?.narrative ?? ''}`;
  if (/金叉|站上|上方/.test(text)) return '偏多';
  if (/死叉|低于|下方/.test(text)) return '偏弱';
  if (changePercent !== undefined && changePercent >= 5) return '强势';
  if (changePercent !== undefined && changePercent <= -5) return '承压';
  return '中性';
}

function rateRisk(pe?: number, changePercent?: number, turnoverRate?: number) {
  if ((changePercent !== undefined && Math.abs(changePercent) >= 9) || (turnoverRate !== undefined && turnoverRate >= 20)) return '高波动';
  if (turnoverRate !== undefined && turnoverRate >= 10) return '波动偏高';
  if (pe !== undefined && pe < 0) return '盈利风险';
  return '中性';
}

function numericValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const match = value.replaceAll(',', '').match(/[-+]?\d+(?:\.\d+)?/);
  const parsed = match ? Number(match[0]) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function resolveASymbol(input: string): Promise<string> {
  const candidate = extractSymbolCandidate(input);
  if (/^\d{6}$/.test(candidate)) return candidate;
  const result = (await sdk.search(candidate)).find((item: { code?: string; category?: string }) => item.category === 'stock' && item.code);
  return result?.code?.replace(/^\D+/, '') ?? normalizeASymbol(candidate);
}

export async function getQuote(symbolInput: string): Promise<StockDetail> {
  return (await queryLatestQuote(symbolInput)).data;
}

export async function getKline(symbolInput: string, limit = 120, period = '1d', beforeTimestamp?: number): Promise<KlinePoint[]> {
  const indexCode = normalizeIndexSymbol(symbolInput);
  if (indexCode) {
    const snapshot = isIndexKlinePeriod(period) ? await fetchMarketIndex(indexCode, period, limit, beforeTimestamp) : undefined;
    return (snapshot?.minutes ?? []).slice(-limit);
  }

  const symbol = normalizeASymbol(symbolInput);
  if (period === '1d') return (await queryHistoricalBars(symbol, { limit, period: '1d', adjustType: 'qfq' })).data;
  try {
    if (period === '15m') return getTencentMinuteKline(symbol, limit, '15');
    if (period === '1h') return getTencentMinuteKline(symbol, limit, '60');
    if (period === '4h') return aggregateKline(await getTencentMinuteKline(symbol, limit * 4, '60'), 4).slice(-limit);
    const tencent = await getTencentHistoryKline(symbol, limit, period);
    if (tencent.length) return tencent;
    const data = await sdk.kline.cn(symbol, { period: toSdkKlinePeriod(period), adjust: 'qfq' as const });
    return data.slice(-limit).map(toKlinePoint).filter((point): point is KlinePoint => Boolean(point));
  } catch {
    const klt = toEastmoneyKlt(period);
    try {
      return period === '4h' ? aggregateKline(await getEastmoneyKline(symbol, limit * 4, '60'), 4).slice(-limit) : getEastmoneyKline(symbol, limit, klt);
    } catch {
      return [];
    }
  }
}

function toSdkKlinePeriod(period: string): 'daily' | 'weekly' | 'monthly' {
  return period === '1w' ? 'weekly' : period === '1mo' ? 'monthly' : 'daily';
}

function toEastmoneyKlt(period: string) {
  return ({ '15m': '15', '1h': '60', '4h': '60', '1d': '101', '1w': '102', '1mo': '103' } as Record<string, string>)[period] ?? '101';
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
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://quote.eastmoney.com/' } });
    if (!response.ok) return [];
    const payload = await response.json() as { data?: { klines?: string[] } };
    return (payload.data?.klines ?? []).map(parseEastmoneyKline).filter((point): point is KlinePoint => Boolean(point));
  } catch {
    return [];
  }
}

async function getTencentHistoryKline(symbol: string, limit: number, period: string): Promise<KlinePoint[]> {
  const quoteSymbol = toQuoteSymbol(symbol);
  const type = period === '1w' ? 'week' : period === '1mo' ? 'month' : 'day';
  const key = `qfq${type}`;
  const url = new URL('https://ifzq.gtimg.cn/appstock/app/fqkline/get');
  url.search = new URLSearchParams({ param: `${quoteSymbol},${type},,,${limit},qfq` }).toString();
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: `https://gu.qq.com/${quoteSymbol}/gp` } });
    if (!response.ok) return [];
    const payload = await response.json() as { data?: Record<string, Record<string, unknown[]>> };
    const rows = payload.data?.[quoteSymbol]?.[key] ?? [];
    return rows.map(parseTencentKline).filter((point): point is KlinePoint => Boolean(point));
  } catch {
    return [];
  }
}

async function getTencentMinuteKline(symbol: string, limit: number, period: '15' | '60'): Promise<KlinePoint[]> {
  const quoteSymbol = toQuoteSymbol(symbol);
  const url = new URL('https://ifzq.gtimg.cn/appstock/app/kline/mkline');
  url.search = new URLSearchParams({ param: `${quoteSymbol},m${period},,${limit}` }).toString();
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: `https://gu.qq.com/${quoteSymbol}/gp` } });
    if (!response.ok) return [];
    const payload = await response.json() as { data?: Record<string, Record<string, unknown[]>> };
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

function aggregateKline(data: KlinePoint[], size: number): KlinePoint[] {
  const result: KlinePoint[] = [];
  for (let i = 0; i < data.length; i += size) {
    const chunk = data.slice(i, i + size);
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    if (!first || !last) continue;
    result.push({
      time: last.time,
      timestamp: last.timestamp,
      open: first.open,
      close: last.close,
      high: Math.max(...chunk.map((item) => item.high)),
      low: Math.min(...chunk.map((item) => item.low)),
      volume: chunk.reduce((sum, item) => sum + item.volume, 0),
      amount: chunk.reduce((sum, item) => sum + (item.amount ?? 0), 0),
      change: last.close - first.open,
      changePercent: first.open ? ((last.close - first.open) / first.open) * 100 : undefined,
      turnoverRate: chunk.reduce((sum, item) => sum + (item.turnoverRate ?? 0), 0),
      pe: last.pe,
    });
  }
  return result;
}

function parseEastmoneyKline(line: string): KlinePoint | undefined {
  const [time, open, close, high, low, volume, amount, amplitude, changePercent, change, turnoverRate] = line.split(',');
  const point = {
    time,
    timestamp: parseMarketTime(time),
    open: Number(open),
    close: Number(close),
    high: Number(high),
    low: Number(low),
    volume: Number(volume),
    amount: Number(amount),
    change: Number(change),
    changePercent: Number(changePercent),
    turnoverRate: Number(turnoverRate),
  };
  void amplitude;
  return [point.open, point.close, point.high, point.low].every(Number.isFinite) ? point : undefined;
}

function parseMarketTime(value: string): number | undefined {
  const text = String(value || '').trim();
  const minute = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (minute) return new Date(`${minute[1]}-${minute[2]}-${minute[3]}T${minute[4]}:${minute[5]}:00+08:00`).getTime();
  const day = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (day) return new Date(`${day[1]}-${day[2]}-${day[3]}T00:00:00+08:00`).getTime();
  const date = Date.parse(text.includes('T') ? text : `${text}T00:00:00+08:00`);
  return Number.isFinite(date) ? date : undefined;
}

function toKlinePoint(raw: unknown): KlinePoint | undefined {
  const record = (raw ?? {}) as AnyRecord;
  const open = pickNumber(record, ['open', '开盘价']);
  const close = pickNumber(record, ['close', 'price', '最新价', '收盘价']);
  const high = pickNumber(record, ['high', '最高价']) ?? close;
  const low = pickNumber(record, ['low', '最低价']) ?? close;
  if (open === undefined || close === undefined || high === undefined || low === undefined) return undefined;
  const time = pickString(record, ['date', 'time', '日期']) ?? '';
  return {
    time,
    timestamp: pickNumber(record, ['timestamp']) ?? parseMarketTime(time),
    open,
    close,
    high,
    low,
    volume: pickNumber(record, ['volume', '成交量']) ?? 0,
    amount: pickNumber(record, ['amount', '成交额']),
    change: pickNumber(record, ['change', '涨跌额']),
    changePercent: pickNumber(record, ['changePercent', '涨跌幅']),
    turnoverRate: pickNumber(record, ['turnoverRate', '换手率']),
    pe: pickNumber(record, ['pe', 'PE', '市盈率']),
  };
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
    withTimeoutReject(sdk.search(text), 900, 'search timeout').catch(() => []) as Promise<Array<{ code?: string; name?: string; category?: string; type?: string }>>,
    searchMarketBoards(q, text),
  ]);
  const fromSdk = sdkRows
    .filter((item) => item.code && item.name)
    .map((item) => {
      const isBoard = /board|industry|concept|板块|行业|概念/i.test(String(item.category ?? item.type ?? ''));
      const codeLooksLikeBoard = /^BK\d+/i.test(String(item.code ?? ''));
      const kind = isBoard || codeLooksLikeBoard ? 'board' as const : 'stock' as const;
      return { code: kind === 'board' ? String(item.code).toUpperCase() : normalizeSearchCode(item.code), name: item.name ?? '', kind };
    })
    .filter((item) => item.code.includes(q) || item.name.toLowerCase().includes(q) || item.code.replace(/^BK/i, '').includes(q));
  const stockRows = fromSdk.filter((item) => item.kind === 'stock');
  const sdkBoardRows = fromSdk.filter((item) => item.kind === 'board');
  const mergedBoardRows = dedupeSearchRows([...sdkBoardRows, ...boardRows]).slice(0, 20);
  const mergedStockRows = stockRows.length ? dedupeSearchRows(stockRows).slice(0, 50) : await searchFallbackStocks(text, q);
  const results = [...mergedBoardRows, ...mergedStockRows].slice(0, 50);
  if (results.length) return results;

  // ponytail: no results from SDK or cache — try raw Eastmoney board/fund search for pure numeric codes
  if (isPureNumeric) {
    const [eastmoneyBoards, eastmoneyFunds] = await Promise.all([
      searchEastmoneyBoards(text).catch(() => []),
      searchEastmoneyFunds(text).catch(() => []),
    ]);
    const fundRows = eastmoneyFunds.map((row) => ({ ...row, kind: 'stock' as const }));
    return [...eastmoneyBoards.map((row) => ({ ...row, kind: 'board' as const, minutes: [] as KlinePoint[] })), ...fundRows].slice(0, 50);
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
      return row.code.toLowerCase().includes(q) || bareCode.includes(bareQ) || bareQ.includes(bareCode) || row.name.toLowerCase().includes(q);
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
  return String(value ?? '').replace(/^(sh|sz|bj)/i, '').replace(/^\D+/, '');
}

async function searchEastmoneyBoards(query: string): Promise<MarketBoardRow[]> {
  const url = new URL('https://searchapi.eastmoney.com/api/suggest/get');
  url.search = new URLSearchParams({ input: query, type: '14' }).toString();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4_000), headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: 'https://www.eastmoney.com/' } });
    if (!response.ok) return [];
    const payload = await response.json() as { QuotationCodeTable?: { Data?: Array<{ Code?: string; Name?: string; Classify?: string }> } };
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
    const response = await fetch(url, { signal: AbortSignal.timeout(4_000), headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: 'https://www.eastmoney.com/' } });
    if (!response.ok) return [];
    const payload = await response.json() as { QuotationCodeTable?: { Data?: Array<{ Code?: string; Name?: string; Classify?: string }> } };
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
    const response = await fetch(url, { signal: AbortSignal.timeout(4_000), headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: 'https://www.eastmoney.com/' } });
    if (!response.ok) return [];
    const payload = await response.json() as { QuotationCodeTable?: { Data?: Array<{ Code?: string; Name?: string; Classify?: string }> } };
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

  const remote = await getRemoteStockDetail(symbolInput).catch((error: unknown) => {
    const code = normalizeASymbol(symbolInput);
    return {
      code,
      name: code,
      exchange: inferExchange(code),
      price: '--',
      changePercent: '--',
      summary: `暂时无法从 stock-sdk 获取 ${code} 的实时详情：${error instanceof Error ? error.message : '未知错误'}`,
    } satisfies StockDetail;
  });
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

  const detail = quote ? toStockDetail(quote, code) : {
    code,
    name: code,
    exchange: inferExchange(code),
    price: latest?.close ?? '--',
    change: latest?.change === undefined ? '--' : `${latest.change >= 0 ? '+' : ''}${formatNumber(latest.change)}`,
    changePercent: latest?.changePercent === undefined ? '--' : formatPercent(latest.changePercent),
    open: latest?.open === undefined ? '--' : formatNumber(latest.open),
    high: latest?.high === undefined ? '--' : formatNumber(latest.high),
    low: latest?.low === undefined ? '--' : formatNumber(latest.low),
    prevClose: latest?.change === undefined || latest?.close === undefined ? '--' : formatNumber(latest.close - latest.change),
    volume: latest?.volume === undefined ? '--' : `${(latest.volume / 10000).toFixed(1)}万手`,
    turnover: latest?.amount === undefined ? '--' : formatMoney(latest.amount),
    turnoverRate: latest?.turnoverRate === undefined ? '--' : `${formatNumber(latest.turnoverRate)}%`,
    rating: deriveStockRating({
      changePercent: latest?.changePercent,
      turnoverRate: latest?.turnoverRate,
    }),
    summary: latest ? `${code} 本地历史行情，最近交易日 ${latest.tradeDate}。` : undefined,
  } satisfies StockDetail;

  return {
    ...detail,
    open: hasValue(detail.open) ? detail.open : latest?.open,
    high: hasValue(detail.high) ? detail.high : latest?.high,
    low: hasValue(detail.low) ? detail.low : latest?.low,
    prevClose: hasValue(detail.prevClose) ? detail.prevClose : latest?.change === undefined || latest?.close === undefined ? detail.prevClose : formatNumber(latest.close - latest.change),
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
    if (detail.kline?.length || detail.constituents?.length) void writeBoardDetail({ detail, updatedAt: new Date().toISOString() });
    return detail;
  };

  if (forceRefresh) {
    const detail = await refreshRemote();
    if (!detail.kline?.length && !detail.constituents?.length) throw new Error('板块接口暂无数据');
    return detail;
  }

  const cached = await readBoardDetail(cacheKey).catch(() => undefined) ?? await readBoardDetail(symbol).catch(() => undefined);
  const cachedName = cached?.detail.name;
  // ponytail: timeout local scan — scanBoardMembership can run 8s+
  const localDetail = await withTimeoutReject(
    getLocalBoardDetail(cacheKey, cachedName ?? boardName),
    6_000,
    '本地板块详情加载超时',
  ).catch(() => undefined);
  if (cached?.detail.constituents?.length) {
    void refreshRemote().catch((error) => console.warn('[market] board detail background refresh failed', symbol, error instanceof Error ? error.message : error));
    return cached.detail;
  }

  if (localDetail?.constituents?.length) {
    void refreshRemote(localDetail).catch((error) => console.warn('[market] board detail background refresh failed', symbol, error instanceof Error ? error.message : error));
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
  const constituents = shouldUseRemoteMarketData() ? await enrichBoardConstituents(detail.constituents ?? []) : detail.constituents ?? [];
  const kline = detail.kline?.length ? detail.kline : constituents.length ? await aggregateRemoteBoardKline(constituents.map((row) => row.code)).catch(() => []) : [];
  return { ...detail, kline, constituents };
}

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== '' && value !== '--';
}

async function enrichBoardConstituents(rows: NonNullable<BoardDetail['constituents']>): Promise<NonNullable<BoardDetail['constituents']>> {
  if (!rows.length) return rows;
  const latestRows = await listLatestMarketRows().catch(() => []);
  const byCode = new Map(latestRows.map((row) => [row.code, row]));
  return rows.map((row) => {
    const latest = byCode.get(row.code);
    if (!latest) return row;
    return {
      ...row,
      price: latest.price ?? row.price ?? '--',
      changePercent: latest.changePercent === undefined ? row.changePercent ?? '--' : formatPercent(latest.changePercent),
      amount: latest.amount === undefined ? row.amount : formatMoney(latest.amount),
      turnover: latest.turnoverRate === undefined ? row.turnover : `${formatNumber(latest.turnoverRate)}%`,
    };
  });
}

async function getRemoteBoardDetail(symbol: string, skipLocalFallback = false, boardName?: string, precomputedLocal?: BoardDetail): Promise<BoardDetail> {
  const canonicalSymbol = normalizeBoardCode(symbol);

  // ponytail: use cached boards; fall back to remote only if cache is empty
  const boards = marketBoardsCache.rows.length
    ? marketBoardsCache.rows
    : await withTimeoutReject(getCachedMarketBoardRows(), BOARD_SDK_REQUEST_TIMEOUT, '板块列表加载超时').catch(() => []);
  const searchName = searchBoardNameCache.get(symbol) ?? searchBoardNameCache.get(canonicalSymbol);
  const board = boards.find((item) => item.code === canonicalSymbol || item.code === symbol || item.name === symbol || item.name === searchName || item.name === boardName) ?? { code: canonicalSymbol, name: searchName ?? boardName ?? symbol, changePercent: undefined };
  const targets = getBoardDetailTargets(canonicalSymbol, board.name, boards, symbol, boardName);
  // ponytail: longer outer timeout so SDK loop has time to try each target
  const [kline, sdkRows] = await Promise.all([
    withTimeoutReject(fetchSdkBoardSeries(board.code, '1d', board.name, targets), BOARD_SDK_OUTER_TIMEOUT, '板块K线加载超时').catch(() => []),
    withTimeoutReject(getSdkBoardConstituents(board.code, board.name, targets), BOARD_SDK_OUTER_TIMEOUT, '板块成分股加载超时').catch(() => []),
  ]);
  const fallbackRows = sdkRows.length ? [] : await firstBoardConstituentsFromTargets(targets).catch(() => []);
  const fallbackKline = kline.length ? [] : await firstBoardKlineFromTargets(targets).catch(() => []);
  const baseConstituents = (sdkRows.length ? sdkRows : fallbackRows).slice(0, 200);
  // ponytail: reuse precomputed local detail instead of re-running expensive scan
  const localDetail = skipLocalFallback ? undefined : precomputedLocal ?? await withTimeoutReject(
    getLocalBoardDetail(board.code),
    5_000,
    '本地板块详情加载超时',
  ).catch(() => undefined);
  const constituents = baseConstituents.length ? await enrichBoardConstituents(baseConstituents) : [];
  const mergedConstituents = constituents.length ? constituents : localDetail?.constituents ?? [];
  const mergedKline = kline.length ? kline : fallbackKline.length ? fallbackKline : localDetail?.kline ?? [];
  return {
    code: board.code,
    name: board.name,
    changePercent: board.changePercent === undefined ? localDetail?.changePercent ?? '--' : formatPercent(board.changePercent),
    kline: mergedKline,
    constituents: mergedConstituents,
  };
}

function getBoardDetailTargets(symbol: string, boardName?: string, boards = marketBoardsCache.rows, ...aliases: Array<string | undefined>): string[] {
  const canonicalSymbol = normalizeBoardCode(symbol);
  const selected = boards.find((item) => item.code === canonicalSymbol || item.code === symbol || item.name === symbol || item.name === boardName || aliases.includes(item.code) || aliases.includes(item.name));
  const normalized = normalizeBoardName(boardName ?? selected?.name ?? symbol);
  const siblings = normalized ? boards.filter((item) => normalizeBoardName(item.name) === normalized) : [];
  return [...new Set([
    selected?.code,
    selected?.name,
    canonicalSymbol,
    symbol,
    boardName,
    ...aliases,
    ...siblings.flatMap((item) => [item.code, item.name]),
  ].filter(Boolean))] as string[];
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
  const payload = await fetchFirstJson<{ data?: { klines?: string[] } }>([
    `https://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`,
    `https://7.push2his.eastmoney.com/api/qt/stock/kline/get?${params}`,
  ], 'https://quote.eastmoney.com/', 3_000);
  const rows = (payload.data?.klines ?? []).map(parseEastmoneyKline).filter((point): point is KlinePoint => Boolean(point));
  return period === '4h' ? aggregateKline(rows, 4) : rows;
}

async function fetchFirstJson<T>(urls: string[], referer: string, timeout = 12_000): Promise<T> {
  let lastError: unknown;
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: referer } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json() as T;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('a-stock-data board request failed');
}

async function aggregateRemoteBoardKline(codes: string[]): Promise<KlinePoint[]> {
  const topCodes = codes.slice(0, 20);
  const series = await Promise.all(topCodes.map((code) => listDailyBars(code, { limit: 120, adjustType: 'qfq' }).catch(() => [])));
  return averageKlineSeries(series.map((rows) => rows.map((row) => ({
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
  }))));
}

function averageKlineSeries(series: KlinePoint[][]): KlinePoint[] {
  const byDate = new Map<string, { open: number; close: number; high: number; low: number; volume: number; amount: number; count: number }>();
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
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([time, group]) => ({
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

async function getSdkBoardConstituents(symbol: string, boardName: string, targets = getBoardDetailTargets(symbol, boardName)): Promise<NonNullable<BoardDetail['constituents']>> {
  const apis = await getBoardApis(symbol, boardName);
  const kind = boardKindCache.get(symbol);

  // ponytail: kind unknown — try both APIs in parallel on first target to discover fast
  if (!kind && targets.length) {
    const firstTarget = targets[0];
    const [industryRows, conceptRows] = await Promise.all([
      withTimeoutReject(sdk.board.industry.constituents(firstTarget), BOARD_SDK_REQUEST_TIMEOUT, '行业成分股加载超时').catch(() => []),
      withTimeoutReject(sdk.board.concept.constituents(firstTarget), BOARD_SDK_REQUEST_TIMEOUT, '概念成分股加载超时').catch(() => []),
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
          const result = await withTimeoutReject(board.constituents(target), BOARD_SDK_REQUEST_TIMEOUT, '板块成分股加载超时');
          if (result.length) {
            const resultKind = board === sdk.board.industry ? 'industry' : 'concept';
            boardKindCache.set(symbol, resultKind);
            return result.map(toBoardConstituent);
          }
        } catch { /* try next */ }
      }
    }
    return [];
  }

  // ponytail: kind known — try preferred API first for each target
  for (const board of apis) {
    for (const target of targets) {
      try {
        const rows = await withTimeoutReject(board.constituents(target), BOARD_SDK_REQUEST_TIMEOUT, '板块成分股加载超时');
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

  const kind = boardKindCache.get(symbol)
    ?? (marketBoardsCache.rows.find((row) => row.code === symbol || row.name === boardName) as unknown as AnyRecord)?.kind as BoardKind | undefined;
  if (kind) boardKindCache.set(symbol, kind);
  return orderBoardApis(kind);
}

function orderBoardApis(kind?: BoardKind): BoardApi[] {
  return kind === 'concept' ? [sdk.board.concept, sdk.board.industry] : [sdk.board.industry, sdk.board.concept];
}

async function getEastmoneyBoardConstituents(symbol: string): Promise<NonNullable<BoardDetail['constituents']>> {
  if (!/^BK\d+/i.test(symbol)) return [];
  // ponytail: force=true bypasses rate-limit cooldown for user-initiated fetches; try primary then CDN
  for (const endpoint of ['https://push2.eastmoney.com/api/qt/clist/get', 'https://29.push2.eastmoney.com/api/qt/clist/get']) {
    try {
      const rows = await fetchEastmoneyClist(`b:${symbol}`, 500, endpoint, true);
      return rows.map((row) => toBoardConstituent(toMarketQuoteRow(row))).filter((row) => row.code && row.name);
    } catch { /* try next endpoint */ }
  }
  return [];
}

function toBoardConstituent(item: { code?: string; symbol?: string; name?: string; price?: unknown; changePercent?: unknown; amount?: unknown; turnover?: unknown; turnoverRate?: unknown }): NonNullable<BoardDetail['constituents']>[number] {
  const code = String(item.code ?? item.symbol ?? '').replace(/^(sh|sz|bj)/i, '').replace(/^\D+/, '');
  return {
    code,
    name: String(item.name ?? code),
    price: item.price === null || item.price === undefined ? '--' : formatNumber(item.price),
    changePercent: item.changePercent === null || item.changePercent === undefined ? '--' : formatPercent(item.changePercent),
    amount: item.amount === null || item.amount === undefined ? '--' : formatMoney(item.amount),
    turnover: item.turnoverRate === null || item.turnoverRate === undefined ? item.turnover === undefined ? '--' : String(item.turnover) : `${formatNumber(item.turnoverRate)}%`,
  };
}

async function getLocalBoardDetail(symbol: string, fallbackName?: string): Promise<BoardDetail> {
  const remoteBoard = marketBoardsCache.rows.find((item) => item.code === symbol);
  const searchName = searchBoardNameCache.get(symbol);
  const board = remoteBoard ?? { code: symbol, name: fallbackName ?? searchName ?? symbol, changePercent: undefined, minutes: [] };
  const rows = await getLocalBoardConstituents(board.name);
  const kline = await aggregateLocalBoardKline(rows.map((row) => row.code)).then((items) => items.length ? items : aggregateBaiduBoardKline(rows.map((row) => row.code))).catch(() => []);
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
  const industryByCode = new Map(securities.map((item) => [item.symbol, item.industry]).filter((item): item is [string, string] => Boolean(item[1])));
  const byIndustry = rows.filter((row) => {
    const industry = industryByCode.get(row.code);
    return industry && boardNamesMatch(industry, localName);
  });
  if (byIndustry.length) return byIndustry.sort((a, b) => Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0));

  const byMembership = await scanBoardMembership(boardName).catch(() => []);
  if (byMembership.length) return byMembership;
  return rows.filter((row) => boardNamesMatch(row.name, localName)).sort((a, b) => Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0));
}

async function scanBoardMembership(boardName: string): Promise<MarketQuoteRow[]> {
  const localName = normalizeBoardName(boardName);
  if (!localName) return [];
  const symbols = prioritizeBoardScanSymbols(await sdk.codes.cn({ simple: true }));
  const matched: string[] = [];
  const deadline = Date.now() + BOARD_SCAN_BUDGET_MS;
  for (let index = 0; index < Math.min(symbols.length, BOARD_CONSTITUENT_SCAN_LIMIT) && Date.now() < deadline; index += BOARD_SCAN_CONCURRENCY) {
    const batch = symbols.slice(index, index + BOARD_SCAN_CONCURRENCY);
    const results = await Promise.all(batch.map(async (code) => ({ code, boards: await getStockBoardMembership(code).catch(() => []) })));
    for (const result of results) {
      if (result.boards.some((item) => item.code === normalizeBoardCode(boardName) || boardNamesMatch(item.name, localName))) matched.push(result.code);
    }
    if (matched.length >= 200) break;
  }
  const quotes = matched.length ? await sdk.quotes.cn(matched).catch(() => []) : [];
  return quotes.map((quote) => toMarketQuoteRow({
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
  })).filter((row) => row.code && row.name).sort((a, b) => Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0));
}

function prioritizeBoardScanSymbols(symbols: string[]) {
  const main = symbols.filter((code) => /^(60|00|30|68)/.test(code));
  const rest = symbols.filter((code) => !/^(60|00|30|68)/.test(code));
  return [...main, ...rest];
}

async function getStockBoardMembership(code: string): Promise<Array<{ code: string; name: string }>> {
  const secid = `${code.startsWith('6') ? 1 : 0}.${code}`;
  const url = new URL('https://push2delay.eastmoney.com/api/qt/slist/get');
  url.search = new URLSearchParams({ fltt: '2', invt: '2', secid, spt: '3', pi: '0', pz: '200', po: '1', fields: 'f12,f14,f3,f128' }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(4_000), headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: 'https://quote.eastmoney.com/' } });
  if (!response.ok) return [];
  const payload = await response.json() as { data?: { diff?: AnyRecord[] | Record<string, AnyRecord> } };
  const diff = payload.data?.diff ?? [];
  const items = Array.isArray(diff) ? diff : Object.values(diff);
  return items.map((item) => ({ code: String(item.f12 ?? ''), name: String(item.f14 ?? '') })).filter((item) => item.code && item.name);
}

async function aggregateBaiduBoardKline(codes: string[]): Promise<KlinePoint[]> {
  const series = await Promise.all(codes.slice(0, 12).map((code) => getBaiduStockKline(code).catch(() => [])));
  return averageKlineSeries(series);
}

async function getBaiduStockKline(code: string): Promise<KlinePoint[]> {
  const url = new URL('https://finance.pae.baidu.com/selfselect/getstockquotation');
  url.search = new URLSearchParams({
    all: '1', isIndex: 'false', isBk: 'false', isBlock: 'false', isFutures: 'false', isStock: 'true',
    newFormat: '1', group: 'quotation_kline_ab', finClientType: 'pc', code, ktype: '1',
  }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000), headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Accept: 'application/vnd.finance-web.v1+json', Origin: 'https://gushitong.baidu.com', Referer: 'https://gushitong.baidu.com/' } });
  if (!response.ok) return [];
  const payload = await response.json() as { Result?: { newMarketData?: { keys?: string[]; marketData?: string } } };
  const keys = payload.Result?.newMarketData?.keys ?? [];
  const rows = payload.Result?.newMarketData?.marketData?.split(';').filter(Boolean) ?? [];
  return rows.map((line) => parseBaiduKline(line, keys)).filter((item): item is KlinePoint => Boolean(item)).slice(-120);
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
    turnoverRate: Number(at('turnover')) || undefined,
  };
  return [point.open, point.close, point.high, point.low].every(Number.isFinite) ? point : undefined;
}

async function aggregateLocalBoardKline(codes: string[]): Promise<KlinePoint[]> {
  const topCodes = codes.slice(0, 20);
  const series = await Promise.all(topCodes.map((code) => listDailyBars(code, { limit: 120, adjustType: 'qfq' }).catch(() => [])));
  const byDate = new Map<string, { open: number; close: number; high: number; low: number; volume: number; amount: number; count: number }>();
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
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([time, group]) => ({
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

export async function getMarketPageSnapshot(tab: MarketTab, period: MarketIndexPeriod = '1d'): Promise<MarketPageSnapshot> {
  if (!shouldUseRemoteMarketData()) {
    const snapshot = getCachedMarketPageSnapshot(tab, period);
    if (!snapshot.rows.length || hasSparseQuoteRows(snapshot.rows)) return getRemoteMarketPageSnapshot(tab, period).then((remote) => {
      marketPageCache.set(marketPageKey(tab, period), { snapshot: remote });
      return remote.rows.length ? remote : snapshot;
    }).catch(() => {
      setTimeout(() => void hydrateLocalMarketPageSnapshot(tab, period), 0);
      return snapshot;
    });
    setTimeout(() => void hydrateLocalMarketPageSnapshot(tab, period), 0);
    return snapshot;
  }
  const snapshot = await getLocalMarketPageSnapshot(tab, period);
  if (!snapshot.rows.length || hasSparseQuoteRows(snapshot.rows)) return getRemoteMarketPageSnapshot(tab, period).then((remote) => {
    if (remote.rows.length) marketPageCache.set(marketPageKey(tab, period), { snapshot: remote });
    return remote.rows.length ? remote : snapshot;
  }).catch(() => snapshot);
  void refreshMarketPageSnapshot(tab, period).catch((error) => console.warn('[market] background refresh failed', error));
  return snapshot;
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
  marketPageCache.set(marketPageKey(tab, period), { snapshot });
  marketPageEvents.emit('updated', snapshot);
}

async function getLocalMarketIndices(period: MarketIndexPeriod): Promise<MarketIndexSnapshot[]> {
  const symbols = [
    { db: '000001', code: '000001', name: '上证指数' },
    { db: '399001', code: '399001', name: '深证成指' },
  ];
  const rows = await Promise.all(symbols.map(async (item) => {
    const bars = await listDailyBars(item.db, { limit: period === '1d' ? 120 : 60, adjustType: 'qfq' }).catch(() => []);
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
    return latest ? {
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
    } : fallbackIndex(item.code, period);
  }));
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
  if (needsSpotQuotePatch(tab)) {
    const rows = await getRemoteMarketQuotes(tab);
    if (rows.length) upsertQuoteRows(rows, `market:${tab}`);
    return { tab, period, updatedAt: new Date().toISOString(), indices: marketIndexCache.get(period)?.rows ?? fallbackIndices(period), rows, boards: [] };
  }
  const [indices, rows] = await Promise.all([
    getCachedMarketIndices(period),
    getRemoteMarketQuotes(tab),
  ]);
  if (rows.length) upsertQuoteRows(rows, `market:${tab}`);
  return { tab, period, updatedAt: new Date().toISOString(), indices, rows, boards: [] };
}

async function getLocalMarketPageSnapshot(tab: MarketTab, period: MarketIndexPeriod): Promise<MarketPageSnapshot> {
  const cached = marketPageCache.get(marketPageKey(tab, period))?.snapshot;
  const localRows = (await listLatestMarketRows().then((rows) => rows.map(toMarketQuoteRow)).catch(() => []))
    .filter((row) => quoteMatchesTab(row.code, tab))
    .sort((a, b) => Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0));
  const persistedRows = cachedQuoteRows(tab);
  const rows = localRows.length ? mergeQuoteRows(localRows, quoteCache.rows.length ? quoteCache.rows : getStoredQuoteRows()) : cached?.rows?.length ? cached.rows : persistedRows;
  if (hasSparseQuoteRows(rows)) return getRemoteMarketPageSnapshot(tab, period);
  const indices = marketIndexCache.get(period)?.rows ?? cached?.indices ?? await getLocalMarketIndices(period);
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
  const refreshing = getRemoteMarketPageSnapshot(tab, period).then((snapshot) => {
    marketPageCache.set(key, { snapshot });
    marketPageEvents.emit('updated', snapshot);
    return snapshot;
  }).finally(() => {
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
  return rows.filter((row) => quoteMatchesTab(row.code, tab));
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
    return quoteCache.rows.filter((row) => quoteMatchesTab(row.code, tab)).sort((a, b) => Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0));
  }
  const quotes = await refreshQuoteCache();
  return quotes.filter((row) => quoteMatchesTab(row.code, tab)).sort((a, b) => Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0));
}

async function getMarketQuotes(tab: MarketTab): Promise<MarketQuoteRow[]> {
  const quotes = await getAllMarketQuoteRows();
  return quotes.filter((row) => quoteMatchesTab(row.code, tab)).sort((a, b) => Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0));
}

async function getAllMarketQuoteRows(): Promise<MarketQuoteRow[]> {
  const local = await listLatestMarketRows().then((rows) => rows.map(toMarketQuoteRow)).catch(() => []);
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
    .finally(() => { quoteCache.promise = undefined; }) as Promise<MarketQuoteRow[]>;
  return quoteCache.promise;
}

async function fetchRemoteQuoteRows() {
  const sdkRows = await withTimeoutReject((sdk as unknown as { quoteService: { getAllAShareQuotes(): Promise<unknown[]> } }).quoteService.getAllAShareQuotes(), 10_000, 'Tencent quotes timeout')
    .then((rows) => mergeByCode(quoteCache.rows, (rows as AnyRecord[]).map(toMarketQuoteRow).filter((row) => row.code)))
    .catch(() => quoteCache.rows);
  const sparseTabs = (['sh-main', 'sz-main', 'bj', 'gem', 'star'] as const).filter((tab) => hasSparseQuoteRows(sdkRows.filter((row) => quoteMatchesTab(row.code, tab))));
  if (!sparseTabs.length) return sdkRows;

  const eastmoneyRows = await fetchSpecialMarketQuoteRows(sparseTabs).catch(() => []);
  return mergeByCode(sdkRows, eastmoneyRows);
}

async function fetchSpecialMarketQuoteRows(tabs: MarketTab[]) {
  const sdkRows = await Promise.all(tabs.map(fetchSdkMarketQuoteRows)).then((rows) => rows.flat()).catch(() => []);
  if (sdkRows.length && !hasSparseQuoteMetrics(sdkRows)) return sdkRows;
  return fetchEastmoneyQuoteRows(tabs);
}

async function fetchSdkMarketQuoteRows(tab: MarketTab) {
  const market = marketTabSdkMarket(tab);
  if (!market) return [];
  if (tab === 'sz-main') {
    const service = (sdk as unknown as {
      quoteService: {
        getAShareCodeList(options?: { market?: string }): Promise<string[]>;
        getAllQuotesByCodes(codes: string[], options?: { batchSize?: number; concurrency?: number }): Promise<unknown[]>;
      };
    }).quoteService;
    const codes = (await withTimeoutReject(service.getAShareCodeList({ market }), 5_000, `${market} code list timeout`)).filter((code) => quoteMatchesTab(code.replace(/^(sh|sz|bj)/i, ''), tab));
    return withTimeoutReject(service.getAllQuotesByCodes(codes, { batchSize: 500, concurrency: 6 }), 5_000, `${market} quotes timeout`)
      .then((rows) => (rows as AnyRecord[]).map(toMarketQuoteRow).filter((row) => row.code));
  }
  return withTimeoutReject((sdk as unknown as { quoteService: { getAllAShareQuotes(options?: { market?: string; batchSize?: number; concurrency?: number }): Promise<unknown[]> } }).quoteService.getAllAShareQuotes({ market, batchSize: 500, concurrency: 6 }), 5_000, `${market} quotes timeout`)
    .then((rows) => (rows as AnyRecord[]).map(toMarketQuoteRow).filter((row) => row.code));
}

async function fetchEastmoneyQuoteRows(tabs: MarketTab[]) {
  const rows = await Promise.all(tabs.map(async (tab) => {
    const fs = marketTabFs(tab);
    if (!fs) return [];
    return fetchEastmoneyClist(fs, 5000).then((items) => items.map(toMarketQuoteRow).filter((row) => row.code));
  }));
  if (rows.some((items) => items.length)) warnEastmoneyFallback('quotes', new Error('stock-sdk sparse market quote metrics'));
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

function mergeByCode<T extends { code: string }>(current: T[], incoming: T[]) {
  const byCode = new Map(current.map((row) => [row.code, row]));
  for (const row of incoming) byCode.set(row.code, { ...byCode.get(row.code), ...compactRow(row) } as T);
  return [...byCode.values()];
}

function compactRow<T extends object>(row: T) {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== null && value !== '';
  })) as Partial<T>;
}

async function warmBoardDetailCache(rows: MarketBoardRow[]) {
  for (const row of rows) {
    const cached = await readBoardDetail(row.code).catch(() => undefined);
    if (cached?.detail.kline?.length && cached.detail.constituents?.length) continue;
    void getBoardDetail(row.code).catch(() => undefined);
    break;
  }
}

async function getCachedMarketBoardRows(allowRemote = true): Promise<MarketBoardRow[]> {
  if (allowRemote && shouldUseRemoteMarketData()) {
    const live = await refreshMarketBoardRows().catch(() => []);
    if (live.length) return live;
  }
  if (marketBoardsCache.rows.length) return marketBoardsCache.rows;
  const disk = await readBoardSnapshot().catch(() => undefined);
  if (disk?.rows.length) {
    marketBoardsCache = { rows: disk.rows, updatedAt: Date.parse(disk.updatedAt) || Date.now(), loadedFromDb: true };
    return marketBoardsCache.rows;
  }
  return [];
}

async function refreshMarketBoardRows(): Promise<MarketBoardRow[]> {
  if (marketBoardsCache.promise) return marketBoardsCache.promise;
  marketBoardsCache.promise = getRemoteMarketBoardRows()
    .then((rows) => {
      if (rows.length) {
        const merged = mergeByCode(marketBoardsCache.rows, rows);
        marketBoardsCache = { rows: merged, updatedAt: Date.now(), loadedFromDb: false };
        if (Date.now() - marketBoardsLastPersistedAt >= 30_000) void persistMarketBoardRows(merged);
      }
      return marketBoardsCache.rows;
    })
    .catch(() => marketBoardsCache.rows)
    .finally(() => { marketBoardsCache.promise = undefined; }) as Promise<MarketBoardRow[]>;
  return marketBoardsCache.promise;
}

async function persistMarketBoardRows(rows: MarketBoardRow[]) {
  marketBoardsLastPersistedAt = Date.now();
  await writeBoardSnapshot({ rows, updatedAt: new Date().toISOString() }).catch((error) => console.warn('[market] persist board snapshot failed', error));
}

function shouldUseRemoteMarketData() {
  const status = remoteMarketStatus();
  return status === 'open' || status === 'pre_market' || status === 'lunch_break';
}

async function getRemoteMarketBoardRows(): Promise<MarketBoardRow[]> {
  const sdkRows = await getSdkMarketBoardRows();
  if (sdkRows.length) return sdkRows;
  warnEastmoneyFallback('boards', new Error('stock-sdk board.list empty'));
  return fetchEastmoneyBoardRows();
}

async function fetchEastmoneyBoardRows(): Promise<MarketBoardRow[]> {
  const [industries, concepts] = await Promise.allSettled([
    fetchEastmoneyClist('m:90 t:2 f:!50', 200, 'https://29.push2.eastmoney.com/api/qt/clist/get'),
    fetchEastmoneyClist('m:90 t:3 f:!50', 200, 'https://29.push2.eastmoney.com/api/qt/clist/get'),
  ]);
  const rows = [
    ...(industries.status === 'fulfilled' ? industries.value.map((row) => ({ ...row, kind: 'industry' })) : []),
    ...(concepts.status === 'fulfilled' ? concepts.value.map((row) => ({ ...row, kind: 'concept' })) : []),
  ].map(toMarketBoardRow).filter((row) => row.code && row.name);
  return rows;
}

async function getSdkMarketBoardRows(kinds: BoardKind[] = ['industry', 'concept']): Promise<MarketBoardRow[]> {
  const [industries, concepts] = await Promise.allSettled([
    kinds.includes('industry') ? withTimeoutReject(sdk.board.industry.list(), 5_000, 'industry boards timeout') : Promise.resolve([]),
    kinds.includes('concept') ? withTimeoutReject(sdk.board.concept.list(), 5_000, 'concept boards timeout') : Promise.resolve([]),
  ]);
  const industryRows = industries.status === 'fulfilled' ? industries.value : [];
  const conceptRows = concepts.status === 'fulfilled' ? concepts.value : [];
  for (const item of industryRows) boardKindCache.set(item.code, 'industry');
  for (const item of conceptRows) boardKindCache.set(item.code, 'concept');
  const rows = [
    ...industryRows.map((row) => ({ ...row, kind: 'industry' })),
    ...conceptRows.map((row) => ({ ...row, kind: 'concept' })),
  ].map(toMarketBoardRow).filter((row) => row.code && row.name);
  return enrichBoardSpotRows(rows);
}

async function enrichBoardSpotRows(rows: MarketBoardRow[]): Promise<MarketBoardRow[]> {
  const result = [...rows];
  for (let start = 0; start < result.length; start += 8) {
    const updates = await Promise.all(result.slice(start, start + 8).map(async (row) => {
      if (row.volume !== undefined && row.amount !== undefined) return row;
      for (const board of orderBoardApis(boardKindCache.get(row.code))) {
        try {
          const spot = await board.spot(row.code);
          const metrics = Object.fromEntries(spot.map((item) => [item.item, item.value]));
          const volume = Number(metrics['成交量']);
          const amount = Number(metrics['成交额']);
          if (Number.isFinite(volume) || Number.isFinite(amount)) return {
            ...row,
            volume: Number.isFinite(volume) ? volume : row.volume,
            amount: Number.isFinite(amount) ? amount : row.amount,
          };
        } catch {
          // Try the other board namespace; keep missing values explicit if both fail.
        }
      }
      return row;
    }));
    updates.forEach((row, index) => { result[start + index] = row; });
  }
  return result;
}

function normalizeBoardName(name: string) {
  return name.replace(/行业|板块|Ⅱ|Ⅲ|II|III|\s/g, '');
}

function boardNamesMatch(industry: string, boardName: string) {
  const local = normalizeBoardName(industry);
  return local === boardName || local.includes(boardName) || boardName.includes(local);
}

async function fetchEastmoneyClist(fs: string, pageSize = 10000, endpoint = 'https://push2.eastmoney.com/api/qt/clist/get', force = false): Promise<AnyRecord[]> {
  if (!force && Date.now() < (eastmoneyClistDisabledUntil.get(endpoint) ?? 0)) throw new Error('东财行情临时不可用，使用备用源');
  const url = new URL(endpoint);
  url.search = new URLSearchParams({
    pn: '1',
    pz: String(pageSize),
    po: '1',
    np: '1',
    fltt: '2',
    invt: '2',
    fs,
    fields: 'f2,f3,f4,f5,f6,f8,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23,f104,f105,f128,f136,f140',
  }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: 'https://quote.eastmoney.com/' } });
  if (!response.ok) {
    if (response.status === 502 || response.status === 403 || response.status === 429) eastmoneyClistDisabledUntil.set(endpoint, Date.now() + 30_000);
    throw new Error(`东财行情 HTTP ${response.status}`);
  }
  const payload = await response.json() as { data?: { diff?: AnyRecord[] | Record<string, AnyRecord> } };
  const diff = payload.data?.diff ?? [];
  return Array.isArray(diff) ? diff : Object.values(diff);
}

function warnEastmoneyFallback(scope: string, error: unknown) {
  if (eastmoneyClistWarned) return;
  eastmoneyClistWarned = true;
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[market] eastmoney ${scope} unavailable (${message}); fallback enabled for 5 minutes`);
}

function withTimeoutReject<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

function quoteMatchesTab(code: string, tab: MarketTab) {
  if (tab === 'star') return code.startsWith('688');
  if (tab === 'gem') return code.startsWith('300') || code.startsWith('301');
  if (tab === 'bj') return code.startsWith('4') || code.startsWith('8') || code.startsWith('92');
  if (tab === 'sh-main') return code.startsWith('6') && !code.startsWith('688');
  if (tab === 'sz-main') return /^(000|001|002|003)/.test(code);
  return true;
}

function toMarketQuoteRow(row: AnyRecord): MarketQuoteRow {
  const code = pickString(row, ['f12', 'code', 'symbol'])?.replace(/^(sh|sz|bj)/i, '').replace(/^\D+/, '') ?? '';
  const name = pickStockName(row, code);
  return {
    code,
    name,
    price: pickNumber(row, ['f2', 'price', 'latestPrice', 'lastPrice', 'close']),
    changePercent: pickNumber(row, ['f3', 'changePercent', 'pctChg', 'pctChange', 'change_rate']),
    volume: pickNumber(row, ['f5', 'volume', 'volume2']),
    amount: normalizeAmount(pickNumber(row, ['f6', 'amount', 'turnover'])),
    open: pickNumber(row, ['f17', 'open']),
    high: pickNumber(row, ['f15', 'high']),
    low: pickNumber(row, ['f16', 'low']),
    prevClose: pickNumber(row, ['f18', 'prevClose']),
    turnoverRate: pickNumber(row, ['f8', 'turnoverRate']),
    marketCap: normalizeMarketCap(pickNumber(row, ['f20', 'totalMarketCap', 'marketCap'])),
  };
}

function pickStockName(row: AnyRecord, code: string) {
  const name = pickString(row, ['f14', 'name', '名称']);
  return name && !/^\d{6}$/.test(name) ? name : code;
}

function normalizeAmount(value?: number) {
  return value !== undefined && Math.abs(value) < 1_000_000 ? value * 10_000 : value;
}

function normalizeMarketCap(value?: number) {
  return value !== undefined && value < 100_000 ? value * 100_000_000 : value;
}

function hasQuoteMetrics(row: MarketQuoteRow | MarketBoardRow) {
  return hasValue(row.price) && hasValue(row.changePercent) && hasValue(row.turnoverRate) && hasValue(row.volume) && hasValue(row.amount);
}

function hasSparseQuoteMetrics(rows: MarketQuoteRow[]) {
  return rows.length > 0 && rows.filter(hasQuoteMetrics).length / rows.length < 0.8;
}

function hasSparseQuoteRows(rows: MarketQuoteRow[]) {
  return hasSparseQuoteMetrics(rows) || rows.some((row) => !row.name || row.name === row.code);
}

function toMarketBoardRow(row: AnyRecord): MarketBoardRow {
  const rawCode = pickString(row, ['f12', 'code', 'boardCode', 'symbol']) ?? '';
  const code = /^BK\d+$/i.test(rawCode) ? rawCode.toUpperCase() : rawCode.replace(/^(sh|sz|bj)/i, '').replace(/^\D+/, '');
  const name = pickString(row, ['f14', 'name', 'boardName', '名称']) ?? code;
  const kind = row.kind === 'concept' || row.kind === 'industry' ? row.kind : undefined;
  if (kind && code) boardKindCache.set(code, kind);
  return {
    code,
    name,
    price: pickNumber(row, ['f2', 'price', 'latestPrice', 'lastPrice', 'close']),
    changePercent: pickNumber(row, ['f3', 'changePercent', 'pctChg', 'pctChange', 'change_rate']),
    volume: pickNumber(row, ['f5', 'volume']),
    amount: pickNumber(row, ['f6', 'amount', 'turnover']),
    marketCap: pickNumber(row, ['f20', 'totalMarketCap', 'marketCap']),
    turnoverRate: pickNumber(row, ['f8', 'turnoverRate']),
    minutes: [],
  };
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
  return period === '15m' || period === '1h' || period === '4h' || period === '1d' || period === '1w' || period === '1mo';
}

async function getCachedMarketIndices(period: MarketIndexPeriod) {
  const entry = marketIndexCache.get(period) ?? {};
  if (entry.refreshing) return entry.refreshing;
  if (entry.rows?.length) return entry.rows;
  const refreshing = getMarketIndices(period).then((rows) => {
    const merged = mergeByCode(entry.rows ?? [], rows);
    marketIndexCache.set(period, { rows: merged });
    return merged;
  }).catch(() => entry.rows ?? []).finally(() => {
    const latest = marketIndexCache.get(period);
    if (latest?.refreshing === refreshing) marketIndexCache.set(period, { rows: latest.rows });
  }) as Promise<MarketIndexSnapshot[]>;
  marketIndexCache.set(period, { ...entry, refreshing });
  return refreshing;
}

async function fetchSdkBoardSeries(code: string, period: MarketIndexPeriod, name?: string, targets = getBoardDetailTargets(code, name)): Promise<KlinePoint[]> {
  const limit = period === '4h' ? 80 : period === '1d' ? 120 : 60;
  const load = async (board: BoardApi, target: string) => {
    const rows = period === '1d'
      ? await withTimeoutReject(board.kline(target, { period: 'daily', adjust: 'qfq' }), BOARD_SDK_REQUEST_TIMEOUT, '板块K线加载超时')
      : await withTimeoutReject(board.minuteKline(target, { period: period === '15m' ? '15' : '60' }), BOARD_SDK_REQUEST_TIMEOUT, '板块分钟K线加载超时');
    const points = rows.map(toKlinePoint).filter((point): point is KlinePoint => Boolean(point)).slice(-limit);
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
        } catch { /* try next */ }
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

async function fetchEastmoneyBoardSeries(code: string, period: MarketIndexPeriod): Promise<KlinePoint[]> {
  const klt = ({ '15m': '15', '1h': '60', '4h': '60', '1d': '101' } as const)[period];
  const limit = period === '4h' ? 80 : period === '1d' ? 120 : 60;
  const url = new URL('https://7.push2his.eastmoney.com/api/qt/stock/kline/get');
  url.search = new URLSearchParams({
    secid: `90.${code}`,
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    klt,
    fqt: '1',
    beg: '0',
    end: '20500101',
    lmt: String(limit),
  }).toString();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4_000), headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: 'https://quote.eastmoney.com/' } });
    if (!response.ok) return [];
    const payload = await response.json() as { data?: { klines?: string[] } };
    const rows = (payload.data?.klines ?? []).map(parseBoardKlinePoint).filter((item): item is KlinePoint => Boolean(item));
    return period === '4h' ? aggregateBoardSeries(rows, 4) : rows;
  } catch {
    return [];
  }
}

function aggregateBoardSeries(data: KlinePoint[], size: number) {
  return aggregateKline(data, size);
}

function parseBoardKlinePoint(line: string): KlinePoint | undefined {
  return parseEastmoneyKline(line);
}

function mergeKlineRows(current: KlinePoint[], incoming: KlinePoint[]) {
  const byTime = new Map(current.map((row) => [row.time, row]));
  for (const row of incoming) byTime.set(row.time, { ...byTime.get(row.time), ...row });
  return [...byTime.values()].sort((a, b) => (a.timestamp ?? parseMarketTime(a.time) ?? 0) - (b.timestamp ?? parseMarketTime(b.time) ?? 0));
}

async function fetchMarketIndex(code: string, period: IndexKlinePeriod, limit?: number, beforeTimestamp?: number): Promise<MarketIndexSnapshot | undefined> {
  try {
    const [quote, series] = await Promise.all([fetchIndexQuote(code), fetchIndexSeries(code, period, limit, beforeTimestamp)]);
    return quote ? { ...quote, minutes: patchLatestIndexBar(series, quote) } : undefined;
  } catch {
    return undefined;
  }
}

async function fetchIndexQuote(code: string): Promise<Omit<MarketIndexSnapshot, 'minutes'> | undefined> {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${code}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(4_000), headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: 'https://gu.qq.com/' } });
  if (!response.ok) return undefined;
  const payload = await response.json() as { data?: Record<string, AnyRecord> };
  return toMarketIndexSnapshot(code, payload.data?.[code]);
}

async function fetchIndexSeries(code: string, period: IndexKlinePeriod, limit?: number, beforeTimestamp?: number) {
  if (period === '1d' || period === '1w' || period === '1mo') return fetchIndexHistorySeries(code, period, limit ?? (period === '1d' ? 120 : period === '1w' ? 240 : 120));
  const k = period === '15m' ? '15' : '60';
  const count = limit ?? (period === '4h' ? 80 : 60);
  const rows = await fetchIndexMinuteSeries(code, k, period === '4h' ? count * 4 : count, beforeTimestamp);
  return period === '4h' ? aggregateIndexSeries(rows, 4).slice(-count) : rows;
}

async function fetchIndexMinuteSeries(code: string, k: '15' | '60', limit: number, beforeTimestamp?: number) {
  const before = beforeTimestamp ? formatTencentMinuteTimestamp(beforeTimestamp) : '';
  const url = new URL('https://ifzq.gtimg.cn/appstock/app/kline/mkline');
  url.search = new URLSearchParams({ param: `${code},m${k},${before},${limit}` }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(4_000), headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: 'https://gu.qq.com/' } });
  if (!response.ok) return [];
  const payload = await response.json() as { data?: Record<string, Record<string, unknown[]>> };
  return ((payload.data?.[code]?.[`m${k}`] ?? []) as unknown[]).map(parseIndexKlinePoint).filter((item): item is NonNullable<ReturnType<typeof parseIndexKlinePoint>> => Boolean(item));
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
  return [...data.slice(0, -1), {
    ...latest,
    close: quote.price,
    high: Math.max(latest.high, quote.price),
    low: Math.min(latest.low, quote.price),
    change: typeof quote.prevClose === 'number' ? Number((quote.price - quote.prevClose).toFixed(2)) : latest.change,
    changePercent: typeof quote.prevClose === 'number' && quote.prevClose ? Number((((quote.price - quote.prevClose) / quote.prevClose) * 100).toFixed(2)) : latest.changePercent,
  }];
}

async function fetchIndexHistorySeries(code: string, period: '1d' | '1w' | '1mo', limit = 120) {
  const type = period === '1w' ? 'week' : period === '1mo' ? 'month' : 'day';
  const url = new URL('https://ifzq.gtimg.cn/appstock/app/fqkline/get');
  url.search = new URLSearchParams({ param: `${code},${type},,,${limit},qfq` }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(4_000), headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: 'https://gu.qq.com/' } });
  if (!response.ok) return [];
  const payload = await response.json() as { data?: Record<string, Record<string, unknown[]>> };
  return (payload.data?.[code]?.[type] ?? []).map(parseIndexKlinePoint).filter((item): item is NonNullable<ReturnType<typeof parseIndexKlinePoint>> => Boolean(item));
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

export async function getStockFundFlowSnapshot(symbolInput: string): Promise<IStockFundFlowSnapshot> {
  const symbol = normalizeASymbol(symbolInput);
  const warnings: string[] = [];
  let latest: IStockFundFlowSnapshot | undefined;
  try {
    const rows = await sdk.fundFlow.individual(symbol, { period: 'daily' });
    const row = [...rows].reverse().find(hasFundFlowValue);
    if (row) latest = stockSdkFundFlowToSnapshot(row);
  } catch (error) {
    warnings.push(`stock-sdk 个股资金流获取失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!latest) latest = await fetchEastmoneyFundFlowSnapshot(symbol, warnings).catch(async (error: Error) => {
    warnings.push(`a-stock-data 东财日级资金流获取失败：${error.message}`);
    return fetchEastmoneyMinuteFundFlowSnapshot(symbol, warnings).catch((minuteError: Error) => {
      warnings.push(`a-stock-data 东财分钟级资金流获取也失败：${minuteError.message}`);
      return undefined;
    });
  });
  let activeStats: ReturnType<typeof activeOrderStats> | undefined;
  try {
    const date = latest?.date ?? new Date().toISOString().slice(0, 10);
    activeStats = activeOrderStats(await sdk.marketEvent.individualChanges(symbol, { date }));
  } catch (error) {
    warnings.push(`主动买卖比例获取失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!activeStats?.total) warnings.push('暂无盘口异动样本，无法计算主动买卖比例');
  if (!latest) {
    warnings.push('所有资金流数据源（stock-sdk / 东财 push2his / 东财 push2）均未返回有效的净流入数据');
  }
  const fallback: IStockFundFlowSnapshot = {
    date: new Date().toISOString().slice(0, 10),
    mainNetInflow: null,
    mainNetInflowPercent: null,
    superLargeNetInflow: null,
    superLargeNetInflowPercent: null,
    largeNetInflow: null,
    largeNetInflowPercent: null,
    mediumNetInflow: null,
    mediumNetInflowPercent: null,
    smallNetInflow: null,
    smallNetInflowPercent: null,
    source: 'a-stock-data',
  };
  return {
    ...(latest ?? fallback),
    activeBuyRatio: activeStats?.total ? (activeStats.buy / activeStats.total) * 100 : undefined,
    activeSellRatio: activeStats?.total ? (activeStats.sell / activeStats.total) * 100 : undefined,
    activeSampleCount: activeStats?.total,
    activeRatioSource: 'a-stock-data 盘口异动样本（大笔买入/大笔卖出）',
    warnings: warnings.length ? warnings : undefined,
  };
}

function stockSdkFundFlowToSnapshot(row: Awaited<ReturnType<typeof sdk.fundFlow.individual>>[number]): IStockFundFlowSnapshot {
  return {
    date: row.date,
    mainNetInflow: row.mainNetInflow,
    mainNetInflowPercent: row.mainNetInflowPercent,
    superLargeNetInflow: row.superLargeNetInflow,
    superLargeNetInflowPercent: row.superLargeNetInflowPercent,
    largeNetInflow: row.largeNetInflow,
    largeNetInflowPercent: row.largeNetInflowPercent,
    mediumNetInflow: row.mediumNetInflow,
    mediumNetInflowPercent: row.mediumNetInflowPercent,
    smallNetInflow: row.smallNetInflow,
    smallNetInflowPercent: row.smallNetInflowPercent,
    source: 'stock-sdk',
  };
}

// ponytail: a-stock-data style retry + jitter, transient Eastmoney blocks are common on residential IPs.
// Single retry with backoff covers most blips; full session reuse would need undici Agent, not worth it.
async function eastmoneyGet(url: URL, timeoutMs = 15_000): Promise<Response> {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Referer: 'https://quote.eastmoney.com/',
    Origin: 'https://quote.eastmoney.com',
  };
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * (attempt + Math.random())));
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers });
      if (response.ok) return response;
      if (response.status === 403 || response.status === 429) {
        lastError = new Error(`东财风控：HTTP ${response.status}`);
        continue;
      }
      throw new Error(`东财请求失败：HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (error instanceof DOMException && error.name === 'TimeoutError') continue;
      if (error instanceof TypeError && error.message.includes('fetch')) continue;
      throw error;
    }
  }
  throw lastError;
}

async function fetchEastmoneyFundFlowSnapshot(symbol: string, warnings: string[]): Promise<IStockFundFlowSnapshot> {
  const secid = `${symbol.startsWith('6') ? 1 : 0}.${symbol}`;
  const url = new URL('https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get');
  url.search = new URLSearchParams({
    secid,
    fields1: 'f1,f2,f3,f7',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65',
    lmt: '120',
  }).toString();
  const response = await eastmoneyGet(url);
  const payload = await response.json() as { data?: { klines?: string[] } };
  const line = payload.data?.klines?.at(-1);
  if (!line) throw new Error(`${symbol} 暂无可用个股资金流数据`);
  const parts = line.split(',');
  if (parts.length < 11) throw new Error(`${symbol} 个股资金流字段不完整`);
  warnings.push('资金流数据来自 a-stock-data 东财 push2his 日级接口');
  return {
    date: parts[0],
    mainNetInflow: parseNullableNumber(parts[1]),
    mainNetInflowPercent: parseNullableNumber(parts[6]),
    superLargeNetInflow: parseNullableNumber(parts[5]),
    superLargeNetInflowPercent: parseNullableNumber(parts[10]),
    largeNetInflow: parseNullableNumber(parts[4]),
    largeNetInflowPercent: parseNullableNumber(parts[9]),
    mediumNetInflow: parseNullableNumber(parts[3]),
    mediumNetInflowPercent: parseNullableNumber(parts[8]),
    smallNetInflow: parseNullableNumber(parts[2]),
    smallNetInflowPercent: parseNullableNumber(parts[7]),
    source: 'a-stock-data',
  };
}

async function fetchEastmoneyMinuteFundFlowSnapshot(symbol: string, warnings: string[]): Promise<IStockFundFlowSnapshot> {
  const secid = `${symbol.startsWith('6') ? 1 : 0}.${symbol}`;
  const url = new URL('https://push2.eastmoney.com/api/qt/stock/fflow/kline/get');
  url.search = new URLSearchParams({
    secid,
    klt: '1',
    fields1: 'f1,f2,f3,f7',
    fields2: 'f51,f52,f53,f54,f55,f56,f57',
  }).toString();
  const response = await eastmoneyGet(url);
  const payload = await response.json() as { data?: { klines?: string[] } };
  const lines = payload.data?.klines ?? [];
  if (!lines.length) throw new Error(`${symbol} 暂无可用分钟资金流数据`);
  const totals = lines.reduce((sum, line) => {
    const parts = line.split(',');
    return {
      main: sum.main + (parseNullableNumber(parts[1]) ?? 0),
      small: sum.small + (parseNullableNumber(parts[2]) ?? 0),
      medium: sum.medium + (parseNullableNumber(parts[3]) ?? 0),
      large: sum.large + (parseNullableNumber(parts[4]) ?? 0),
      superLarge: sum.superLarge + (parseNullableNumber(parts[5]) ?? 0),
      date: parts[0] || sum.date,
    };
  }, { main: 0, small: 0, medium: 0, large: 0, superLarge: 0, date: '' });
  warnings.push('资金流数据来自 a-stock-data 东财 push2 分钟级接口累计值；净占比字段该接口不提供');
  return {
    date: totals.date,
    mainNetInflow: totals.main,
    mainNetInflowPercent: null,
    superLargeNetInflow: totals.superLarge,
    superLargeNetInflowPercent: null,
    largeNetInflow: totals.large,
    largeNetInflowPercent: null,
    mediumNetInflow: totals.medium,
    mediumNetInflowPercent: null,
    smallNetInflow: totals.small,
    smallNetInflowPercent: null,
    source: 'a-stock-data',
  };
}

function parseNullableNumber(value: string | undefined) {
  if (!value || value === '-' || value === '--') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function hasFundFlowValue(row: Awaited<ReturnType<typeof sdk.fundFlow.individual>>[number]) {
  return [row.mainNetInflow, row.superLargeNetInflow, row.largeNetInflow, row.mediumNetInflow, row.smallNetInflow].some((value) => value !== null && Number.isFinite(Number(value)));
}

function activeOrderStats(items: Awaited<ReturnType<typeof sdk.marketEvent.individualChanges>>) {
  let buy = 0;
  let sell = 0;
  for (const item of items) {
    const text = `${item.changeType} ${item.changeTypeLabel}`;
    if (item.changeType === 'large_buy' || /大笔买入|特大单买入/.test(text)) buy += 1;
    if (item.changeType === 'large_sell' || /大笔卖出|特大单卖出/.test(text)) sell += 1;
  }
  return { buy, sell, total: buy + sell };
}

export async function getChipDistribution(symbolInput: string): Promise<{ latest?: ChipDistribution; trend: Array<{ days: number; concentration70?: number; concentration90?: number }> }> {
  const symbol = normalizeASymbol(symbolInput);
  const rows = await sdk.chips.cn(symbol, { days: 20, includeHistogram: 'last' });
  const latest = rows.at(-1) as AnyRecord | undefined;
  const at = (n: number) => rows.at(-n) as AnyRecord | undefined;
  return {
    latest: latest ? toChipDistribution(latest) : undefined,
    trend: [5, 10, 20].map((days) => {
      const row = at(days) ?? latest;
      return { days, concentration70: pickNumber(row ?? {}, ['concentration70']), concentration90: pickNumber(row ?? {}, ['concentration90']) };
    }),
  };
}

function toChipDistribution(row: AnyRecord): ChipDistribution {
  const histogram = row.histogram as { prices?: unknown[]; weights?: unknown[]; profit?: unknown[] } | undefined;
  const prices = histogram?.prices ?? [];
  const weights = histogram?.weights ?? [];
  const profits = histogram?.profit ?? [];
  const cost70Low = pickNumber(row, ['cost70Low']);
  const cost70High = pickNumber(row, ['cost70High']);
  const cost90Low = pickNumber(row, ['cost90Low']);
  const cost90High = pickNumber(row, ['cost90High']);
  return {
    date: pickString(row, ['date']) ?? '',
    profitRatio: pickNumber(row, ['profitRatio']),
    avgCost: pickNumber(row, ['avgCost']),
    cost70: cost70Low === undefined || cost70High === undefined ? undefined : `${cost70Low.toFixed(2)}-${cost70High.toFixed(2)}`,
    cost90: cost90Low === undefined || cost90High === undefined ? undefined : `${cost90Low.toFixed(2)}-${cost90High.toFixed(2)}`,
    concentration70: pickNumber(row, ['concentration70']),
    concentration90: pickNumber(row, ['concentration90']),
    points: prices.map((price, index): ChipPoint => ({
      price: Number(price),
      weight: Number(weights[index]) || 0,
      profit: profits[index] === undefined ? undefined : Number(profits[index]),
    })).filter((point) => Number.isFinite(point.price) && point.weight > 0),
  };
}

export async function analyzeTechnical(symbolInput: string): Promise<AgentResultCard> {
  const klines = await getKline(symbolInput, 140);
  return analyzeIndicators(klines);
}

export async function listHotFocus(tab: HotFocusTab): Promise<HotFocusItem[]> {
  try {
    if (tab === 'sector') return listSectorHot();
    if (tab === 'market') return listMarketHot();
    if (tab === 'surge') return listSurgeHot();
    if (tab === 'flow') return listFlowHot();
    return listStockRankHot(tab);
  } catch {
    return [];
  }
}

export interface DailyDragonTigerItem {
  id: string;
  date: string;
  code: string;
  name: string;
  reason: string;
  close?: number;
  changePercent?: number;
  netBuy: number;
  buy: number;
  sell: number;
  turnover?: number;
}

export async function listDailyDragonTiger(): Promise<DailyDragonTigerItem[]> {
  for (const date of recentIsoTradeDateCandidates()) {
    const url = new URL('https://datacenter-web.eastmoney.com/api/data/v1/get');
    url.search = new URLSearchParams({
      reportName: 'RPT_DAILYBILLBOARD_DETAILSNEW',
      columns: 'ALL',
      filter: `(TRADE_DATE>='${date}')(TRADE_DATE<='${date}')`,
      pageNumber: '1',
      pageSize: '500',
      sortColumns: 'BILLBOARD_NET_AMT',
      sortTypes: '-1',
      source: 'WEB',
      client: 'WEB',
    }).toString();
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: 'https://data.eastmoney.com/' },
    });
    if (!response.ok) continue;
    const payload = await response.json() as { result?: { data?: AnyRecord[] } };
    const rows = (payload.result?.data ?? []).map(toDailyDragonTigerItem).filter((item): item is DailyDragonTigerItem => Boolean(item));
    if (rows.length) return rows;
  }
  return [];
}

function toDailyDragonTigerItem(row: AnyRecord): DailyDragonTigerItem | undefined {
  const code = pickString(row, ['SECURITY_CODE']);
  const name = pickString(row, ['SECURITY_NAME_ABBR']);
  if (!code || !name) return undefined;
  const date = (pickString(row, ['TRADE_DATE']) ?? '').slice(0, 10);
  const netBuy = pickNumber(row, ['BILLBOARD_NET_AMT']) ?? 0;
  const buy = pickNumber(row, ['BILLBOARD_BUY_AMT']) ?? 0;
  const sell = pickNumber(row, ['BILLBOARD_SELL_AMT']) ?? 0;
  return {
    id: `daily-lhb-${date}-${code}`,
    date,
    code,
    name,
    reason: pickString(row, ['EXPLANATION']) ?? '',
    close: pickNumber(row, ['CLOSE_PRICE']),
    changePercent: pickNumber(row, ['CHANGE_RATE']),
    netBuy,
    buy,
    sell,
    turnover: pickNumber(row, ['TURNOVERRATE']),
  };
}

function recentIsoTradeDateCandidates() {
  const result: string[] = [];
  const date = new Date();
  for (let i = 0; i < 7; i += 1) {
    result.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
    date.setDate(date.getDate() - 1);
  }
  return result;
}

async function listSectorHot(): Promise<HotFocusItem[]> {
  const [industries, concepts, flows] = await Promise.allSettled([
    sdk.board.industry.list(),
    sdk.board.concept.list(),
    sdk.fundFlow.sectorRank({ indicator: 'today' }),
  ]);
  const boards = [
    ...(industries.status === 'fulfilled' ? industries.value : []),
    ...(concepts.status === 'fulfilled' ? concepts.value : []),
  ];
  if (boards.length) {
    return boards
      .sort((a, b) => Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0))
      .slice(0, 12)
      .map((item) => ({
        id: `sector-${item.code}`,
        title: item.name,
        code: item.code,
        name: item.name,
        changePercent: formatPercent(item.changePercent ?? 0),
        amount: item.totalMarketCap ? `${(item.totalMarketCap / 100000000).toFixed(1)}亿` : undefined,
        description: item.leadingStock ? `领涨：${item.leadingStock}${item.leadingStockChangePercent === null ? '' : ` ${formatPercent(item.leadingStockChangePercent)}`}` : 'stock-sdk 板块行情',
        tag: item.code,
        type: Number(item.changePercent ?? 0) >= 0 ? 'surge' : 'plummet',
      }));
  }
  return flows.status === 'fulfilled' && flows.value.length ? flows.value.slice(0, 12).map((item) => ({
    id: `sector-${item.code}`,
    title: item.name,
    code: item.code,
    name: item.name,
    changePercent: item.changePercent === null ? '--' : formatPercent(item.changePercent),
    amount: item.mainNetInflow === null ? '--' : formatMoney(item.mainNetInflow),
    description: `主力净流入 ${formatMoney(item.mainNetInflow)}${item.topStockName ? `，最大净流入：${item.topStockName}` : ''}`,
    tag: item.code,
    type: Number(item.changePercent ?? 0) >= 0 ? 'surge' : 'plummet',
  })) : [];
}

async function listMarketHot(): Promise<HotFocusItem[]> {
  const rows = (await sdk.fundFlow.market()).slice(0, 10);
  return rows.map((item) => ({
    id: `market-${item.date}`,
    title: item.date,
    price: item.shClose ?? '--',
    changePercent: item.shChangePercent === null ? '--' : formatPercent(item.shChangePercent),
    amount: item.mainNetInflow === null ? '--' : formatMoney(item.mainNetInflow),
    description: `上证 ${formatPercent(item.shChangePercent ?? 0)} / 深证 ${formatPercent(item.szChangePercent ?? 0)}，主力净流入 ${formatMoney(item.mainNetInflow)}`,
    tag: '大盘资金',
    type: Number(item.mainNetInflow ?? 0) >= 0 ? 'surge' : 'plummet',
  }));
}

async function listSurgeHot(): Promise<HotFocusItem[]> {
  if (isBeforeChinaMarketOpen()) return [];
  const [changes, pools] = await Promise.all([listStockChangeEvents(), listEastmoneySurgeHot().catch(() => [])]);
  return [...changes, ...pools.filter((pool) => !changes.some((change) => change.code === pool.code && change.tag === pool.tag))]
    .sort((a, b) => surgeTimeValue(b.time) - surgeTimeValue(a.time));
}

type EastmoneyPoolKind = 'zt' | 'zb' | 'dt';

async function listStockChangeEvents(): Promise<HotFocusItem[]> {
  if (isBeforeChinaMarketOpen()) return [];
  const groups = await Promise.allSettled(stockChangeTypes.map((type) => withTimeout(sdk.marketEvent.stockChanges(type), [])));
  return groups.flatMap((group, groupIndex) => group.status === 'fulfilled' ? toStockChangeHotItems(group.value, groupIndex) : []);
}

function isBeforeChinaMarketOpen(date = new Date()) {
  const day = date.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes < 9 * 60 + 25;
}

function toStockChangeHotItems(changes: Awaited<ReturnType<typeof sdk.marketEvent.stockChanges>>, groupIndex: number): HotFocusItem[] {
  return changes.flatMap((item, index): HotFocusItem[] => {
    const parsed = parseStockChangeInfo(item.changeType, item.info);
    const reason = formatStockChangeReason(item.changeTypeLabel, item.changeType);
    return [{
      id: `surge-${item.changeType}-${item.time}-${item.code}-${groupIndex}-${index}`,
      title: `${item.name} ${item.code}`,
      code: item.code,
      name: item.name,
      time: item.time,
      price: parsed.price === undefined ? undefined : parsed.price.toFixed(2),
      changePercent: parsed.pct === undefined ? undefined : formatPercent(parsed.pct),
      amount: formatChangeHands(parsed.hands, reason) ?? parsed.amount,
      description: reason,
      tag: reason,
      type: /卖|跌|跳水|下挫|低|开板/.test(reason) ? 'plummet' : 'surge',
    }];
  });
}

const stockChangeTypes = [
  'high_60d', 'low_60d', 'rocket_launch', 'quick_rebound', 'surge_60d', 'drop_60d', 'accelerate_down', 'high_dive',
  'limit_down_seal', 'limit_up_seal', 'limit_down_open', 'limit_up_open', 'large_buy', 'large_sell',
] as const;

function withTimeout<T>(promise: Promise<T>, fallback: T, ms = 4_500) {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function parseStockChangeInfo(type: string | undefined, info: string) {
  const [first, second, third, fourth] = String(info ?? '').split(',').map(Number);
  if (type === 'large_buy' || type === 'large_sell') return { hands: first / 100, price: second, pct: third, amount: Number.isFinite(fourth) ? formatMoney(fourth) : undefined };
  if (type === 'limit_up_seal' || type === 'limit_down_seal') {
    return { price: first, pct: fourth, amount: Number.isFinite(second) ? `封单${formatMoney(second)}` : undefined };
  }
  if (type === 'limit_up_open' || type === 'limit_down_open') return { price: first, pct: second };
  return { price: second, pct: Number.isFinite(third) ? third : first };
}

function formatStockChangeReason(label: string, type: string | undefined) {
  if (type === 'high_60d') return '60日新高';
  if (type === 'low_60d') return '60日新低';
  if (type === 'surge_60d' || type === 'rocket_launch' || type === 'quick_rebound') return '快速涨幅';
  if (type === 'drop_60d' || type === 'accelerate_down' || type === 'high_dive') return '快速跌幅';
  if (type === 'limit_down_seal') return '封跌停板';
  if (type === 'limit_up_seal') return '封涨停板';
  if (type === 'limit_down_open') return '跌停开板';
  if (type === 'limit_up_open') return '涨停开板';
  if (type === 'large_buy' || label === '大笔买入') return '特大单买入';
  if (type === 'large_sell' || label === '大笔卖出') return '特大单卖出';
  return label;
}

function formatChangeHands(hands: number | undefined, reason: string) {
  if (!Number.isFinite(hands) || !hands || hands <= 0) return undefined;
  const action = reason.includes('买') ? '买入' : reason.includes('卖') ? '卖出' : '';
  const size = hands >= 10000 ? `${(hands / 10000).toFixed(2).replace(/\.00$/, '')}万手` : `${hands.toFixed(0)}手`;
  return action ? `${action}${size}` : size;
}

const eastmoneyPoolConfigs: Record<EastmoneyPoolKind, { endpoint: string; sort: string; tag: string; type: HotFocusItem['type'] }> = {
  zt: { endpoint: 'getTopicZTPool', sort: 'fbt:asc', tag: '封涨停板', type: 'surge' },
  zb: { endpoint: 'getTopicZBPool', sort: 'fbt:asc', tag: '涨停开板', type: 'volume' },
  dt: { endpoint: 'getTopicDTPool', sort: 'fund:asc', tag: '封跌停板', type: 'plummet' },
};

export async function listEastmoneySurgeByDate(date: string): Promise<HotFocusItem[]> {
  const normalized = date.replace(/-/g, '');
  if (!/^\d{8}$/.test(normalized)) return [];
  const groups = await Promise.allSettled([
    fetchEastmoneyPool('zt', normalized),
    fetchEastmoneyPool('zb', normalized),
    fetchEastmoneyPool('dt', normalized),
  ]);
  return groups.flatMap((group) => (group.status === 'fulfilled' ? group.value : []));
}

async function listEastmoneySurgeHot(): Promise<HotFocusItem[]> {
  const items = await listEastmoneySurgeByDate(formatTradeDate(new Date()));
  return items;
}

async function fetchEastmoneyPool(kind: EastmoneyPoolKind, date: string): Promise<HotFocusItem[]> {
  const config = eastmoneyPoolConfigs[kind];
  const url = new URL(`https://push2ex.eastmoney.com/${config.endpoint}`);
  url.search = new URLSearchParams({
    ut: '7eea3edcaed734bea9cbfc24409ed989',
    dpt: 'wz.ztzt',
    Pageindex: '0',
    pagesize: '10000',
    sort: config.sort,
    date,
  }).toString();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(6_000),
    headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: 'https://quote.eastmoney.com/' },
  });
  if (!response.ok) return [];

  const payload = await response.json() as { data?: { pool?: AnyRecord[] } | AnyRecord[] };
  const pool = Array.isArray(payload.data) ? payload.data : payload.data?.pool;
  return (pool ?? []).map((row) => toEastmoneyPoolItem(row, kind, config, date)).filter((item): item is HotFocusItem => Boolean(item));
}

function toEastmoneyPoolItem(row: AnyRecord, kind: EastmoneyPoolKind, config: typeof eastmoneyPoolConfigs[EastmoneyPoolKind], date: string): HotFocusItem | undefined {
  const code = pickString(row, ['c', 'code']);
  const name = pickString(row, ['n', 'name']);
  if (!code || !name) return undefined;

  const price = pickNumber(row, ['p']);
  const pct = pickNumber(row, ['zdp']);
  const turnover = pickNumber(row, ['hs']);
  const amount = pickNumber(row, [kind === 'zb' ? 'amount' : 'fund', 'amount', 'fba']);
  const limitDays = pickNumber(row, ['lbc', 'days', 'ylbc']);
  const breakTimes = pickNumber(row, ['zbc', 'oc']);
  const industry = pickString(row, ['hybk']);
  const firstSeal = formatEastmoneyPoolTime(pickNumber(row, ['fbt', 'yfbt']));
  const lastSeal = formatEastmoneyPoolTime(pickNumber(row, ['lbt']));
  const eventTime = kind === 'dt' ? '15:00' : firstSeal || lastSeal;
  const details = [
    industry,
    limitDays ? `${limitDays}连板` : '',
    turnover === undefined ? '' : `换手 ${formatNumber(turnover)}%`,
    amount === undefined || amount === 0 ? '' : `${kind === 'zb' ? '成交额' : '封单'} ${formatMoney(amount)}`,
    breakTimes ? `开板 ${breakTimes}次` : '',
  ].filter(Boolean).join(' · ');

  return {
    id: `em-${kind}-${date}-${code}`,
    title: `${name} ${code}`,
    code,
    name,
    time: eventTime,
    price: price === undefined ? undefined : (price / 1000).toFixed(2),
    changePercent: pct === undefined ? undefined : formatPercent(pct),
    amount: formatPoolAmount(kind, amount),
    description: details || config.tag,
    tag: config.tag,
    type: config.type,
  };
}

function formatPoolAmount(kind: EastmoneyPoolKind, amount?: number) {
  if (amount === undefined || amount === 0) return undefined;
  const text = formatMoney(amount);
  if (kind === 'zt') return `封单${text}`;
  if (kind === 'dt') return `封单${text}`;
  return `成交额${text}`;
}

function surgeTimeValue(time?: string) {
  const [hour, minute, second = '0'] = String(time ?? '').split(':');
  return (Number(hour) || 0) * 3600 + (Number(minute) || 0) * 60 + (Number(second) || 0);
}

function formatTradeDate(date: Date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

function formatEastmoneyPoolTime(value?: number) {
  if (!value) return undefined;
  const text = String(value).padStart(6, '0');
  return `${text.slice(0, 2)}:${text.slice(2, 4)}`;
}

async function listFlowHot(): Promise<HotFocusItem[]> {
  const rows = await sdk.fundFlow.sectorRank({ indicator: 'today' });
  return rows.slice(0, 16).map((item) => ({
    id: `flow-${item.code}`,
    title: item.name,
    code: item.topStockCode,
    name: item.topStockName,
    changePercent: item.changePercent === null ? '--' : formatPercent(item.changePercent),
    amount: item.mainNetInflow === null ? '--' : formatMoney(item.mainNetInflow),
    description: `主力净流入 ${formatMoney(item.mainNetInflow)}${item.topStockName ? `，最大净流入：${item.topStockName}` : ''}`,
    tag: '资金流向',
    type: Number(item.mainNetInflow ?? 0) >= 0 ? 'surge' : 'plummet',
  }));
}

async function listStockRankHot(tab: HotFocusTab): Promise<HotFocusItem[]> {
  const rows = await sdk.fundFlow.rank({ indicator: 'today' });
  return rows.slice(0, 16).map((item) => ({
    id: `${tab}-${item.code}`,
    title: item.name,
    code: item.code,
    name: item.name,
    price: item.price ?? '--',
    changePercent: item.changePercent === null ? '--' : formatPercent(item.changePercent),
    amount: item.mainNetInflow === null ? '--' : formatMoney(item.mainNetInflow),
    description: tab === 'diagnosis' ? `主力净占比 ${formatPercent(item.mainNetInflowPercent ?? 0)}，点击查看个股详情` : `主力净流入 ${formatMoney(item.mainNetInflow)}，超大单 ${formatMoney(item.superLargeNetInflow)}`,
    tag: tab === 'diagnosis' ? '诊股候选' : '资金策略',
    type: Number(item.mainNetInflow ?? 0) >= 0 ? 'surge' : 'plummet',
  }));
}

function formatMoney(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  const sign = num > 0 ? '+' : num < 0 ? '-' : '';
  const abs = Math.abs(num);
  if (abs >= 100000000) return `${sign}${(abs / 100000000).toFixed(2)}亿`;
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(2)}万`;
  return `${sign}${abs.toFixed(0)}`;
}

export async function getBoardSnapshot(keyword: string): Promise<AgentResultCard> {
  const [industries, concepts, sectorRank] = await Promise.allSettled([
    sdk.board.industry.list(),
    sdk.board.concept.list(),
    sdk.fundFlow.sectorRank({ indicator: 'today' }),
  ]);

  const boards = [
    ...(industries.status === 'fulfilled' ? (industries.value as unknown as AnyRecord[]) : []),
    ...(concepts.status === 'fulfilled' ? (concepts.value as unknown as AnyRecord[]) : []),
  ];
  const matched = boards.find((board) => String(board.name ?? board.boardName ?? '').includes(keyword.replace(/板块|行业/g, '')));
  const flows = sectorRank.status === 'fulfilled' ? (sectorRank.value as unknown as AnyRecord[]).slice(0, 6) : [];

  return {
    title: `${keyword}板块速览`,
    subtitle: matched ? `匹配板块：${String(matched.name ?? matched.boardName)}` : '未精确匹配板块，展示资金流排名参考',
    rows: flows.map((flow) => ({
      板块: String(flow.name ?? flow.boardName ?? flow.sectorName ?? '--'),
      净流入: String(flow.netInflow ?? flow.mainNetInflow ?? flow.today ?? '--'),
      涨跌幅: String(flow.changePercent ?? flow.pctChg ?? '--'),
    })),
    narrative: '板块数据来自 stock-sdk 行业/概念与资金流接口。若上游数据源限流或字段变动，结果会自动降级展示。',
  };
}
