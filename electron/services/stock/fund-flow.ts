import StockSDK from 'stock-sdk';
import type { IStockFundFlowSnapshot } from '../../../src/shared/types.js';
import { normalizeASymbol } from './symbols.js';
import { listStockFundFlowDaily, upsertStockFundFlowDaily } from '../market-data/market-data-store.js';

const sdk = new StockSDK({ timeout: 12_000, retry: { maxRetries: 1 } });

export async function getStockWeeklyMainNetInflow(symbolInput: string, tradeDates: string[]): Promise<number | null> {
  const symbol = normalizeASymbol(symbolInput);
  const normalizedTradeDates = tradeDates.map(normalizeTradeDate);
  const cached = await listStockFundFlowDaily(symbol, normalizedTradeDates);
  const cachedDates = new Set(cached.map((row) => normalizeTradeDate(row.tradeDate)));
  const missingDates = normalizedTradeDates.filter((tradeDate) => !cachedDates.has(tradeDate));
  if (missingDates.length) {
    const rows = await fetchStockFundFlowDaily(symbol);
    const requested = rows.filter((row) => normalizedTradeDates.includes(normalizeTradeDate(row.tradeDate)));
    if (requested.length) await upsertStockFundFlowDaily(requested);
    cached.push(...requested.filter((row) => !cachedDates.has(row.tradeDate)));
  }
  const values = cached.map((row) => row.mainNetInflow).filter((value) => Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

async function fetchStockFundFlowDaily(symbol: string): Promise<Array<{
  symbol: string;
  tradeDate: string;
  mainNetInflow: number;
  source: string;
  fetchedAt: string;
}>> {
  let rows: Array<{
    symbol: string;
    tradeDate: string;
    mainNetInflow: number;
    source: string;
    fetchedAt: string;
  }>;
  try {
    const stockSdkRows = await sdk.fundFlow.individual(symbol, { period: 'daily' });
    const fetchedAt = new Date().toISOString();
    rows = stockSdkRows
      .filter((row) => Number.isFinite(row.mainNetInflow))
      .map((row) => ({
        symbol,
        tradeDate: normalizeTradeDate(row.date),
        mainNetInflow: row.mainNetInflow!,
        source: 'stock-sdk',
        fetchedAt,
      }));
  } catch {
    rows = await fetchEastmoneyFundFlowDaily(symbol);
  }
  return rows;
}

export async function getStockFundFlowSnapshot(symbolInput: string): Promise<IStockFundFlowSnapshot> {
  const symbol = normalizeASymbol(symbolInput);
  const warnings: string[] = [];
  let latest: IStockFundFlowSnapshot | undefined;
  try {
    const rows = await sdk.fundFlow.individual(symbol, { period: 'daily' });
    const row = [...rows].reverse().find(hasFundFlowValue);
    if (row) latest = stockSdkFundFlowToSnapshot(row);
  } catch (error) {
    warnings.push(`stock-sdk 个股资金流获取失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!latest)
    latest = await fetchEastmoneyFundFlowSnapshot(symbol, warnings).catch(async (error: Error) => {
      warnings.push(`a-stock-data 东财日级资金流获取失败：${error.message}`);
      return fetchEastmoneyMinuteFundFlowSnapshot(symbol, warnings).catch((minuteError: Error) => {
        warnings.push(`a-stock-data 东财分钟级资金流获取也失败：${minuteError.message}`);
        return undefined;
      });
    });
  let activeStats: ReturnType<typeof activeOrderStats> | undefined;
  try {
    const date = latest?.date ?? new Date().toISOString().slice(0, 10);
    activeStats = activeOrderStats(await sdk.marketEvent.individualChanges(symbol, { date }));
  } catch (error) {
    warnings.push(`主动买卖比例获取失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!activeStats?.total) warnings.push('暂无盘口异动样本，无法计算主动买卖比例');
  if (!latest) {
    warnings.push('所有资金流数据源（stock-sdk / 东财 push2his / 东财 push2）均未返回有效的净流入数据');
  }
  const fallback: IStockFundFlowSnapshot = {
    date: new Date().toISOString().slice(0, 10),
    mainNetInflow: null,
    mainNetInflowPercent: null,
    superLargeNetInflow: null,
    superLargeNetInflowPercent: null,
    largeNetInflow: null,
    largeNetInflowPercent: null,
    mediumNetInflow: null,
    mediumNetInflowPercent: null,
    smallNetInflow: null,
    smallNetInflowPercent: null,
    source: 'a-stock-data',
  };
  return {
    ...(latest ?? fallback),
    activeBuyRatio: activeStats?.total ? (activeStats.buy / activeStats.total) * 100 : undefined,
    activeSellRatio: activeStats?.total ? (activeStats.sell / activeStats.total) * 100 : undefined,
    activeSampleCount: activeStats?.total,
    activeRatioSource: 'a-stock-data 盘口异动样本（大笔买入/大笔卖出）',
    warnings: warnings.length ? warnings : undefined,
  };
}

function stockSdkFundFlowToSnapshot(
  row: Awaited<ReturnType<typeof sdk.fundFlow.individual>>[number],
): IStockFundFlowSnapshot {
  return {
    date: row.date,
    mainNetInflow: row.mainNetInflow,
    mainNetInflowPercent: row.mainNetInflowPercent,
    superLargeNetInflow: row.superLargeNetInflow,
    superLargeNetInflowPercent: row.superLargeNetInflowPercent,
    largeNetInflow: row.largeNetInflow,
    largeNetInflowPercent: row.largeNetInflowPercent,
    mediumNetInflow: row.mediumNetInflow,
    mediumNetInflowPercent: row.mediumNetInflowPercent,
    smallNetInflow: row.smallNetInflow,
    smallNetInflowPercent: row.smallNetInflowPercent,
    source: 'stock-sdk',
  };
}

// ponytail: a-stock-data style retry + jitter, transient Eastmoney blocks are common on residential IPs.
// Single retry with backoff covers most blips; full session reuse would need undici Agent, not worth it.
async function eastmoneyGet(url: URL, timeoutMs = 15_000): Promise<Response> {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Referer: 'https://quote.eastmoney.com/',
    Origin: 'https://quote.eastmoney.com',
  };
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * (attempt + Math.random())));
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers });
      if (response.ok) return response;
      if (response.status === 403 || response.status === 429) {
        lastError = new Error(`东财风控：HTTP ${response.status}`);
        continue;
      }
      throw new Error(`东财请求失败：HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (error instanceof DOMException && error.name === 'TimeoutError') continue;
      if (error instanceof TypeError && error.message.includes('fetch')) continue;
      throw error;
    }
  }
  throw lastError;
}

async function fetchEastmoneyFundFlowDaily(symbol: string): Promise<Array<{
  symbol: string;
  tradeDate: string;
  mainNetInflow: number;
  source: string;
  fetchedAt: string;
}>> {
  const secid = `${symbol.startsWith('6') ? 1 : 0}.${symbol}`;
  const url = new URL('https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get');
  url.search = new URLSearchParams({
    secid,
    fields1: 'f1,f2,f3,f7',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65',
    lmt: '20',
  }).toString();
  const response = await eastmoneyGet(url);
  const payload = (await response.json()) as { data?: { klines?: string[] } };
  const fetchedAt = new Date().toISOString();
  return (payload.data?.klines ?? [])
    .map((line) => {
      const parts = line.split(',');
      const mainNetInflow = parseNullableNumber(parts[1]);
      return mainNetInflow === null
        ? undefined
        : { symbol, tradeDate: normalizeTradeDate(parts[0]), mainNetInflow, source: 'a-stock-data:eastmoney', fetchedAt };
    })
    .filter((row): row is { symbol: string; tradeDate: string; mainNetInflow: number; source: string; fetchedAt: string } => Boolean(row));
}

async function fetchEastmoneyFundFlowSnapshot(symbol: string, warnings: string[]): Promise<IStockFundFlowSnapshot> {
  const secid = `${symbol.startsWith('6') ? 1 : 0}.${symbol}`;
  const url = new URL('https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get');
  url.search = new URLSearchParams({
    secid,
    fields1: 'f1,f2,f3,f7',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65',
    lmt: '120',
  }).toString();
  const response = await eastmoneyGet(url);
  const payload = (await response.json()) as { data?: { klines?: string[] } };
  const line = payload.data?.klines?.at(-1);
  if (!line) throw new Error(`${symbol} 暂无可用个股资金流数据`);
  const parts = line.split(',');
  if (parts.length < 11) throw new Error(`${symbol} 个股资金流字段不完整`);
  warnings.push('资金流数据来自 a-stock-data 东财 push2his 日级接口');
  return {
    date: parts[0],
    mainNetInflow: parseNullableNumber(parts[1]),
    mainNetInflowPercent: parseNullableNumber(parts[6]),
    superLargeNetInflow: parseNullableNumber(parts[5]),
    superLargeNetInflowPercent: parseNullableNumber(parts[10]),
    largeNetInflow: parseNullableNumber(parts[4]),
    largeNetInflowPercent: parseNullableNumber(parts[9]),
    mediumNetInflow: parseNullableNumber(parts[3]),
    mediumNetInflowPercent: parseNullableNumber(parts[8]),
    smallNetInflow: parseNullableNumber(parts[2]),
    smallNetInflowPercent: parseNullableNumber(parts[7]),
    source: 'a-stock-data',
  };
}

async function fetchEastmoneyMinuteFundFlowSnapshot(
  symbol: string,
  warnings: string[],
): Promise<IStockFundFlowSnapshot> {
  const secid = `${symbol.startsWith('6') ? 1 : 0}.${symbol}`;
  const url = new URL('https://push2.eastmoney.com/api/qt/stock/fflow/kline/get');
  url.search = new URLSearchParams({
    secid,
    klt: '1',
    fields1: 'f1,f2,f3,f7',
    fields2: 'f51,f52,f53,f54,f55,f56,f57',
  }).toString();
  const response = await eastmoneyGet(url);
  const payload = (await response.json()) as { data?: { klines?: string[] } };
  const lines = payload.data?.klines ?? [];
  if (!lines.length) throw new Error(`${symbol} 暂无可用分钟资金流数据`);
  const totals = lines.reduce(
    (sum, line) => {
      const parts = line.split(',');
      return {
        main: sum.main + (parseNullableNumber(parts[1]) ?? 0),
        small: sum.small + (parseNullableNumber(parts[2]) ?? 0),
        medium: sum.medium + (parseNullableNumber(parts[3]) ?? 0),
        large: sum.large + (parseNullableNumber(parts[4]) ?? 0),
        superLarge: sum.superLarge + (parseNullableNumber(parts[5]) ?? 0),
        date: parts[0] || sum.date,
      };
    },
    { main: 0, small: 0, medium: 0, large: 0, superLarge: 0, date: '' },
  );
  warnings.push('资金流数据来自 a-stock-data 东财 push2 分钟级接口累计值；净占比字段该接口不提供');
  return {
    date: totals.date,
    mainNetInflow: totals.main,
    mainNetInflowPercent: null,
    superLargeNetInflow: totals.superLarge,
    superLargeNetInflowPercent: null,
    largeNetInflow: totals.large,
    largeNetInflowPercent: null,
    mediumNetInflow: totals.medium,
    mediumNetInflowPercent: null,
    smallNetInflow: totals.small,
    smallNetInflowPercent: null,
    source: 'a-stock-data',
  };
}

function normalizeTradeDate(value: string) {
  const match = String(value).match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : value;
}

function parseNullableNumber(value: string | undefined) {
  if (!value || value === '-' || value === '--') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function hasFundFlowValue(row: Awaited<ReturnType<typeof sdk.fundFlow.individual>>[number]) {
  return [row.mainNetInflow, row.superLargeNetInflow, row.largeNetInflow, row.mediumNetInflow, row.smallNetInflow].some(
    (value) => value !== null && Number.isFinite(Number(value)),
  );
}

function activeOrderStats(items: Awaited<ReturnType<typeof sdk.marketEvent.individualChanges>>) {
  let buy = 0;
  let sell = 0;
  for (const item of items) {
    const text = `${item.changeType} ${item.changeTypeLabel}`;
    if (item.changeType === 'large_buy' || /大笔买入|特大单买入/.test(text)) buy += 1;
    if (item.changeType === 'large_sell' || /大笔卖出|特大单卖出/.test(text)) sell += 1;
  }
  return { buy, sell, total: buy + sell };
}
