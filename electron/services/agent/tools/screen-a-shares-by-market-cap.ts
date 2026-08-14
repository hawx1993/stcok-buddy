import type { AgentTool } from '../../tools/types.js';
import { screenASharesByMarketCap as screenASharesByMarketCapService } from '../../market-data/market-cap-screener.js';
import { asRecord, num, text } from './input.js';

/** 模型可调用：按市值范围筛选全市场股票，数据遵循 DuckDB → stock-sdk → a-stock-data。 */
export const screenASharesByMarketCap: AgentTool<{ minMarketCap?: number; maxMarketCap?: number; unit?: 'yuan' | 'yi'; marketCapField?: 'total' | 'circulating'; limit?: number; includeST?: boolean; sortOrder?: 'asc' | 'desc' }, Awaited<ReturnType<typeof screenASharesByMarketCapService>>> = {
  name: 'screenASharesByMarketCap',
  description: '全市场 A 股市值筛选工具，用真实数据按 DuckDB → stock-sdk → a-stock-data 获取个股总市值/流通市值。用于“市值在30亿到100亿”“总市值小于50亿”“流通市值30亿到100亿”等查询。输入示例 {minMarketCap:30,maxMarketCap:100,unit:"yi",marketCapField:"total"}。',
  inputSchema: { type: 'object', properties: { minMarketCap: { type: 'number' }, maxMarketCap: { type: 'number' }, unit: { type: 'string', enum: ['yuan', 'yi'] }, marketCapField: { type: 'string', enum: ['total', 'circulating'] }, limit: { type: 'number' }, includeST: { type: 'boolean' }, sortOrder: { type: 'string', enum: ['asc', 'desc'] } } },
  run: (input) => {
    const record = asRecord(input);
    const unit = text(record, 'unit', 'yi') === 'yuan' ? 'yuan' : 'yi';
    const marketCapField = text(record, 'marketCapField', 'total') === 'circulating' ? 'circulating' : 'total';
    const sortOrder = text(record, 'sortOrder', 'asc') === 'desc' ? 'desc' : 'asc';
    return screenASharesByMarketCapService({ minMarketCap: record.minMarketCap === undefined ? undefined : num(record, 'minMarketCap', 0), maxMarketCap: record.maxMarketCap === undefined ? undefined : num(record, 'maxMarketCap', 0), unit, marketCapField, limit: num(record, 'limit', 50), includeST: record.includeST === true, sortOrder });
  },
};
