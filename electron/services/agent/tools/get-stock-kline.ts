import type { AgentTool } from '../../tools/types.js';
import { getKline } from '../../stock/stock-client.js';
import { asRecord, num, text } from './input.js';

/** Registry/workflow 专用：按既有 stock-client 契约获取股票 K 线序列。 */
export const getStockKline: AgentTool<{ symbol: string; limit?: number; period?: string }, Awaited<ReturnType<typeof getKline>>> = {
  name: 'getStockKline',
  description: 'Fetch A-share K-line data.',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' }, limit: { type: 'number' }, period: { type: 'string' } }, required: ['symbol'] },
  run: (input) => {
    const record = asRecord(input);
    return getKline(text(record, 'symbol'), num(record, 'limit', 120), text(record, 'period', '1d'));
  },
};
