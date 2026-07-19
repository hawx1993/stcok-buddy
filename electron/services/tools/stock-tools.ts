import type { HotFocusTab } from '../../../src/shared/types.js';
import { getMarketDataSyncStatus } from '../market-data/market-data-sync.js';
import { queryHistoricalBars } from '../market-data/market-data-query.js';
import { runTechnicalAnalysis } from '../agent/analysis-agent.js';
import { listMarketNews, listStockNewsAnnouncements } from '../stock/news-client.js';
import { getChipDistribution, getKline, getQuote, getStockFundFlowSnapshot as fetchStockFundFlowSnapshot, listDailyDragonTiger, listHotFocus, resolveASymbol } from '../stock/stock-client.js';
import type { AgentTool } from './types.js';

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? input as Record<string, unknown> : {};
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
    const symbol = await resolveASymbol(text(asRecord(input), 'query'));
    return { symbol };
  },
};

export const getStockQuote: AgentTool<{ symbol: string }, Awaited<ReturnType<typeof getQuote>>> = {
  name: 'getStockQuote',
  description: 'Fetch current A-share quote.',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  run: (input) => getQuote(text(asRecord(input), 'symbol')),
};

export const getStockKline: AgentTool<{ symbol: string; limit?: number; period?: string }, Awaited<ReturnType<typeof getKline>>> = {
  name: 'getStockKline',
  description: 'Fetch A-share K-line data.',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' }, limit: { type: 'number' }, period: { type: 'string' } }, required: ['symbol'] },
  run: (input) => {
    const record = asRecord(input);
    return getKline(text(record, 'symbol'), num(record, 'limit', 120), text(record, 'period', '1d'));
  },
};

export const getHistoricalDailyBars: AgentTool<{ symbol: string; limit?: number; startDate?: string; endDate?: string; adjustType?: 'qfq' | 'none' }, Awaited<ReturnType<typeof queryHistoricalBars>>> = {
  name: 'getHistoricalDailyBars',
  description: 'Query A-share historical daily bars from local DuckDB first, backfilling missing ranges remotely. Not for realtime prices or minute bars.',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' }, limit: { type: 'number' }, startDate: { type: 'string' }, endDate: { type: 'string' }, adjustType: { type: 'string', enum: ['qfq', 'none'] } }, required: ['symbol'] },
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

export const getMarketDataStatus: AgentTool<Record<string, never>, Awaited<ReturnType<typeof getMarketDataSyncStatus>>> = {
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

export const getMarketNews: AgentTool<{ query: string; page?: number; pageSize?: number }, Awaited<ReturnType<typeof listMarketNews>>['items']> = {
  name: 'getMarketNews',
  description: 'Fetch market news list.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' }, page: { type: 'number' }, pageSize: { type: 'number' } } },
  async run(input) {
    const record = asRecord(input);
    return (await listMarketNews(text(record, 'query'), num(record, 'page', 1), num(record, 'pageSize', 10))).items;
  },
};

export const getStockNewsAnnouncements: AgentTool<{ symbol: string; limit?: number }, Awaited<ReturnType<typeof listStockNewsAnnouncements>>> = {
  name: 'getStockNewsAnnouncements',
  description: 'Fetch stock news and announcements.',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' }, limit: { type: 'number' } }, required: ['symbol'] },
  run: (input) => {
    const record = asRecord(input);
    return listStockNewsAnnouncements(text(record, 'symbol'), num(record, 'limit', 10));
  },
};

export const getStockFundFlowSnapshot: AgentTool<{ symbol: string }, Awaited<ReturnType<typeof fetchStockFundFlowSnapshot>>> = {
  name: 'getStockFundFlowSnapshot',
  description: 'Fetch individual A-share fund flow snapshot from stock-sdk.',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  run: (input) => fetchStockFundFlowSnapshot(text(asRecord(input), 'symbol')),
};

export const getStockChipDistribution: AgentTool<{ symbol: string }, Awaited<ReturnType<typeof getChipDistribution>>> = {
  name: 'getStockChipDistribution',
  description: 'Fetch A-share chip distribution data.',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  run: (input) => getChipDistribution(text(asRecord(input), 'symbol')),
};

export const getDragonTiger: AgentTool<{ symbol?: string; limit?: number }, Awaited<ReturnType<typeof listDailyDragonTiger>>> = {
  name: 'getDragonTiger',
  description: 'Fetch daily market-wide dragon tiger board records.',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' }, limit: { type: 'number' } } },
  async run(input) {
    return (await listDailyDragonTiger()).slice(0, num(asRecord(input), 'limit', 50));
  },
};

export const getHotFocus: AgentTool<{ tab: HotFocusTab }, Awaited<ReturnType<typeof listHotFocus>>> = {
  name: 'getHotFocus',
  description: 'Fetch hot focus list by tab.',
  inputSchema: { type: 'object', properties: { tab: { type: 'string' } }, required: ['tab'] },
  run: (input) => listHotFocus(text(asRecord(input), 'tab', 'surge') as HotFocusTab),
};
