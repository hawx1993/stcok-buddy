import type { IStockFundFlowSnapshot, KlinePoint, StockDetail } from '../../../src/shared/types.js';
import { getMarketDataSyncStatus } from '../market-data/market-data-sync.js';
import { getLatestDailyBar, listDailyBars, listLatestMarketRows } from '../market-data/market-data-store.js';
import { remoteMarketStatus } from '../market-data/providers.js';
import { getKline, getQuote, getStockFundFlowSnapshot } from '../stock/stock-client.js';
import type { IBaiduKline, IEMFundFlowMinuteRow, ITencentQuote } from '../stock/a-stock-data-runner.js';
import { runAStockDataFn } from '../stock/a-stock-data-runner.js';
import type { AgentTool } from '../tools/types.js';
import {
  emFundFlowToSnapshot,
  localBarToKlinePoint,
  localBarToStockDetail,
  parseBaiduKline,
  tencentQuoteToStockDetail,
} from './agent-data-mappers.js';

/**
 * Agent 专用数据工具：严格遵循「DuckDB 本地 → a-stock-data → stock-sdk 兜底」的数据源优先级。
 * 只用于 AI Agent 取数；不动共享数据层（市场页/个股面板仍走原逻辑）。
 */

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

function text(input: Record<string, unknown>, key: string, fallback = '') {
  return String(input[key] ?? fallback);
}

function num(input: Record<string, unknown>, key: string, fallback: number) {
  const value = Number(input[key]);
  return Number.isFinite(value) ? value : fallback;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const getStockQuoteLocalFirst: AgentTool<{ symbol: string }, StockDetail> = {
  name: 'getStockQuoteLocalFirst',
  description: 'Get A-share quote with priority DuckDB → a-stock-data → stock-sdk.',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  async run(input) {
    const symbol = text(asRecord(input), 'symbol');
    const marketStatus = remoteMarketStatus();
    const marketOpen = marketStatus === 'open' || marketStatus === 'pre_market' || marketStatus === 'lunch_break';
    if (!marketOpen) {
      try {
        const bar = await getLatestDailyBar(symbol);
        const barDate = String(bar?.tradeDate ?? '');
        const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
        if (bar && barDate >= weekAgo) return localBarToStockDetail(bar, symbol);
      } catch (error) {
        console.warn('[agent-data] DuckDB 本地行情读取失败', error);
      }
    }
    try {
      const quotes = await runAStockDataFn<Record<string, ITencentQuote>>('tencent_quote', { codes: symbol });
      const quote = quotes?.[symbol];
      if (quote && !quote.is_stale) return tencentQuoteToStockDetail(quote, symbol);
    } catch (error) {
      console.warn('[agent-data] 腾讯行情失败', error);
    }
    return getQuote(symbol);
  },
};

export const getStockKlineLocalFirst: AgentTool<{ symbol: string; limit?: number }, KlinePoint[]> = {
  name: 'getStockKlineLocalFirst',
  description: 'Get A-share daily K-line with priority DuckDB → a-stock-data → stock-sdk.',
  inputSchema: {
    type: 'object',
    properties: { symbol: { type: 'string' }, limit: { type: 'number' } },
    required: ['symbol'],
  },
  async run(input) {
    const record = asRecord(input);
    const symbol = text(record, 'symbol');
    const limit = num(record, 'limit', 120);
    try {
      const local = await listDailyBars(symbol, { adjustType: 'qfq', limit });
      if (local.length) return local.map((bar) => localBarToKlinePoint(bar));
    } catch (error) {
      console.warn('[agent-data] DuckDB K线读取失败', error);
    }
    try {
      const baidu = await runAStockDataFn<IBaiduKline>('baidu_kline_with_ma', { code: symbol });
      const bars = parseBaiduKline(baidu);
      if (bars.length) return bars.slice(-limit);
    } catch (error) {
      console.warn('[agent-data] 百度K线失败', error);
    }
    return getKline(symbol, limit);
  },
};

export interface ILocalDuckDBQueryResult {
  source: 'duckdb:local';
  storage: 'local';
  symbol?: string;
  latestQuote?: StockDetail;
  kline: KlinePoint[];
  marketRows: Awaited<ReturnType<typeof listLatestMarketRows>>;
  latestTradeDate?: string;
  warnings: string[];
  isEmpty: boolean;
}

export const queryLocalDuckDBData: AgentTool<{ symbol?: string; limit?: number }, ILocalDuckDBQueryResult> = {
  name: 'queryLocalDuckDBData',
  description: 'Query only local DuckDB market data after remote/a-stock-data returns no data.',
  inputSchema: {
    type: 'object',
    properties: { symbol: { type: 'string' }, limit: { type: 'number' } },
  },
  async run(input) {
    const record = asRecord(input);
    const symbol = text(record, 'symbol').trim();
    const limit = Math.min(120, Math.max(1, num(record, 'limit', 60)));
    const warnings: string[] = [];

    if (symbol) {
      const [latestBarResult, barsResult] = await Promise.allSettled([
        getLatestDailyBar(symbol),
        listDailyBars(symbol, { adjustType: 'qfq', limit }),
      ]);
      const latestBar = latestBarResult.status === 'fulfilled' ? latestBarResult.value : undefined;
      const bars = barsResult.status === 'fulfilled' ? barsResult.value : [];
      if (latestBarResult.status === 'rejected') warnings.push(`本地 DuckDB 最近日线读取失败：${formatError(latestBarResult.reason)}`);
      if (barsResult.status === 'rejected') warnings.push(`本地 DuckDB K线读取失败：${formatError(barsResult.reason)}`);
      if (!latestBar && bars.length === 0) warnings.push('本地 DuckDB 暂无该标的可用数据');
      return {
        source: 'duckdb:local',
        storage: 'local',
        symbol,
        latestQuote: latestBar ? localBarToStockDetail(latestBar, symbol) : undefined,
        kline: bars.map((bar) => localBarToKlinePoint(bar)),
        marketRows: [],
        latestTradeDate: latestBar?.tradeDate ?? bars.at(-1)?.tradeDate,
        warnings,
        isEmpty: !latestBar && bars.length === 0,
      };
    }

    const [statusResult, rowsResult] = await Promise.allSettled([getMarketDataSyncStatus(), listLatestMarketRows()]);
    const status = statusResult.status === 'fulfilled' ? statusResult.value : undefined;
    const rows = rowsResult.status === 'fulfilled' ? rowsResult.value : [];
    if (statusResult.status === 'rejected') warnings.push(`本地 DuckDB 同步状态读取失败：${formatError(statusResult.reason)}`);
    if (rowsResult.status === 'rejected') warnings.push(`本地 DuckDB 市场快照读取失败：${formatError(rowsResult.reason)}`);
    const marketRows = rows.slice(0, 20);
    if (marketRows.length === 0) warnings.push('本地 DuckDB 暂无可用市场快照数据');
    return {
      source: 'duckdb:local',
      storage: 'local',
      kline: [],
      marketRows,
      latestTradeDate: status?.latestLocalTradeDate,
      warnings,
      isEmpty: marketRows.length === 0,
    };
  },
};

export const getStockFundFlowLocalFirst: AgentTool<{ symbol: string }, IStockFundFlowSnapshot> = {
  name: 'getStockFundFlowLocalFirst',
  description: 'Get A-share fund flow with priority a-stock-data → stock-sdk (no local DuckDB storage).',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  async run(input) {
    const symbol = text(asRecord(input), 'symbol');
    try {
      const rows = await runAStockDataFn<IEMFundFlowMinuteRow[]>('eastmoney_fund_flow_minute', { code: symbol });
      if (rows.length) return emFundFlowToSnapshot(rows, symbol);
    } catch (error) {
      console.warn('[agent-data] 东财资金流失败', error);
    }
    return getStockFundFlowSnapshot(symbol);
  },
};
