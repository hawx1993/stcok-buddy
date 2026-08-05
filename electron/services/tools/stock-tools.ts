import type { HotFocusTab } from '../../../src/shared/types.js';
import { getMarketDataSyncStatus } from '../market-data/market-data-sync.js';
import { queryHistoricalBars } from '../market-data/market-data-query.js';
import { screenASharesByMarketCap as screenASharesByMarketCapService } from '../market-data/market-cap-screener.js';
import { runTechnicalAnalysis } from '../agent/analysis-agent.js';
import { listMarketNews, listStockNewsAnnouncements } from '../stock/news-client.js';
import {
  getChipDistribution,
  getKline,
  getQuote,
  getStockFundFlowSnapshot as fetchStockFundFlowSnapshot,
  listDailyDragonTiger,
  listHotFocus,
  resolveASymbol,
} from '../stock/stock-client.js';
import { getMarketReview as fetchMarketReview } from '../stock/market-review-service.js';
import { listNorthboundFlow } from '../stock/northbound-flow.js';
import type { AgentTool } from './types.js';

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

export const resolveStockSymbol: AgentTool<{ query: string }, { symbol: string; name?: string }> = {
  name: 'resolveStockSymbol',
  description: 'Resolve A-share stock code from a user query.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  async run(input) {
    const result = await resolveASymbol(text(asRecord(input), 'query'));
    return result;
  },
};

export const getStockQuote: AgentTool<{ symbol: string }, Awaited<ReturnType<typeof getQuote>>> = {
  name: 'getStockQuote',
  description: 'Fetch current A-share quote.',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  run: (input) => getQuote(text(asRecord(input), 'symbol')),
};

export const getStockKline: AgentTool<
  { symbol: string; limit?: number; period?: string },
  Awaited<ReturnType<typeof getKline>>
> = {
  name: 'getStockKline',
  description: 'Fetch A-share K-line data.',
  inputSchema: {
    type: 'object',
    properties: { symbol: { type: 'string' }, limit: { type: 'number' }, period: { type: 'string' } },
    required: ['symbol'],
  },
  run: (input) => {
    const record = asRecord(input);
    return getKline(text(record, 'symbol'), num(record, 'limit', 120), text(record, 'period', '1d'));
  },
};

export const getHistoricalDailyBars: AgentTool<
  { symbol: string; limit?: number; startDate?: string; endDate?: string; adjustType?: 'qfq' | 'none' },
  Awaited<ReturnType<typeof queryHistoricalBars>>
> = {
  name: 'getHistoricalDailyBars',
  description:
    'Query A-share historical daily bars from local DuckDB first, backfilling missing ranges remotely. Not for realtime prices or minute bars.',
  inputSchema: {
    type: 'object',
    properties: {
      symbol: { type: 'string' },
      limit: { type: 'number' },
      startDate: { type: 'string' },
      endDate: { type: 'string' },
      adjustType: { type: 'string', enum: ['qfq', 'none'] },
    },
    required: ['symbol'],
  },
  run: (input) => {
    const record = asRecord(input);
    return queryHistoricalBars(text(record, 'symbol'), {
      limit: num(record, 'limit', 120),
      startDate: record.startDate ? text(record, 'startDate') : undefined,
      endDate: record.endDate ? text(record, 'endDate') : undefined,
      adjustType: text(record, 'adjustType', 'qfq') as 'qfq' | 'none',
    });
  },
};

export const getMarketDataStatus: AgentTool<
  Record<string, never>,
  Awaited<ReturnType<typeof getMarketDataSyncStatus>>
> = {
  name: 'getMarketDataStatus',
  description: 'Return local A-share database synchronization status and latest available trade date.',
  inputSchema: { type: 'object', properties: {} },
  run: () => getMarketDataSyncStatus(),
};

export const getTechnicalIndicators: AgentTool<{ symbol: string }, Awaited<ReturnType<typeof runTechnicalAnalysis>>> = {
  name: 'getTechnicalIndicators',
  description: 'Calculate technical indicator summary.',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  run: (input) => runTechnicalAnalysis(text(asRecord(input), 'symbol')),
};

export const getMarketNews: AgentTool<
  { query: string; page?: number; pageSize?: number },
  Awaited<ReturnType<typeof listMarketNews>>['items']
> = {
  name: 'getMarketNews',
  description: 'Fetch market news list.',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' }, page: { type: 'number' }, pageSize: { type: 'number' } },
  },
  async run(input) {
    const record = asRecord(input);
    return (await listMarketNews(text(record, 'query'), num(record, 'page', 1), num(record, 'pageSize', 10))).items;
  },
};

export const getStockNewsAnnouncements: AgentTool<
  { symbol: string; limit?: number },
  Awaited<ReturnType<typeof listStockNewsAnnouncements>>
> = {
  name: 'getStockNewsAnnouncements',
  description: 'Fetch stock news and announcements.',
  inputSchema: {
    type: 'object',
    properties: { symbol: { type: 'string' }, limit: { type: 'number' } },
    required: ['symbol'],
  },
  run: (input) => {
    const record = asRecord(input);
    return listStockNewsAnnouncements(text(record, 'symbol'), num(record, 'limit', 10));
  },
};

export const getStockFundFlowSnapshot: AgentTool<
  { symbol: string },
  Awaited<ReturnType<typeof fetchStockFundFlowSnapshot>>
> = {
  name: 'getStockFundFlowSnapshot',
  description: 'Fetch individual A-share fund flow snapshot from stock-sdk.',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  run: (input) => fetchStockFundFlowSnapshot(text(asRecord(input), 'symbol')),
};

export const getStockChipDistribution: AgentTool<
  { symbol: string },
  Awaited<ReturnType<typeof getChipDistribution>>
> = {
  name: 'getStockChipDistribution',
  description: 'Fetch A-share chip distribution data.',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  run: (input) => getChipDistribution(text(asRecord(input), 'symbol')),
};

export const getMarketReview: AgentTool<Record<string, never>, Awaited<ReturnType<typeof fetchMarketReview>>> = {
  name: 'getMarketReview',
  description: 'Fetch and calculate a real-data A-share daily market review.',
  inputSchema: { type: 'object', properties: {} },
  run: () => fetchMarketReview(),
};

export const getDragonTiger: AgentTool<
  { symbol?: string; limit?: number },
  Awaited<ReturnType<typeof listDailyDragonTiger>>
> = {
  name: 'getDragonTiger',
  description: 'Fetch daily market-wide dragon tiger board records.',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' }, limit: { type: 'number' } } },
  async run(input) {
    return (await listDailyDragonTiger()).slice(0, num(asRecord(input), 'limit', 50));
  },
};

export const getHotFocus: AgentTool<{ tab: HotFocusTab }, Awaited<ReturnType<typeof listHotFocus>>> = {
  name: 'getHotFocus',
  description: 'Fetch hot focus list by tab. For northbound/southbound (沪深港通) capital flow use getNorthboundFlow.',
  inputSchema: { type: 'object', properties: { tab: { type: 'string' } }, required: ['tab'] },
  run: (input) => listHotFocus(text(asRecord(input), 'tab', 'surge') as HotFocusTab),
};

export const getNorthboundFlow: AgentTool<Record<string, never>, Awaited<ReturnType<typeof listNorthboundFlow>>> = {
  name: 'getNorthboundFlow',
  description: 'Fetch northbound/southbound (沪深港通) capital flow summary from stock-sdk.',
  inputSchema: { type: 'object', properties: {} },
  run: () => listNorthboundFlow(),
};

export const screenASharesByMarketCap: AgentTool<
  {
    minMarketCap?: number;
    maxMarketCap?: number;
    unit?: 'yuan' | 'yi';
    marketCapField?: 'total' | 'circulating';
    limit?: number;
    includeST?: boolean;
    sortOrder?: 'asc' | 'desc';
  },
  Awaited<ReturnType<typeof screenASharesByMarketCapService>>
> = {
  name: 'screenASharesByMarketCap',
  description:
    '全市场 A 股市值筛选工具，用真实数据按 DuckDB → stock-sdk → a-stock-data 获取个股总市值/流通市值。用于“市值在30亿到100亿”“总市值小于50亿”“流通市值30亿到100亿”等查询。输入示例 {minMarketCap:30,maxMarketCap:100,unit:"yi",marketCapField:"total"}。',
  inputSchema: {
    type: 'object',
    properties: {
      minMarketCap: { type: 'number' },
      maxMarketCap: { type: 'number' },
      unit: { type: 'string', enum: ['yuan', 'yi'] },
      marketCapField: { type: 'string', enum: ['total', 'circulating'] },
      limit: { type: 'number' },
      includeST: { type: 'boolean' },
      sortOrder: { type: 'string', enum: ['asc', 'desc'] },
    },
  },
  run: (input) => {
    const record = asRecord(input);
    const unit = text(record, 'unit', 'yi') === 'yuan' ? 'yuan' : 'yi';
    const marketCapField = text(record, 'marketCapField', 'total') === 'circulating' ? 'circulating' : 'total';
    const sortOrder = text(record, 'sortOrder', 'asc') === 'desc' ? 'desc' : 'asc';
    return screenASharesByMarketCapService({
      minMarketCap: record.minMarketCap === undefined ? undefined : num(record, 'minMarketCap', 0),
      maxMarketCap: record.maxMarketCap === undefined ? undefined : num(record, 'maxMarketCap', 0),
      unit,
      marketCapField,
      limit: num(record, 'limit', 50),
      includeST: record.includeST === true,
      sortOrder,
    });
  },
};
