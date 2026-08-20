import type { IAgentContext } from './orchestrator-types.js';
import {
  countDailyBarsForDate,
  countFreshListedStockChips,
  countStockSnapshots,
  getLatestSyncJob,
  getLatestTradeDate,
  getMarketDataStats,
} from '../stock-db/market-data-store.js';
import { determineTargetTradeDate, ensureMarketDataCoverage } from '../market-data/market-data-sync.js';
import {
  hydrateAllMarketChipsInWorker,
  hydrateAllMarketSnapshotsInWorker,
  hydrateAllSecuritiesInWorker,
} from '../market-data/market-data-hydration-worker-client.js';
import type { IMarketDataHydrationStatus } from '../market-data/market-data-hydration-worker-types.js';
import { getChipDistribution } from '../stock/chip-distribution-provider.js';

const DEFAULT_MIN_COVERAGE = 5000;
const DEFAULT_CHIP_TIMEOUT_MS = 120_000;
const CHIP_DISTRIBUTION_MAX_AGE_MS = 5 * 24 * 60 * 60_000;

export type TChipCoverageMode = 'none' | 'symbol' | 'market';

export interface IDataCoverageResult {
  ok: boolean;
  minCoverage: number;
  needsChips: boolean;
  chipCoverageMode: TChipCoverageMode;
  chipSymbol?: string;
  before: {
    securities: number;
    snapshots: number;
    dailyBarSymbols: number;
    chips: number;
  };
  after: {
    securities: number;
    snapshots: number;
    dailyBarSymbols: number;
    chips: number;
  };
  hydrated: {
    securities: number;
    snapshots: number;
    dailyBarSymbols: number;
    chips: number;
  };
  warnings: string[];
  elapsedMs: number;
}

interface ICoverageStats {
  securities: number;
  snapshots: number;
  dailyBarSymbols: number;
  chips: number;
}

export async function runDataCoverageAgent(
  ctx: IAgentContext,
  options: {
    minCoverage?: number;
    needsChips?: boolean;
    chipCoverageMode?: TChipCoverageMode;
    chipSymbol?: string;
    chipTimeoutMs?: number;
    requireDailyBars?: boolean;
  } = {},
): Promise<IDataCoverageResult> {
  const start = Date.now();
  const minCoverage = options.minCoverage ?? DEFAULT_MIN_COVERAGE;
  const chipCoverageMode = options.chipCoverageMode ?? (options.needsChips ? 'market' : 'none');
  const needsChips = chipCoverageMode !== 'none';
  const requireDailyBars = options.requireDailyBars ?? true;
  const chipTimeoutMs = options.chipTimeoutMs ?? DEFAULT_CHIP_TIMEOUT_MS;
  const warnings: string[] = [];

  emitProgress(ctx, `正在检查本地数据覆盖度（目标 ${minCoverage} 只个股）...`);
  let targetTradeDate: string | undefined;
  try {
    targetTradeDate = await determineTargetTradeDate();
  } catch (error) {
    warnings.push(`无法确定最近已收盘交易日：${formatError(error)}`);
  }
  const before = await readCoverageStats(targetTradeDate);
  let after = before;

  // 1. 行情快照同时提供证券名称和交易所，使用 worker 拉取全市场真实数据并在 DuckDB 批量写入。
  if (after.snapshots < minCoverage) {
    emitProgress(ctx, `本地行情快照 ${after.snapshots} 只，不足 ${minCoverage}，正在 worker 中获取全市场实时行情...`);
    try {
      const result = await hydrateAllMarketSnapshotsInWorker((status) => {
        emitHydrationProgress(ctx, status, '正在同步全市场行情快照...');
      });
      warnings.push(...result.warnings);
      if (!result.hydrated) warnings.push('stock-sdk 未返回全市场快照，行情快照覆盖度未提升');
    } catch (error) {
      warnings.push(`获取全市场行情快照失败：${formatError(error)}`);
    }
  }

  // 2. 快照无法补足证券列表时才走名称补齐，使用 worker 避免主线程承担全市场远程遍历。
  after = await readCoverageStats(targetTradeDate);
  if (after.securities < minCoverage) {
    emitProgress(ctx, `本地证券列表 ${after.securities} 只，不足 ${minCoverage}，正在 worker 中同步全市场证券基础信息...`);
    try {
      const result = await hydrateAllSecuritiesInWorker((status) => {
        emitHydrationProgress(ctx, status, '正在同步证券基础信息...');
      });
      warnings.push(...result.warnings);
      if (!result.hydrated) warnings.push('远程证券列表为空，无法补齐证券基础信息');
    } catch (error) {
      warnings.push(`同步证券基础信息失败：${formatError(error)}`);
    }
  }

  // 3. 日K：仅当本地落后于最近已收盘交易日且该交易日尚未尝试过同步时才增量补齐，
  //    避免每次提问/重启后重复全量同步；缺失个股由实际查询时按需补齐。
  //    条件选股等场景不依赖本地日K（requireDailyBars=false），跳过日K覆盖检查。
  after = await readCoverageStats(targetTradeDate);
  let dailyBarOk = !requireDailyBars || !targetTradeDate;
  if (requireDailyBars && targetTradeDate) {
    if (after.dailyBarSymbols >= minCoverage) {
      dailyBarOk = true;
      emitProgress(ctx, `DuckDB 已覆盖 ${targetTradeDate} 日K（${after.dailyBarSymbols}/${minCoverage}）`);
    } else {
      const [latestTradeDate, latestJob] = await Promise.all([getLatestTradeDate(), getLatestSyncJob()]);
      const isCurrent = latestTradeDate !== undefined && latestTradeDate >= targetTradeDate;
      const alreadyAttempted = latestJob?.targetTradeDate === targetTradeDate && latestJob.status !== 'running';
      if (isCurrent || alreadyAttempted) {
        dailyBarOk = true;
        emitProgress(
          ctx,
          `DuckDB 已覆盖 ${targetTradeDate} 日K（${after.dailyBarSymbols}/${minCoverage}），缺失个股按需补齐`,
        );
      } else {
        emitProgress(
          ctx,
          `本地 ${targetTradeDate} 日K覆盖 ${after.dailyBarSymbols} 只，不足 ${minCoverage}，正在增量补齐缺失数据...`,
        );
        try {
          await ensureMarketDataCoverage({ targetTradeDate, minCoverage }, (status) => {
            emitProgress(ctx, status.message ?? '正在同步缺失日K线数据...');
          });
        } catch (error) {
          warnings.push(`日K线同步失败：${formatError(error)}`);
        }
        after = await readCoverageStats(targetTradeDate);
        dailyBarOk = after.dailyBarSymbols >= minCoverage;
      }
    }
  }

  // 4. 筹码：单股查询只补目标股票；全市场筹码条件才触发 A 股全市场 worker 批量补齐。
  after = await readCoverageStats(targetTradeDate);
  let chipsOk = chipCoverageMode === 'none';
  if (chipCoverageMode === 'symbol') {
    if (!options.chipSymbol) {
      warnings.push('单股筹码补齐缺少股票代码');
    } else {
      emitProgress(ctx, `正在补齐 ${options.chipSymbol} 单股筹码缓存...`);
      try {
        const result = await getChipDistribution(options.chipSymbol);
        warnings.push(...(result.warnings ?? []));
        chipsOk = true;
        emitProgress(ctx, `${options.chipSymbol} 单股筹码缓存已就绪`);
      } catch (error) {
        warnings.push(`${options.chipSymbol} 筹码补齐失败：${formatError(error)}`);
      }
    }
  } else if (chipCoverageMode === 'market') {
    const chipTarget = Math.max(minCoverage, after.securities);
    if (after.chips < chipTarget) {
      emitProgress(
        ctx,
        `本地有效筹码缓存 ${after.chips} 只，不足 A 股全市场目标 ${chipTarget}，正在 worker 中批量补齐...`,
      );
      try {
        const result = await hydrateAllMarketChipsInWorker(
          { timeoutMs: chipTimeoutMs, maxAgeMs: CHIP_DISTRIBUTION_MAX_AGE_MS },
          (status) => {
            emitHydrationProgress(ctx, status, '正在同步 A 股全市场筹码缓存...');
          },
        );
        warnings.push(...result.warnings);
        if (result.hydrated > 0) emitProgress(ctx, `已批量补齐 ${result.hydrated} 只股票的本地筹码缓存`);
      } catch (error) {
        warnings.push(`筹码补齐失败：${formatError(error)}`);
      }
    }
    after = await readCoverageStats(targetTradeDate);
    chipsOk = after.chips >= Math.max(minCoverage, after.securities);
  }

  after = await readCoverageStats(targetTradeDate);
  const elapsedMs = Date.now() - start;
  const ok = after.securities >= minCoverage && after.snapshots >= minCoverage && dailyBarOk && chipsOk;

  if (!ok) {
    warnings.push(
      `数据覆盖度仍未达标（目标 ${minCoverage} 只）：证券 ${after.securities}、快照 ${after.snapshots}${requireDailyBars ? `、日K ${after.dailyBarSymbols}` : ''}${formatChipStatus(chipCoverageMode, after, minCoverage, chipsOk)}，后续筛选可能仍存在数据缺口。`,
    );
  } else {
    emitProgress(
      ctx,
      `本地数据覆盖度已达标：证券 ${after.securities}、快照 ${after.snapshots}${requireDailyBars ? `、日K ${after.dailyBarSymbols}` : ''}${formatChipStatus(chipCoverageMode, after, minCoverage, chipsOk)}`,
    );
  }

  return {
    ok,
    minCoverage,
    needsChips,
    chipCoverageMode,
    chipSymbol: options.chipSymbol,
    before,
    after,
    hydrated: calcHydrated(before, after),
    warnings: uniqueWarnings(warnings),
    elapsedMs,
  };
}

async function readCoverageStats(targetTradeDate?: string): Promise<ICoverageStats> {
  const [stats, snapshots, dailyBarSymbols, chips] = await Promise.all([
    getMarketDataStats(),
    countStockSnapshots(),
    targetTradeDate ? countDailyBarsForDate(targetTradeDate) : Promise.resolve(0),
    countFreshListedStockChips(CHIP_DISTRIBUTION_MAX_AGE_MS),
  ]);
  return {
    securities: stats.securityCount,
    snapshots,
    dailyBarSymbols,
    chips,
  };
}

function calcHydrated(before: ICoverageStats, after: ICoverageStats): ICoverageStats {
  return {
    securities: Math.max(0, after.securities - before.securities),
    snapshots: Math.max(0, after.snapshots - before.snapshots),
    dailyBarSymbols: Math.max(0, after.dailyBarSymbols - before.dailyBarSymbols),
    chips: Math.max(0, after.chips - before.chips),
  };
}

function emitHydrationProgress(
  ctx: IAgentContext,
  status: IMarketDataHydrationStatus,
  fallbackMessage: string,
): void {
  emitProgress(ctx, status.message ?? fallbackMessage);
}

function formatChipStatus(
  mode: TChipCoverageMode,
  stats: ICoverageStats,
  minCoverage: number,
  symbolChipOk: boolean,
): string {
  if (mode === 'none') return '';
  if (mode === 'symbol') return `、单股筹码${symbolChipOk ? '已就绪' : '未就绪'}`;
  const target = Math.max(minCoverage, stats.securities);
  return `、有效筹码 ${stats.chips}/${target}`;
}

function emitProgress(ctx: IAgentContext, message: string): void {
  ctx.emitEvent?.({
    type: 'progress_updated',
    title: '数据覆盖检查',
    message,
    progress: { current: 50, total: 100 },
    step: { id: 'data-coverage', agent: 'DataCoverage', description: message, status: 'running' },
    subAgent: { name: 'DataCoverage', description: message, status: 'running' },
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function uniqueWarnings(warnings: string[]): string[] {
  return [...new Set(warnings)];
}
