import { calcChipDistribution } from 'stock-sdk';
import type { ChipDistributionItem, ChipKlineLike } from 'stock-sdk';
import type { ChipDistribution, ChipPoint, IChipDistributionResult, KlinePoint, TChipDistributionSource } from '../../../src/shared/types.js';

const CHIP_TREND_DAYS = [5, 10, 20] as const;

export function calculateChipDistribution(
  klines: KlinePoint[],
  source: TChipDistributionSource,
  warnings?: string[],
): IChipDistributionResult {
  const input: ChipKlineLike[] = klines
    .filter(hasValidChipBar)
    .map((bar) => ({
      date: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      turnoverRate: bar.turnoverRate ?? null,
    }));
  if (!input.length || !input.some((bar) => (bar.turnoverRate ?? 0) > 0)) {
    throw new Error('日 K 线缺少有效换手率，无法计算筹码分布');
  }
  const rows = calcChipDistribution(input, { range: 120, includeHistogram: 'all' });
  return chipRowsToResult(rows, source, warnings);
}

export function chipRowsToResult(
  rows: ChipDistributionItem[],
  source: TChipDistributionSource,
  warnings?: string[],
): IChipDistributionResult {
  const latestRow = rows.at(-1);
  const distributions = rows.map(toChipDistribution).filter((item) => item.points.length);
  const distribution = distributions.at(-1);
  if (!distribution) throw new Error('筹码算法未返回有效直方图');
  return {
    latest: distribution,
    distributions,
    trend: CHIP_TREND_DAYS.map((days) => {
      const row = rows.at(-days) ?? latestRow;
      return {
        days,
        concentration70: nullableNumber(row?.concentration70),
        concentration90: nullableNumber(row?.concentration90),
      };
    }),
    source,
    warnings: warnings?.length ? warnings : undefined,
  };
}

function toChipDistribution(row: ChipDistributionItem): ChipDistribution {
  const cost70Low = nullableNumber(row.cost70Low);
  const cost70High = nullableNumber(row.cost70High);
  const cost90Low = nullableNumber(row.cost90Low);
  const cost90High = nullableNumber(row.cost90High);
  const prices = row.histogram?.prices ?? [];
  const ratios = row.histogram?.ratios ?? [];
  const interpolated = buildInterpolatedConcentration(prices, ratios);
  return {
    date: row.date,
    profitRatio: nullableNumber(row.profitRatio),
    avgCost: nullableNumber(row.avgCost),
    cost70: formatCostRange(cost70Low, cost70High),
    cost90: formatCostRange(cost90Low, cost90High),
    concentration70: interpolated?.concentration70 ?? nullableNumber(row.concentration70),
    concentration90: interpolated?.concentration90 ?? nullableNumber(row.concentration90),
    points: prices
      .map((price, index): ChipPoint => ({ price, weight: ratios[index] ?? 0 }))
      .filter((point) => Number.isFinite(point.price) && Number.isFinite(point.weight) && point.weight > 0),
  };
}

function buildInterpolatedConcentration(
  prices: number[],
  ratios: number[],
): { concentration90: number; concentration70: number } | undefined {
  if (!prices.length || !ratios.length || prices.length !== ratios.length) return undefined;
  const total = ratios.reduce((sum, r) => sum + r, 0);
  if (total <= 0) return undefined;
  const cdf: number[] = [];
  let acc = 0;
  for (let i = 0; i < ratios.length; i++) {
    acc += ratios[i];
    cdf.push(acc / total);
  }
  const quantilePrice = (target: number) => {
    if (target <= 0) return prices[0];
    if (target >= 1) return prices[prices.length - 1];
    for (let i = 0; i < cdf.length; i++) {
      if (cdf[i] >= target) {
        if (i === 0) return prices[0];
        const t = (target - cdf[i - 1]) / (cdf[i] - cdf[i - 1]);
        return prices[i - 1] + t * (prices[i] - prices[i - 1]);
      }
    }
    return prices[prices.length - 1];
  };
  const p05 = quantilePrice(0.05);
  const p95 = quantilePrice(0.95);
  const p15 = quantilePrice(0.15);
  const p85 = quantilePrice(0.85);
  const concentration90 = p95 + p05 === 0 ? 0 : (p95 - p05) / (p95 + p05);
  const concentration70 = p85 + p15 === 0 ? 0 : (p85 - p15) / (p85 + p15);
  return {
    concentration90: Math.round(concentration90 * 1000) / 1000,
    concentration70: Math.round(concentration70 * 1000) / 1000,
  };
}

function hasValidChipBar(bar: KlinePoint) {
  return [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite);
}

function nullableNumber(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? undefined : value;
}

function formatCostRange(low: number | undefined, high: number | undefined) {
  return low === undefined || high === undefined ? undefined : `${low.toFixed(2)}-${high.toFixed(2)}`;
}
