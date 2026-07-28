import StockSDK from 'stock-sdk';
import type {
  KlinePoint,
  MarketBoardRow,
  MarketIndexPeriod,
  MarketQuoteRow,
  MarketTab,
} from '../../../src/shared/types.js';
import { readBoardSnapshot, writeBoardSnapshot } from '../market-data/market-data-store.js';
import { remoteMarketStatus } from '../market-data/providers.js';
import { normalizeMarketCap, pickNumber, pickString } from './format.js';

export type BoardKind = 'industry' | 'concept';

export let marketBoardsCache: {
  rows: MarketBoardRow[];
  updatedAt: number;
  promise?: Promise<MarketBoardRow[]>;
  loadedFromDb?: boolean;
} = { rows: [], updatedAt: 0 };
export let marketBoardsLastPersistedAt = 0;

export const boardKindCache = new Map<string, BoardKind>();
export const searchBoardNameCache = new Map<string, string>();

export const sdk = new StockSDK({ timeout: 12_000, retry: { maxRetries: 1 } });
export type IndexKlinePeriod = MarketIndexPeriod | '1w' | '1mo';
export type BoardApi = typeof sdk.board.industry;
export const BOARD_DETAIL_TIMEOUT = 8_000;
export const BOARD_SDK_REQUEST_TIMEOUT = 2_500;
export const BOARD_SDK_OUTER_TIMEOUT = 7_000;
export const BOARD_CONSTITUENT_SCAN_LIMIT = 2_400;
export const BOARD_SCAN_CONCURRENCY = 32;
export const BOARD_SCAN_BUDGET_MS = 5_500;

type AnyRecord = Record<string, unknown>;
let eastmoneyClistWarned = false;
const eastmoneyClistDisabledUntil = new Map<string, number>();



export function aggregateKline(data: KlinePoint[], size: number): KlinePoint[] {
  const result: KlinePoint[] = [];
  for (let i = 0; i < data.length; i += size) {
    const chunk = data.slice(i, i + size);
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    if (!first || !last) continue;
    result.push(aggregateKlineChunk(chunk));
  }
  return result;
}

function aggregateKlineChunk(chunk: KlinePoint[]): KlinePoint {
  const first = chunk[0];
  const last = chunk[chunk.length - 1];
  return {
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
  };
}

/** Aggregate daily bars into calendar weeks (Mon-Sun). */
export function aggregateKlineByWeek(data: KlinePoint[]): KlinePoint[] {
  const groups = new Map<string, KlinePoint[]>();
  for (const point of data) {
    const ts = point.timestamp ?? parseMarketTime(point.time);
    if (!ts) continue;
    const date = new Date(ts);
    const monday = new Date(date);
    monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    const list = groups.get(key) ?? [];
    list.push(point);
    groups.set(key, list);
  }
  return Array.from(groups.values()).map(aggregateKlineChunk);
}

/** Aggregate daily bars into calendar months. */
export function aggregateKlineByMonth(data: KlinePoint[]): KlinePoint[] {
  const groups = new Map<string, KlinePoint[]>();
  for (const point of data) {
    const ts = point.timestamp ?? parseMarketTime(point.time);
    if (!ts) continue;
    const date = new Date(ts);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const list = groups.get(key) ?? [];
    list.push(point);
    groups.set(key, list);
  }
  return Array.from(groups.values()).map(aggregateKlineChunk);
}


export function parseEastmoneyKline(line: string): KlinePoint | undefined {
  const [time, open, close, high, low, volume, amount, amplitude, changePercent, change, turnoverRate] =
    line.split(',');
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


export function parseMarketTime(value: string): number | undefined {
  const text = String(value || '').trim();
  const minute = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (minute) return new Date(`${minute[1]}-${minute[2]}-${minute[3]}T${minute[4]}:${minute[5]}:00+08:00`).getTime();
  const day = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (day) return new Date(`${day[1]}-${day[2]}-${day[3]}T00:00:00+08:00`).getTime();
  const date = Date.parse(text.includes('T') ? text : `${text}T00:00:00+08:00`);
  return Number.isFinite(date) ? date : undefined;
}


export function toKlinePoint(raw: unknown): KlinePoint | undefined {
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


export function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== '' && value !== '--';
}


export function orderBoardApis(kind?: BoardKind): BoardApi[] {
  return kind === 'concept' ? [sdk.board.concept, sdk.board.industry] : [sdk.board.industry, sdk.board.concept];
}


export function mergeByCode<T extends { code: string }>(current: T[], incoming: T[]) {
  const byCode = new Map(current.map((row) => [row.code, row]));
  for (const row of incoming) byCode.set(row.code, { ...byCode.get(row.code), ...compactRow(row) } as T);
  return [...byCode.values()];
}


export function compactRow<T extends object>(row: T) {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null && value !== '';
    }),
  ) as Partial<T>;
}


export async function getCachedMarketBoardRows(allowRemote = true): Promise<MarketBoardRow[]> {
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


export async function refreshMarketBoardRows(): Promise<MarketBoardRow[]> {
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
    .finally(() => {
      marketBoardsCache.promise = undefined;
    }) as Promise<MarketBoardRow[]>;
  return marketBoardsCache.promise;
}


export async function persistMarketBoardRows(rows: MarketBoardRow[]) {
  marketBoardsLastPersistedAt = Date.now();
  await writeBoardSnapshot({ rows, updatedAt: new Date().toISOString() }).catch((error) =>
    console.warn('[market] persist board snapshot failed', error),
  );
}


export function shouldUseRemoteMarketData() {
  const status = remoteMarketStatus();
  return status === 'open' || status === 'pre_market' || status === 'lunch_break';
}


export async function getRemoteMarketBoardRows(): Promise<MarketBoardRow[]> {
  const sdkRows = await getSdkMarketBoardRows();
  if (sdkRows.length) return sdkRows;
  warnEastmoneyFallback('boards', new Error('stock-sdk board.list empty'));
  return fetchEastmoneyBoardRows();
}


export async function fetchEastmoneyBoardRows(): Promise<MarketBoardRow[]> {
  const [industries, concepts] = await Promise.allSettled([
    fetchEastmoneyClist('m:90 t:2 f:!50', 200, 'https://29.push2.eastmoney.com/api/qt/clist/get'),
    fetchEastmoneyClist('m:90 t:3 f:!50', 200, 'https://29.push2.eastmoney.com/api/qt/clist/get'),
  ]);
  const rows = [
    ...(industries.status === 'fulfilled' ? industries.value.map((row) => ({ ...row, kind: 'industry' })) : []),
    ...(concepts.status === 'fulfilled' ? concepts.value.map((row) => ({ ...row, kind: 'concept' })) : []),
  ]
    .map(toMarketBoardRow)
    .filter((row) => row.code && row.name);
  return rows;
}


export async function getSdkMarketBoardRows(kinds: BoardKind[] = ['industry', 'concept']): Promise<MarketBoardRow[]> {
  const [industries, concepts] = await Promise.allSettled([
    kinds.includes('industry')
      ? withTimeoutReject(sdk.board.industry.list(), 5_000, 'industry boards timeout')
      : Promise.resolve([]),
    kinds.includes('concept')
      ? withTimeoutReject(sdk.board.concept.list(), 5_000, 'concept boards timeout')
      : Promise.resolve([]),
  ]);
  const industryRows = industries.status === 'fulfilled' ? industries.value : [];
  const conceptRows = concepts.status === 'fulfilled' ? concepts.value : [];
  for (const item of industryRows) boardKindCache.set(item.code, 'industry');
  for (const item of conceptRows) boardKindCache.set(item.code, 'concept');
  const rows = [
    ...industryRows.map((row) => ({ ...row, kind: 'industry' })),
    ...conceptRows.map((row) => ({ ...row, kind: 'concept' })),
  ]
    .map(toMarketBoardRow)
    .filter((row) => row.code && row.name);
  return enrichBoardSpotRows(rows);
}


export async function enrichBoardSpotRows(rows: MarketBoardRow[]): Promise<MarketBoardRow[]> {
  const result = [...rows];
  for (let start = 0; start < result.length; start += 8) {
    const updates = await Promise.all(
      result.slice(start, start + 8).map(async (row) => {
        if (row.volume !== undefined && row.amount !== undefined) return row;
        for (const board of orderBoardApis(boardKindCache.get(row.code))) {
          try {
            const spot = await board.spot(row.code);
            const metrics = Object.fromEntries(spot.map((item) => [item.item, item.value]));
            const volume = Number(metrics['成交量']);
            const amount = Number(metrics['成交额']);
            if (Number.isFinite(volume) || Number.isFinite(amount))
              return {
                ...row,
                volume: Number.isFinite(volume) ? volume : row.volume,
                amount: Number.isFinite(amount) ? amount : row.amount,
              };
          } catch {
            // Try the other board namespace; keep missing values explicit if both fail.
          }
        }
        return row;
      }),
    );
    updates.forEach((row, index) => {
      result[start + index] = row;
    });
  }
  return result;
}


export function normalizeBoardName(name: string) {
  return name.replace(/行业|板块|Ⅱ|Ⅲ|II|III|\s/g, '');
}


export function boardNamesMatch(industry: string, boardName: string) {
  const local = normalizeBoardName(industry);
  return local === boardName || local.includes(boardName) || boardName.includes(local);
}


export async function fetchEastmoneyClist(
  fs: string,
  pageSize = 10000,
  endpoint = 'https://push2.eastmoney.com/api/qt/clist/get',
  force = false,
): Promise<AnyRecord[]> {
  if (!force && Date.now() < (eastmoneyClistDisabledUntil.get(endpoint) ?? 0))
    throw new Error('东财行情临时不可用，使用备用源');
  const url = new URL(endpoint);
  url.search = new URLSearchParams({
    pn: '1',
    pz: String(pageSize),
    po: '1',
    np: '1',
    fltt: '2',
    invt: '2',
    fs,
    fields: 'f2,f3,f4,f5,f6,f8,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23,f100,f104,f105,f128,f136,f140',
  }).toString();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: 'https://quote.eastmoney.com/' },
  });
  if (!response.ok) {
    if (response.status === 502 || response.status === 403 || response.status === 429)
      eastmoneyClistDisabledUntil.set(endpoint, Date.now() + 30_000);
    throw new Error(`东财行情 HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { data?: { diff?: AnyRecord[] | Record<string, AnyRecord> } };
  const diff = payload.data?.diff ?? [];
  return Array.isArray(diff) ? diff : Object.values(diff);
}


export async function fetchEastmoneyQuoteRowsByCodes(codes: string[]): Promise<AnyRecord[]> {
  const uniqueCodes = [...new Set(codes)].filter(Boolean);
  if (!uniqueCodes.length) return [];
  const rows = await Promise.all(
    chunk(uniqueCodes, 100).map(async (items) => {
      const secids = items.map((code) => `${code.startsWith('6') ? '1' : '0'}.${code}`).join(',');
      const url = new URL('https://push2.eastmoney.com/api/qt/ulist.np/get');
      url.search = new URLSearchParams({
        fltt: '2',
        invt: '2',
        secids,
        fields: 'f2,f3,f4,f5,f6,f8,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23,f100,f104,f105,f128,f136,f140',
      }).toString();
      const response = await fetch(url, {
        signal: AbortSignal.timeout(3_000),
        headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: 'https://quote.eastmoney.com/' },
      });
      if (!response.ok) throw new Error(`东财个股行情 HTTP ${response.status}`);
      const payload = (await response.json()) as { data?: { diff?: AnyRecord[] | Record<string, AnyRecord> } };
      const diff = payload.data?.diff ?? [];
      return Array.isArray(diff) ? diff : Object.values(diff);
    }),
  );
  return rows.flat();
}


export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size));
  return chunks;
}


export function warnEastmoneyFallback(scope: string, error: unknown) {
  if (eastmoneyClistWarned) return;
  eastmoneyClistWarned = true;
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[market] eastmoney ${scope} unavailable (${message}); fallback enabled for 5 minutes`);
}


export function withTimeoutReject<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
}


export function toMarketQuoteRow(row: AnyRecord): MarketQuoteRow {
  const code =
    pickString(row, ['f12', 'code', 'symbol'])
      ?.replace(/^(sh|sz|bj)/i, '')
      .replace(/^\D+/, '') ?? '';
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
    industry: normalizeIndustryName(pickString(row, ['f100', 'industry'])),
  };
}


export function pickStockName(row: AnyRecord, code: string) {
  const name = pickString(row, ['f14', 'name', '名称']);
  return name && !/^\d{6}$/.test(name) ? name : code;
}


export function normalizeAmount(value?: number) {
  return value !== undefined && Math.abs(value) < 1_000_000 ? value * 10_000 : value;
}


export function normalizeIndustryName(value: string | undefined) {
  if (!value) return undefined;
  const text = value.trim();
  return text && text !== '-' && text !== '--' ? text : undefined;
}


export function toMarketBoardRow(row: AnyRecord): MarketBoardRow {
  const rawCode = pickString(row, ['f12', 'code', 'boardCode', 'symbol']) ?? '';
  const code = /^BK\d+$/i.test(rawCode)
    ? rawCode.toUpperCase()
    : rawCode.replace(/^(sh|sz|bj)/i, '').replace(/^\D+/, '');
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
