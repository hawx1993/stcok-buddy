import type { AgentTool } from '../../tools/types.js';
import { getChipDistribution } from '../../stock/stock-client.js';
import { asRecord, text } from './input.js';

/** 模型可调用：经既有真实数据链路获取单股筹码分布。 */
export const getStockChipDistribution: AgentTool<{ symbol: string }, Awaited<ReturnType<typeof getChipDistribution>>> = {
  name: 'getStockChipDistribution',
  description: 'Fetch A-share chip distribution data.',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  run: (input) => getChipDistribution(text(asRecord(input), 'symbol')),
};
