import { listRemoteSecurities } from './providers.js';
import {
  listAShareMarketCapSnapshotRows,
  upsertSecurities,
  upsertStockSnapshots,
  type IAShareMarketCapSnapshotRow,
} from './market-data-store.js';
import type { SecurityRecord } from './types.js';
import { runAStockDataFn, type ITencentQuote } from '../stock/a-stock-data-runner.js';
import { normalizeMarketCap } from '../stock/format.js';
import { sdk } from '../stock/shared.js';
import { normalizeASymbol } from '../stock/symbols.js';

export type TMarketCapField = 'total' | 'circulating';
export type TMarketCapUnit = 'yuan' | 'yi';
export type TMarketCapDataSource = 'duckdb' | 'stock-sdk' | 'a-stock-data';

export interface IMarketCapScreenInput {
  minMarketCap?: number;
  maxMarketCap?: number;
  unit?: TMarketCapUnit;
  marketCapField?: TMarketCapField;
  limit?: number;
  includeST?: boolean;
  sortOrder?: 'asc' | 'desc';
}

export interface IMarketCapScreenRow {
  code: string;
  name: string;
  exchange: SecurityRecord['exchange'];
  industry?: string;
  price?: number;
  changePercent?: number;
  turnoverRate?: number;
  amount?: number;
  totalMarketCap?: number;
  circulatingMarketCap?: number;
  marketCap: number;
  marketCapYi: number;
  marketCapText: string;
  dataSource: TMarketCapDataSource;
  fetchedAt?: string;
}

export interface IMarketCapScreenResult {
  source: 'duckdb+stock-sdk+a-stock-data';
  storage: 'local' | 'mixed' | 'remote' | 'none';
  marketCapField: TMarketCapField;
  minMarketCap?: number;
  maxMarketCap?: number;
  unit: 'yuan';
  rows: IMarketCapScreenRow[];
  matchedCount: number;
  returnedCount: number;
  totalCandidates: number;
  sourceStats: {
    duckdbMatched: number;
    stockSdkMatched: number;
    aStockDataMatched: number;
    missingMarketCap: number;
  };
  warnings: string[];
  isEmpty: boolean;
}

interface IMarketCapQuoteRecord {
  code: string;
  name: string;
  exchange?: SecurityRecord['exchange'];
  industry?: string;
  price?: number;
  change?: number;
  changePercent?: number;
  open?: number;
  high?: number;
  low?: number;
  prevClose?: number;
  volume?: number;
  amount?: number;
  turnoverRate?: number;
  pe?: number;
  pb?: number;
  totalMarketCap?: number;
  circulatingMarketCap?: number;
  amplitude?: number;
  fetchedAt?: string;
}

interface IQuoteFetchResult {
  quotes: IMarketCapQuoteRecord[];
  warnings: string[];
}

interface IMarketCapScreenerDependencies {
  listLocalRows(includeST: boolean): Promise<IAShareMarketCapSnapshotRow[]>;
  listRemoteSecurities(): Promise<SecurityRecord[]>;
  upsertSecurities(records: SecurityRecord[]): Promise<void>;
  upsertSnapshots(records: IMarketCapQuoteRecord[]): Promise<void>;
  fetchStockSdkQuotes(codes: string[]): Promise<IQuoteFetchResult>;
  fetchAStockDataQuotes(codes: string[]): Promise<IQuoteFetchResult>;
}

const YI_YUAN = 100_000_000;
const STOCK_SDK_BATCH_SIZE = 80;
const A_STOCK_DATA_BATCH_SIZE = 100;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const defaultDependencies: IMarketCapScreenerDependencies = {
  listLocalRows: listAShareMarketCapSnapshotRows,
  listRemoteSecurities,
  upsertSecurities,
  upsertSnapshots: async (records) => {
    await upsertStockSnapshots(records.map((record) => ({
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
    })));
  },
  fetchStockSdkQuotes: fetchStockSdkQuotesDefault,
  fetchAStockDataQuotes: fetchAStockDataQuotesDefault,
};

let dependencies = defaultDependencies;

export function setMarketCapScreenerDependenciesForTest(overrides: Partial<IMarketCapScreenerDependencies>) {
  dependencies = { ...defaultDependencies, ...overrides };
}

export function resetMarketCapScreenerDependenciesForTest() {
  dependencies = defaultDependencies;
}

export async function screenASharesByMarketCap(input: IMarketCapScreenInput = {}): Promise<IMarketCapScreenResult> {
  const options = normalizeInput(input);
  const warnings: string[] = [];
  let localRows = await loadLocalRows(options.includeST, warnings);

  if (!localRows.length) {
    await fillSecuritiesFromRemote(warnings);
    localRows = await loadLocalRows(options.includeST, warnings);
  }

  const totalCandidates = localRows.length;
  const candidateByCode = new Map(localRows.map((row) => [row.symbol, row]));
  const resolved = new Map<string, IMarketCapScreenRow>();

  for (const row of localRows) {
    const mapped = rowToScreenRow(row, options.marketCapField, 'duckdb');
    if (mapped) resolved.set(mapped.code, mapped);
  }

  const missingAfterDuckDB = localRows
    .filter((row) => !resolved.has(row.symbol))
    .map((row) => row.symbol);
  const stockSdkResult = await loadStockSdkQuotes(missingAfterDuckDB, warnings);
  await persistQuoteRecords(stockSdkResult.quotes, warnings);
  mergeQuoteRows(stockSdkResult.quotes, candidateByCode, resolved, options.marketCapField, 'stock-sdk');

  const missingAfterStockSdk = missingAfterDuckDB.filter((code) => !resolved.has(code));
  const aStockDataResult = await loadAStockDataQuotes(missingAfterStockSdk, warnings);
  await persistQuoteRecords(aStockDataResult.quotes, warnings);
  mergeQuoteRows(aStockDataResult.quotes, candidateByCode, resolved, options.marketCapField, 'a-stock-data');

  const matched = [...resolved.values()]
    .filter((row) => passesRange(row.marketCap, options.minMarketCap, options.maxMarketCap))
    .sort((left, right) => options.sortOrder === 'asc' ? left.marketCap - right.marketCap : right.marketCap - left.marketCap);

  const rows = matched.slice(0, options.limit);
  const sourceStats = {
    duckdbMatched: matched.filter((row) => row.dataSource === 'duckdb').length,
    stockSdkMatched: matched.filter((row) => row.dataSource === 'stock-sdk').length,
    aStockDataMatched: matched.filter((row) => row.dataSource === 'a-stock-data').length,
    missingMarketCap: Math.max(0, totalCandidates - resolved.size),
  };

  if (!totalCandidates) warnings.push('未获取到全市场 A 股候选列表，无法完成 5000+ 股票市值筛选');
  if (sourceStats.missingMarketCap > 0) warnings.push(`${sourceStats.missingMarketCap} 只 A 股缺少可用${marketCapFieldLabel(options.marketCapField)}，未纳入市值筛选`);
  if (!matched.length) warnings.push('未找到符合市值区间的 A 股');

  return {
    source: 'duckdb+stock-sdk+a-stock-data',
    storage: storageForRows(rows),
    marketCapField: options.marketCapField,
    minMarketCap: options.minMarketCap,
    maxMarketCap: options.maxMarketCap,
    unit: 'yuan',
    rows,
    matchedCount: matched.length,
    returnedCount: rows.length,
    totalCandidates,
    sourceStats,
    warnings,
    isEmpty: rows.length === 0,
  };
}

function normalizeInput(input: IMarketCapScreenInput): Required<Pick<IMarketCapScreenInput, 'marketCapField' | 'limit' | 'includeST' | 'sortOrder'>> & Pick<IMarketCapScreenInput, 'minMarketCap' | 'maxMarketCap'> {
  const unit = input.unit ?? 'yi';
  const minMarketCap = normalizeBound(input.minMarketCap, unit);
  const maxMarketCap = normalizeBound(input.maxMarketCap, unit);
  return {
    minMarketCap,
    maxMarketCap,
    marketCapField: input.marketCapField === 'circulating' ? 'circulating' : 'total',
    limit: Math.max(1, Math.min(MAX_LIMIT, Math.floor(input.limit ?? DEFAULT_LIMIT))),
    includeST: input.includeST === true,
    sortOrder: input.sortOrder === 'desc' ? 'desc' : 'asc',
  };
}

function normalizeBound(value: number | undefined, unit: TMarketCapUnit) {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.round(unit === 'yi' ? value * YI_YUAN : value));
}

async function loadLocalRows(includeST: boolean, warnings: string[]) {
  try {
    return await dependencies.listLocalRows(includeST);
  } catch (error) {
    warnings.push(`本地 DuckDB 市值快照读取失败：${formatError(error)}`);
    return [];
  }
}

async function fillSecuritiesFromRemote(warnings: string[]) {
  try {
    const securities = await dependencies.listRemoteSecurities();
    if (!securities.length) {
      warnings.push('stock-sdk 未返回 A 股证券列表');
      return;
    }
    await dependencies.upsertSecurities(securities);
  } catch (error) {
    warnings.push(`stock-sdk 获取 A 股证券列表失败：${formatError(error)}`);
  }
}

async function loadStockSdkQuotes(codes: string[], warnings: string[]) {
  if (!codes.length) return { quotes: [], warnings: [] };
  try {
    const result = await dependencies.fetchStockSdkQuotes(codes);
    warnings.push(...result.warnings);
    return result;
  } catch (error) {
    warnings.push(`stock-sdk 批量补齐市值失败：${formatError(error)}`);
    return { quotes: [], warnings: [] };
  }
}

async function loadAStockDataQuotes(codes: string[], warnings: string[]) {
  if (!codes.length) return { quotes: [], warnings: [] };
  try {
    const result = await dependencies.fetchAStockDataQuotes(codes);
    warnings.push(...result.warnings);
    return result;
  } catch (error) {
    warnings.push(`a-stock-data 腾讯行情补齐市值失败：${formatError(error)}`);
    return { quotes: [], warnings: [] };
  }
}

async function persistQuoteRecords(records: IMarketCapQuoteRecord[], warnings: string[]) {
  if (!records.length) return;
  try {
    await dependencies.upsertSnapshots(records);
  } catch (error) {
    warnings.push(`市值快照回写 DuckDB 失败：${formatError(error)}`);
  }
}

function mergeQuoteRows(
  quotes: IMarketCapQuoteRecord[],
  candidateByCode: Map<string, IAShareMarketCapSnapshotRow>,
  resolved: Map<string, IMarketCapScreenRow>,
  field: TMarketCapField,
  source: Exclude<TMarketCapDataSource, 'duckdb'>,
) {
  for (const quote of quotes) {
    const code = normalizeASymbol(quote.code);
    if (!code || resolved.has(code)) continue;
    const candidate = candidateByCode.get(code);
    if (!candidate) continue;
    const row = quoteToScreenRow(quote, candidate, field, source);
    if (row) resolved.set(code, row);
  }
}

function rowToScreenRow(
  row: IAShareMarketCapSnapshotRow,
  field: TMarketCapField,
  source: TMarketCapDataSource,
): IMarketCapScreenRow | undefined {
  const totalMarketCap = normalizeMarketCapValue(row.totalMarketCap);
  const circulatingMarketCap = normalizeMarketCapValue(row.circulatingMarketCap);
  const marketCap = selectMarketCap({ totalMarketCap, circulatingMarketCap }, field);
  if (marketCap === undefined) return undefined;
  return {
    code: row.symbol,
    name: row.name,
    exchange: row.exchange,
    industry: row.industry,
    price: row.price,
    changePercent: row.changePercent,
    turnoverRate: row.turnoverRate,
    amount: row.amount,
    totalMarketCap,
    circulatingMarketCap,
    marketCap,
    marketCapYi: marketCap / YI_YUAN,
    marketCapText: formatMarketCapText(marketCap),
    dataSource: source,
    fetchedAt: row.fetchedAt,
  };
}

function quoteToScreenRow(
  quote: IMarketCapQuoteRecord,
  candidate: IAShareMarketCapSnapshotRow,
  field: TMarketCapField,
  source: Exclude<TMarketCapDataSource, 'duckdb'>,
): IMarketCapScreenRow | undefined {
  const totalMarketCap = normalizeMarketCapValue(quote.totalMarketCap);
  const circulatingMarketCap = normalizeMarketCapValue(quote.circulatingMarketCap);
  const marketCap = selectMarketCap({ totalMarketCap, circulatingMarketCap }, field);
  if (marketCap === undefined) return undefined;
  return {
    code: candidate.symbol,
    name: quote.name || candidate.name,
    exchange: candidate.exchange,
    industry: quote.industry ?? candidate.industry,
    price: quote.price,
    changePercent: quote.changePercent,
    turnoverRate: quote.turnoverRate,
    amount: quote.amount,
    totalMarketCap,
    circulatingMarketCap,
    marketCap,
    marketCapYi: marketCap / YI_YUAN,
    marketCapText: formatMarketCapText(marketCap),
    dataSource: source,
    fetchedAt: quote.fetchedAt,
  };
}

function normalizeMarketCapValue(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return normalizeMarketCap(value);
}

function selectMarketCap(
  values: Pick<IMarketCapScreenRow, 'totalMarketCap' | 'circulatingMarketCap'>,
  field: TMarketCapField,
) {
  return field === 'circulating' ? values.circulatingMarketCap : values.totalMarketCap;
}

function passesRange(value: number, min?: number, max?: number) {
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

function storageForRows(rows: IMarketCapScreenRow[]): IMarketCapScreenResult['storage'] {
  if (!rows.length) return 'none';
  const sources = new Set(rows.map((row) => row.dataSource));
  if (sources.size > 1) return 'mixed';
  if (sources.has('duckdb')) return 'local';
  return 'remote';
}

function formatMarketCapText(value: number) {
  return `${(value / YI_YUAN).toFixed(1)}亿`;
}

function marketCapFieldLabel(field: TMarketCapField) {
  return field === 'circulating' ? '流通市值' : '总市值';
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function inferAShareExchange(code: string): SecurityRecord['exchange'] {
  if (code.startsWith('6')) return 'SH';
  if (code.startsWith('8') || code.startsWith('4')) return 'BJ';
  return 'SZ';
}

async function fetchStockSdkQuotesDefault(codes: string[]): Promise<IQuoteFetchResult> {
  const quotes: IMarketCapQuoteRecord[] = [];
  const warnings: string[] = [];
  const unique = uniqueCodes(codes);
  for (const batch of chunk(unique, STOCK_SDK_BATCH_SIZE)) {
    try {
      const rows = await sdk.batch.byCodes(batch, { batchSize: STOCK_SDK_BATCH_SIZE, concurrency: 1 });
      quotes.push(...rows.map((row) => ({
        code: normalizeASymbol(row.code),
        name: row.name,
        exchange: inferAShareExchange(normalizeASymbol(row.code)),
        price: row.price,
        change: row.change,
        changePercent: row.changePercent,
        open: row.open,
        high: row.high,
        low: row.low,
        prevClose: row.prevClose,
        volume: row.volume,
        amount: row.amount,
        turnoverRate: row.turnoverRate ?? undefined,
        pe: row.pe ?? undefined,
        pb: row.pb ?? undefined,
        totalMarketCap: row.totalMarketCap ?? undefined,
        circulatingMarketCap: row.circulatingMarketCap ?? undefined,
        amplitude: row.amplitude ?? undefined,
        fetchedAt: new Date().toISOString(),
      })));
    } catch (error) {
      warnings.push(`stock-sdk 批次 ${batch[0]}-${batch.at(-1)} 市值补齐失败：${formatError(error)}`);
    }
  }
  return { quotes, warnings };
}

async function fetchAStockDataQuotesDefault(codes: string[]): Promise<IQuoteFetchResult> {
  const quotes: IMarketCapQuoteRecord[] = [];
  const warnings: string[] = [];
  const unique = uniqueCodes(codes);
  for (const batch of chunk(unique, A_STOCK_DATA_BATCH_SIZE)) {
    try {
      const result = await runAStockDataFn<Record<string, ITencentQuote>>('tencent_quote', { codes: batch.join(',') });
      for (const [rawCode, quote] of Object.entries(result)) {
        const code = normalizeASymbol(rawCode);
        const totalMarketCap = normalizeYiMarketCap(quote.mcap_yi);
        const circulatingMarketCap = normalizeYiMarketCap(quote.float_mcap_yi);
        if (totalMarketCap === undefined && circulatingMarketCap === undefined) continue;
        quotes.push({
          code,
          name: quote.name,
          exchange: inferAShareExchange(code),
          price: finiteNumber(quote.price),
          change: finiteNumber(quote.change_amt),
          changePercent: finiteNumber(quote.change_pct),
          open: finiteNumber(quote.open),
          high: finiteNumber(quote.high),
          low: finiteNumber(quote.low),
          prevClose: finiteNumber(quote.last_close),
          amount: quote.amount_wan > 0 ? quote.amount_wan * 10_000 : undefined,
          turnoverRate: finiteNumber(quote.turnover_pct),
          pe: finiteNumber(quote.pe_ttm),
          pb: finiteNumber(quote.pb),
          totalMarketCap,
          circulatingMarketCap,
          amplitude: finiteNumber(quote.amplitude_pct),
          fetchedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      warnings.push(`a-stock-data 批次 ${batch[0]}-${batch.at(-1)} 市值补齐失败：${formatError(error)}`);
    }
  }
  return { quotes, warnings };
}

function normalizeYiMarketCap(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value * YI_YUAN);
}

function finiteNumber(value: number | undefined) {
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

function uniqueCodes(codes: string[]) {
  return [...new Set(codes.map((code) => normalizeASymbol(code)).filter(Boolean))];
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}
