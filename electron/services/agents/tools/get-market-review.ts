import type { AgentTool } from '../types.js';
import { getMarketReview as fetchMarketReview } from '../../stock/anomaly/market-review-service.js';

/** 模型可调用：取得基于真实市场数据计算的复盘原始结果。 */
export const getMarketReview: AgentTool<Record<string, never>, Awaited<ReturnType<typeof fetchMarketReview>>> = {
  name: 'getMarketReview',
  description: 'Fetch and calculate a real-data A-share daily market review.',
  inputSchema: { type: 'object', properties: {} },
  run: () => fetchMarketReview(),
};
