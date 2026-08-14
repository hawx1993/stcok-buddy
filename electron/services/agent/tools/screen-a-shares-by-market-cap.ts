import type { AgentTool } from '../../tools/types.js';
import { screenASharesByMarketCap as screenASharesByMarketCapService } from '../../market-data/market-cap-screener.js';
import { asRecord, num, optionalNum, text } from './input.js';

/** 模型可调用：按市值范围筛选全市场股票，数据遵循 DuckDB → stock-sdk → a-stock-data。 */
export const screenASharesByMarketCap: AgentTool<{ minMarketCap?: number; maxMarketCap?: number; turnoverRateMin?: number; turnoverRateMax?: number; unit?: 'yuan' | 'yi'; marketCapField?: 'total' | 'circulating'; limit?: number; includeST?: boolean; sortOrder?: 'asc' | 'desc' }, Awaited<ReturnType<typeof screenASharesByMarketCapService>>> = {
  name: 'screenASharesByMarketCap',
  description: '全市场 A 股市值筛选工具，用真实数据按 DuckDB → stock-sdk → a-stock-data 获取个股总市值/流通市值，支持按换手率区间二次过滤。用于“市值在30亿到100亿”“总市值小于50亿”“流通市值30亿到100亿”“市值100亿到500亿且换手率大于10%”等查询。全市场筛选请传大 limit（如 500）避免只返回部分结果。输入示例 {minMarketCap:100,maxMarketCap:500,unit:"yi",marketCapField:"total",turnoverRateMin:10,limit:500}。',
  inputSchema: { type: 'object', properties: { minMarketCap: { type: 'number' }, maxMarketCap: { type: 'number' }, turnoverRateMin: { type: 'number' }, turnoverRateMax: { type: 'number' }, unit: { type: 'string', enum: ['yuan', 'yi'] }, marketCapField: { type: 'string', enum: ['total', 'circulating'] }, limit: { type: 'number' }, includeST: { type: 'boolean' }, sortOrder: { type: 'string', enum: ['asc', 'desc'] } } },
  run: (input) => {
    const record = asRecord(input);
    const unit = text(record, 'unit', 'yi') === 'yuan' ? 'yuan' : 'yi';
    const marketCapField = text(record, 'marketCapField', 'total') === 'circulating' ? 'circulating' : 'total';
    const sortOrder = text(record, 'sortOrder', 'asc') === 'desc' ? 'desc' : 'asc';
    return screenASharesByMarketCapService({ minMarketCap: record.minMarketCap === undefined ? undefined : num(record, 'minMarketCap', 0), maxMarketCap: record.maxMarketCap === undefined ? undefined : num(record, 'maxMarketCap', 0), turnoverRateMin: optionalNum(record, 'turnoverRateMin'), turnoverRateMax: optionalNum(record, 'turnoverRateMax'), unit, marketCapField, limit: num(record, 'limit', 50), includeST: record.includeST === true, sortOrder });
  },
};
