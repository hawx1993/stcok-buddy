import { EventEmitter } from 'node:events';
import StockSDK from 'stock-sdk';
import type { AgentResultCard, BoardDetail, ChipDistribution, ChipPoint, HotFocusItem, HotFocusTab, KlinePoint, MarketBoardRow, MarketIndexPeriod, MarketIndexSnapshot, MarketPageSnapshot, MarketQuoteRow, MarketTab, StockDetail } from '../../../src/shared/types.js';
import { getLatestDailyBar, listDailyBars, listLatestMarketRows, listSecurities, readBoardDetail, readBoardSnapshot, writeBoardDetail, writeBoardSnapshot } from '../market-data/market-data-store.js';
import { queryHistoricalBars, queryLatestQuote } from '../market-data/market-data-query.js';
import { remoteMarketStatus } from '../market-data/providers.js';
import { formatNumber, formatPercent, pickNumber, pickString } from './format.js';
import { analyzeIndicators } from './indicators.js';
import { extractSymbolCandidate, normalizeASymbol, inferExchange, toQuoteSymbol } from './symbols.js';

const sdk = new StockSDK({ timeout: 12_000, retry: { maxRetries: 1 } });
let quoteCache: { rows: MarketQuoteRow[]; updatedAt: number; promise?: Promise<MarketQuoteRow[]> } = { rows: [], updatedAt: 0 };
const marketPageEvents = new EventEmitter();
const marketPageCache = new Map<string, { snapshot?: MarketPageSnapshot; refreshing?: Promise<MarketPageSnapshot> }>();
const marketIndexCache = new Map<MarketIndexPeriod, { rows?: MarketIndexSnapshot[]; refreshing?: Promise<MarketIndexSnapshot[]> }>();
let marketBoardsCache: { rows: MarketBoardRow[]; updatedAt: number; promise?: Promise<MarketBoardRow[]>; loadedFromDb?: boolean } = { rows: [], updatedAt: 0 };
let marketBoardsLastPersistedAt = 0;
let marketBoardsRefreshTimer: NodeJS.Timeout | undefined;
const boardSeriesCache = new Map<string, { rows?: KlinePoint[]; refreshing?: Promise<KlinePoint[]> }>();
type BoardKind = 'industry' | 'concept';
type BoardApi = typeof sdk.board.industry;
const boardKindCache = new Map<string, BoardKind>();

type AnyRecord = Record<string, unknown>;

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
    rating: {
      fundamental: '待评估',
      valuation: pe && pe < 25 ? '相对合理' : '需核查',
      tech: '待分析',
      risk: '中性',
    },
    summary: `${name}（${code}）实时行情来自 stock-sdk。当前价格 ${price === undefined ? '--' : price}，涨跌幅 ${changePercent === undefined ? '--' : formatPercent(changePercent)}。`,
  };
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

export async function getKline(symbolInput: string, limit = 120, period = '1d'): Promise<KlinePoint[]> {
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
  const close = pickNumber(record, ['close', '收盘价']);
  const high = pickNumber(record, ['high', '最高价']);
  const low = pickNumber(record, ['low', '最低价']);
  if (open === undefined || close === undefined || high === undefined || low === undefined) return undefined;
  return {
    time: pickString(record, ['date', 'time', '日期']) ?? '',
    timestamp: pickNumber(record, ['timestamp']) ?? parseMarketTime(pickString(record, ['date', 'time', '日期']) ?? ''),
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

export async function searchStocks(query: string): Promise<MarketQuoteRow[]> {
  const text = query.trim();
  if (!text) return [];
  const q = text.toLowerCase();

  const sdkRows = await sdk.search(text).catch(() => []) as Array<{ code?: string; name?: string; category?: string; type?: string }>;
  const fromSdk = sdkRows
    .filter((item) => item.code && (item.category === 'stock' || /^GP-|A股|stock/i.test(String(item.type ?? item.category ?? ''))))
    .map((item) => ({ code: normalizeSearchCode(item.code), name: item.name || normalizeSearchCode(item.code) }))
    .filter((item) => item.code.includes(q) || item.name.toLowerCase().includes(q));
  if (fromSdk.length) return dedupeSearchRows(fromSdk).slice(0, 50);

  const suggested = await searchEastmoneyStocks(text);
  if (suggested.length) return suggested;

  const marketRows = await getAllMarketQuoteRows().catch(() => []);
  return marketRows.filter((row) => row.code.includes(q) || row.name.toLowerCase().includes(q)).slice(0, 50);
}

function dedupeSearchRows(rows: MarketQuoteRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => row.code && !seen.has(row.code) && seen.add(row.code));
}

function normalizeSearchCode(value?: string) {
  return String(value ?? '').replace(/^(sh|sz|bj)/i, '').replace(/^\D+/, '');
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
  try {
    const quote = await getQuote(symbolInput);
    try {
      const technical = await analyzeTechnical(symbolInput);
      return {
        ...quote,
        rating: {
          fundamental: quote.rating?.fundamental ?? '待评估',
          valuation: quote.rating?.valuation ?? '需核查',
          risk: quote.rating?.risk ?? '中性',
          tech: technical.subtitle?.includes('金叉') || technical.subtitle?.includes('站上') ? '偏多' : '中性',
        },
        summary: `${quote.summary ?? ''} ${technical.narrative ?? ''}`.trim(),
      };
    } catch {
      return quote;
    }
  } catch (error) {
    const code = normalizeASymbol(symbolInput);
    return {
      code,
      name: code,
      exchange: inferExchange(code),
      price: '--',
      changePercent: '--',
      summary: `暂时无法从 stock-sdk 获取 ${code} 的实时详情：${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}

export async function getBoardDetail(symbol: string): Promise<BoardDetail> {
  if (symbol.startsWith('LOCAL-')) return getLocalBoardDetail(symbol);
  const cached = await readBoardDetail(symbol).catch(() => undefined);
  if (cached?.detail.kline?.length && cached.detail.constituents?.length && hasConstituentQuotes(cached.detail.constituents)) return cached.detail;
  if (cached?.detail.constituents?.length) {
    const detail = await completeBoardDetail(cached.detail);
    if (detail.kline?.length || hasConstituentQuotes(detail.constituents)) void writeBoardDetail({ detail, updatedAt: new Date().toISOString() });
    if (detail.kline?.length || hasConstituentQuotes(detail.constituents)) return detail;
  }

  const localDetail = await getLocalBoardDetail(symbol).catch(() => undefined);
  if (localDetail?.kline?.length || localDetail?.constituents?.length) {
    void writeBoardDetail({ detail: localDetail, updatedAt: new Date().toISOString() });
    if (shouldUseRemoteMarketData()) void getRemoteBoardDetail(symbol).then((detail) => {
      if (detail.kline?.length || detail.constituents?.length) return writeBoardDetail({ detail, updatedAt: new Date().toISOString() });
    }).catch(() => undefined);
    return localDetail;
  }

  try {
    const detail = await getRemoteBoardDetail(symbol);
    if (detail.kline?.length || detail.constituents?.length) void writeBoardDetail({ detail, updatedAt: new Date().toISOString() });
    return detail;
  } catch (error) {
    console.warn('[market] board detail unavailable, using local fallback', symbol, error instanceof Error ? error.message : error);
    return localDetail ?? { code: symbol, name: symbol, kline: [], constituents: [] };
  }
}

async function completeBoardDetail(detail: BoardDetail): Promise<BoardDetail> {
  const constituents = await enrichBoardConstituents(detail.constituents ?? []);
  const kline = detail.kline?.length ? detail.kline : constituents.length ? await aggregateRemoteBoardKline(constituents.map((row) => row.code)).catch(() => []) : [];
  return { ...detail, kline, constituents };
}

function hasConstituentQuotes(rows?: BoardDetail['constituents']) {
  return Boolean(rows?.length && rows.some((row) => hasValue(row.price) || hasValue(row.changePercent) || hasValue(row.amount) || hasValue(row.turnover)));
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

async function getRemoteBoardDetail(symbol: string): Promise<BoardDetail> {
  const boards = await getCachedMarketBoardRows();
  const board = boards.find((item) => item.code === symbol) ?? { code: symbol, name: symbol, changePercent: undefined };
  const [kline, remoteRows] = await Promise.all([
    getAStockBoardKline(symbol, '1d').catch(() => getCachedBoardSeries(symbol, '1d').catch(() => [])),
    getAStockBoardConstituents(symbol).catch(() => getRemoteBoardConstituents(symbol, board.name).catch(() => [])),
  ]);
  const pageRows = remoteRows.length ? [] : await getEastmoneyIndustryPageConstituents(symbol).catch(() => []);
  const constituents = await enrichBoardConstituents(remoteRows.length ? remoteRows : pageRows);
  const pageKline = kline.length || !constituents.length ? [] : await aggregateRemoteBoardKline(constituents.map((row) => row.code)).catch(() => []);
  const localDetail = kline.length && constituents.length ? undefined : await getLocalBoardDetail(symbol);
  return {
    code: board.code,
    name: board.name,
    changePercent: board.changePercent === undefined ? localDetail?.changePercent ?? '--' : formatPercent(board.changePercent),
    kline: kline.length ? kline : pageKline.length ? pageKline : localDetail?.kline ?? [],
    constituents: constituents.length ? constituents.slice(0, 80) : localDetail?.constituents ?? [],
  };
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

async function getAStockBoardConstituents(symbol: string): Promise<NonNullable<BoardDetail['constituents']>> {
  if (!/^BK\d+/i.test(symbol)) return [];
  const params = new URLSearchParams({
    pn: '1',
    pz: '200',
    po: '1',
    np: '1',
    fltt: '2',
    invt: '2',
    fs: `b:${symbol.toUpperCase()} f:!50`,
    fields: 'f2,f3,f4,f5,f6,f8,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23',
  });
  const payload = await fetchFirstJson<{ data?: { diff?: AnyRecord[] | Record<string, AnyRecord> } }>([
    `https://push2.eastmoney.com/api/qt/clist/get?${params}`,
    `https://29.push2.eastmoney.com/api/qt/clist/get?${params}`,
  ], 'https://quote.eastmoney.com/', 3_000);
  const diff = payload.data?.diff ?? [];
  const rows = Array.isArray(diff) ? diff : Object.values(diff);
  return rows.map((row) => toBoardConstituent(toMarketQuoteRow(row))).filter((row) => row.code && row.name);
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

async function getEastmoneyIndustryPageConstituents(symbol: string): Promise<NonNullable<BoardDetail['constituents']>> {
  const match = /^BK0?(\d+)/i.exec(symbol);
  if (!match) return [];
  const response = await fetch(`https://stock.eastmoney.com/hangye/hy${match[1]}.html`, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2' } });
  if (!response.ok) return [];
  const html = await response.text();
  const found = [...html.matchAll(/quote\.eastmoney\.com\/unify\/r\/(?:0|1)\.(\d{6})">([^<]+)<\/a>/g)];
  const seen = new Set<string>();
  return found.map(([, code, name]) => ({ code, name })).filter((row) => row.code && !seen.has(row.code) && seen.add(row.code));
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

async function getRemoteBoardConstituents(symbol: string, boardName: string): Promise<NonNullable<BoardDetail['constituents']>> {
  const sdkRows = await getSdkBoardConstituents(symbol, boardName);
  if (sdkRows.length) return sdkRows;
  return getEastmoneyBoardConstituents(symbol);
}

async function getSdkBoardConstituents(symbol: string, boardName: string): Promise<NonNullable<BoardDetail['constituents']>> {
  for (const board of await getBoardApis(symbol, boardName)) {
    try {
      const rows = await board.constituents(symbol);
      if (rows.length) return rows.map(toBoardConstituent);
    } catch {
      // Try the other board namespace, then the real-data HTTP fallback.
    }
  }
  return [];
}

async function getBoardApis(symbol: string, boardName?: string): Promise<BoardApi[]> {
  const cachedKind = boardKindCache.get(symbol);
  if (cachedKind) return orderBoardApis(cachedKind);
  const [industries, concepts] = await Promise.allSettled([
    sdk.board.industry.list(),
    sdk.board.concept.list(),
  ]);
  const industryRows = industries.status === 'fulfilled' ? industries.value : [];
  const conceptRows = concepts.status === 'fulfilled' ? concepts.value : [];
  for (const item of industryRows) boardKindCache.set(item.code, 'industry');
  for (const item of conceptRows) boardKindCache.set(item.code, 'concept');
  const kind = boardKindCache.get(symbol)
    ?? (industryRows.some((item) => item.name === boardName) ? 'industry' : conceptRows.some((item) => item.name === boardName) ? 'concept' : undefined);
  if (kind) boardKindCache.set(symbol, kind);
  return orderBoardApis(kind);
}

function orderBoardApis(kind?: BoardKind): BoardApi[] {
  return kind === 'concept' ? [sdk.board.concept, sdk.board.industry] : [sdk.board.industry, sdk.board.concept];
}

async function getEastmoneyBoardConstituents(symbol: string): Promise<NonNullable<BoardDetail['constituents']>> {
  if (!/^BK\d+/i.test(symbol)) return [];
  try {
    return (await fetchEastmoneyClist(`b:${symbol} f:!50`, 200, 'https://29.push2.eastmoney.com/api/qt/clist/get')).map((row) => toBoardConstituent(toMarketQuoteRow(row))).filter((row) => row.code && row.name);
  } catch {
    return [];
  }
}

function toBoardConstituent(item: { code?: string; name?: string; price?: unknown; changePercent?: unknown; amount?: unknown; turnoverRate?: unknown }): NonNullable<BoardDetail['constituents']>[number] {
  return {
    code: String(item.code ?? ''),
    name: String(item.name ?? item.code ?? ''),
    price: item.price === null || item.price === undefined ? '--' : String(item.price),
    changePercent: item.changePercent === null || item.changePercent === undefined ? '--' : formatPercent(item.changePercent),
    amount: item.amount === null || item.amount === undefined ? '--' : formatMoney(item.amount),
    turnover: item.turnoverRate === null || item.turnoverRate === undefined ? '--' : `${formatNumber(item.turnoverRate)}%`,
  };
}

async function getLocalBoardDetail(symbol: string): Promise<BoardDetail> {
  const boards = await getLocalIndustryBoardRows();
  const remoteBoard = marketBoardsCache.rows.find((item) => item.code === symbol);
  const board = boards.find((item) => item.code === symbol || item.name === remoteBoard?.name) ?? remoteBoard ?? { code: symbol, name: symbol, changePercent: undefined, minutes: [] };
  const securities = await listSecurities().catch(() => []);
  const industryByCode = new Map(securities.map((item) => [item.symbol, item.industry]).filter((item): item is [string, string] => Boolean(item[1])));
  const localName = normalizeBoardName(board.name);
  const rows = (await listLatestMarketRows().catch(() => []))
    .filter((row) => {
      const industry = industryByCode.get(row.code);
      return industry && boardNamesMatch(industry, localName);
    })
    .sort((a, b) => Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0));
  const kline = await aggregateLocalBoardKline(rows.map((row) => row.code));
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
    setTimeout(() => void hydrateLocalMarketPageSnapshot(tab, period), 0);
    return snapshot;
  }
  const snapshot = await getLocalMarketPageSnapshot(tab, period);
  if (tab === 'boards' || tab === 'leaders') startMarketBoardsRefreshLoop(period);
  if (tab === 'leaders' && !snapshot.boards.every((row) => row.minutes.length)) return refreshMarketPageSnapshot(tab, period).catch(() => snapshot);
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
    rows: cached?.rows ?? quoteCache.rows.filter((row) => quoteMatchesTab(row.code, tab)),
    boards: tab === 'boards' || tab === 'leaders' ? cached?.boards ?? marketBoardsCache.rows.slice(0, tab === 'leaders' ? 4 : 200) : [],
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
  const [indices, rows, boards] = await Promise.all([
    getCachedMarketIndices(period),
    tab === 'boards' || tab === 'leaders' ? Promise.resolve([]) : getRemoteMarketQuotes(tab),
    tab === 'boards' || tab === 'leaders' ? getMarketBoards(tab, period) : Promise.resolve([]),
  ]);
  return { tab, period, updatedAt: new Date().toISOString(), indices, rows, boards };
}

async function getLocalMarketPageSnapshot(tab: MarketTab, period: MarketIndexPeriod): Promise<MarketPageSnapshot> {
  const cached = marketPageCache.get(marketPageKey(tab, period))?.snapshot;
  const localRows = tab === 'boards' || tab === 'leaders'
    ? []
    : (await listLatestMarketRows().then((rows) => rows.map(toMarketQuoteRow)).catch(() => []))
      .filter((row) => quoteMatchesTab(row.code, tab))
      .sort((a, b) => Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0));
  const rows = localRows.length ? mergeQuoteRows(localRows, quoteCache.rows) : cached?.rows ?? quoteCache.rows.filter((row) => quoteMatchesTab(row.code, tab));
  const cachedBoards = cached?.boards?.length ? cached.boards : getCachedMarketBoardsForTab(tab, period);
  const indices = marketIndexCache.get(period)?.rows ?? cached?.indices ?? await getLocalMarketIndices(period);
  return {
    tab,
    period,
    updatedAt: cached?.updatedAt ?? new Date().toISOString(),
    indices,
    rows,
    boards: tab === 'boards' || tab === 'leaders' ? cachedBoards : [],
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
  marketPageCache.set(key, { ...entry, refreshing });
  return refreshing;
}

function marketPageKey(tab: MarketTab, period: MarketIndexPeriod) {
  return `${tab}:${period}`;
}

function getLeaderBoardsWithCachedSeries(rows: MarketBoardRow[], period: MarketIndexPeriod) {
  return rows.slice(0, 4).map((row) => {
    const cached = boardSeriesCache.get(`${row.code}:${period}`)?.rows;
    return {
      ...row,
      minutes: cached ?? row.minutes ?? [],
    };
  });
}

function emitLeaderBoardSnapshot(period: MarketIndexPeriod) {
  const boards = getLeaderBoardsWithCachedSeries(marketBoardsCache.rows, period);
  const snapshot = { tab: 'leaders' as const, period, updatedAt: new Date().toISOString(), indices: marketIndexCache.get(period)?.rows ?? [], rows: [], boards };
  marketPageCache.set(marketPageKey('leaders', period), { snapshot });
  marketPageEvents.emit('updated', snapshot);
}

function hydrateLeaderBoardSeries(period: MarketIndexPeriod) {
  for (const row of marketBoardsCache.rows.slice(0, 4)) {
    void getCachedBoardSeries(row.code, period).then((minutes) => {
      if (!minutes.length) return;
      marketBoardsCache = { ...marketBoardsCache, rows: mergeByCode(marketBoardsCache.rows, [{ ...row, minutes }]), updatedAt: Date.now() };
      emitLeaderBoardSnapshot(period);
    });
  }
}

function getCachedMarketBoardsForTab(tab: MarketTab, period: MarketIndexPeriod) {
  if (marketBoardsCache.rows.length) {
    if (tab === 'leaders') hydrateLeaderBoardSeries(period);
    return tab === 'leaders' ? getLeaderBoardsWithCachedSeries(marketBoardsCache.rows, period) : marketBoardsCache.rows.slice(0, 200);
  }
  void getCachedMarketBoardRows().then((rows) => {
    if (!rows.length) return;
    if (tab === 'leaders') hydrateLeaderBoardSeries(period);
    const boards = tab === 'leaders' ? getLeaderBoardsWithCachedSeries(rows, period) : rows.slice(0, 200);
    const snapshot = { tab, period, updatedAt: new Date().toISOString(), indices: marketIndexCache.get(period)?.rows ?? [], rows: [], boards };
    marketPageCache.set(marketPageKey(tab, period), { snapshot });
    marketPageEvents.emit('updated', snapshot);
  });
  return marketPageCache.get(marketPageKey(tab === 'leaders' ? 'boards' : 'leaders', period))?.snapshot?.boards ?? [];
}

let eastmoneyClistWarned = false;
const eastmoneyClistDisabledUntil = new Map<string, number>();

async function getRemoteMarketQuotes(tab: MarketTab): Promise<MarketQuoteRow[]> {
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
    return mergeQuoteRows(local, quoteCache.rows);
  }
  if (quoteCache.rows.length) {
    void refreshQuoteCache();
    return quoteCache.rows;
  }
  return refreshQuoteCache();
}

async function refreshQuoteCache() {
  if (quoteCache.promise) return quoteCache.promise;
  if (quoteCache.rows.length && Date.now() - quoteCache.updatedAt < 4_500) return quoteCache.rows;
  quoteCache.promise = withTimeoutReject((sdk as unknown as { quoteService: { getAllAShareQuotes(): Promise<unknown[]> } }).quoteService.getAllAShareQuotes(), 10_000, 'Tencent quotes timeout')
    .then((rows) => {
      quoteCache = { rows: mergeByCode(quoteCache.rows, (rows as AnyRecord[]).map(toMarketQuoteRow)), updatedAt: Date.now() };
      return quoteCache.rows;
    })
    .catch(() => quoteCache.rows)
    .finally(() => { quoteCache.promise = undefined; }) as Promise<MarketQuoteRow[]>;
  return quoteCache.promise;
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

async function getMarketBoards(tab: MarketTab, period: MarketIndexPeriod): Promise<MarketBoardRow[]> {
  const rows = await getCachedMarketBoardRows();
  const leaders = rows
    .filter((row) => row.code && row.name)
    .sort((a, b) => Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0))
    .slice(0, tab === 'leaders' ? 4 : 200);
  if (tab !== 'leaders') {
    void warmBoardDetailCache(leaders.slice(0, 30));
    return leaders;
  }
  const withSeries = await Promise.all(leaders.map(async (row) => ({ ...row, minutes: await getCachedBoardSeries(row.code, period) })));
  marketBoardsCache = { ...marketBoardsCache, rows: mergeByCode(marketBoardsCache.rows, withSeries), updatedAt: Date.now() };
  void warmBoardDetailCache(withSeries);
  return withSeries;
}

async function warmBoardDetailCache(rows: MarketBoardRow[]) {
  for (const row of rows) {
    const cached = await readBoardDetail(row.code).catch(() => undefined);
    if (cached?.detail.kline?.length && cached.detail.constituents?.length) continue;
    void getBoardDetail(row.code).catch(() => undefined);
    break;
  }
}

async function getCachedMarketBoardRows(): Promise<MarketBoardRow[]> {
  if (marketBoardsCache.rows.length) {
    if (shouldUseRemoteMarketData() && Date.now() - marketBoardsCache.updatedAt > 5_000) void refreshMarketBoardRows();
    return marketBoardsCache.rows;
  }
  const disk = await readBoardSnapshot().catch(() => undefined);
  if (disk?.rows.length) {
    marketBoardsCache = { rows: disk.rows, updatedAt: Date.parse(disk.updatedAt) || Date.now(), loadedFromDb: true };
    if (shouldUseRemoteMarketData()) void refreshMarketBoardRows();
    return marketBoardsCache.rows;
  }
  const local = await getLocalIndustryBoardRows();
  if (local.length) {
    marketBoardsCache = { rows: local, updatedAt: Date.now() };
    void persistMarketBoardRows(local);
    if (shouldUseRemoteMarketData()) void refreshMarketBoardRows();
    return local;
  }
  return shouldUseRemoteMarketData() ? refreshMarketBoardRows() : [];
}

async function refreshMarketBoardRows(): Promise<MarketBoardRow[]> {
  if (marketBoardsCache.promise) return marketBoardsCache.promise;
  marketBoardsCache.promise = getRemoteMarketBoardRows()
    .then((rows) => rows.length ? rows : getLocalIndustryBoardRows())
    .then((rows) => {
      if (rows.length) {
        const merged = mergeByCode(marketBoardsCache.rows, rows);
        marketBoardsCache = { rows: merged, updatedAt: Date.now() };
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

function startMarketBoardsRefreshLoop(period: MarketIndexPeriod) {
  if (marketBoardsRefreshTimer || !shouldUseRemoteMarketData()) return;
  marketBoardsRefreshTimer = setInterval(() => {
    if (!shouldUseRemoteMarketData()) {
      clearInterval(marketBoardsRefreshTimer);
      marketBoardsRefreshTimer = undefined;
      return;
    }
    void refreshMarketBoardRows().then((rows) => {
      for (const tab of ['leaders', 'boards'] as const) {
        if (tab === 'leaders') hydrateLeaderBoardSeries(period);
        const boards = tab === 'leaders' ? getLeaderBoardsWithCachedSeries(rows, period) : rows.slice(0, 200);
        const snapshot = { tab, period, updatedAt: new Date().toISOString(), indices: marketIndexCache.get(period)?.rows ?? [], rows: [], boards };
        marketPageCache.set(marketPageKey(tab, period), { snapshot });
        marketPageEvents.emit('updated', snapshot);
      }
    });
  }, 5_000);
}

function shouldUseRemoteMarketData() {
  const status = remoteMarketStatus();
  return status === 'open' || status === 'pre_market' || status === 'lunch_break';
}

async function getRemoteMarketBoardRows(): Promise<MarketBoardRow[]> {
  const groups = await Promise.allSettled([
    fetchEastmoneyClist('m:90 t:2 f:!50', 1000, 'https://17.push2.eastmoney.com/api/qt/clist/get'),
    fetchEastmoneyClist('m:90 t:3 f:!50', 1000, 'https://79.push2.eastmoney.com/api/qt/clist/get'),
  ]);
  const remoteRows = groups.flatMap((group) => group.status === 'fulfilled' ? group.value : []).map(toMarketBoardRow).filter((row) => row.code && row.name);
  if (remoteRows.length) {
    const missingKinds: BoardKind[] = [];
    if (groups[0]?.status !== 'fulfilled') missingKinds.push('industry');
    if (groups[1]?.status !== 'fulfilled') missingKinds.push('concept');
    const sdkRows = missingKinds.length ? await getSdkMarketBoardRows(missingKinds) : [];
    return mergeByCode(remoteRows, sdkRows);
  }
  const error = groups.find((group) => group.status === 'rejected');
  if (error?.status === 'rejected') warnEastmoneyFallback('boards', error.reason);
  const sdkRows = await getSdkMarketBoardRows();
  return sdkRows.length ? sdkRows : getLocalIndustryBoardRows();
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
    ...industryRows as unknown as AnyRecord[],
    ...conceptRows as unknown as AnyRecord[],
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

async function getLocalIndustryBoardRows(): Promise<MarketBoardRow[]> {
  const rows = await listLatestMarketRows().catch(() => []);
  const securities = await listSecurities().catch(() => []);
  const industryByCode = new Map(securities.map((item) => [item.symbol, item.industry]).filter((item): item is [string, string] => Boolean(item[1])));
  const groups = new Map<string, { amount: number; volume: number; marketCap: number; changeSum: number; changeCount: number }>();
  for (const row of rows) {
    const industry = industryByCode.get(row.code);
    if (!industry) continue;
    const group = groups.get(industry) ?? { amount: 0, volume: 0, marketCap: 0, changeSum: 0, changeCount: 0 };
    group.amount += Number(row.amount) || 0;
    group.volume += Number(row.volume) || 0;
    group.changeSum += Number(row.changePercent) || 0;
    group.changeCount += Number.isFinite(Number(row.changePercent)) ? 1 : 0;
    groups.set(industry, group);
  }
  return [...groups.entries()].map(([name, group]) => ({
    code: `LOCAL-${safeBoardCode(name)}`,
    name,
    price: undefined,
    changePercent: group.changeCount ? group.changeSum / group.changeCount : undefined,
    volume: group.volume || undefined,
    amount: group.amount || undefined,
    marketCap: group.marketCap || undefined,
    minutes: [],
  })).sort((a, b) => Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0));
}

function safeBoardCode(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash.toString(36).toUpperCase();
}

function normalizeBoardName(name: string) {
  return name.replace(/行业|板块|Ⅱ|Ⅲ|II|III|\s/g, '');
}

function boardNamesMatch(industry: string, boardName: string) {
  const local = normalizeBoardName(industry);
  return local === boardName || local.includes(boardName) || boardName.includes(local);
}

async function fetchEastmoneyClist(fs: string, pageSize = 10000, endpoint = 'https://push2.eastmoney.com/api/qt/clist/get'): Promise<AnyRecord[]> {
  if (Date.now() < (eastmoneyClistDisabledUntil.get(endpoint) ?? 0)) throw new Error('东财行情临时不可用，使用备用源');
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
    if (response.status === 502 || response.status === 403 || response.status === 429) eastmoneyClistDisabledUntil.set(endpoint, Date.now() + 5 * 60_000);
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
  return {
    code: String(row.f12 ?? row.code ?? ''),
    name: String(row.f14 ?? row.name ?? row.f12 ?? ''),
    price: pickNumber(row, ['f2', 'price']),
    changePercent: pickNumber(row, ['f3', 'changePercent']),
    volume: pickNumber(row, ['f5', 'volume', 'volume2']),
    amount: pickNumber(row, ['f6', 'amount']),
    open: pickNumber(row, ['f17', 'open']),
    high: pickNumber(row, ['f15', 'high']),
    low: pickNumber(row, ['f16', 'low']),
    prevClose: pickNumber(row, ['f18', 'prevClose']),
    turnoverRate: pickNumber(row, ['f8', 'turnoverRate']),
    marketCap: pickNumber(row, ['f20', 'totalMarketCap', 'marketCap']),
  };
}

function toMarketBoardRow(row: AnyRecord): MarketBoardRow {
  return {
    code: String(row.f12 ?? row.code ?? row.boardCode ?? ''),
    name: String(row.f14 ?? row.name ?? row.boardName ?? row.f12 ?? ''),
    price: pickNumber(row, ['f2', 'price', 'latestPrice']),
    changePercent: pickNumber(row, ['f3', 'changePercent']),
    volume: pickNumber(row, ['f5', 'volume']),
    amount: pickNumber(row, ['f6', 'amount']),
    marketCap: pickNumber(row, ['f20', 'totalMarketCap', 'marketCap']),
    turnoverRate: pickNumber(row, ['f8', 'turnoverRate']),
    minutes: [],
  };
}

async function getMarketIndices(period: MarketIndexPeriod): Promise<MarketIndexSnapshot[]> {
  const result = await Promise.all(['sh000001', 'sz399001'].map((code) => fetchMarketIndex(code, period)));
  return result.filter((item): item is MarketIndexSnapshot => Boolean(item));
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

async function getCachedBoardSeries(code: string, period: MarketIndexPeriod) {
  const key = `${code}:${period}`;
  const entry = boardSeriesCache.get(key) ?? {};
  if (entry.refreshing) return entry.refreshing;
  if (entry.rows?.length) return entry.rows;
  let resolvedRows: KlinePoint[] = [];
  const refreshing = fetchBoardSeries(code, period).then((rows) => {
    resolvedRows = rows;
    return rows;
  }).catch(() => [] as KlinePoint[]).finally(() => {
    const latest = boardSeriesCache.get(key);
    if (latest?.refreshing !== refreshing) return;
    if (resolvedRows.length) boardSeriesCache.set(key, { rows: resolvedRows });
    else boardSeriesCache.delete(key);
  });
  boardSeriesCache.set(key, { ...entry, refreshing });
  return refreshing;
}

async function fetchBoardSeries(code: string, period: MarketIndexPeriod): Promise<KlinePoint[]> {
  if (code.startsWith('LOCAL-')) return period === '1d' ? (await getLocalBoardDetail(code)).kline ?? [] : [];
  const aStockRows = await getAStockBoardKline(code, period).catch(() => []);
  if (aStockRows.length) return aStockRows;
  const sdkRows = await fetchSdkBoardSeries(code, period);
  if (sdkRows.length) return sdkRows;
  return fetchEastmoneyBoardSeries(code, period);
}

async function fetchSdkBoardSeries(code: string, period: MarketIndexPeriod): Promise<KlinePoint[]> {
  const limit = period === '4h' ? 80 : period === '1d' ? 120 : 60;
  const load = async (board: BoardApi) => {
    const rows = period === '1d'
      ? await board.kline(code, { period: 'daily', adjust: 'qfq' })
      : await board.minuteKline(code, { period: period === '15m' ? '15' : '60' });
    const points = rows.map(toKlinePoint).filter((point): point is KlinePoint => Boolean(point)).slice(-limit);
    return period === '4h' ? aggregateKline(points, 4) : points;
  };
  const boardName = marketBoardsCache.rows.find((row) => row.code === code)?.name;
  for (const board of await getBoardApis(code, boardName)) {
    try {
      const rows = await load(board);
      if (rows.length) return rows;
    } catch {
      // Try the other board namespace, then the real-data HTTP fallback.
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

async function fetchMarketIndex(code: string, period: MarketIndexPeriod): Promise<MarketIndexSnapshot | undefined> {
  try {
    const [quote, minutes] = await Promise.all([fetchIndexQuote(code), fetchIndexSeries(code, period)]);
    return quote ? { ...quote, minutes } : undefined;
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

async function fetchIndexSeries(code: string, period: MarketIndexPeriod) {
  if (period === '1d') return fetchIndexDailySeries(code);
  const k = period === '15m' ? '15' : '60';
  const limit = period === '4h' ? 80 : 60;
  const rows = await fetchIndexMinuteSeries(code, k, limit);
  return period === '4h' ? aggregateIndexSeries(rows, 4) : rows;
}

async function fetchIndexMinuteSeries(code: string, k: '15' | '60', limit: number) {
  const url = new URL('https://ifzq.gtimg.cn/appstock/app/kline/mkline');
  url.search = new URLSearchParams({ param: `${code},m${k},,${limit}` }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(4_000), headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: 'https://gu.qq.com/' } });
  if (!response.ok) return [];
  const payload = await response.json() as { data?: Record<string, Record<string, unknown[]>> };
  return ((payload.data?.[code]?.[`m${k}`] ?? []) as unknown[]).map(parseIndexKlinePoint).filter((item): item is NonNullable<ReturnType<typeof parseIndexKlinePoint>> => Boolean(item));
}

function aggregateIndexSeries(data: KlinePoint[], size: number) {
  return aggregateKline(data, size);
}

async function fetchIndexDailySeries(code: string) {
  const url = new URL('https://ifzq.gtimg.cn/appstock/app/fqkline/get');
  url.search = new URLSearchParams({ param: `${code},day,,,120,qfq` }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(4_000), headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: 'https://gu.qq.com/' } });
  if (!response.ok) return [];
  const payload = await response.json() as { data?: Record<string, { day?: unknown[] }> };
  return (payload.data?.[code]?.day ?? []).map(parseIndexKlinePoint).filter((item): item is NonNullable<ReturnType<typeof parseIndexKlinePoint>> => Boolean(item));
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
  })) : fallbackSectorHot();
}

function fallbackSectorHot(): HotFocusItem[] {
  return [
    ['BK0475', '半导体', '+1.86%', '国产替代与AI算力链活跃'],
    ['BK0437', '酿酒行业', '+1.12%', '消费复苏预期升温'],
    ['BK0428', '证券', '+0.94%', '市场成交回暖带动券商弹性'],
    ['BK0737', '软件开发', '+0.73%', 'AI应用与信创方向轮动'],
  ].map(([code, name, changePercent, description]) => ({
    id: `sector-fallback-${code}`,
    title: name,
    code,
    name,
    changePercent,
    description,
    tag: code,
    type: String(changePercent).startsWith('-') ? 'plummet' : 'surge',
  }));
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
