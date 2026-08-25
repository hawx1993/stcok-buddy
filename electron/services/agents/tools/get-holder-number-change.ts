import type { IHolderNumberChangeRow } from '../../stock/quotes/a-stock-data-runner.js';
import { runAStockDataFn } from '../../stock/quotes/a-stock-data-runner.js';
import type { AgentTool } from '../types.js';
import { asRecord, text } from './input.js';

/** 模型可调用：通过 a-stock-data 查询股东户数变化，辅助判断筹码集中。 */
export const getHolderNumberChange: AgentTool<{ symbol: string }, IHolderNumberChangeRow[]> = {
  name: 'getHolderNumberChange',
  description: 'Fetch A-share shareholder count change history (a-stock-data).',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  run: (input) =>
    runAStockDataFn<IHolderNumberChangeRow[]>('holder_num_change', { code: text(asRecord(input), 'symbol') }),
};
