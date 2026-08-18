import type { AgentTool } from '../../tools/types.js';
import { listDailyDragonTiger } from '../../stock/stock-client.js';
import { asRecord, num } from './input.js';

/** Registry/workflow 专用：获取当日全市场龙虎榜记录并按数量截取。 */
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
