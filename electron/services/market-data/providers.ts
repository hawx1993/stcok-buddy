import StockSDK, { type FullQuote, type HistoryKline } from 'stock-sdk';
import type { AdjustType, DailyBarRecord, HistoricalBarProvider, SecurityRecord, TradeCalendarRecord } from './types.js';

const sdk = new StockSDK({
  timeout: 12_000,
  retry: { maxRetries: 2, baseDelay: 500 },
  providerPolicies: {
    eastmoney: {
      timeout: 15_000,
      rateLimit: { requestsPerSecond: 1, maxBurst: 1 },
      circuitBreaker: { failureThreshold: 5, resetTimeout: 60_000 },
    },
  },
});

export const stockSdkHistoricalProvider: HistoricalBarProvider = {
  name: 'stock-sdk',
  async getDailyBars(symbol, options) {
    const rows = await sdk.kline.cn(symbol, {
      period: 'daily',
      adjust: options.adjustType === 'qfq' ? 'qfq' : '',
      startDate: compactDate(options.startDate),
      endDate: compactDate(options.endDate),
    });
    const fetchedAt = new Date().toISOString();
    const bars = rows.map((row) => toDailyBar(symbol, row, options.adjustType, fetchedAt));
    // ponytail: log first/last row dates to diagnose date format issues
    if (bars.length) {
      console.log('[market-data] getDailyBars ok', { symbol, count: bars.length, firstDate: bars[0].tradeDate, lastDate: bars.at(-1)?.tradeDate });
    } else {
      console.log('[market-data] getDailyBars empty', { symbol, options });
    }
    return bars;
  },
};

export async function listRemoteSecurities(onProgress?: (completed: number, total: number) => void, shouldStop?: () => boolean): Promise<SecurityRecord[]> {
  const codes = await sdk.codes.cn({ simple: true });
  const now = new Date().toISOString();
  const names = new Map<string, string>();
  const batchSize = 100;
  for (let index = 0; index < codes.length; index += batchSize) {
    if (shouldStop?.()) break;
    const batch = codes.slice(index, index + batchSize);
    try {
      const quotes = await sdk.batch.byCodes(batch, { batchSize: 100, concurrency: 2 });
      for (const quote of quotes) names.set(quote.code.replace(/^\D+/, ''), quote.name);
    } catch (error) {
      console.warn('[market-data] security name batch failed', error);
    }
    onProgress?.(Math.min(index + batch.length, codes.length), codes.length);
  }
  return codes.map((symbol) => ({
    symbol,
    name: names.get(symbol) ?? symbol,
    exchange: exchangeOf(symbol),
    securityType: 'stock',
    status: 'listed',
    isSt: /ST|退/.test(names.get(symbol) ?? ''),
    source: 'stock-sdk',
    updatedAt: now,
  }));
}

export async function listRemoteTradingCalendar(): Promise<TradeCalendarRecord[]> {
  const dates = await sdk.reference.tradingCalendar();
  const now = new Date().toISOString();
  return dates.map((tradeDate, index) => ({
    market: 'A',
    tradeDate,
    isOpen: true,
    previousTradeDate: dates[index - 1],
    nextTradeDate: dates[index + 1],
    source: 'stock-sdk:tencent',
    updatedAt: now,
  }));
}

export async function isRemoteTradingDay(date: string) {
  return sdk.calendar.isTradingDay(date);
}

export async function previousRemoteTradingDay(date: string) {
  return sdk.calendar.prevTradingDay(date);
}

export function remoteMarketStatus(now = new Date()) {
  return sdk.calendar.marketStatus('A', now);
}

export async function getRemoteFullQuote(symbol: string): Promise<FullQuote> {
  const quote = (await sdk.quotes.cn([symbol]))[0];
  if (!quote) throw new Error(`未获取到 ${symbol} 实时行情`);
  return quote;
}

function toDailyBar(symbol: string, row: HistoryKline, adjustType: AdjustType, fetchedAt: string): DailyBarRecord {
  return {
    symbol,
    tradeDate: normalizeDate(row.date),
    open: row.open ?? Number.NaN,
    high: row.high ?? Number.NaN,
    low: row.low ?? Number.NaN,
    close: row.close ?? Number.NaN,
    volume: row.volume ?? Number.NaN,
    amount: row.amount ?? undefined,
    change: row.change ?? undefined,
    changePercent: row.changePercent ?? undefined,
    turnoverRate: row.turnoverRate ?? undefined,
    adjustType,
    source: 'stock-sdk:eastmoney',
    fetchedAt,
  };
}

function compactDate(value?: string) {
  return value?.replaceAll('-', '');
}

function normalizeDate(value: string): string {
  const text = String(value ?? '');
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  // Compact YYYYMMDD → YYYY-MM-DD
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  // ISO with time → extract date part
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  // Timestamp → convert to date
  const ts = Number(text);
  if (Number.isFinite(ts) && ts > 0) {
    const d = new Date(ts < 1e12 ? ts * 1000 : ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  // Last resort: try Date.parse
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) {
    const d = new Date(parsed);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return text;
}

function exchangeOf(symbol: string): SecurityRecord['exchange'] {
  if (symbol.startsWith('6')) return 'SH';
  if (symbol.startsWith('4') || symbol.startsWith('8') || symbol.startsWith('92')) return 'BJ';
  return 'SZ';
}
