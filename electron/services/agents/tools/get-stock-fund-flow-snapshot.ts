import type { AgentTool } from '../types.js';
import { getStockFundFlowSnapshot as fetchStockFundFlowSnapshot } from '../../stock/stock-detail/stock-client.js';
import { asRecord, text } from './input.js';

/** Registry/workflow 专用：通过 stock-client 获取个股资金流快照。 */
export const getStockFundFlowSnapshot: AgentTool<
  { symbol: string },
  Awaited<ReturnType<typeof fetchStockFundFlowSnapshot>>
> = {
  name: 'getStockFundFlowSnapshot',
  description: 'Fetch individual A-share fund flow snapshot from stock-sdk.',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  run: (input) => fetchStockFundFlowSnapshot(text(asRecord(input), 'symbol')),
};
