import type {
  KlinePoint,
  MarketIndexPeriod,
  MarketIndexSnapshot,
} from '../../../src/shared/types.js';
import {
  type IndexKlinePeriod,
  aggregateKline,
  mergeByCode,
  parseMarketTime,
} from './shared.js';
import { marketIndexCache } from './market-state.js';
import { upsertDailyBars } from '../market-data/market-data-store.js';
import type { DailyBarRecord } from '../market-data/types.js';

type AnyRecord = Record<string, unknown>;

export async function getMarketIndices(period: MarketIndexPeriod): Promise<MarketIndexSnapshot[]> {
  const result = await Promise.all(['sh000001', 'sz399001'].map((code) => fetchMarketIndex(code, period)));
  const indices = result.filter((item): item is MarketIndexSnapshot => Boolean(item));
  // 把指数日线持久化到 DuckDB；周线/月线由本地日线聚合生成，避免不同周期数据混在一起。
  if (period === '1d') {
    persistIndexSnapshots(indices, period).catch((err) =>
      console.warn('[market-indices] persist to DuckDB failed', err),
    );
  }
  return indices;
}

export function normalizeIndexSymbol(input: string): 'sh000001' | 'sz399001' | undefined {
  const text = input.trim().toLowerCase();
  if (text === '上证指数' || text === 'sh000001') return 'sh000001';
  if (text === '深证成指' || text === 'sz399001') return 'sz399001';
  return undefined;
}

export function isIndexKlinePeriod(period: string): period is IndexKlinePeriod {
  return (
    period === '15m' || period === '1h' || period === '4h' || period === '1d' || period === '1w' || period === '1mo'
  );
}

export async function getCachedMarketIndices(period: MarketIndexPeriod) {
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

/** Normalize Tencent compact dates ("20240722") to ISO ("2024-07-22") for DuckDB DATE columns. */
export function normalizeIndexDate(time: string): string {
  const compact = time.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(time)) return time;
  return time.slice(0, 10);
}

/** 将指数 K 线写入 daily_bars，离线时 getLocalMarketIndices / getCachedIndexKline 可直接读取 */
async function persistIndexSnapshots(indices: MarketIndexSnapshot[], period: MarketIndexPeriod) {
  const fetchedAt = new Date().toISOString();
  const bars: DailyBarRecord[] = [];
  for (const index of indices) {
    const symbol = index.code;
    if (!symbol || !index.minutes?.length) continue;
    for (const point of index.minutes) {
      if (!point.time) continue;
      const tradeDate = normalizeIndexDate(point.time);
      bars.push({
        symbol,
        tradeDate,
        open: point.open,
        high: point.high,
        low: point.low,
        close: point.close,
        volume: point.volume,
        amount: point.amount,
        change: point.change,
        changePercent: point.changePercent,
        turnoverRate: point.turnoverRate,
        adjustType: 'qfq',
        source: `stock-sdk:tencent-index:${period}`,
        fetchedAt,
      });
    }
  }
  if (bars.length) await upsertDailyBars(bars);
}

export async function fetchMarketIndex(
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

export function formatTencentMinuteTimestamp(timestamp: number) {
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

function formatTencentHistoryDate(timestamp: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(timestamp));
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

export function fallbackIndices(period: MarketIndexPeriod): MarketIndexSnapshot[] {
  return [fallbackIndex('sh000001', period), fallbackIndex('sz399001', period)];
}

export function fallbackIndex(code: string, _period: MarketIndexPeriod): MarketIndexSnapshot {
  const symbol = code === '399001' || code === 'sz399001' ? '399001' : '000001';
  const name = symbol === '399001' ? '深证成指' : '上证指数';
  return { code: symbol, name, price: '--', change: '--', changePercent: '--', minutes: [] };
}
