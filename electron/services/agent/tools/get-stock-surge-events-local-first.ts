import type { StockSurgeEvent } from '../../../../src/shared/types.js';
import type { ITdxTransactionRow } from '../../stock/a-stock-data-runner.js';
import { runAStockDataFn } from '../../stock/a-stock-data-runner.js';
import { listStockSurgeEvents } from '../../stock/stock-client.js';
import type { AgentTool } from '../../tools/types.js';
import { asRecord, formatError, num, safePositiveInt, text } from './input.js';

interface IStockSurgeEventsLocalFirstInput {
  symbol: string;
  days?: number;
  limit?: number;
  minHands?: number;
}
interface IStockSurgeEventsLocalFirstOutput {
  source: 'right-panel-local-first' | 'a-stock-data';
  storage: 'local' | 'remote';
  symbol: string;
  rows: StockSurgeEvent[];
  warnings: string[];
  isEmpty: boolean;
}
function tdxTransactionToSurgeEvent(symbol: string, row: ITdxTransactionRow, index: number): StockSurgeEvent {
  const side = row.buyorsell === 0 ? '买入' : row.buyorsell === 1 ? '卖出' : '中性';
  const tag = side === '中性' ? '中性大单' : `特大单${side}`;
  const tradeDate = new Date().toISOString().slice(0, 10);
  const hands = Number.isFinite(Number(row.vol)) ? Number(row.vol) : undefined;
  return {
    id: `tdx-transaction-${tradeDate}-${row.time || index}-${index}`,
    tradeDate,
    title: `${symbol} 逐笔成交`,
    code: symbol,
    time: row.time,
    price: row.price === null ? undefined : row.price,
    amount:
      hands === undefined
        ? undefined
        : `${side}${hands >= 10000 ? `${(hands / 10000).toFixed(2).replace(/\.00$/, '')}万手` : `${hands.toFixed(0)}手`}`,
    description: `通达信逐笔成交${tag}`,
    tag,
    type: side === '卖出' ? 'plummet' : side === '买入' ? 'surge' : 'neutral',
  };
}

/** 模型可调用：优先读取右侧栏同源的真实异动历史，缺失时查询 a-stock-data 通达信逐笔成交。 */
export const getStockSurgeEventsLocalFirst: AgentTool<
  IStockSurgeEventsLocalFirstInput,
  IStockSurgeEventsLocalFirstOutput
> = {
  name: 'getStockSurgeEventsLocalFirst',
  description:
    'Get individual stock surge/anomaly and large-order events with priority DuckDB → stock-sdk → a-stock-data.',
  inputSchema: {
    type: 'object',
    properties: {
      symbol: { type: 'string' },
      days: { type: 'number' },
      limit: { type: 'number' },
      minHands: { type: 'number' },
    },
    required: ['symbol'],
  },
  async run(input) {
    const record = asRecord(input);
    const symbol = text(record, 'symbol').trim();
    const limit = safePositiveInt(num(record, 'limit', 200), 200, 1000);
    const minHands = safePositiveInt(num(record, 'minHands', 10000), 10000, 1000000);
    const warnings: string[] = [];
    try {
      const rows = (await listStockSurgeEvents(symbol)).slice(0, limit);
      if (rows.length)
        return { source: 'right-panel-local-first', storage: 'local', symbol, rows, warnings, isEmpty: false };
      warnings.push('右侧栏同源个股异动服务未返回最近异动历史');
    } catch (error) {
      warnings.push(`右侧栏同源个股异动服务读取失败：${formatError(error)}`);
    }
    try {
      const transactions = await runAStockDataFn<ITdxTransactionRow[]>('tdx_transactions', {
        code: symbol,
        min_hands: minHands,
        limit,
      });
      const rows = transactions.map((row, index) => tdxTransactionToSurgeEvent(symbol, row, index));
      if (rows.length) return { source: 'a-stock-data', storage: 'remote', symbol, rows, warnings, isEmpty: false };
      warnings.push(`a-stock-data 通达信逐笔成交未返回单笔不低于 ${minHands} 手的大单样本`);
    } catch (error) {
      warnings.push(`a-stock-data 通达信逐笔成交获取失败：${formatError(error)}`);
    }
    return { source: 'a-stock-data', storage: 'remote', symbol, rows: [], warnings, isEmpty: true };
  },
};
