import type { IChipDistributionResult, KlinePoint } from '../../../src/shared/types.js';
import { getStockChipCacheRecord, upsertStockChip } from '../stock-db/market-data-store.js';
import type { IBaiduKline } from './a-stock-data-runner.js';
import { runAStockDataFn } from './a-stock-data-runner.js';
import {
  calculateChipDistributionInWorker,
  loadStockSdkChipDistributionInWorker,
} from './chip-distribution-worker-client.js';
import { normalizeASymbol } from './symbols.js';

const chipDistributionCache = new Map<
  string,
  {
    result?: IChipDistributionResult;
    updatedAt: number;
    fetchedAt?: string;
    promise?: Promise<IChipDistributionResult>;
  }
>();
const CHIP_DISTRIBUTION_CACHE_TTL_MS = 5 * 60_000;
const CHIP_DISTRIBUTION_MAX_AGE_MS = 5 * 24 * 60 * 60_000;

export async function getChipDistribution(symbolInput: string): Promise<IChipDistributionResult> {
  const symbol = normalizeASymbol(symbolInput);
  const cached = chipDistributionCache.get(symbol);
  const now = Date.now();
  if (
    cached?.result &&
    now - cached.updatedAt < CHIP_DISTRIBUTION_CACHE_TTL_MS &&
    (!cached.fetchedAt || isFreshChipCache(cached.fetchedAt, now))
  ) {
    return cached.result;
  }
  if (cached?.promise) return cached.promise;

  const localWarnings: string[] = [];
  try {
    const cacheRecord = await getStockChipCacheRecord(symbol);
    if (cacheRecord && isFreshChipCache(cacheRecord.fetchedAt, now)) {
      const localResult = asChipDistributionResult(cacheRecord.data);
      chipDistributionCache.set(symbol, {
        result: localResult,
        updatedAt: Date.now(),
        fetchedAt: cacheRecord.fetchedAt,
      });
      return localResult;
    }
    if (cacheRecord) localWarnings.push(`DuckDB 筹码缓存已超过 5 天（${cacheRecord.fetchedAt}）`);
  } catch (error) {
    localWarnings.push(`DuckDB 筹码缓存读取失败：${formatError(error)}`);
  }

  const promise = loadChipDistribution(symbol, localWarnings)
    .then(async (result) => {
      const fetchedAt = new Date().toISOString();
      try {
        await upsertStockChip(symbol, result);
      } catch (error) {
        throw new Error(`DuckDB 筹码缓存写入失败（${symbol}）：${formatError(error)}`);
      }
      chipDistributionCache.set(symbol, { result, updatedAt: Date.now(), fetchedAt });
      return result;
    })
    .catch((error: unknown) => {
      chipDistributionCache.delete(symbol);
      throw error;
    });
  chipDistributionCache.set(symbol, {
    result: cached?.result,
    updatedAt: cached?.updatedAt ?? 0,
    fetchedAt: cached?.fetchedAt,
    promise,
  });
  return promise;
}

async function loadChipDistribution(symbol: string, warnings: string[] = []): Promise<IChipDistributionResult> {
  try {
    const result = await loadStockSdkChipDistributionInWorker(symbol);
    return withChipWarnings(result, warnings);
  } catch (stockSdkError) {
    const stockSdkMessage = formatError(stockSdkError);
    const fallbackWarnings = [...warnings, `stock-sdk 筹码数据获取失败：${stockSdkMessage}`];
    try {
      const baidu = await runAStockDataFn<IBaiduKline>('baidu_kline_with_ma', { code: symbol });
      const klines = parseAStockDataBaiduKline(baidu).slice(-360);
      if (!klines.length) throw new Error('a-stock-data 百度日 K 未返回有效数据');
      return await calculateChipDistributionInWorker(klines, 'a-stock-data', fallbackWarnings);
    } catch (fallbackError) {
      const fallbackMessage = formatError(fallbackError);
      throw new Error(`筹码分布数据获取失败。stock-sdk：${stockSdkMessage}；a-stock-data 百度日 K：${fallbackMessage}`);
    }
  }
}

function isFreshChipCache(fetchedAt: string, now: number): boolean {
  const fetchedAtMs = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedAtMs)) return false;
  const age = now - fetchedAtMs;
  return age >= 0 && age < CHIP_DISTRIBUTION_MAX_AGE_MS;
}

function asChipDistributionResult(value: unknown): IChipDistributionResult {
  if (!value || typeof value !== 'object') throw new Error('DuckDB 筹码缓存格式无效');
  const result = value as Partial<IChipDistributionResult>;
  if (!Array.isArray(result.distributions) || !Array.isArray(result.trend)) {
    throw new Error('DuckDB 筹码缓存缺少 distributions/trend');
  }
  return result as IChipDistributionResult;
}

function withChipWarnings(result: IChipDistributionResult, warnings: string[]): IChipDistributionResult {
  if (!warnings.length) return result;
  return { ...result, warnings: [...warnings, ...(result.warnings ?? [])] };
}

function parseAStockDataBaiduKline(data: IBaiduKline | null): KlinePoint[] {
  if (!data || !Array.isArray(data.keys) || !Array.isArray(data.rows)) return [];
  const indexOf = (name: string) => data.keys.indexOf(name);
  const timeIndex = indexOf('time');
  const openIndex = indexOf('open');
  const highIndex = indexOf('high');
  const lowIndex = indexOf('low');
  const closeIndex = indexOf('close');
  const volumeIndex = indexOf('volume');
  if (timeIndex < 0 || closeIndex < 0) return [];
  return data.rows.flatMap((row) => {
    const values = row.split(',');
    const point: KlinePoint = {
      time: values[timeIndex] ?? '',
      open: Number(values[openIndex]),
      high: Number(values[highIndex]),
      low: Number(values[lowIndex]),
      close: Number(values[closeIndex]),
      volume: Number(values[volumeIndex]) || 0,
      amount: optionalKlineNumber(values, indexOf('amount')),
      change: optionalKlineNumber(values, indexOf('ratioamount')),
      changePercent: optionalKlineNumber(values, indexOf('ratioprice')),
      turnoverRate:
        optionalKlineNumber(values, indexOf('turnoverratio')) ?? optionalKlineNumber(values, indexOf('turnover')),
    };
    return point.time && [point.open, point.high, point.low, point.close].every(Number.isFinite) ? [point] : [];
  });
}

function optionalKlineNumber(values: string[], index: number): number | undefined {
  if (index < 0) return undefined;
  const value = Number(values[index]);
  return Number.isFinite(value) ? value : undefined;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
