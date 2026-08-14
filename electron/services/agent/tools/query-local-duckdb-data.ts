import type { KlinePoint, StockDetail } from '../../../../src/shared/types.js';
import { getMarketDataSyncStatus } from '../../market-data/market-data-sync.js';
import { getLatestDailyBar, listDailyBars, listLatestMarketRows } from '../../market-data/market-data-store.js';
import type { AgentTool } from '../../tools/types.js';
import { localBarToKlinePoint, localBarToStockDetail } from '../agent-data-mappers.js';
import { asRecord, formatError, num, text } from './input.js';

export interface ILocalDuckDBQueryResult { source: 'duckdb:local'; storage: 'local'; symbol?: string; latestQuote?: StockDetail; kline: KlinePoint[]; marketRows: Awaited<ReturnType<typeof listLatestMarketRows>>; latestTradeDate?: string; warnings: string[]; isEmpty: boolean; }

/** Registry/workflow 专用：在远程请求前仅查询本地 DuckDB 的单股或市场快照。 */
export const queryLocalDuckDBData: AgentTool<{ symbol?: string; limit?: number }, ILocalDuckDBQueryResult> = {
  name: 'queryLocalDuckDBData',
  description: 'Query only local DuckDB market data before remote providers or for local-only screening context.',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' }, limit: { type: 'number' } } },
  async run(input) {
    const record = asRecord(input);
    const symbol = text(record, 'symbol').trim();
    const limit = Math.min(120, Math.max(1, num(record, 'limit', 60)));
    const warnings: string[] = [];
    if (symbol) {
      const [latestBarResult, barsResult] = await Promise.allSettled([getLatestDailyBar(symbol), listDailyBars(symbol, { adjustType: 'qfq', limit })]);
      const latestBar = latestBarResult.status === 'fulfilled' ? latestBarResult.value : undefined;
      const bars = barsResult.status === 'fulfilled' ? barsResult.value : [];
      if (latestBarResult.status === 'rejected') warnings.push(`本地 DuckDB 最近日线读取失败：${formatError(latestBarResult.reason)}`);
      if (barsResult.status === 'rejected') warnings.push(`本地 DuckDB K线读取失败：${formatError(barsResult.reason)}`);
      if (!latestBar && bars.length === 0) warnings.push('本地 DuckDB 暂无该标的可用数据');
      return { source: 'duckdb:local', storage: 'local', symbol, latestQuote: latestBar ? localBarToStockDetail(latestBar, symbol) : undefined, kline: bars.map((bar) => localBarToKlinePoint(bar)), marketRows: [], latestTradeDate: latestBar?.tradeDate ?? bars.at(-1)?.tradeDate, warnings, isEmpty: !latestBar && bars.length === 0 };
    }
    const [statusResult, rowsResult] = await Promise.allSettled([getMarketDataSyncStatus(), listLatestMarketRows()]);
    const status = statusResult.status === 'fulfilled' ? statusResult.value : undefined;
    const rows = rowsResult.status === 'fulfilled' ? rowsResult.value : [];
    if (statusResult.status === 'rejected') warnings.push(`本地 DuckDB 同步状态读取失败：${formatError(statusResult.reason)}`);
    if (rowsResult.status === 'rejected') warnings.push(`本地 DuckDB 市场快照读取失败：${formatError(rowsResult.reason)}`);
    const marketRows = rows.slice(0, 20);
    if (!marketRows.length) warnings.push('本地 DuckDB 暂无可用市场快照数据');
    return { source: 'duckdb:local', storage: 'local', kline: [], marketRows, latestTradeDate: status?.latestLocalTradeDate, warnings, isEmpty: marketRows.length === 0 };
  },
};
