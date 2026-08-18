import type { IStockFundFlowSnapshot } from '../../../../src/shared/types.js';
import type { AgentTool } from '../types.js';
import { getStockFundFlowSnapshot } from './get-stock-fund-flow-snapshot.js';
import { asRecord, text } from './input.js';

/** 模型可调用：取得个股资金流；复用既有 stock-sdk → a-stock-data 真实数据降级链路。 */
export const getStockFundFlowLocalFirst: AgentTool<{ symbol: string }, IStockFundFlowSnapshot> = {
  name: 'getStockFundFlowLocalFirst',
  description: 'Get A-share fund flow with priority stock-sdk → a-stock-data (no complete local DuckDB snapshot).',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  run: (input) => getStockFundFlowSnapshot.run({ symbol: text(asRecord(input), 'symbol') }),
};
