import type { IChipDistributionResult } from '../../../src/shared/types.js';
import { getBoardDetail } from '../stock/anomaly/board-detail.js';
import { getChipDistribution } from '../stock/chip-distribution/chip-distribution-provider.js';
import { normalizeMarketCap } from '../stock/stock-detail/format.js';
import { refreshMarketBoardRows } from '../stock/quotes/shared.js';
import {
  emptyConditionScreenerBoardScope,
  loadConditionScreenerLeadingBoardScope,
  type IConditionScreenerBoardDependencies,
  type IConditionScreenerBoardScope,
} from './condition-screener-board-provider.js';
import {
  fetchConditionScreenerSinaBoards,
  fetchConditionScreenerSinaConstituents,
} from './condition-screener-sina-board-provider.js';
import type {
  IConditionScreenerCandidate,
  IConditionScreenerInput,
  IConditionScreenerResult,
  IConditionScreenerRow,
  TConditionScreenerMarketScope,
  TConditionScreenerSortBy,
  TConditionScreenerSortOrder,
} from './condition-screener-types.js';
export type {
  IConditionScreenerInput,
  IConditionScreenerLeadingBoard,
  IConditionScreenerResult,
  IConditionScreenerRow,
  TConditionScreenerDataSource,
  TConditionScreenerMarketScope,
  TConditionScreenerSortBy,
  TConditionScreenerSortOrder,
} from './condition-screener-types.js';
import {
  getMarketDataStats,
  listAShareMarketCapSnapshotRows,
  listBoardConstituents,
  listMarketBoards,
  listStockChips,
  upsertSecurities,
  upsertStockSnapshots,
  type IAShareMarketCapSnapshotRow,
} from '../stock-db/market-data-store.js';
import {
  fetchAStockDataMarketSnapshotQuotes,
  fetchStockSdkAllMarketSnapshotQuotes,
  type IMarketSnapshotQuoteFetchResult,
  type IMarketSnapshotQuoteRecord,
} from './market-snapshot-provider.js';
import { listRemoteSecurities } from './providers.js';
import type { SecurityRecord, StockChipCacheRecord } from './types.js';

interface IConditionScreenerDependencies extends IConditionScreenerBoardDependencies {
  listLocalRows(includeST: boolean): Promise<IAShareMarketCapSnapshotRow[]>;
  listRemoteSecurities(): Promise<SecurityRecord[]>;
  upsertSecurities(records: SecurityRecord[]): Promise<void>;
  upsertSnapshots(records: IMarketSnapshotQuoteRecord[]): Promise<void>;
  fetchStockSdkAllQuotes(): Promise<IMarketSnapshotQuoteFetchResult>;
  fetchAStockDataQuotes(codes: string[]): Promise<IMarketSnapshotQuoteFetchResult>;
  listStockChips(limit: number): Promise<StockChipCacheRecord[]>;
  getChipDistribution(symbol: string): Promise<IChipDistributionResult>;
  getMarketDataStats(): Promise<Awaited<ReturnType<typeof getMarketDataStats>>>;
}

const WAN_YUAN = 10_000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const CHIP_BACKGROUND_HYDRATION_LIMIT = 20;
const CHIP_BACKGROUND_HYDRATION_CONCURRENCY = 3;
const CHIP_DISPLAY_HYDRATION_CONCURRENCY = 3;

const defaultDependencies: IConditionScreenerDependencies = {
  listLocalRows: listAShareMarketCapSnapshotRows,
  listRemoteSecurities,
  upsertSecurities,
  upsertSnapshots: async (records) => {
    await upsertStockSnapshots(
      records.map((record) => ({
        symbol: record.code,
        name: record.name,
        price: record.price,
        change: record.change,
        changePercent: record.changePercent,
        open: record.open,
        high: record.high,
        low: record.low,
        prevClose: record.prevClose,
        volume: record.volume,
        amount: record.amount,
        turnoverRate: record.turnoverRate,
        pe: record.pe,
        pb: record.pb,
        totalMarketCap: record.totalMarketCap,
        circulatingMarketCap: record.circulatingMarketCap,
        amplitude: record.amplitude,
      })),
    );
  },
  fetchStockSdkAllQuotes: fetchStockSdkAllMarketSnapshotQuotes,
  fetchAStockDataQuotes: fetchAStockDataMarketSnapshotQuotes,
  listStockChips,
  getChipDistribution,
  listMarketBoards,
  listBoardConstituents,
  getRemoteBoards: refreshMarketBoardRows,
  getBoardDetail,
  getAStockDataBoards: fetchConditionScreenerSinaBoards,
  getAStockDataBoardConstituents: fetchConditionScreenerSinaConstituents,
  getMarketDataStats,
};

let dependencies = defaultDependencies;

export function setConditionScreenerDependenciesForTest(overrides: Partial<IConditionScreenerDependencies>) {
  dependencies = { ...defaultDependencies, ...overrides };
}

export function resetConditionScreenerDependenciesForTest() {
  dependencies = defaultDependencies;
}

export async function screenASharesByConditions(input: IConditionScreenerInput): Promise<IConditionScreenerResult> {
  const options = normalizeInput(input);
  const warnings: string[] = [];
  const localRows = await loadCandidateRows(!options.excludeST, warnings);
  const candidates = await enrichCandidates(localRows, options, warnings);
  const leadingBoardScope = options.leadingBoards
    ? await loadConditionScreenerLeadingBoardScope(dependencies, warnings)
    : emptyConditionScreenerBoardScope();
  const scopedCandidates = candidates.filter((candidate) =>
    passesQuoteConditions(candidate, options, leadingBoardScope),
  );
  const chipResult = await applyChipConditions(scopedCandidates, options, leadingBoardScope, warnings);
  const rows = await hydrateDisplayedChipMetrics(sortRows(chipResult.rows, options).slice(0, options.limit));
  const stats = await loadStats(warnings);
  const missingQuoteFields = candidates.filter((candidate) => hasRequiredQuoteFieldMissing(candidate, options)).length;
  const missingChipData = chipResult.missingChipData;
  const hasCurrentQuotes = candidates.some(hasCurrentQuote);

  if (!hasCurrentQuotes) warnings.push('未获得可用于条件选股的当前全市场行情快照');
  return {
    source: 'duckdb+stock-sdk+a-stock-data',
    storage: storageForCandidates(candidates),
    freshness: hasCurrentQuotes ? 'current' : 'stale',
    isComplete: warnings.length === 0,
    latestTradeDate: stats?.latestTradeDate,
    rows,
    matchedCount: chipResult.rows.length,
    returnedCount: rows.length,
    totalCandidates: candidates.length,
    leadingBoards: leadingBoardScope.boards,
    sourceStats: {
      duckdbMatched: chipResult.rows.filter((row) => row.dataSource === 'duckdb').length,
      stockSdkMatched: chipResult.rows.filter((row) => row.dataSource === 'stock-sdk').length,
      aStockDataMatched: chipResult.rows.filter((row) => row.dataSource === 'a-stock-data').length,
      missingQuoteFields,
      missingChipData,
    },
    warnings: uniqueWarnings(warnings),
    isEmpty: rows.length === 0,
  };
}

function normalizeInput(input: IConditionScreenerInput) {
  return {
    minTotalMarketCapYuan: integer(input.minTotalMarketCapYuan),
    maxTotalMarketCapYuan: integer(input.maxTotalMarketCapYuan),
    maxTotalMarketCapYuanExclusive: integer(input.maxTotalMarketCapYuanExclusive),
    minCirculatingMarketCapYuan: integer(input.minCirculatingMarketCapYuan),
    maxCirculatingMarketCapYuan: integer(input.maxCirculatingMarketCapYuan),
    maxCirculatingMarketCapYuanExclusive: integer(input.maxCirculatingMarketCapYuanExclusive),
    turnoverRateMin: finite(input.turnoverRateMin),
    turnoverRateMax: finite(input.turnoverRateMax),
    turnoverRateMinExclusive: finite(input.turnoverRateMinExclusive),
    minAmountYuan: integer(input.minAmountYuan),
    maxAmountYuan: integer(input.maxAmountYuan),
    amountMinYuanExclusive: integer(input.amountMinYuanExclusive),
    minVolume: integer(input.minVolume),
    maxVolume: integer(input.maxVolume),
    volumeMinExclusive: integer(input.volumeMinExclusive),
    changePercentMin: finite(input.changePercentMin),
    changePercentMax: finite(input.changePercentMax),
    concentration90Min: finite(input.concentration90Min),
    concentration90Max: finite(input.concentration90Max),
    concentration90MaxExclusive: finite(input.concentration90MaxExclusive),
    concentration70Min: finite(input.concentration70Min),
    concentration70Max: finite(input.concentration70Max),
    concentration70MaxExclusive: finite(input.concentration70MaxExclusive),
    profitRatioMin: finite(input.profitRatioMin),
    profitRatioMax: finite(input.profitRatioMax),
    profitRatioMinExclusive: finite(input.profitRatioMinExclusive),
    excludeST: input.excludeST === true,
    marketScopes: normalizeMarketScopes(input.marketScopes),
    leadingBoards: input.leadingBoards === true,
    sortBy: normalizeSortBy(input.sortBy),
    sortOrder: input.sortOrder === 'desc' ? ('desc' as const) : ('asc' as const),
    limit: Math.max(1, Math.min(MAX_LIMIT, Math.floor(input.limit ?? DEFAULT_LIMIT))),
  };
}

function normalizeSortBy(value: IConditionScreenerInput['sortBy']): TConditionScreenerSortBy {
  const allowed: TConditionScreenerSortBy[] = [
    'code',
    'totalMarketCap',
    'circulatingMarketCap',
    'amount',
    'volume',
    'turnoverRate',
    'changePercent',
    'concentration90',
    'concentration70',
  ];
  return value && allowed.includes(value) ? value : 'code';
}

function normalizeMarketScopes(value: IConditionScreenerInput['marketScopes']): TConditionScreenerMarketScope[] {
  const allowed: TConditionScreenerMarketScope[] = ['sh', 'sz', 'bj', 'kc', 'cy', 'main'];
  return value ? [...new Set(value.filter((scope) => allowed.includes(scope)))] : [];
}

async function loadCandidateRows(includeST: boolean, warnings: string[]) {
  return readLocalRows(includeST, warnings);
}

async function readLocalRows(includeST: boolean, warnings: string[]) {
  try {
    return await dependencies.listLocalRows(includeST);
  } catch (error) {
    warnings.push(`暂无本地快照，DuckDB 读取失败：${formatError(error)}`);
    return [];
  }
}

async function enrichCandidates(
  localRows: IAShareMarketCapSnapshotRow[],
  options: ReturnType<typeof normalizeInput>,
  warnings: string[],
) {
  const candidates = new Map<string, IConditionScreenerCandidate>();
  for (const row of localRows) candidates.set(row.symbol, localRowToCandidate(row));

  const stockSdk = await loadAllMarketQuotes(warnings);
  if (!candidates.size) {
    for (const quote of stockSdk.quotes) candidates.set(quote.code, quoteToCandidate(quote));
    await persistSecurities(stockSdk.quotes, warnings);
  } else {
    mergeQuoteCandidates(candidates, stockSdk.quotes, 'stock-sdk', true);
  }
  await persistQuotes(stockSdk.quotes, warnings);

  const missingAfterStockSdk = [...candidates.values()]
    .filter((candidate) => !hasCurrentQuote(candidate) || hasRequiredQuoteFieldMissing(candidate, options))
    .map((candidate) => candidate.code);
  const aStockData = await loadQuotes(
    dependencies.fetchAStockDataQuotes,
    missingAfterStockSdk,
    'a-stock-data',
    warnings,
  );
  mergeQuoteCandidates(candidates, aStockData.quotes, 'a-stock-data', false);
  await persistQuotes(aStockData.quotes, warnings);

  return [...candidates.values()];
}

async function loadStats(warnings: string[]) {
  try {
    return await dependencies.getMarketDataStats();
  } catch (error) {
    warnings.push(`本地行情统计读取失败：${formatError(error)}`);
    return undefined;
  }
}

async function loadAllMarketQuotes(warnings: string[]) {
  try {
    const result = await dependencies.fetchStockSdkAllQuotes();
    warnings.push(...result.warnings);
    if (!result.quotes.length) warnings.push('stock-sdk 暂不可用，未返回全市场行情快照');
    return result;
  } catch (error) {
    warnings.push(`stock-sdk 暂不可用，全市场行情获取失败：${formatError(error)}`);
    return { quotes: [], warnings: [] };
  }
}

async function loadQuotes(
  fetcher: (codes: string[]) => Promise<IMarketSnapshotQuoteFetchResult>,
  codes: string[],
  source: 'stock-sdk' | 'a-stock-data',
  warnings: string[],
) {
  if (!codes.length) return { quotes: [], warnings: [] };
  try {
    const result = await fetcher(codes);
    warnings.push(...result.warnings);
    if (!result.quotes.length) warnings.push(`${source} 暂不可用，未返回缺失行情字段`);
    return result;
  } catch (error) {
    warnings.push(`${source} 暂不可用，行情补齐失败：${formatError(error)}`);
    return { quotes: [], warnings: [] };
  }
}

async function persistQuotes(records: IMarketSnapshotQuoteRecord[], warnings: string[]) {
  if (!records.length) return;
  try {
    await dependencies.upsertSnapshots(records);
  } catch (error) {
    warnings.push(`行情快照回写 DuckDB 失败：${formatError(error)}`);
  }
}

async function persistSecurities(records: IMarketSnapshotQuoteRecord[], warnings: string[]) {
  if (!records.length) return;
  try {
    await dependencies.upsertSecurities(
      records.map((record) => ({
        symbol: record.code,
        name: record.name,
        exchange: record.exchange ?? exchangeForCode(record.code),
        securityType: 'stock',
        status: 'listed',
        industry: record.industry,
        isSt: isStName(record.name),
        source: 'stock-sdk',
        updatedAt: record.fetchedAt ?? new Date().toISOString(),
      })),
    );
  } catch (error) {
    warnings.push(`全市场证券列表回写 DuckDB 失败：${formatError(error)}`);
  }
}

function quoteToCandidate(quote: IMarketSnapshotQuoteRecord): IConditionScreenerCandidate {
  return {
    code: quote.code,
    name: quote.name,
    exchange: quote.exchange ?? exchangeForCode(quote.code),
    industry: quote.industry,
    isSt: isStName(quote.name),
    price: quote.price,
    changePercent: quote.changePercent,
    turnoverRate: quote.turnoverRate,
    amountYuan: amountYuanFromWan(quote.amount),
    volume: integer(quote.volume),
    totalMarketCapYuan: marketCapYuan(quote.totalMarketCap),
    circulatingMarketCapYuan: marketCapYuan(quote.circulatingMarketCap),
    fetchedAt: quote.fetchedAt,
    dataSource: 'stock-sdk',
  };
}

function isStName(name: string) {
  return /(?:^|\*)ST|退/i.test(name);
}

function exchangeForCode(code: string): SecurityRecord['exchange'] {
  if (code.startsWith('6')) return 'SH';
  if (code.startsWith('4') || code.startsWith('8')) return 'BJ';
  return 'SZ';
}

function localRowToCandidate(row: IAShareMarketCapSnapshotRow): IConditionScreenerCandidate {
  return {
    code: row.symbol,
    name: row.name,
    exchange: row.exchange,
    industry: row.industry,
    isSt: row.isSt,
    dataSource: 'duckdb',
  };
}

function mergeQuoteCandidates(
  candidates: Map<string, IConditionScreenerCandidate>,
  quotes: IMarketSnapshotQuoteRecord[],
  source: 'stock-sdk' | 'a-stock-data',
  replaceExisting: boolean,
) {
  for (const quote of quotes) {
    const candidate = candidates.get(quote.code);
    if (!candidate) continue;
    const before = { ...candidate };
    if (quote.name) {
      candidate.name = quote.name;
      candidate.isSt ||= /ST|退/.test(quote.name);
    }
    if (replaceExisting) {
      candidate.price = quote.price;
      candidate.changePercent = quote.changePercent;
      candidate.turnoverRate = quote.turnoverRate;
      candidate.amountYuan = amountYuanFromWan(quote.amount);
      candidate.volume = integer(quote.volume);
      candidate.totalMarketCapYuan = marketCapYuan(quote.totalMarketCap);
      candidate.circulatingMarketCapYuan = marketCapYuan(quote.circulatingMarketCap);
      candidate.fetchedAt = quote.fetchedAt;
      candidate.dataSource = source;
      continue;
    }
    candidate.price ??= quote.price;
    candidate.changePercent ??= quote.changePercent;
    candidate.turnoverRate ??= quote.turnoverRate;
    candidate.amountYuan ??= amountYuanFromWan(quote.amount);
    candidate.volume ??= integer(quote.volume);
    candidate.totalMarketCapYuan ??= marketCapYuan(quote.totalMarketCap);
    candidate.circulatingMarketCapYuan ??= marketCapYuan(quote.circulatingMarketCap);
    candidate.fetchedAt ??= quote.fetchedAt;
    if (candidateDiffers(before, candidate)) candidate.dataSource = source;
  }
}

function hasCurrentQuote(candidate: IConditionScreenerCandidate) {
  return (
    candidate.dataSource !== 'duckdb' &&
    [
      candidate.price,
      candidate.changePercent,
      candidate.turnoverRate,
      candidate.amountYuan,
      candidate.volume,
      candidate.totalMarketCapYuan,
      candidate.circulatingMarketCapYuan,
    ].some((value) => value !== undefined && Number.isFinite(value))
  );
}

function hasRequiredQuoteFieldMissing(
  candidate: IConditionScreenerCandidate,
  options: ReturnType<typeof normalizeInput>,
) {
  return missingQuoteFields(candidate, options).length > 0;
}

function missingQuoteFields(
  candidate: IConditionScreenerCandidate,
  options: ReturnType<typeof normalizeInput>,
): string[] {
  const missing: string[] = [];
  const needsTotalMarketCap =
    options.minTotalMarketCapYuan !== undefined ||
    options.maxTotalMarketCapYuan !== undefined ||
    options.maxTotalMarketCapYuanExclusive !== undefined ||
    options.sortBy === 'totalMarketCap';
  const needsCirculatingMarketCap =
    options.minCirculatingMarketCapYuan !== undefined ||
    options.maxCirculatingMarketCapYuan !== undefined ||
    options.maxCirculatingMarketCapYuanExclusive !== undefined ||
    options.sortBy === 'circulatingMarketCap';
  const needsAmount =
    options.minAmountYuan !== undefined ||
    options.maxAmountYuan !== undefined ||
    options.amountMinYuanExclusive !== undefined ||
    options.sortBy === 'amount';
  const needsVolume =
    options.minVolume !== undefined ||
    options.maxVolume !== undefined ||
    options.volumeMinExclusive !== undefined ||
    options.sortBy === 'volume';
  const needsTurnover =
    options.turnoverRateMin !== undefined ||
    options.turnoverRateMax !== undefined ||
    options.turnoverRateMinExclusive !== undefined ||
    options.sortBy === 'turnoverRate';
  const needsChangePercent =
    options.changePercentMin !== undefined ||
    options.changePercentMax !== undefined ||
    options.sortBy === 'changePercent';
  if (needsTotalMarketCap && candidate.totalMarketCapYuan === undefined) missing.push('总市值');
  if (needsCirculatingMarketCap && candidate.circulatingMarketCapYuan === undefined) missing.push('流通市值');
  if (needsAmount && candidate.amountYuan === undefined) missing.push('成交额');
  if (needsVolume && candidate.volume === undefined) missing.push('成交量');
  if (needsTurnover && candidate.turnoverRate === undefined) missing.push('换手率');
  if (needsChangePercent && candidate.changePercent === undefined) missing.push('涨跌幅');
  return missing;
}

async function applyChipConditions(
  candidates: IConditionScreenerCandidate[],
  options: ReturnType<typeof normalizeInput>,
  boardScope: IConditionScreenerBoardScope,
  warnings: string[],
): Promise<{ rows: IConditionScreenerRow[]; missingChipData: number }> {
  const needsChip = hasChipConditions(options);
  const chipByCode = await loadChips(warnings);
  if (needsChip) startBackgroundChipHydration(candidates, options, chipByCode, warnings);

  let missingChipData = 0;
  const rows: IConditionScreenerRow[] = [];
  for (const candidate of candidates) {
    const metrics = getChipMetrics(chipByCode.get(candidate.code));
    if (needsChip && !hasRequiredChipMetrics(metrics, options)) {
      missingChipData += 1;
      continue;
    }
    if (!passesChipConditions(metrics, options)) continue;
    rows.push({
      code: candidate.code,
      name: candidate.name,
      exchange: candidate.exchange,
      industry: candidate.industry,
      price: candidate.price,
      changePercent: candidate.changePercent,
      turnoverRate: candidate.turnoverRate,
      amountYuan: candidate.amountYuan,
      volume: candidate.volume,
      totalMarketCapYuan: candidate.totalMarketCapYuan,
      circulatingMarketCapYuan: candidate.circulatingMarketCapYuan,
      concentration90Percent: metrics.concentration90Percent,
      concentration70Percent: metrics.concentration70Percent,
      profitRatioPercent: metrics.profitRatioPercent,
      chipDate: metrics.chipDate,
      leadingBoards: boardScope.membershipByCode.get(candidate.code),
      missingFields: missingQuoteFields(candidate, options),
      dataSource: candidate.dataSource,
      fetchedAt: candidate.fetchedAt,
    });
  }
  if (missingChipData) warnings.push(`筹码数据缺失 ${missingChipData} 只，未纳入含筹码条件筛选`);
  return { rows, missingChipData };
}

async function hydrateDisplayedChipMetrics(rows: IConditionScreenerRow[]): Promise<IConditionScreenerRow[]> {
  const targets = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.concentration90Percent === undefined || row.concentration70Percent === undefined);
  if (!targets.length) return rows;

  const hydratedRows = [...rows];
  let failedCount = 0;
  await runWithConcurrency(targets, CHIP_DISPLAY_HYDRATION_CONCURRENCY, async ({ row, index }) => {
    try {
      const chip = await dependencies.getChipDistribution(row.code);
      if (!isChipDistributionResult(chip)) {
        failedCount += 1;
        return;
      }
      const metrics = getChipMetricsFromDistribution(chip);
      hydratedRows[index] = {
        ...row,
        concentration90Percent: row.concentration90Percent ?? metrics.concentration90Percent,
        concentration70Percent: row.concentration70Percent ?? metrics.concentration70Percent,
        profitRatioPercent: row.profitRatioPercent ?? metrics.profitRatioPercent,
        chipDate: row.chipDate ?? metrics.chipDate,
      };
    } catch (error) {
      failedCount += 1;
      console.warn(`[condition-screener] ${row.code} 展示筹码数据补齐失败：${formatError(error)}`);
    }
  });
  if (failedCount) console.warn(`[condition-screener] 展示行筹码数据补齐失败 ${failedCount} 只`);
  return hydratedRows;
}

async function loadChips(warnings: string[]) {
  try {
    const chips = await dependencies.listStockChips(10000);
    return new Map(chips.map((chip) => [chip.symbol, chip]));
  } catch (error) {
    warnings.push(`本地筹码缓存读取失败：${formatError(error)}`);
    return new Map<string, StockChipCacheRecord>();
  }
}

function startBackgroundChipHydration(
  candidates: IConditionScreenerCandidate[],
  options: ReturnType<typeof normalizeInput>,
  chipByCode: Map<string, StockChipCacheRecord>,
  warnings: string[],
) {
  const missingCandidates = candidates.filter(
    (candidate) => !hasRequiredChipMetrics(getChipMetrics(chipByCode.get(candidate.code)), options),
  );
  if (!missingCandidates.length) return;

  const candidatesToHydrate = missingCandidates.slice(0, CHIP_BACKGROUND_HYDRATION_LIMIT);
  warnings.push(
    `筹码数据待补齐 ${missingCandidates.length} 只，已基于本地真实筹码缓存完成本轮筛选；后台将补齐前 ${candidatesToHydrate.length} 只供后续筛选使用`,
  );
  void runWithConcurrency(candidatesToHydrate, CHIP_BACKGROUND_HYDRATION_CONCURRENCY, async (candidate) => {
    try {
      const data = await dependencies.getChipDistribution(candidate.code);
      if (!isChipDistributionResult(data)) {
        console.warn(`[condition-screener] ${candidate.code} 返回无效筹码数据`);
      }
    } catch (error) {
      console.warn(`[condition-screener] ${candidate.code} 筹码后台补齐失败：${formatError(error)}`);
    }
  }).catch((error) => {
    console.warn(`[condition-screener] 筹码后台补齐任务失败：${formatError(error)}`);
  });
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
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

function getChipMetrics(chip: StockChipCacheRecord | undefined) {
  return getChipMetricsFromDistribution(chip && isChipDistributionResult(chip.data) ? chip.data : undefined);
}

function getChipMetricsFromDistribution(chip: IChipDistributionResult | undefined) {
  const latest = chip?.latest;
  return {
    concentration90Percent: ratioPercent(latest?.concentration90),
    concentration70Percent: ratioPercent(latest?.concentration70),
    profitRatioPercent: ratioPercent(latest?.profitRatio),
    chipDate: latest?.date,
  };
}

function hasRequiredChipMetrics(
  metrics: ReturnType<typeof getChipMetrics>,
  options: ReturnType<typeof normalizeInput>,
) {
  return !(
    (needsRangeMetric(options.concentration90Min, options.concentration90Max, options.concentration90MaxExclusive) &&
      metrics.concentration90Percent === undefined) ||
    (needsRangeMetric(options.concentration70Min, options.concentration70Max, options.concentration70MaxExclusive) &&
      metrics.concentration70Percent === undefined) ||
    (needsRangeMetric(options.profitRatioMin, options.profitRatioMax, options.profitRatioMinExclusive) &&
      metrics.profitRatioPercent === undefined) ||
    (options.sortBy === 'concentration90' && metrics.concentration90Percent === undefined) ||
    (options.sortBy === 'concentration70' && metrics.concentration70Percent === undefined)
  );
}

function hasChipConditions(options: ReturnType<typeof normalizeInput>) {
  return (
    needsRangeMetric(options.concentration90Min, options.concentration90Max, options.concentration90MaxExclusive) ||
    needsRangeMetric(options.concentration70Min, options.concentration70Max, options.concentration70MaxExclusive) ||
    needsRangeMetric(options.profitRatioMin, options.profitRatioMax, options.profitRatioMinExclusive) ||
    options.sortBy === 'concentration90' ||
    options.sortBy === 'concentration70'
  );
}

function needsRangeMetric(min?: number, max?: number, exclusiveMinOrMax?: number) {
  return min !== undefined || max !== undefined || exclusiveMinOrMax !== undefined;
}

function passesChipConditions(metrics: ReturnType<typeof getChipMetrics>, options: ReturnType<typeof normalizeInput>) {
  if (!passesInclusiveRange(metrics.concentration90Percent, options.concentration90Min, options.concentration90Max))
    return false;
  if (
    options.concentration90MaxExclusive !== undefined &&
    !passesExclusiveMax(metrics.concentration90Percent, options.concentration90MaxExclusive)
  )
    return false;
  if (!passesInclusiveRange(metrics.concentration70Percent, options.concentration70Min, options.concentration70Max))
    return false;
  if (
    options.concentration70MaxExclusive !== undefined &&
    !passesExclusiveMax(metrics.concentration70Percent, options.concentration70MaxExclusive)
  )
    return false;
  if (!passesInclusiveRange(metrics.profitRatioPercent, options.profitRatioMin, options.profitRatioMax)) return false;
  if (
    options.profitRatioMinExclusive !== undefined &&
    !passesExclusiveMin(metrics.profitRatioPercent, options.profitRatioMinExclusive)
  )
    return false;
  return true;
}

function passesQuoteConditions(
  candidate: IConditionScreenerCandidate,
  options: ReturnType<typeof normalizeInput>,
  boardScope: IConditionScreenerBoardScope,
) {
  if (!hasCurrentQuote(candidate)) return false;
  if (options.excludeST && candidate.isSt) return false;
  if (!passesMarketScopes(candidate, options.marketScopes)) return false;
  if (!passesInclusiveRange(candidate.totalMarketCapYuan, options.minTotalMarketCapYuan, options.maxTotalMarketCapYuan))
    return false;
  if (
    options.maxTotalMarketCapYuanExclusive !== undefined &&
    !passesExclusiveMax(candidate.totalMarketCapYuan, options.maxTotalMarketCapYuanExclusive)
  )
    return false;
  if (
    !passesInclusiveRange(
      candidate.circulatingMarketCapYuan,
      options.minCirculatingMarketCapYuan,
      options.maxCirculatingMarketCapYuan,
    )
  )
    return false;
  if (
    options.maxCirculatingMarketCapYuanExclusive !== undefined &&
    !passesExclusiveMax(candidate.circulatingMarketCapYuan, options.maxCirculatingMarketCapYuanExclusive)
  )
    return false;
  if (!passesInclusiveRange(candidate.turnoverRate, options.turnoverRateMin, options.turnoverRateMax)) return false;
  if (
    options.turnoverRateMinExclusive !== undefined &&
    !passesExclusiveMin(candidate.turnoverRate, options.turnoverRateMinExclusive)
  )
    return false;
  if (!passesInclusiveRange(candidate.amountYuan, options.minAmountYuan, options.maxAmountYuan)) return false;
  if (
    options.amountMinYuanExclusive !== undefined &&
    !passesExclusiveMin(candidate.amountYuan, options.amountMinYuanExclusive)
  )
    return false;
  if (!passesInclusiveRange(candidate.volume, options.minVolume, options.maxVolume)) return false;
  if (options.volumeMinExclusive !== undefined && !passesExclusiveMin(candidate.volume, options.volumeMinExclusive))
    return false;
  if (!passesInclusiveRange(candidate.changePercent, options.changePercentMin, options.changePercentMax)) return false;
  return !options.leadingBoards || boardScope.membershipByCode.has(candidate.code);
}

function passesMarketScopes(candidate: IConditionScreenerCandidate, scopes: TConditionScreenerMarketScope[]) {
  if (!scopes.length) return true;
  return scopes.some((scope) => {
    if (scope === 'sh') return candidate.exchange === 'SH';
    if (scope === 'sz') return candidate.exchange === 'SZ';
    if (scope === 'bj') return candidate.exchange === 'BJ';
    if (scope === 'kc') return candidate.code.startsWith('688') || candidate.code.startsWith('689');
    if (scope === 'cy') return candidate.code.startsWith('300') || candidate.code.startsWith('301');
    if (scope === 'main')
      return (
        (candidate.exchange === 'SH' &&
          candidate.code.startsWith('6') &&
          !candidate.code.startsWith('688') &&
          !candidate.code.startsWith('689')) ||
        (candidate.exchange === 'SZ' &&
          (candidate.code.startsWith('000') ||
            candidate.code.startsWith('001') ||
            candidate.code.startsWith('002') ||
            candidate.code.startsWith('003')))
      );
    return false;
  });
}

function sortRows(rows: IConditionScreenerRow[], options: ReturnType<typeof normalizeInput>) {
  return [...rows].sort((left, right) => {
    const difference = compareOptionalNumbers(
      sortValue(left, options.sortBy),
      sortValue(right, options.sortBy),
      options.sortOrder,
    );
    if (difference) return difference;
    return left.code.localeCompare(right.code);
  });
}

function sortValue(row: IConditionScreenerRow, sortBy: TConditionScreenerSortBy) {
  return {
    code: undefined,
    totalMarketCap: row.totalMarketCapYuan,
    circulatingMarketCap: row.circulatingMarketCapYuan,
    amount: row.amountYuan,
    volume: row.volume,
    turnoverRate: row.turnoverRate,
    changePercent: row.changePercent,
    concentration90: row.concentration90Percent,
    concentration70: row.concentration70Percent,
  }[sortBy];
}

function storageForCandidates(candidates: IConditionScreenerCandidate[]): IConditionScreenerResult['storage'] {
  if (!candidates.length) return 'none';
  const sources = new Set(candidates.map((candidate) => candidate.dataSource));
  if (sources.size > 1) return 'mixed';
  return sources.has('duckdb') ? 'local' : 'remote';
}

function candidateDiffers(left: IConditionScreenerCandidate, right: IConditionScreenerCandidate) {
  return (
    left.price !== right.price ||
    left.changePercent !== right.changePercent ||
    left.turnoverRate !== right.turnoverRate ||
    left.amountYuan !== right.amountYuan ||
    left.volume !== right.volume ||
    left.totalMarketCapYuan !== right.totalMarketCapYuan ||
    left.circulatingMarketCapYuan !== right.circulatingMarketCapYuan
  );
}

function marketCapYuan(value: number | undefined) {
  return integer(normalizeMarketCap(value));
}

function amountYuanFromWan(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value * WAN_YUAN);
}

function passesInclusiveRange(value: number | undefined, min?: number, max?: number) {
  if (min === undefined && max === undefined) return true;
  return value !== undefined && (min === undefined || value >= min) && (max === undefined || value <= max);
}

function passesExclusiveMin(value: number | undefined, min: number) {
  return value !== undefined && value > min;
}

function passesExclusiveMax(value: number | undefined, max: number) {
  return value !== undefined && value < max;
}

function compareOptionalNumbers(
  left: number | undefined,
  right: number | undefined,
  order: TConditionScreenerSortOrder,
) {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  const difference = left - right;
  return order === 'desc' ? -difference : difference;
}

function isChipDistributionResult(value: unknown): value is IChipDistributionResult {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<IChipDistributionResult>;
  return Array.isArray(record.distributions) && Array.isArray(record.trend);
}

function ratioPercent(value: number | undefined) {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.abs(value) <= 1 ? value * 100 : value;
}

function integer(value: number | undefined) {
  return value === undefined || !Number.isFinite(value) || value < 0 ? undefined : Math.round(value);
}

function finite(value: number | undefined) {
  return value === undefined || !Number.isFinite(value) ? undefined : value;
}

function uniqueWarnings(warnings: string[]) {
  return [...new Set(warnings)];
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
