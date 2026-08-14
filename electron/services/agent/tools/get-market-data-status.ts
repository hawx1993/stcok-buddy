import type { AgentTool } from '../../tools/types.js';
import { getMarketDataSyncStatus } from '../../market-data/market-data-sync.js';

/** Registry/workflow 专用：返回本地 A 股数据库的同步状态和最新交易日。 */
export const getMarketDataStatus: AgentTool<Record<string, never>, Awaited<ReturnType<typeof getMarketDataSyncStatus>>> = {
  name: 'getMarketDataStatus',
  description: 'Return local A-share database synchronization status and latest available trade date.',
  inputSchema: { type: 'object', properties: {} },
  run: () => getMarketDataSyncStatus(),
};
