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
  return {
    date: row.date,
    profitRatio: nullableNumber(row.profitRatio),
    avgCost: nullableNumber(row.avgCost),
    cost70: formatCostRange(cost70Low, cost70High),
    cost90: formatCostRange(cost90Low, cost90High),
    concentration70: nullableNumber(row.concentration70),
    concentration90: nullableNumber(row.concentration90),
    points: prices
      .map((price, index): ChipPoint => ({ price, weight: ratios[index] ?? 0 }))
      .filter((point) => Number.isFinite(point.price) && Number.isFinite(point.weight) && point.weight > 0),
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
