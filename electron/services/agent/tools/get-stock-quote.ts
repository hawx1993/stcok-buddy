import type { AgentTool } from '../../tools/types.js';
import { getQuote } from '../../stock/stock-client.js';
import { asRecord, text } from './input.js';

/** Registry/workflow 专用：经既有 stock-client 读取单只股票最新行情。 */
export const getStockQuote: AgentTool<{ symbol: string }, Awaited<ReturnType<typeof getQuote>>> = {
  name: 'getStockQuote',
  description: 'Fetch current A-share quote.',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  run: (input) => getQuote(text(asRecord(input), 'symbol')),
};
