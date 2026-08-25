import type { KlinePoint, MarketIndexPeriod } from '../../../src/shared/types.js';
import { listDailyBars } from '../stock-db/market-data-store.js';
import { aggregateKline, parseEastmoneyKline, parseMarketTime } from './shared.js';

export async function getAStockBoardKline(symbol: string, period: MarketIndexPeriod): Promise<KlinePoint[]> {
  if (!/^BK\d+/i.test(symbol)) return [];
  const klt = ({ '15m': '15', '1h': '60', '4h': '60', '1d': '101', '1w': '102', '1mo': '103' } as const)[period];
  const limit = period === '4h' ? 80 : period === '1d' ? 120 : period === '1w' ? 240 : period === '1mo' ? 120 : 60;
  const params = new URLSearchParams({
    secid: `90.${symbol.toUpperCase()}`,
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    klt,
    fqt: '1',
    beg: '0',
    end: '20500101',
    lmt: String(limit),
  });
  const payload = await fetchFirstJson<{ data?: { klines?: string[] } }>(
    [
      `https://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`,
      `https://7.push2his.eastmoney.com/api/qt/stock/kline/get?${params}`,
    ],
    'https://quote.eastmoney.com/',
    3_000,
  );
  const rows = (payload.data?.klines ?? [])
    .map(parseEastmoneyKline)
    .filter((point): point is KlinePoint => Boolean(point));
  return period === '4h' ? aggregateKline(rows, 4) : rows;
}

async function fetchFirstJson<T>(urls: string[], referer: string, timeout = 12_000): Promise<T> {
  let lastError: unknown;
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeout),
        headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: referer },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('a-stock-data board request failed');
}

export async function aggregateRemoteBoardKline(codes: string[]): Promise<KlinePoint[]> {
  const topCodes = codes.slice(0, 20);
  const series = await Promise.all(
    topCodes.map((code) => listDailyBars(code, { limit: 120, adjustType: 'qfq' }).catch(() => [])),
  );
  return averageKlineSeries(
    series.map((rows) =>
      rows.map((row) => ({
        time: row.tradeDate,
        timestamp: parseMarketTime(row.tradeDate),
        open: row.open,
        close: row.close,
        high: row.high,
        low: row.low,
        volume: row.volume,
        amount: row.amount,
        change: row.change,
        changePercent: row.changePercent,
        turnoverRate: row.turnoverRate,
      })),
    ),
  );
}

function averageKlineSeries(series: KlinePoint[][]): KlinePoint[] {
  const byDate = new Map<
    string,
    { open: number; close: number; high: number; low: number; volume: number; amount: number; count: number }
  >();
  for (const rows of series) {
    for (const row of rows) {
      const group = byDate.get(row.time) ?? { open: 0, close: 0, high: 0, low: 0, volume: 0, amount: 0, count: 0 };
      group.open += row.open;
      group.close += row.close;
      group.high += row.high;
      group.low += row.low;
      group.volume += row.volume;
      group.amount += row.amount ?? 0;
      group.count += 1;
      byDate.set(row.time, group);
    }
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, group]) => ({
      time,
      timestamp: parseMarketTime(time),
      open: group.open / group.count,
      close: group.close / group.count,
      high: group.high / group.count,
      low: group.low / group.count,
      volume: group.volume,
      amount: group.amount,
    }));
}

export async function aggregateBaiduBoardKline(codes: string[]): Promise<KlinePoint[]> {
  const series = await Promise.all(codes.slice(0, 12).map((code) => getBaiduStockKline(code).catch(() => [])));
  return averageKlineSeries(series);
}

export async function getBaiduStockKline(code: string, limit = 240): Promise<KlinePoint[]> {
  const url = new URL('https://finance.pae.baidu.com/selfselect/getstockquotation');
  url.search = new URLSearchParams({
    all: '1',
    isIndex: 'false',
    isBk: 'false',
    isBlock: 'false',
    isFutures: 'false',
    isStock: 'true',
    newFormat: '1',
    group: 'quotation_kline_ab',
    finClientType: 'pc',
    code,
    ktype: '1',
  }).toString();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(8_000),
    headers: {
      'User-Agent': 'Mozilla/5.0 StockBuddy/0.2',
      Accept: 'application/vnd.finance-web.v1+json',
      Origin: 'https://gushitong.baidu.com',
      Referer: 'https://gushitong.baidu.com/',
    },
  });
  if (!response.ok) throw new Error(`百度股市通日 K 请求失败：HTTP ${response.status}`);
  const payload = (await response.json()) as {
    ResultCode?: number | string;
    Result?: { newMarketData?: { keys?: string[]; marketData?: string } };
  };
  if (String(payload.ResultCode ?? '0') !== '0') throw new Error(`百度股市通返回错误码 ${payload.ResultCode}`);
  const keys = payload.Result?.newMarketData?.keys ?? [];
  const rows = payload.Result?.newMarketData?.marketData?.split(';').filter(Boolean) ?? [];
  const data = rows
    .map((line) => parseBaiduKline(line, keys))
    .filter((item): item is KlinePoint => Boolean(item))
    .slice(-limit);
  if (!data.length) throw new Error(`${code} 暂无百度股市通日 K 数据`);
  return data;
}

function parseBaiduKline(line: string, keys: string[]): KlinePoint | undefined {
  const values = line.split(',');
  const at = (name: string) => values[keys.indexOf(name)];
  const point = {
    time: at('time') ?? '',
    timestamp: Number(at('timestamp')) || parseMarketTime(at('time') ?? ''),
    open: Number(at('open')),
    close: Number(at('close')),
    high: Number(at('high')),
    low: Number(at('low')),
    volume: Number(at('volume')) || 0,
    amount: Number(at('amount')) || undefined,
    change: Number(at('ratioamount')) || undefined,
    changePercent: Number(at('ratioprice')) || undefined,
    turnoverRate: Number(at('turnoverratio') ?? at('turnover')) || undefined,
  };
  return [point.open, point.close, point.high, point.low].every(Number.isFinite) ? point : undefined;
}

export async function aggregateLocalBoardKline(codes: string[]): Promise<KlinePoint[]> {
  const topCodes = codes.slice(0, 20);
  const series = await Promise.all(
    topCodes.map((code) => listDailyBars(code, { limit: 120, adjustType: 'qfq' }).catch(() => [])),
  );
  const byDate = new Map<
    string,
    { open: number; close: number; high: number; low: number; volume: number; amount: number; count: number }
  >();
  for (const rows of series) {
    for (const row of rows) {
      const group = byDate.get(row.tradeDate) ?? { open: 0, close: 0, high: 0, low: 0, volume: 0, amount: 0, count: 0 };
      group.open += row.open;
      group.close += row.close;
      group.high += row.high;
      group.low += row.low;
      group.volume += row.volume;
      group.amount += row.amount ?? 0;
      group.count += 1;
      byDate.set(row.tradeDate, group);
    }
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, group]) => ({
      time,
      timestamp: parseMarketTime(time),
      open: group.open / group.count,
      close: group.close / group.count,
      high: group.high / group.count,
      low: group.low / group.count,
      volume: group.volume,
      amount: group.amount,
    }));
}
