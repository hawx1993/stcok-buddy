import type { AgentTool } from '../../tools/types.js';
import { queryHistoricalBars } from '../../market-data/market-data-query.js';
import { asRecord, num, text } from './input.js';

/** Registry/workflow 专用：本地 DuckDB 优先，并由市场数据层回补缺失的历史日线。 */
export const getHistoricalDailyBars: AgentTool<{ symbol: string; limit?: number; startDate?: string; endDate?: string; adjustType?: 'qfq' | 'none' }, Awaited<ReturnType<typeof queryHistoricalBars>>> = {
  name: 'getHistoricalDailyBars',
  description: 'Query A-share historical daily bars from local DuckDB first, backfilling missing ranges remotely. Not for realtime prices or minute bars.',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' }, limit: { type: 'number' }, startDate: { type: 'string' }, endDate: { type: 'string' }, adjustType: { type: 'string', enum: ['qfq', 'none'] } }, required: ['symbol'] },
  run: (input) => {
    const record = asRecord(input);
    return queryHistoricalBars(text(record, 'symbol'), { limit: num(record, 'limit', 120), startDate: record.startDate ? text(record, 'startDate') : undefined, endDate: record.endDate ? text(record, 'endDate') : undefined, adjustType: text(record, 'adjustType', 'qfq') as 'qfq' | 'none' });
  },
};
