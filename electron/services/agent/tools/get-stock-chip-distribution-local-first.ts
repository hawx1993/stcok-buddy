import type { ChipDistribution, IChipDistributionResult } from '../../../../src/shared/types.js';
import { getStockChipCacheRecord } from '../../market-data/market-data-store.js';
import type { AgentTool } from '../../tools/types.js';
import { getStockChipDistribution } from './get-stock-chip-distribution.js';
import { asRecord, num, safePositiveInt, text } from './input.js';

interface IStockChipDistributionLocalFirstInput {
  symbol: string;
  days?: number;
}
interface IChipDistributionSummary {
  date: string;
  profitRatio?: number;
  avgCost?: number;
  cost70?: string;
  cost90?: string;
  concentration70?: number;
  concentration90?: number;
}
export interface IStockChipDistributionLocalFirstOutput {
  source: 'duckdb:market' | 'stock-sdk' | 'a-stock-data';
  storage: 'local' | 'remote';
  freshness: 'current' | 'fallback';
  fetchedAt?: string;
  sourceTrace: string[];
  symbol: string;
  latest?: ChipDistribution;
  recent: IChipDistributionSummary[];
  trend: IChipDistributionResult['trend'];
  warnings: string[];
  isEmpty: boolean;
}

function isChipDistributionResult(value: unknown): value is IChipDistributionResult {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<IChipDistributionResult>;
  return Array.isArray(record.distributions) && Array.isArray(record.trend);
}
function summarizeChipDistribution(item: ChipDistribution): IChipDistributionSummary {
  return {
    date: item.date,
    profitRatio: item.profitRatio,
    avgCost: item.avgCost,
    cost70: item.cost70,
    cost90: item.cost90,
    concentration70: item.concentration70,
    concentration90: item.concentration90,
  };
}
function isChipCacheFresh(fetchedAt: string, now: number): boolean {
  const fetchedAtMs = Date.parse(fetchedAt);
  const age = now - fetchedAtMs;
  return Number.isFinite(fetchedAtMs) && age >= 0 && age < 5 * 24 * 60 * 60_000;
}

/** 模型可调用：读取五日内的真实 DuckDB 筹码缓存，过期或缺失时走既有远程筹码链路。 */
export const getStockChipDistributionLocalFirst: AgentTool<
  IStockChipDistributionLocalFirstInput,
  IStockChipDistributionLocalFirstOutput
> = {
  name: 'getStockChipDistributionLocalFirst',
  description:
    'Get single-stock chip distribution with priority DuckDB → stock-sdk → a-stock-data, including 90% and 70% concentration.',
  inputSchema: {
    type: 'object',
    properties: { symbol: { type: 'string' }, days: { type: 'number' } },
    required: ['symbol'],
  },
  async run(input) {
    const record = asRecord(input);
    const symbol = text(record, 'symbol').trim();
    const days = safePositiveInt(num(record, 'days', 5), 5, 120);
    const sourceTrace: string[] = [];
    const now = Date.now();
    try {
      const cacheRecord = await getStockChipCacheRecord(symbol);
      if (cacheRecord && isChipCacheFresh(cacheRecord.fetchedAt, now)) {
        const localChip = cacheRecord.data;
        if (isChipDistributionResult(localChip)) {
          const recent = localChip.distributions.slice(-days).map(summarizeChipDistribution);
          const isEmpty = !localChip.latest && recent.length === 0;
          return {
            source: 'duckdb:market',
            storage: 'local',
            freshness: 'current',
            fetchedAt: cacheRecord.fetchedAt,
            sourceTrace: localChip.warnings ?? [],
            symbol,
            latest: localChip.latest,
            recent,
            trend: localChip.trend,
            warnings: isEmpty ? ['本地 DuckDB 筹码缓存没有有效分布数据'] : [],
            isEmpty,
          };
        }
        sourceTrace.push('本地 DuckDB 筹码缓存格式无效，已尝试远程真实数据源');
      } else if (cacheRecord) {
        sourceTrace.push(`本地 DuckDB 筹码缓存已超过 5 天（${cacheRecord.fetchedAt}），已刷新远程真实数据源`);
      } else {
        sourceTrace.push('本地 DuckDB 暂无该股票筹码缓存，已尝试远程真实数据源');
      }
    } catch (error) {
      sourceTrace.push(`本地 DuckDB 筹码读取失败：${error instanceof Error ? error.message : String(error)}`);
    }
    const remoteChip = await getStockChipDistribution.run({ symbol });
    const recent = remoteChip.distributions.slice(-days).map(summarizeChipDistribution);
    const isEmpty = !remoteChip.latest && recent.length === 0;
    return {
      source: remoteChip.source,
      storage: 'remote',
      freshness: 'current',
      fetchedAt: new Date().toISOString(),
      sourceTrace: [...sourceTrace, ...(remoteChip.warnings ?? [])],
      symbol,
      latest: remoteChip.latest,
      recent,
      trend: remoteChip.trend,
      warnings: isEmpty ? ['远程筹码数据源未返回有效分布数据'] : [],
      isEmpty,
    };
  },
};
