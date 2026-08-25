import type { FullQuote } from 'stock-sdk';
import { runAStockDataFn, type ITencentQuote } from '../stock/quotes/a-stock-data-runner.js';
import { sdk } from '../stock/quotes/shared.js';
import { normalizeASymbol } from '../stock/stock-detail/symbols.js';
import type { SecurityRecord } from './types.js';

export interface IMarketSnapshotQuoteRecord {
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
  /** 成交额（万），与 stock_snapshots 的存储单位一致。 */
  amount?: number;
  turnoverRate?: number;
  pe?: number;
  pb?: number;
  /** 总市值（亿），与 stock_snapshots 的存储单位一致。 */
  totalMarketCap?: number;
  /** 流通市值（亿），与 stock_snapshots 的存储单位一致。 */
  circulatingMarketCap?: number;
  amplitude?: number;
  fetchedAt?: string;
}

export interface IMarketSnapshotQuoteFetchResult {
  quotes: IMarketSnapshotQuoteRecord[];
  warnings: string[];
}

const STOCK_SDK_BATCH_SIZE = 500;
const STOCK_SDK_BATCH_CONCURRENCY = 6;
const A_STOCK_DATA_BATCH_SIZE = 100;

export async function fetchStockSdkMarketSnapshotQuotes(codes: string[]): Promise<IMarketSnapshotQuoteFetchResult> {
  const unique = uniqueCodes(codes);
  if (!unique.length) return { quotes: [], warnings: [] };

  try {
    const rows = await sdk.batch.byCodes(unique, {
      batchSize: STOCK_SDK_BATCH_SIZE,
      concurrency: STOCK_SDK_BATCH_CONCURRENCY,
    });
    return { quotes: rows.map(toMarketSnapshotQuote), warnings: [] };
  } catch (error) {
    return { quotes: [], warnings: [`stock-sdk 全市场行情补齐失败：${formatError(error)}`] };
  }
}

export async function fetchStockSdkAllMarketSnapshotQuotes(): Promise<IMarketSnapshotQuoteFetchResult> {
  try {
    const rows = await sdk.batch.cn({ batchSize: STOCK_SDK_BATCH_SIZE, concurrency: STOCK_SDK_BATCH_CONCURRENCY });
    return { quotes: rows.map(toMarketSnapshotQuote), warnings: [] };
  } catch (error) {
    return { quotes: [], warnings: [`stock-sdk 全市场行情获取失败：${formatError(error)}`] };
  }
}

export async function fetchAStockDataMarketSnapshotQuotes(codes: string[]): Promise<IMarketSnapshotQuoteFetchResult> {
  const quotes: IMarketSnapshotQuoteRecord[] = [];
  const warnings: string[] = [];
  const unique = uniqueCodes(codes);
  for (const batch of chunk(unique, A_STOCK_DATA_BATCH_SIZE)) {
    try {
      const result = await runAStockDataFn<Record<string, ITencentQuote>>('tencent_quote', { codes: batch.join(',') });
      for (const [rawCode, quote] of Object.entries(result)) {
        const code = normalizeASymbol(rawCode);
        if (!code) continue;
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
          amount: positiveFiniteNumber(quote.amount_wan),
          turnoverRate: finiteNumber(quote.turnover_pct),
          pe: finiteNumber(quote.pe_ttm),
          pb: finiteNumber(quote.pb),
          totalMarketCap: positiveFiniteNumber(quote.mcap_yi),
          circulatingMarketCap: positiveFiniteNumber(quote.float_mcap_yi),
          amplitude: finiteNumber(quote.amplitude_pct),
          fetchedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      warnings.push(`a-stock-data 批次 ${batch[0]}-${batch.at(-1)} 行情补齐失败：${formatError(error)}`);
    }
  }
  return { quotes, warnings };
}

function toMarketSnapshotQuote(row: FullQuote): IMarketSnapshotQuoteRecord {
  const code = normalizeASymbol(row.code);
  return {
    code,
    name: row.name,
    exchange: inferAShareExchange(code),
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
  };
}

function inferAShareExchange(code: string): SecurityRecord['exchange'] {
  if (code.startsWith('6')) return 'SH';
  if (code.startsWith('8') || code.startsWith('4')) return 'BJ';
  return 'SZ';
}

function positiveFiniteNumber(value: number | undefined) {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
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

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
