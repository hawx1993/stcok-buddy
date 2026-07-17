import { EventEmitter } from 'node:events';
import { partitionValidDailyBars } from './quality.js';
import { isRemoteTradingDay, listRemoteSecurities, listRemoteTradingCalendar, previousRemoteTradingDay, stockSdkHistoricalProvider } from './providers.js';
import {
  clearSyncFailure, countDailyBarsForDate, createSyncJob, getLatestSyncJob, getLatestTradeDate,
  getMarketDataStats, listDailyBars, listLatestSyncFailures, listSecurities, recordSyncFailure,
  updateSyncJob, upsertDailyBars, upsertSecurities, upsertTradingCalendar,
} from './market-data-store.js';
import type { MarketDataSyncStatus, SyncJobType } from './types.js';

const INITIAL_YEARS = 10;
const CONCURRENCY = 4;
let currentSync: Promise<MarketDataSyncStatus> | undefined;
let stopRequested = false;
let memoryStatus: MarketDataSyncStatus = idleStatus();
const events = new EventEmitter();

export function onMarketDataProgress(listener: (status: MarketDataSyncStatus) => void) {
  events.on('progress', listener);
  return () => events.off('progress', listener);
}

export async function getMarketDataSyncStatus(): Promise<MarketDataSyncStatus> {
  if (currentSync) return memoryStatus;
  const latest = await getLatestSyncJob();
  const latestLocalTradeDate = await getLatestTradeDate();
  return latest ? { ...latest, latestLocalTradeDate, message: latest.errorMessage ?? latest.message } : { ...idleStatus(), latestLocalTradeDate };
}

export function startMarketDataSync(force = false) {
  if (currentSync) return currentSync;
  stopRequested = false;
  currentSync = runSync(force).finally(() => { currentSync = undefined; });
  return currentSync;
}

export function retryMarketDataFailures() {
  if (currentSync) return currentSync;
  stopRequested = false;
  currentSync = runRepair().finally(() => { currentSync = undefined; });
  return currentSync;
}

export function requestMarketDataSyncStop() {
  stopRequested = true;
}

export async function waitForMarketDataSync() {
  await currentSync?.catch(() => undefined);
}

export async function determineTargetTradeDate(now = new Date()) {
  const today = isoDate(now);
  const isTradingDay = await isRemoteTradingDay(today).catch(() => false);
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (isTradingDay && minutes >= 15 * 60 + 30) return today;
  return previousRemoteTradingDay(today).catch(() => previousWeekday(now));
}

async function runSync(force: boolean): Promise<MarketDataSyncStatus> {
  updateMemory({ ...idleStatus(), state: 'checking', message: '正在检查本地行情数据' });
  const targetTradeDate = await determineTargetTradeDate();
  let securities = await listSecurities();
  if (!securities.length || force) {
    updateMemory({ ...memoryStatus, state: 'initializing', targetTradeDate, message: '正在同步 A 股证券列表' });
    const remote = await listRemoteSecurities((processed, total) => updateMemory({ ...memoryStatus, processedSymbols: processed, totalSymbols: total, message: `正在同步 A 股证券列表（${processed}/${total}）` }));
    await upsertSecurities(remote);
    securities = remote;
  }
  const calendar = await listRemoteTradingCalendar();
  await upsertTradingCalendar(calendar);

  const latestTradeDate = await getLatestTradeDate();
  if (!force && latestTradeDate && latestTradeDate >= targetTradeDate) {
    const done = { ...idleStatus(), state: 'completed' as const, targetTradeDate, latestLocalTradeDate: latestTradeDate, message: '本地行情已是最新' };
    updateMemory(done);
    return done;
  }

  const jobType: SyncJobType = latestTradeDate ? 'daily_incremental' : 'initial_backfill';
  const previous = await getLatestSyncJob();
  const checkpoint = previous?.status === 'running' && previous.jobType === jobType && previous.targetTradeDate === targetTradeDate ? previous.checkpointSymbol : undefined;
  const symbols = checkpoint ? securities.filter((item) => item.symbol > checkpoint) : securities;
  const jobId = `market-sync-${Date.now()}`;
  await createSyncJob({ id: jobId, jobType, targetTradeDate, totalSymbols: securities.length, checkpointSymbol: checkpoint });

  const startDate = latestTradeDate ? dayAfter(latestTradeDate) : yearsAgo(targetTradeDate, INITIAL_YEARS);
  const baseProcessed = securities.length - symbols.length;
  let processed = baseProcessed;
  let succeeded = 0;
  let failed = 0;
  updateMemory({ state: jobType === 'initial_backfill' ? 'initializing' : 'syncing', jobType, targetTradeDate, processedSymbols: processed, totalSymbols: securities.length, succeededSymbols: 0, failedSymbols: 0, startedAt: new Date().toISOString(), latestLocalTradeDate: latestTradeDate, message: jobType === 'initial_backfill' ? '正在后台回填最近 10 年日线' : '正在同步最新交易日数据' });

  await runPool(symbols, CONCURRENCY, async (security) => {
    if (stopRequested) return;
    try {
      const existing = await listDailyBars(security.symbol, { limit: 1, adjustType: 'qfq' });
      const symbolStart = existing.at(-1)?.tradeDate ? dayAfter(existing.at(-1)!.tradeDate) : startDate;
      if (symbolStart <= targetTradeDate) {
        const rows = await stockSdkHistoricalProvider.getDailyBars(security.symbol, { adjustType: 'qfq', startDate: symbolStart, endDate: targetTradeDate });
        const { valid, invalid } = partitionValidDailyBars(rows);
        if (valid.length) await upsertDailyBars(valid);
        if (invalid.length) console.warn(`[market-data] ${security.symbol} ignored ${invalid.length} invalid bars`);
      }
      await clearSyncFailure(jobId, security.symbol, 'daily-bars');
      succeeded += 1;
    } catch (error) {
      failed += 1;
      await recordSyncFailure(jobId, security.symbol, 'daily-bars', error instanceof Error ? error.message : String(error));
    } finally {
      processed += 1;
      await updateSyncJob(jobId, { processedSymbols: processed, succeededSymbols: succeeded, failedSymbols: failed, checkpointSymbol: security.symbol });
      updateMemory({ ...memoryStatus, processedSymbols: processed, succeededSymbols: succeeded, failedSymbols: failed, latestLocalTradeDate: await getLatestTradeDate() });
    }
  });

  if (stopRequested) {
    await updateSyncJob(jobId, { status: 'cancelled', finishedAt: new Date().toISOString(), errorMessage: '应用退出，同步已在当前批次后停止' });
    const cancelled = { ...memoryStatus, state: 'idle' as const, finishedAt: new Date().toISOString(), message: '同步已安全停止，下次启动将继续' };
    updateMemory(cancelled);
    return cancelled;
  }

  const covered = await countDailyBarsForDate(targetTradeDate);
  const coverage = securities.length ? covered / securities.length : 0;
  const status = coverage >= 0.99 ? 'completed' : coverage >= 0.95 ? 'partial' : failed ? 'failed' : 'partial';
  const finishedAt = new Date().toISOString();
  await updateSyncJob(jobId, { status, finishedAt, metadataJson: JSON.stringify({ covered, coverage }) });
  const result: MarketDataSyncStatus = { ...memoryStatus, state: status, finishedAt, latestLocalTradeDate: await getLatestTradeDate(), message: `同步完成，目标日覆盖 ${(coverage * 100).toFixed(1)}%` };
  updateMemory(result);
  return result;
}

async function runRepair(): Promise<MarketDataSyncStatus> {
  const failures = await listLatestSyncFailures();
  if (!failures.length) return getMarketDataSyncStatus();
  updateMemory({ ...idleStatus(), state: 'syncing', jobType: 'repair', totalSymbols: failures.length, message: '正在重试失败股票' });
  const target = await determineTargetTradeDate();
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  for (const item of failures) {
    try {
      const latest = await listDailyBars(item.symbol, { limit: 1, adjustType: 'qfq' });
      const rows = await stockSdkHistoricalProvider.getDailyBars(item.symbol, { adjustType: 'qfq', startDate: latest[0] ? dayAfter(latest[0].tradeDate) : yearsAgo(target, INITIAL_YEARS), endDate: target });
      const { valid } = partitionValidDailyBars(rows);
      if (valid.length) await upsertDailyBars(valid);
      await clearSyncFailure(item.jobId, item.symbol, item.stage);
      succeeded += 1;
    } catch { failed += 1; }
    processed += 1;
    updateMemory({ ...memoryStatus, processedSymbols: processed, succeededSymbols: succeeded, failedSymbols: failed });
  }
  const result = { ...memoryStatus, state: failed ? 'partial' as const : 'completed' as const, finishedAt: new Date().toISOString(), latestLocalTradeDate: await getLatestTradeDate(), message: failed ? '部分失败股票仍未补齐' : '失败股票已重试完成' };
  updateMemory(result);
  return result;
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!stopRequested) {
      const current = index++;
      if (current >= items.length) break;
      await worker(items[current]);
    }
  }));
}

function updateMemory(status: MarketDataSyncStatus) {
  memoryStatus = status;
  events.emit('progress', status);
}

function idleStatus(): MarketDataSyncStatus {
  return { state: 'idle', processedSymbols: 0, totalSymbols: 0, succeededSymbols: 0, failedSymbols: 0 };
}
function yearsAgo(target: string, years: number) { const date = new Date(`${target}T12:00:00+08:00`); date.setFullYear(date.getFullYear() - years); return isoDate(date); }
function dayAfter(value: string) { const date = new Date(`${value}T12:00:00+08:00`); date.setDate(date.getDate() + 1); return isoDate(date); }
function previousWeekday(now: Date) { const date = new Date(now); do date.setDate(date.getDate() - 1); while (date.getDay() === 0 || date.getDay() === 6); return isoDate(date); }
function isoDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }

export { getMarketDataStats };
