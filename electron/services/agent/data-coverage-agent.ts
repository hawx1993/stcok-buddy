import type { IAgentContext } from './orchestrator-types.js';
import {
  countDailyBarsForDate,
  countStockChips,
  countStockSnapshots,
  getLatestSyncJob,
  getLatestTradeDate,
  getMarketDataStats,
  listSecurities,
  listStockChips,
  upsertSecurities,
  upsertStockSnapshots,
} from '../market-data/market-data-store.js';
import { fetchStockSdkAllMarketSnapshotQuotes } from '../market-data/market-snapshot-provider.js';
import { listRemoteSecurities } from '../market-data/providers.js';
import { determineTargetTradeDate, ensureMarketDataCoverage } from '../market-data/market-data-sync.js';
import { getChipDistribution } from '../stock/chip-distribution-provider.js';
import type { SecurityRecord } from '../market-data/types.js';

const DEFAULT_MIN_COVERAGE = 5000;
const DEFAULT_CHIP_TIMEOUT_MS = 120_000;
const CHIP_HYDRATION_CONCURRENCY = 20;
const CHIP_CHECK_INTERVAL = 50;

export interface IDataCoverageResult {
  ok: boolean;
  minCoverage: number;
  needsChips: boolean;
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
    chipTimeoutMs?: number;
    requireDailyBars?: boolean;
  } = {},
): Promise<IDataCoverageResult> {
  const start = Date.now();
  const minCoverage = options.minCoverage ?? DEFAULT_MIN_COVERAGE;
  const needsChips = options.needsChips ?? false;
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

  // 1. 行情快照同时提供证券名称和交易所，先复用一次全市场批量请求完成两类缓存。
  if (after.snapshots < minCoverage) {
    emitProgress(ctx, `本地行情快照 ${after.snapshots} 只，不足 ${minCoverage}，正在获取全市场实时行情...`);
    try {
      const result = await fetchStockSdkAllMarketSnapshotQuotes();
      warnings.push(...result.warnings);
      if (result.quotes.length) {
        await upsertStockSnapshots(
          result.quotes.map((quote) => ({
            symbol: quote.code,
            name: quote.name,
            price: quote.price,
            change: quote.change,
            changePercent: quote.changePercent,
            open: quote.open,
            high: quote.high,
            low: quote.low,
            prevClose: quote.prevClose,
            volume: quote.volume,
            amount: quote.amount,
            turnoverRate: quote.turnoverRate,
            pe: quote.pe,
            pb: quote.pb,
            totalMarketCap: quote.totalMarketCap,
            circulatingMarketCap: quote.circulatingMarketCap,
            amplitude: quote.amplitude,
          })),
        );
        const updatedAt = new Date().toISOString();
        await upsertSecurities(
          result.quotes.map((quote) => ({
            symbol: quote.code,
            name: quote.name,
            exchange: quote.exchange ?? inferExchange(quote.code),
            securityType: 'stock' as const,
            status: 'listed' as const,
            isSt: /(?:^|\*)ST|退/i.test(quote.name),
            source: 'stock-sdk',
            updatedAt,
          })),
        );
      } else {
        warnings.push('stock-sdk 未返回全市场快照，行情快照覆盖度未提升');
      }
    } catch (error) {
      warnings.push(`获取全市场行情快照失败：${formatError(error)}`);
    }
  }

  // 2. 快照无法补足证券列表时才走名称补齐，避免冷启动重复遍历全市场。
  after = await readCoverageStats(targetTradeDate);
  if (after.securities < minCoverage) {
    emitProgress(ctx, `本地证券列表 ${after.securities} 只，不足 ${minCoverage}，正在同步全市场证券基础信息...`);
    try {
      const remote = await listRemoteSecurities();
      if (remote.length) {
        await upsertSecurities(remote);
      } else {
        warnings.push('远程证券列表为空，无法补齐证券基础信息');
      }
    } catch (error) {
      warnings.push(`同步证券基础信息失败：${formatError(error)}`);
    }
  }

  // 3. 日K：仅当本地落后于最近已收盘交易日且该交易日尚未尝试过同步时才增量补齐，
  //    避免每次提问/重启后重复全量同步；缺失个股由实际查询时按需真实补齐。
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

  // 4. 筹码：仅在用户查询涉及筹码条件时触发，避免不必要的全量远程调用
  after = await readCoverageStats(targetTradeDate);
  if (needsChips && after.chips < minCoverage) {
    emitProgress(ctx, `本地筹码缓存 ${after.chips} 只，不足 ${minCoverage}，正在补齐缺失筹码...`);
    try {
      const hydratedChips = await hydrateMissingChips(minCoverage, chipTimeoutMs, ctx);
      if (hydratedChips > 0) {
        warnings.push(`已补齐 ${hydratedChips} 只股票的本地筹码缓存`);
      }
    } catch (error) {
      warnings.push(`筹码补齐失败：${formatError(error)}`);
    }
  }

  after = await readCoverageStats(targetTradeDate);
  const elapsedMs = Date.now() - start;
  const ok =
    after.securities >= minCoverage &&
    after.snapshots >= minCoverage &&
    dailyBarOk &&
    (!needsChips || after.chips >= minCoverage);

  if (!ok) {
    warnings.push(
      `数据覆盖度仍未达标（目标 ${minCoverage} 只）：证券 ${after.securities}、快照 ${after.snapshots}${requireDailyBars ? `、日K ${after.dailyBarSymbols}` : ''}${needsChips ? `、筹码 ${after.chips}` : ''}，后续筛选可能仍存在数据缺口。`,
    );
  } else {
    emitProgress(
      ctx,
      `本地数据覆盖度已达标：证券 ${after.securities}、快照 ${after.snapshots}${requireDailyBars ? `、日K ${after.dailyBarSymbols}` : ''}${needsChips ? `、筹码 ${after.chips}` : ''}`,
    );
  }

  return {
    ok,
    minCoverage,
    needsChips,
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
    countStockChips(),
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

async function hydrateMissingChips(targetCount: number, timeoutMs: number, ctx: IAgentContext): Promise<number> {
  const [securities, chips] = await Promise.all([listSecurities(), listStockChips(10000)]);
  const chipSymbols = new Set(chips.map((chip) => chip.symbol));
  const missingSymbols = securities
    .filter((security) => security.status === 'listed' && !chipSymbols.has(security.symbol))
    .map((security) => security.symbol);

  if (!missingSymbols.length) return 0;

  const startChipCount = chips.length;
  let hydrated = 0;
  let stop = false;
  const start = Date.now();
  const timeoutAt = start + timeoutMs;

  const checkTarget = async () => {
    const current = await countStockChips();
    if (current >= targetCount) {
      stop = true;
    }
  };

  await runWithConcurrency(missingSymbols, CHIP_HYDRATION_CONCURRENCY, async (symbol, index) => {
    if (stop || Date.now() >= timeoutAt) return;
    try {
      await getChipDistribution(symbol);
      hydrated += 1;
      if (hydrated % CHIP_CHECK_INTERVAL === 0) {
        emitProgress(ctx, `已补齐 ${hydrated} 只股票筹码缓存，继续中...`);
        await checkTarget();
      }
    } catch (error) {
      // 单只股票筹码失败不影响整体流程
      console.warn(`[data-coverage] 筹码补齐失败 ${symbol}:`, formatError(error));
    }
  });

  // 最终统计实际新增（可能包含并发时其他写入）
  const finalChipCount = await countStockChips();
  return Math.max(0, finalChipCount - startChipCount);
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

function inferExchange(code: string): SecurityRecord['exchange'] {
  if (code.startsWith('6')) return 'SH';
  if (code.startsWith('4') || code.startsWith('8') || code.startsWith('92')) return 'BJ';
  return 'SZ';
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
