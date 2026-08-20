import type { AgentTool } from '../types.js';
import { listStockNewsAnnouncements } from '../../stock/news-client.js';
import { asRecord, num, text } from './input.js';

/** 模型可调用：读取指定股票的新闻与公告，供事件和风险研究使用。 */
export const getStockNewsAnnouncements: AgentTool<
  { symbol: string; limit?: number },
  Awaited<ReturnType<typeof listStockNewsAnnouncements>>
> = {
  name: 'getStockNewsAnnouncements',
  description: 'Fetch stock news and announcements.',
  inputSchema: {
    type: 'object',
    properties: { symbol: { type: 'string' }, limit: { type: 'number' } },
    required: ['symbol'],
  },
  run: (input) => {
    const record = asRecord(input);
    return listStockNewsAnnouncements(text(record, 'symbol'), num(record, 'limit', 10));
  },
};
