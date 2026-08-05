import type { ChipDistribution, IChipDistributionResult, IStockFundFlowSnapshot, KlinePoint, StockDetail, StockSurgeEvent } from '../../../src/shared/types.js';
import { getMarketDataSyncStatus } from '../market-data/market-data-sync.js';
import { queryHistoricalBars, queryLatestQuote } from '../market-data/market-data-query.js';
import { getLatestDailyBar, getStockChip, listDailyBars, listLatestMarketRows } from '../market-data/market-data-store.js';
import { remoteMarketStatus } from '../market-data/providers.js';
import { getChipDistribution, getStockFundFlowSnapshot, listStockSurgeEvents } from '../stock/stock-client.js';
import type { IBaiduKline, ITdxTransactionRow, ITencentQuote } from '../stock/a-stock-data-runner.js';
import { runAStockDataFn } from '../stock/a-stock-data-runner.js';
import type { AgentTool } from '../tools/types.js';
import {
  localBarToKlinePoint,
  localBarToStockDetail,
  parseBaiduKline,
  tencentQuoteToStockDetail,
} from './agent-data-mappers.js';

/**
 * Agent 专用数据工具：严格遵循「DuckDB 本地 → stock-sdk → a-stock-data」的数据源优先级。
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
  description: 'Get A-share quote with priority DuckDB → stock-sdk → a-stock-data.',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  async run(input) {
    const symbol = text(asRecord(input), 'symbol');
    const marketStatus = remoteMarketStatus();
    const marketOpen = marketStatus === 'open' || marketStatus === 'pre_market' || marketStatus === 'lunch_break';
    const errors: string[] = [];

    if (!marketOpen) {
      try {
        const bar = await getLatestDailyBar(symbol);
        const barDate = String(bar?.tradeDate ?? '');
        const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
        if (bar && barDate >= weekAgo) return localBarToStockDetail(bar, symbol);
      } catch (error) {
        errors.push(`DuckDB 本地行情读取失败：${formatError(error)}`);
      }
    }

    let localStaleQuote: StockDetail | undefined;
    try {
      const result = await queryLatestQuote(symbol);
      const freshRemote = result.meta.storage === 'remote' && result.meta.freshness !== 'stale' && result.meta.freshness !== 'fallback';
      if (freshRemote) return result.data;
      localStaleQuote = result.data;
      errors.push(...(result.meta.warnings ?? ['stock-sdk 未返回满足实时性的行情']));
    } catch (error) {
      errors.push(`stock-sdk 行情获取失败：${formatError(error)}`);
    }

    try {
      const quotes = await runAStockDataFn<Record<string, ITencentQuote>>('tencent_quote', { codes: symbol });
      const quote = quotes?.[symbol];
      if (quote && !quote.is_stale) return tencentQuoteToStockDetail(quote, symbol);
      if (quote?.is_stale) errors.push(`a-stock-data 腾讯行情过期：${quote.stale_reason ?? '报价可能非当日真实成交'}`);
    } catch (error) {
      errors.push(`a-stock-data 腾讯行情失败：${formatError(error)}`);
    }

    if (!marketOpen && localStaleQuote) return localStaleQuote;
    throw new Error(`行情数据源暂不可用：${errors.join('；') || '未返回可用行情'}`);
  },
};

export const getStockKlineLocalFirst: AgentTool<{ symbol: string; limit?: number }, KlinePoint[]> = {
  name: 'getStockKlineLocalFirst',
  description: 'Get A-share daily K-line with priority DuckDB → stock-sdk → a-stock-data.',
  inputSchema: {
    type: 'object',
    properties: { symbol: { type: 'string' }, limit: { type: 'number' } },
    required: ['symbol'],
  },
  async run(input) {
    const record = asRecord(input);
    const symbol = text(record, 'symbol');
    const limit = num(record, 'limit', 120);
    const errors: string[] = [];
    let partialLocalOrStockSdk: KlinePoint[] = [];

    try {
      const result = await queryHistoricalBars(symbol, { limit, adjustType: 'qfq' });
      if (result.meta.isComplete && result.data.length) return result.data;
      partialLocalOrStockSdk = result.data;
      errors.push(...(result.meta.warnings ?? ['DuckDB/stock-sdk 未返回完整 K 线']));
    } catch (error) {
      errors.push(`DuckDB/stock-sdk K线获取失败：${formatError(error)}`);
    }

    try {
      const baidu = await runAStockDataFn<IBaiduKline>('baidu_kline_with_ma', { code: symbol });
      const bars = parseBaiduKline(baidu);
      if (bars.length) return bars.slice(-limit);
    } catch (error) {
      errors.push(`a-stock-data 百度K线失败：${formatError(error)}`);
    }

    if (partialLocalOrStockSdk.length) return partialLocalOrStockSdk;
    throw new Error(`K线数据源暂不可用：${errors.join('；') || '未返回可用 K 线'}`);
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
  description: 'Query only local DuckDB market data before remote providers or for local-only screening context.',
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

interface IStockChipDistributionLocalFirstInput {
  symbol: string;
  days?: number;
}

interface IChipDistributionSummary {
  date: string;
  profitRatio?: number;
  avgCost?: number;
  cost70?: string;
  cost90?: string;
  concentration70?: number;
  concentration90?: number;
}

interface IStockChipDistributionLocalFirstOutput {
  source: 'duckdb:market' | 'stock-sdk' | 'a-stock-data';
  storage: 'local' | 'remote';
  symbol: string;
  latest?: ChipDistribution;
  recent: IChipDistributionSummary[];
  trend: IChipDistributionResult['trend'];
  warnings: string[];
  isEmpty: boolean;
}

function isChipDistributionResult(value: unknown): value is IChipDistributionResult {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<IChipDistributionResult>;
  return Array.isArray(record.distributions) && Array.isArray(record.trend);
}

function summarizeChipDistribution(item: ChipDistribution): IChipDistributionSummary {
  return {
    date: item.date,
    profitRatio: item.profitRatio,
    avgCost: item.avgCost,
    cost70: item.cost70,
    cost90: item.cost90,
    concentration70: item.concentration70,
    concentration90: item.concentration90,
  };
}

export const getStockChipDistributionLocalFirst: AgentTool<
  IStockChipDistributionLocalFirstInput,
  IStockChipDistributionLocalFirstOutput
> = {
  name: 'getStockChipDistributionLocalFirst',
  description: 'Get single-stock chip distribution with priority DuckDB → stock-sdk → a-stock-data, including 90% and 70% concentration.',
  inputSchema: {
    type: 'object',
    properties: { symbol: { type: 'string' }, days: { type: 'number' } },
    required: ['symbol'],
  },
  async run(input) {
    const record = asRecord(input);
    const symbol = text(record, 'symbol').trim();
    const days = safePositiveInt(num(record, 'days', 5), 5, 120);
    const warnings: string[] = [];
    const localChip = await getStockChip(symbol);
    if (isChipDistributionResult(localChip)) {
      const recent = localChip.distributions.slice(-days).map(summarizeChipDistribution);
      return {
        source: 'duckdb:market',
        storage: 'local',
        symbol,
        latest: localChip.latest,
        recent,
        trend: localChip.trend,
        warnings: localChip.warnings ?? [],
        isEmpty: !localChip.latest && recent.length === 0,
      };
    }
    warnings.push('本地 DuckDB 暂无该股票筹码缓存，已尝试 stock-sdk / a-stock-data 真实数据源');

    const remoteChip = await getChipDistribution(symbol);
    const recent = remoteChip.distributions.slice(-days).map(summarizeChipDistribution);
    return {
      source: remoteChip.source,
      storage: 'remote',
      symbol,
      latest: remoteChip.latest,
      recent,
      trend: remoteChip.trend,
      warnings: [...warnings, ...(remoteChip.warnings ?? [])],
      isEmpty: !remoteChip.latest && recent.length === 0,
    };
  },
};

interface IStockSurgeEventsLocalFirstInput {
  symbol: string;
  days?: number;
  limit?: number;
  minHands?: number;
}

interface IStockSurgeEventsLocalFirstOutput {
  source: 'right-panel-local-first' | 'a-stock-data';
  storage: 'local' | 'remote';
  symbol: string;
  rows: StockSurgeEvent[];
  warnings: string[];
  isEmpty: boolean;
}

function safePositiveInt(value: number, fallback: number, max: number): number {
  return Math.max(1, Math.min(max, Math.floor(Number.isFinite(value) ? value : fallback)));
}

function tdxTransactionToSurgeEvent(symbol: string, row: ITdxTransactionRow, index: number): StockSurgeEvent {
  const side = row.buyorsell === 0 ? '买入' : row.buyorsell === 1 ? '卖出' : '中性';
  const tag = side === '中性' ? '中性大单' : `特大单${side}`;
  const tradeDate = new Date().toISOString().slice(0, 10);
  const hands = Number.isFinite(Number(row.vol)) ? Number(row.vol) : undefined;
  return {
    id: `tdx-transaction-${tradeDate}-${row.time || index}-${index}`,
    tradeDate,
    title: `${symbol} 逐笔成交`,
    code: symbol,
    time: row.time,
    price: row.price === null ? undefined : row.price,
    amount: hands === undefined ? undefined : `${side}${hands >= 10000 ? `${(hands / 10000).toFixed(2).replace(/\.00$/, '')}万手` : `${hands.toFixed(0)}手`}`,
    description: `通达信逐笔成交${tag}`,
    tag,
    type: side === '卖出' ? 'plummet' : side === '买入' ? 'surge' : 'neutral',
  };
}

export const getStockSurgeEventsLocalFirst: AgentTool<
  IStockSurgeEventsLocalFirstInput,
  IStockSurgeEventsLocalFirstOutput
> = {
  name: 'getStockSurgeEventsLocalFirst',
  description: 'Get individual stock surge/anomaly and large-order events with priority DuckDB → stock-sdk → a-stock-data.',
  inputSchema: {
    type: 'object',
    properties: {
      symbol: { type: 'string' },
      days: { type: 'number' },
      limit: { type: 'number' },
      minHands: { type: 'number' },
    },
    required: ['symbol'],
  },
  async run(input) {
    const record = asRecord(input);
    const symbol = text(record, 'symbol').trim();
    const limit = safePositiveInt(num(record, 'limit', 200), 200, 1000);
    const minHands = safePositiveInt(num(record, 'minHands', 10000), 10000, 1000000);
    const warnings: string[] = [];

    try {
      const rows = (await listStockSurgeEvents(symbol)).slice(0, limit);
      if (rows.length) {
        return { source: 'right-panel-local-first', storage: 'local', symbol, rows, warnings, isEmpty: false };
      }
      warnings.push('右侧栏同源个股异动服务未返回最近异动历史');
    } catch (error) {
      warnings.push(`右侧栏同源个股异动服务读取失败：${formatError(error)}`);
    }

    try {
      const transactions = await runAStockDataFn<ITdxTransactionRow[]>('tdx_transactions', {
        code: symbol,
        min_hands: minHands,
        limit,
      });
      const rows = transactions.map((row, index) => tdxTransactionToSurgeEvent(symbol, row, index));
      if (rows.length) return { source: 'a-stock-data', storage: 'remote', symbol, rows, warnings, isEmpty: false };
      warnings.push(`a-stock-data 通达信逐笔成交未返回单笔不低于 ${minHands} 手的大单样本`);
    } catch (error) {
      warnings.push(`a-stock-data 通达信逐笔成交获取失败：${formatError(error)}`);
    }

    return { source: 'a-stock-data', storage: 'remote', symbol, rows: [], warnings, isEmpty: true };
  },
};

export const getStockFundFlowLocalFirst: AgentTool<{ symbol: string }, IStockFundFlowSnapshot> = {
  name: 'getStockFundFlowLocalFirst',
  description: 'Get A-share fund flow with priority stock-sdk → a-stock-data (no complete local DuckDB snapshot).',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  async run(input) {
    return getStockFundFlowSnapshot(text(asRecord(input), 'symbol'));
  },
};
