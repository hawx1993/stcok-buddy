import type { IStockFundFlowSnapshot, KlinePoint, StockDetail } from '../../../src/shared/types.js';
import { inferExchange } from '../stock/symbols.js';
import type { IBaiduKline, IEMFundFlowMinuteRow, ITencentQuote } from '../stock/a-stock-data-runner.js';

/**
 * Agent 数据工具用的纯映射函数（无 DuckDB / stock-sdk 运行时依赖，可单测）。
 */

/** DuckDB daily_bars 行的结构子集 */
export interface ILocalDailyBar {
  tradeDate: string;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  volume?: number | null;
  amount?: number | null;
  change?: number | null;
  changePercent?: number | null;
  turnoverRate?: number | null;
}

function toNum(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** 腾讯行情 → StockDetail（a-stock-data 源） */
export function tencentQuoteToStockDetail(q: ITencentQuote, symbol: string): StockDetail {
  return {
    code: symbol,
    name: q.name || symbol,
    exchange: inferExchange(symbol),
    price: q.price || 0,
    change: `${q.change_amt >= 0 ? '+' : ''}${q.change_amt.toFixed(2)}`,
    changePercent: `${q.change_pct >= 0 ? '+' : ''}${q.change_pct.toFixed(2)}%`,
    open: q.open || '--',
    high: q.high || '--',
    low: q.low || '--',
    prevClose: q.last_close || '--',
    pe: q.pe_ttm || '--',
    pb: q.pb || '--',
    marketCap: q.mcap_yi ? `${q.mcap_yi.toFixed(1)}亿` : '--',
    turnover: q.amount_wan ? `${(q.amount_wan / 10000).toFixed(2)}亿` : '--',
    turnoverRate: q.turnover_pct ? `${q.turnover_pct.toFixed(2)}%` : '--',
    summary: `${q.name || symbol}（${symbol}）腾讯行情快照：现价 ${q.price}，涨跌幅 ${q.change_pct}%，PE(TTM) ${q.pe_ttm}，PB ${q.pb}${
      q.is_stale ? `。⚠️ ${q.stale_reason ?? '报价可能非当日真实成交'}` : ''
    }`,
  };
}

/** DuckDB 最近日线 → StockDetail（本地源） */
export function localBarToStockDetail(bar: ILocalDailyBar, symbol: string): StockDetail {
  const close = toNum(bar.close);
  const change = toNum(bar.change);
  const changePercent = toNum(bar.changePercent);
  const amount = toNum(bar.amount);
  const turnoverRate = toNum(bar.turnoverRate);
  return {
    code: symbol,
    name: symbol,
    exchange: inferExchange(symbol),
    price: close ?? '--',
    change: change !== undefined ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}` : '--',
    changePercent: changePercent !== undefined ? `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%` : '--',
    open: toNum(bar.open) ?? '--',
    high: toNum(bar.high) ?? '--',
    low: toNum(bar.low) ?? '--',
    prevClose: change !== undefined && close !== undefined ? close - change : '--',
    turnover: amount ? `${(amount / 1e8).toFixed(2)}亿` : '--',
    turnoverRate: turnoverRate !== undefined ? `${turnoverRate.toFixed(2)}%` : '--',
    summary: `${symbol} 本地 DuckDB 最近交易日 ${String(bar.tradeDate ?? '--')} 收盘 ${close ?? '--'}，涨跌幅 ${
      changePercent ?? '--'
    }%。`,
  };
}

/** DuckDB 日线行 → KlinePoint */
export function localBarToKlinePoint(bar: ILocalDailyBar): KlinePoint {
  return {
    time: String(bar.tradeDate ?? ''),
    open: toNum(bar.open) ?? 0,
    high: toNum(bar.high) ?? 0,
    low: toNum(bar.low) ?? 0,
    close: toNum(bar.close) ?? 0,
    volume: toNum(bar.volume) ?? 0,
    amount: toNum(bar.amount),
    change: toNum(bar.change),
    changePercent: toNum(bar.changePercent),
    turnoverRate: toNum(bar.turnoverRate),
  };
}

/** 百度股市通 K线（keys + 逗号分隔行）→ KlinePoint[] */
export function parseBaiduKline(data: IBaiduKline | null): KlinePoint[] {
  if (!data || !Array.isArray(data.keys) || !Array.isArray(data.rows)) return [];
  const idx = (name: string) => data.keys.indexOf(name);
  const iTime = idx('time');
  const iOpen = idx('open');
  const iHigh = idx('high');
  const iLow = idx('low');
  const iClose = idx('close');
  const iVol = idx('volume');
  if (iTime < 0 || iClose < 0) return [];
  const out: KlinePoint[] = [];
  for (const row of data.rows) {
    if (typeof row !== 'string') continue;
    const v = row.split(',');
    const time = v[iTime];
    if (!time) continue;
    out.push({
      time,
      open: Number(v[iOpen]) || 0,
      high: Number(v[iHigh]) || 0,
      low: Number(v[iLow]) || 0,
      close: Number(v[iClose]) || 0,
      volume: Number(v[iVol]) || 0,
    });
  }
  return out;
}

/** 东财分钟级资金流 → IStockFundFlowSnapshot（a-stock-data 源） */
export function emFundFlowToSnapshot(rows: IEMFundFlowMinuteRow[], symbol: string): IStockFundFlowSnapshot {
  const sum = (get: (row: IEMFundFlowMinuteRow) => number) => rows.reduce((acc, row) => acc + (get(row) || 0), 0);
  const date = rows.at(-1)?.time?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
  return {
    date,
    mainNetInflow: sum((row) => row.main_net),
    mainNetInflowPercent: null,
    superLargeNetInflow: sum((row) => row.super_net),
    superLargeNetInflowPercent: null,
    largeNetInflow: sum((row) => row.large_net),
    largeNetInflowPercent: null,
    mediumNetInflow: sum((row) => row.mid_net),
    mediumNetInflowPercent: null,
    smallNetInflow: sum((row) => row.small_net),
    smallNetInflowPercent: null,
    source: 'a-stock-data',
    warnings: [`${symbol} 资金流来自 a-stock-data 东财分钟级，为当日累计值`],
  };
}
