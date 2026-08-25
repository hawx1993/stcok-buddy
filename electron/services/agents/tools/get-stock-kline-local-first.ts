import type { KlinePoint } from '../../../../src/shared/types.js';
import { queryHistoricalBars } from '../../market-data/market-data-query.js';
import type { IBaiduKline } from '../../stock/quotes/a-stock-data-runner.js';
import { runAStockDataFn } from '../../stock/quotes/a-stock-data-runner.js';
import type { AgentTool } from '../types.js';
import { parseBaiduKline } from '../agent-data-mappers.js';
import { asRecord, formatError, num, text } from './input.js';

/** 模型可调用：获取个股日 K 线，优先本地/stock-sdk，失败后使用 a-stock-data 百度日线。 */
export const getStockKlineLocalFirst: AgentTool<{ symbol: string; limit?: number }, KlinePoint[]> = {
  name: 'getStockKlineLocalFirst',
  description: 'Get A-share daily K-line with priority DuckDB → stock-sdk → a-stock-data.',
  inputSchema: {
    type: 'object',
    properties: { symbol: { type: 'string' }, limit: { type: 'number' } },
    required: ['symbol'],
  },
  async run(input) {
    const record = asRecord(input);
    const symbol = text(record, 'symbol');
    const limit = num(record, 'limit', 120);
    const errors: string[] = [];
    let partialLocalOrStockSdk: KlinePoint[] = [];
    try {
      const result = await queryHistoricalBars(symbol, { limit, adjustType: 'qfq' });
      if (result.meta.isComplete && result.data.length) return result.data;
      partialLocalOrStockSdk = result.data;
      errors.push(...(result.meta.warnings ?? ['DuckDB/stock-sdk 未返回完整 K 线']));
    } catch (error) {
      errors.push(`DuckDB/stock-sdk K线获取失败：${formatError(error)}`);
    }
    try {
      const baidu = await runAStockDataFn<IBaiduKline>('baidu_kline_with_ma', { code: symbol });
      const bars = parseBaiduKline(baidu);
      if (bars.length) return bars.slice(-limit);
    } catch (error) {
      errors.push(`a-stock-data 百度K线失败：${formatError(error)}`);
    }
    if (partialLocalOrStockSdk.length) return partialLocalOrStockSdk;
    throw new Error(`K线数据源暂不可用：${errors.join('；') || '未返回可用 K 线'}`);
  },
};
