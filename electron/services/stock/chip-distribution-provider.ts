import type {
  ChipDistribution,
  ChipPoint,
  IChipDistributionResult,
  KlinePoint,
  TChipDistributionPeriod,
  TChipDistributionSource,
} from '../../../src/shared/types.js';
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
const CHIP_SNAPSHOT_VERSION = 2;
const CHIP_KLINE_LIMIT_BY_PERIOD: Record<TChipDistributionPeriod, number> = {
  '15m': 240,
  '1h': 240,
  '1d': 360,
  '1w': 240,
  '1mo': 120,
};
const CHIP_PERIOD_LABELS: Record<TChipDistributionPeriod, string> = {
  '15m': '15分钟',
  '1h': '1小时',
  '1d': '日K',
  '1w': '周K',
  '1mo': '月K',
};

export async function getChipDistribution(
  symbolInput: string,
  periodInput: unknown = '1d',
): Promise<IChipDistributionResult> {
  const symbol = normalizeASymbol(symbolInput);
  const period = normalizeChipPeriod(periodInput);
  const cacheKey = getChipCacheKey(symbol, period);
  const cached = chipDistributionCache.get(cacheKey);
  const now = Date.now();
  if (
    cached?.result?.period === period &&
    now - cached.updatedAt < CHIP_DISTRIBUTION_CACHE_TTL_MS &&
    (!cached.fetchedAt || isFreshChipCache(cached.fetchedAt, now))
  ) {
    return cached.result;
  }
  if (cached?.promise) return cached.promise;

  const localWarnings: string[] = [];
  try {
    const cacheRecord = await getStockChipCacheRecord(symbol, period);
    if (cacheRecord && isFreshChipCache(cacheRecord.fetchedAt, now)) {
      if (hasCurrentChipSnapshotVersion(cacheRecord.data)) {
        const localResult = asChipDistributionResult(cacheRecord.data, period);
        chipDistributionCache.set(cacheKey, {
          result: localResult,
          updatedAt: Date.now(),
          fetchedAt: cacheRecord.fetchedAt,
        });
        return localResult;
      }
    } else if (cacheRecord) {
      localWarnings.push(`DuckDB ${CHIP_PERIOD_LABELS[period]}筹码缓存已超过 5 天（${cacheRecord.fetchedAt}）`);
    }
  } catch (error) {
    localWarnings.push(`DuckDB ${CHIP_PERIOD_LABELS[period]}筹码缓存读取失败：${formatError(error)}`);
  }

  const promise = loadChipDistribution(symbol, period, localWarnings)
    .then((result) => {
      const checkedResult = asChipDistributionResult(result, period);
      const fetchedAt = new Date().toISOString();
      chipDistributionCache.set(cacheKey, { result: checkedResult, updatedAt: Date.now(), fetchedAt });
      void upsertStockChip(symbol, checkedResult, period).catch((error: unknown) => {
        const warning = `DuckDB ${CHIP_PERIOD_LABELS[period]}筹码缓存写入失败（${symbol}）：${formatError(error)}`;
        console.warn(`[chip-distribution] ${warning}`);
      });
      return checkedResult;
    })
    .catch((error: unknown) => {
      chipDistributionCache.delete(cacheKey);
      throw error;
    });
  chipDistributionCache.set(cacheKey, {
    result: cached?.result,
    updatedAt: cached?.updatedAt ?? 0,
    fetchedAt: cached?.fetchedAt,
    promise,
  });
  return promise;
}

async function loadChipDistribution(
  symbol: string,
  period: TChipDistributionPeriod,
  warnings: string[] = [],
): Promise<IChipDistributionResult> {
  const dailyResult = await loadDailyChipDistribution(symbol, warnings);
  return period === '1d' ? dailyResult : adaptDailyChipDistributionPeriod(dailyResult, period);
}

async function loadDailyChipDistribution(
  symbol: string,
  warnings: string[],
): Promise<IChipDistributionResult> {
  try {
    const result = await loadStockSdkChipDistributionInWorker(symbol);
    return withChipWarnings(asChipDistributionResult(result, '1d'), warnings);
  } catch (stockSdkError) {
    const stockSdkMessage = formatError(stockSdkError);
    const fallbackWarnings = [...warnings, `stock-sdk 筹码数据获取失败：${stockSdkMessage}`];
    try {
      const baidu = await runAStockDataFn<IBaiduKline>('baidu_kline_with_ma', { code: symbol });
      const klines = parseAStockDataBaiduKline(baidu).slice(-CHIP_KLINE_LIMIT_BY_PERIOD['1d']);
      if (!klines.length) throw new Error('a-stock-data 百度日 K 未返回有效数据');
      const result = await calculateChipDistributionInWorker(klines, 'a-stock-data', fallbackWarnings, '1d');
      return withChipWarnings(asChipDistributionResult(result, '1d'), fallbackWarnings);
    } catch (fallbackError) {
      const fallbackMessage = formatError(fallbackError);
      throw new Error(`筹码分布数据获取失败。stock-sdk：${stockSdkMessage}；a-stock-data 百度日 K：${fallbackMessage}`);
    }
  }
}

function adaptDailyChipDistributionPeriod(
  result: IChipDistributionResult,
  period: Exclude<TChipDistributionPeriod, '1d'>,
): IChipDistributionResult {
  const sourceLabel = result.source === 'a-stock-data' ? 'a-stock-data 百度' : 'stock-sdk';
  return {
    ...result,
    period,
    latest: result.latest ? { ...result.latest, period } : undefined,
    distributions: result.distributions.map((distribution) => ({ ...distribution, period })),
    warnings: [
      ...(result.warnings ?? []),
      `数据说明：${CHIP_PERIOD_LABELS[period]}视图展示${sourceLabel}日K筹码分布`,
    ],
  };
}

function getChipCacheKey(symbol: string, period: TChipDistributionPeriod): string {
  return `${symbol}|${period}`;
}

function normalizeChipPeriod(value: unknown): TChipDistributionPeriod {
  if (value === undefined || value === null || value === '') return '1d';
  if (value === '15m' || value === '1h' || value === '1d' || value === '1w' || value === '1mo') return value;
  throw new Error(`不支持的筹码分布周期：${String(value)}`);
}

function isFreshChipCache(fetchedAt: string, now: number): boolean {
  const fetchedAtMs = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedAtMs)) return false;
  const age = now - fetchedAtMs;
  return age >= 0 && age < CHIP_DISTRIBUTION_MAX_AGE_MS;
}

function hasCurrentChipSnapshotVersion(value: unknown): boolean {
  return isRecord(value) && value.chipSnapshotVersion === CHIP_SNAPSHOT_VERSION;
}

function asChipDistributionResult(value: unknown, expectedPeriod: TChipDistributionPeriod): IChipDistributionResult {
  if (!isRecord(value)) throw new Error('DuckDB 筹码缓存格式无效');
  const resultPeriod = typeof value.period === 'string' ? value.period : expectedPeriod;
  if (resultPeriod !== expectedPeriod) {
    throw new Error(`筹码分布缓存周期不匹配：期望 ${expectedPeriod}，实际 ${resultPeriod}`);
  }
  if (!Array.isArray(value.distributions) || !Array.isArray(value.trend)) {
    throw new Error('DuckDB 筹码缓存缺少 distributions/trend');
  }
  const distributions = value.distributions.flatMap((item) => {
    const distribution = normalizeCachedDistribution(item, expectedPeriod);
    return distribution ? [distribution] : [];
  });
  const latest = normalizeCachedDistribution(value.latest, expectedPeriod) ?? distributions.at(-1);
  return {
    period: expectedPeriod,
    latest,
    distributions,
    trend: normalizeChipTrend(value.trend),
    source: normalizeChipSource(value.source),
    warnings: normalizeWarnings(value.warnings),
  };
}

function normalizeCachedDistribution(
  value: unknown,
  expectedPeriod: TChipDistributionPeriod,
): ChipDistribution | undefined {
  if (!isRecord(value) || typeof value.date !== 'string') return undefined;
  const period = typeof value.period === 'string' ? value.period : expectedPeriod;
  if (period !== expectedPeriod) return undefined;
  const points = normalizeChipPoints(value.points);
  if (!points.length) return undefined;
  return {
    date: value.date,
    ...(isFiniteNumber(value.timestamp) ? { timestamp: value.timestamp } : {}),
    period,
    profitRatio: optionalNumber(value.profitRatio),
    avgCost: optionalNumber(value.avgCost),
    cost90: optionalString(value.cost90),
    cost70: optionalString(value.cost70),
    concentration90: optionalNumber(value.concentration90),
    concentration70: optionalNumber(value.concentration70),
    points,
  };
}

function normalizeChipPoints(value: unknown): ChipPoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || !isFiniteNumber(item.price) || !isFiniteNumber(item.weight)) return [];
    return [{ price: item.price, weight: item.weight, profit: optionalNumber(item.profit) }];
  });
}

function normalizeChipTrend(value: unknown[]): IChipDistributionResult['trend'] {
  return value.flatMap((item) => {
    if (!isRecord(item) || !isFiniteNumber(item.days)) return [];
    return [
      {
        days: item.days,
        concentration70: optionalNumber(item.concentration70),
        concentration90: optionalNumber(item.concentration90),
      },
    ];
  });
}

function normalizeChipSource(value: unknown): TChipDistributionSource {
  return value === 'a-stock-data' ? 'a-stock-data' : 'stock-sdk';
}

function normalizeWarnings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const warnings = value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
  return warnings.length ? warnings : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function optionalNumber(value: unknown): number | undefined {
  return isFiniteNumber(value) ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function withChipWarnings(result: IChipDistributionResult, warnings: string[]): IChipDistributionResult {
  if (!warnings.length) return result;
  return { ...result, warnings: [...new Set([...warnings, ...(result.warnings ?? [])])] };
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
