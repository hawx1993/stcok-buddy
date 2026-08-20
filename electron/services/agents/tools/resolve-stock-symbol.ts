import type { AgentTool } from '../types.js';
import { resolveASymbol } from '../../stock/stock-client.js';
import { asRecord, text } from './input.js';

/** 模型可调用：将名称、简称或代码解析为标准 A 股证券代码。 */
export const resolveStockSymbol: AgentTool<{ query: string }, { symbol: string; name?: string }> = {
  name: 'resolveStockSymbol',
  description: 'Resolve A-share stock code from a user query.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  async run(input) {
    return resolveASymbol(text(asRecord(input), 'query'));
  },
};
