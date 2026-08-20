import { parentPort } from 'node:worker_threads';
import { expose } from 'comlink';
import StockSDK from 'stock-sdk';
import { nodeEndpoint } from '../stock/comlink-node-endpoint.js';
import { calculateChipDistribution, chipRowsToResult } from '../stock/chip-distribution.js';
import { runAStockDataFn, type IBaiduKline } from '../stock/a-stock-data-runner.js';
import {
  listSecurities,
  listStockChips,
  upsertSecurities,
  upsertStockChips,
  upsertStockSnapshots,
  type IStockChipUpsertItem,
} from '../stock-db/market-data-store.js';
import { fetchStockSdkAllMarketSnapshotQuotes, type IMarketSnapshotQuoteRecord } from './market-snapshot-provider.js';
import { listRemoteSecurities } from './providers.js';
import type { SecurityRecord } from './types.js';
import type { IChipDistributionResult, KlinePoint } from '../../../src/shared/types.js';
import type {
  IHydrateAllMarketChipsOptions,
  IMarketDataHydrationStatus,
  IMarketDataHydrationWorkerApi,
  TMarketDataHydrationProgressListener,
  TMarketDataHydrationStage,
} from './market-data-hydration-worker-types.js';

if (!parentPort) throw new Error('market data hydration worker requires parentPort');

const sdk = new StockSDK({ timeout: 12_000, retry: { maxRetries: 1 } });
const DEFAULT_CHIP_TIMEOUT_MS = 120_000;
const DEFAULT_CHIP_BATCH_SIZE = 40;
const DEFAULT_CHIP_CONCURRENCY = 8;
const DEFAULT_CHIP_MAX_AGE_MS = 5 * 24 * 60 * 60_000;
const MAX_WARNING_COUNT = 20;

const api: IMarketDataHydrationWorkerApi = {
  async hydrateAllMarketSnapshots(onProgress) {
    emit(onProgress, runningStatus('snapshots', '正在 worker 中拉取 A 股全市场行情快照...'));
    try {
      const result = await fetchStockSdkAllMarketSnapshotQuotes();
      if (result.quotes.length) {
        await upsertStockSnapshots(result.quotes.map(toStockSnapshot));
        await upsertSecurities(result.quotes.map(toSecurityRecord));
      }
      const state = result.quotes.length ? statusFromWarnings(result.warnings) : 'failed';
      const warnings = result.quotes.length ? result.warnings : uniqueWarnings([...result.warnings, 'stock-sdk 未返回全市场快照']);
      return completedStatus({
        stage: 'snapshots',
        state,
        total: result.quotes.length,
        succeeded: result.quotes.length,
        failed: 0,
        hydrated: result.quotes.length,
        warnings,
        message: result.quotes.length
          ? `worker 已批量写入 ${result.quotes.length} 条全市场行情快照`
          : 'worker 未获取到全市场行情快照',
      });
    } catch (error) {
      return failedStatus('snapshots', `全市场行情快照补齐失败：${formatError(error)}`);
    }
  },

  async hydrateAllSecurities(onProgress) {
    emit(onProgress, runningStatus('securities', '正在 worker 中同步 A 股全市场证券基础信息...'));
    try {
      const securities = await listRemoteSecurities((completed, total) => {
        emit(onProgress, {
          ...runningStatus('securities', `正在同步证券基础信息 ${completed}/${total}...`),
          processed: completed,
          total,
        });
      });
      if (securities.length) await upsertSecurities(securities);
      return completedStatus({
        stage: 'securities',
        state: securities.length ? 'completed' : 'failed',
        total: securities.length,
        succeeded: securities.length,
        failed: 0,
        hydrated: securities.length,
        warnings: securities.length ? [] : ['远程证券列表为空，无法补齐证券基础信息'],
        message: securities.length
          ? `worker 已批量写入 ${securities.length} 条证券基础信息`
          : 'worker 未获取到证券基础信息',
      });
    } catch (error) {
      return failedStatus('securities', `证券基础信息补齐失败：${formatError(error)}`);
    }
  },

  async hydrateAllMarketChips(options, onProgress) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_CHIP_TIMEOUT_MS;
    const batchSize = clampPositiveInteger(options.batchSize, DEFAULT_CHIP_BATCH_SIZE, 200);
    const concurrency = clampPositiveInteger(options.concurrency, DEFAULT_CHIP_CONCURRENCY, 32);
    const maxAgeMs = options.maxAgeMs ?? DEFAULT_CHIP_MAX_AGE_MS;
    const warnings: string[] = [];
    const startedAt = Date.now();
    const timeoutAt = startedAt + timeoutMs;

    emit(onProgress, runningStatus('chips', '正在 worker 中检查 A 股全市场筹码缓存...'));
    try {
      const [securities, chips] = await Promise.all([listSecurities(), listStockChips(10000)]);
      const listed = securities.filter((security) => security.status === 'listed' && security.securityType === 'stock');
      const chipBySymbol = new Map(chips.map((chip) => [chip.symbol, chip]));
      const targets = listed.filter((security) => {
        const chip = chipBySymbol.get(security.symbol);
        return !chip || !isFreshChipCache(chip.fetchedAt, Date.now(), maxAgeMs);
      });

      if (!targets.length) {
        return completedStatus({
          stage: 'chips',
          state: 'completed',
          total: 0,
          succeeded: 0,
          failed: 0,
          hydrated: 0,
          warnings: [],
          message: `A 股全市场筹码缓存已覆盖 ${listed.length} 只上市股票`,
        });
      }

      let processed = 0;
      let succeeded = 0;
      let failed = 0;
      for (let index = 0; index < targets.length; index += batchSize) {
        if (Date.now() >= timeoutAt) {
          warnings.push(`A 股全市场筹码补齐达到 ${Math.round(timeoutMs / 1000)} 秒超时，已安全停止`);
          break;
        }
        const batch = targets.slice(index, index + batchSize);
        const loaded = await loadChipBatch(batch, concurrency, warnings);
        if (loaded.items.length) {
          try {
            await upsertStockChips(loaded.items);
            succeeded += loaded.items.length;
          } catch (error) {
            failed += loaded.items.length;
            collectWarning(warnings, `筹码批量写入失败：${formatError(error)}`);
          }
        }
        failed += loaded.failed;
        processed += batch.length;
        emit(onProgress, {
          state: 'running',
          stage: 'chips',
          processed,
          total: targets.length,
          succeeded,
          failed,
          hydrated: succeeded,
          warnings: [...warnings],
          message: `worker 已补齐 ${succeeded} 只筹码缓存，进度 ${processed}/${targets.length}`,
        });
      }

      const state = failed || warnings.length || processed < targets.length ? 'partial' : 'completed';
      return completedStatus({
        stage: 'chips',
        state,
        total: targets.length,
        processed,
        succeeded,
        failed: failed + Math.max(0, targets.length - processed),
        hydrated: succeeded,
        warnings: uniqueWarnings(warnings),
        message: `worker 已批量写入 ${succeeded} 只 A 股筹码缓存`,
      });
    } catch (error) {
      return failedStatus('chips', `A 股全市场筹码补齐失败：${formatError(error)}`);
    }
  },
};

async function loadChipBatch(
  securities: SecurityRecord[],
  concurrency: number,
  warnings: string[],
): Promise<{ items: IStockChipUpsertItem[]; failed: number }> {
  const items: IStockChipUpsertItem[] = [];
  let failed = 0;
  await runWithConcurrency(securities, concurrency, async (security) => {
    try {
      const data = await loadChipDistribution(security.symbol);
      items.push({ symbol: security.symbol, data });
    } catch (error) {
      failed += 1;
      collectWarning(warnings, `${security.symbol} 筹码补齐失败：${formatError(error)}`);
    }
  });
  return { items, failed };
}

async function loadChipDistribution(symbol: string): Promise<IChipDistributionResult> {
  try {
    const rows = await sdk.chips.cn(symbol, { days: 360, range: 120, includeHistogram: 'all' });
    return chipRowsToResult(rows, 'stock-sdk');
  } catch (stockSdkError) {
    const stockSdkMessage = formatError(stockSdkError);
    try {
      const baidu = await runAStockDataFn<IBaiduKline>('baidu_kline_with_ma', { code: symbol });
      const klines = parseAStockDataBaiduKline(baidu).slice(-360);
      if (!klines.length) throw new Error('a-stock-data 百度日 K 未返回有效数据');
      return calculateChipDistribution(klines, 'a-stock-data', [`stock-sdk 筹码数据获取失败：${stockSdkMessage}`]);
    } catch (fallbackError) {
      throw new Error(
        `筹码分布数据获取失败。stock-sdk：${stockSdkMessage}；a-stock-data 百度日 K：${formatError(fallbackError)}`,
      );
    }
  }
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  });
  await Promise.all(workers);
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

function toStockSnapshot(quote: IMarketSnapshotQuoteRecord) {
  return {
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
  };
}

function toSecurityRecord(quote: IMarketSnapshotQuoteRecord): SecurityRecord {
  return {
    symbol: quote.code,
    name: quote.name,
    exchange: quote.exchange ?? inferExchange(quote.code),
    securityType: 'stock',
    status: 'listed',
    isSt: /(?:^|\*)ST|退/i.test(quote.name),
    source: 'stock-sdk',
    updatedAt: new Date().toISOString(),
  };
}

function optionalKlineNumber(values: string[], index: number): number | undefined {
  if (index < 0) return undefined;
  const value = Number(values[index]);
  return Number.isFinite(value) ? value : undefined;
}

function isFreshChipCache(fetchedAt: string, now: number, maxAgeMs: number): boolean {
  const fetchedAtMs = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedAtMs)) return false;
  const age = now - fetchedAtMs;
  return age >= 0 && age < maxAgeMs;
}

function inferExchange(code: string): SecurityRecord['exchange'] {
  if (code.startsWith('6')) return 'SH';
  if (code.startsWith('4') || code.startsWith('8') || code.startsWith('92')) return 'BJ';
  return 'SZ';
}

function runningStatus(stage: TMarketDataHydrationStage, message: string): IMarketDataHydrationStatus {
  return { state: 'running', stage, processed: 0, total: 0, succeeded: 0, failed: 0, hydrated: 0, warnings: [], message };
}

function completedStatus(status: Omit<IMarketDataHydrationStatus, 'processed'> & { processed?: number }) {
  const processed = status.processed ?? status.total;
  return { ...status, processed };
}

function failedStatus(stage: TMarketDataHydrationStage, message: string): IMarketDataHydrationStatus {
  return { state: 'failed', stage, processed: 0, total: 0, succeeded: 0, failed: 0, hydrated: 0, warnings: [message], message };
}

function statusFromWarnings(warnings: string[]): 'completed' | 'partial' {
  return warnings.length ? 'partial' : 'completed';
}

function emit(onProgress: TMarketDataHydrationProgressListener, status: IMarketDataHydrationStatus): void {
  onProgress(status);
}

function collectWarning(warnings: string[], warning: string): void {
  if (warnings.length < MAX_WARNING_COUNT) warnings.push(warning);
}

function uniqueWarnings(warnings: string[]): string[] {
  return [...new Set(warnings)];
}

function clampPositiveInteger(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

expose(api, nodeEndpoint(parentPort));
