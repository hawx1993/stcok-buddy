import type { IDividendHistoryRow } from '../../stock/a-stock-data-runner.js';
import { runAStockDataFn } from '../../stock/a-stock-data-runner.js';
import type { AgentTool } from '../types.js';
import { asRecord, text } from './input.js';

/** 模型可调用：通过 a-stock-data 获取股票分红、送转历史。 */
export const getDividendHistory: AgentTool<{ symbol: string }, IDividendHistoryRow[]> = {
  name: 'getDividendHistory',
  description: 'Fetch A-share dividend/transfer history (a-stock-data).',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  run: (input) => runAStockDataFn<IDividendHistoryRow[]>('dividend_history', { code: text(asRecord(input), 'symbol') }),
};
