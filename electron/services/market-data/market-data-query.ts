import { captureEvent } from '../llm/posthog-client.js';
import type { KlinePoint, StockDetail } from '../../../src/shared/types.js';
import { inferExchange, normalizeASymbol } from '../stock/symbols.js';
import { partitionValidDailyBars } from './quality.js';
import { getRemoteFullQuote, remoteMarketStatus, stockSdkHistoricalProvider } from './providers.js';
import { getLatestDailyBar, listDailyBars, upsertDailyBars } from './market-data-store.js';
import type { AdjustType, DataResult, HistoricalBarProvider, HistoricalBarsOptions, HistoricalBarsResult, LatestQuoteResult } from './types.js';

let historicalProviders: HistoricalBarProvider[] = [stockSdkHistoricalProvider];

export function setHistoricalProvidersForTest(providers: HistoricalBarProvider[]) {
  historicalProviders = providers;
}

export async function queryHistoricalBars(symbolInput: string, options: HistoricalBarsOptions = {}): Promise<HistoricalBarsResult> {
  const symbol = normalizeASymbol(symbolInput);
  const adjustType = options.adjustType ?? 'qfq';
  const limit = options.limit ? Math.max(1, Math.floor(options.limit)) : undefined;
  validateOptions(options, adjustType);

  let local = await listDailyBars(symbol, { startDate: options.startDate, endDate: options.endDate, limit, adjustType });
  if (isComplete(local, options, limit)) {
    captureEvent('market_cache_read', { kind: 'historical_bars', hit: true, partial: false, symbol, rows: local.length });
    return resultFromBars(local, 'duckdb:daily_bars', 'local', true, [], adjustType);
  }

  const warnings: string[] = [];
  let fetched = false;
  const missing = calculateMissingRange(local, options, limit);
  for (const provider of historicalProviders) {
    try {
      const rows = await provider.getDailyBars(symbol, { adjustType, ...missing });
      const { valid, invalid } = partitionValidDailyBars(rows);
      console.log('[market-data] partition', { symbol, provider: provider.name, total: rows.length, valid: valid.length, invalid: invalid.length, firstInvalid: invalid[0]?.error });
      if (invalid.length) warnings.push(`${provider.name} 返回 ${invalid.length} 条无效日线，已忽略`);
      if (valid.length) {
        await upsertDailyBars(valid);
        fetched = true;
        break;
      }
    } catch (error) {
      console.error('[market-data] provider error', { symbol, provider: provider.name, error: error instanceof Error ? error.message : String(error) });
      warnings.push(`${provider.name} 补齐失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  local = await listDailyBars(symbol, { startDate: options.startDate, endDate: options.endDate, limit, adjustType });
  const complete = isComplete(local, options, limit);
  captureEvent('market_cache_read', { kind: 'historical_bars', hit: complete, partial: !complete && local.length > 0, symbol, rows: local.length, fetched_remote: fetched });
  if (!complete && !warnings.length) warnings.push('远程数据源未返回缺失区间数据');
  return resultFromBars(local, fetched ? 'duckdb:daily_bars+remote' : 'duckdb:daily_bars', fetched ? 'mixed' : 'local', complete, warnings, adjustType);
}

export async function queryLatestQuote(symbolInput: string, remoteLoader = getRemoteFullQuote): Promise<LatestQuoteResult> {
  const symbol = normalizeASymbol(symbolInput);
  const status = remoteMarketStatus();
  try {
    const quote = await remoteLoader(symbol);
    const isLive = status === 'open' || status === 'pre_market' || status === 'lunch_break';
    captureEvent('market_cache_read', { kind: 'latest_quote', hit: false, storage: 'remote', symbol });
    return {
      data: toStockDetail(quote, symbol),
      meta: {
        source: `stock-sdk:${quote.source}`,
        storage: 'remote',
        freshness: isLive ? 'live' : 'current',
        fetchedAt: new Date().toISOString(),
        isComplete: true,
        warnings: isLive ? [] : ['当前为非交易时段，行情为最近可用快照'],
      },
    };
  } catch (error) {
    const latest = await getLatestDailyBar(symbol);
    captureEvent('market_cache_read', { kind: 'latest_quote_fallback', hit: Boolean(latest), storage: latest ? 'local' : 'none', symbol });
    if (!latest) throw error;
    return {
      data: {
        code: symbol,
        name: symbol,
        exchange: inferExchange(symbol),
        price: latest.close,
        change: latest.change === undefined ? undefined : `${latest.change >= 0 ? '+' : ''}${latest.change.toFixed(2)}`,
        changePercent: latest.changePercent === undefined ? undefined : `${latest.changePercent >= 0 ? '+' : ''}${latest.changePercent.toFixed(2)}%`,
        open: latest.open,
        high: latest.high,
        low: latest.low,
        prevClose: latest.change === undefined ? undefined : Number((latest.close - latest.change).toFixed(2)),
        volume: `${(latest.volume / 10_000).toFixed(1)}万手`,
        turnover: latest.amount === undefined ? '--' : `${(latest.amount / 100_000_000).toFixed(2)}亿`,
        turnoverRate: latest.turnoverRate === undefined ? undefined : `${latest.turnoverRate.toFixed(2)}%`,
        summary: `实时行情获取失败，当前价格为 ${latest.tradeDate} 最近交易日收盘价。`,
      },
      meta: {
        source: latest.source,
        storage: 'local',
        freshness: 'stale',
        latestTradeDate: latest.tradeDate,
        isComplete: false,
        warnings: ['实时行情获取失败，当前价格为最近交易日收盘价'],
        adjustType: latest.adjustType,
      },
    };
  }
}

function calculateMissingRange(local: Awaited<ReturnType<typeof listDailyBars>>, options: HistoricalBarsOptions, limit?: number) {
  if (!local.length) return { startDate: options.startDate ?? (limit ? yearsAgoForLimit(limit) : undefined), endDate: options.endDate };
  if (options.startDate && local[0].tradeDate > options.startDate) return { startDate: options.startDate, endDate: dayBefore(local[0].tradeDate) };
  if (options.endDate && local.at(-1)!.tradeDate < options.endDate) return { startDate: dayAfter(local.at(-1)!.tradeDate), endDate: options.endDate };
  if (limit && local.length < limit) return { startDate: yearsAgoForLimit(limit), endDate: dayBefore(local[0].tradeDate) };
  return { startDate: options.startDate, endDate: options.endDate };
}

function isComplete(local: Awaited<ReturnType<typeof listDailyBars>>, options: HistoricalBarsOptions, limit?: number) {
  if (!local.length) return false;
  if (limit && local.length < limit) return false;
  if (options.startDate && local[0].tradeDate > options.startDate) return false;
  if (options.endDate && local.at(-1)!.tradeDate < options.endDate) return false;
  return true;
}

function resultFromBars(bars: Awaited<ReturnType<typeof listDailyBars>>, source: string, storage: 'local' | 'mixed', complete: boolean, warnings: string[], adjustType: AdjustType): HistoricalBarsResult {
  return {
    data: bars.map(toKlinePoint),
    meta: {
      source,
      storage,
      freshness: complete ? 'historical' : 'stale',
      fetchedAt: bars.at(-1)?.fetchedAt,
      latestTradeDate: bars.at(-1)?.tradeDate,
      requestedStartDate: bars[0]?.tradeDate,
      requestedEndDate: bars.at(-1)?.tradeDate,
      isComplete: complete,
      warnings,
      adjustType,
    },
  };
}

function toKlinePoint(bar: Awaited<ReturnType<typeof listDailyBars>>[number]): KlinePoint {
  return {
    time: bar.tradeDate,
    timestamp: toTimestamp(bar.tradeDate),
    open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume,
    amount: bar.amount, change: bar.change, changePercent: bar.changePercent, turnoverRate: bar.turnoverRate,
  };
}

function toTimestamp(tradeDate: string): number | undefined {
  // ponytail: guard NaN from Date.parse on malformed dates (e.g. old DB data before toDateString fix)
  const ts = Date.parse(`${tradeDate}T00:00:00+08:00`);
  return Number.isFinite(ts) ? ts : undefined;
}

function toStockDetail(quote: Awaited<ReturnType<typeof getRemoteFullQuote>>, symbol: string): StockDetail {
  return {
    code: quote.code || symbol,
    name: quote.name || symbol,
    exchange: inferExchange(symbol),
    price: quote.price,
    change: `${quote.change >= 0 ? '+' : ''}${quote.change.toFixed(2)}`,
    changePercent: `${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%`,
    open: quote.open ?? '--',
    high: quote.high ?? '--',
    low: quote.low ?? '--',
    prevClose: quote.prevClose ?? '--',
    pe: quote.pe ?? '--', pb: quote.pb ?? '--',
    marketCap: quote.totalMarketCap === null ? '--' : `${(quote.totalMarketCap / 100000000).toFixed(1)}亿`,
    volume: `${(quote.volume / 10_000).toFixed(1)}万手`,
    turnover: `${(quote.amount / 10_000).toFixed(2)}亿`,
    turnoverRate: quote.turnoverRate === null || quote.turnoverRate === undefined ? '--' : `${quote.turnoverRate.toFixed(2)}%`,
    rating: { fundamental: '待评估', valuation: quote.pe && quote.pe < 25 ? '相对合理' : '需核查', tech: '待分析', risk: '中性' },
    summary: `${quote.name}（${symbol}）远程行情快照，时间 ${quote.time || '--'}。`,
  };
}

function validateOptions(options: HistoricalBarsOptions, adjustType: AdjustType) {
  if (options.period && options.period !== '1d') throw new Error('本地历史工具仅支持日线');
  if (!['qfq', 'none'].includes(adjustType)) throw new Error('不支持的复权口径');
  for (const value of [options.startDate, options.endDate]) if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('日期必须为 YYYY-MM-DD');
  if (options.startDate && options.endDate && options.startDate > options.endDate) throw new Error('开始日期不能晚于结束日期');
}

function yearsAgoForLimit(limit: number) {
  const date = new Date();
  date.setFullYear(date.getFullYear() - Math.ceil(limit / 220) - 1);
  return isoDate(date);
}
function dayBefore(value: string) { const date = new Date(`${value}T12:00:00+08:00`); date.setDate(date.getDate() - 1); return isoDate(date); }
function dayAfter(value: string) { const date = new Date(`${value}T12:00:00+08:00`); date.setDate(date.getDate() + 1); return isoDate(date); }
function isoDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }

export type { DataResult };
