import type { AgentTool } from '../../tools/types.js';
import { listMarketNews } from '../../stock/news-client.js';
import { asRecord, num, text } from './input.js';

/** Registry/workflow 专用：从新闻服务读取市场新闻列表。 */
export const getMarketNews: AgentTool<{ query: string; page?: number; pageSize?: number }, Awaited<ReturnType<typeof listMarketNews>>['items']> = {
  name: 'getMarketNews',
  description: 'Fetch market news list.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' }, page: { type: 'number' }, pageSize: { type: 'number' } } },
  async run(input) {
    const record = asRecord(input);
    return (await listMarketNews(text(record, 'query'), num(record, 'page', 1), num(record, 'pageSize', 10))).items;
  },
};
