import type { AgentTool } from '../types.js';
import { listNorthboundFlow } from '../../stock/northbound-flow.js';

/** 模型可调用：获取沪深港通的北向、南向资金流汇总。 */
export const getNorthboundFlow: AgentTool<Record<string, never>, Awaited<ReturnType<typeof listNorthboundFlow>>> = {
  name: 'getNorthboundFlow',
  description: 'Fetch northbound/southbound (沪深港通) capital flow summary from stock-sdk.',
  inputSchema: { type: 'object', properties: {} },
  run: () => listNorthboundFlow(),
};
