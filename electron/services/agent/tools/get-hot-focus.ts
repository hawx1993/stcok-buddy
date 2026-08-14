import type { HotFocusTab } from '../../../../src/shared/types.js';
import type { AgentTool } from '../../tools/types.js';
import { listHotFocus } from '../../stock/stock-client.js';
import { asRecord, text } from './input.js';

/** 模型可调用：按异动、板块、资金流或市场维度获取热点聚焦数据。 */
export const getHotFocus: AgentTool<{ tab: HotFocusTab }, Awaited<ReturnType<typeof listHotFocus>>> = {
  name: 'getHotFocus',
  description: 'Fetch hot focus list by tab. For northbound/southbound (沪深港通) capital flow use getNorthboundFlow.',
  inputSchema: { type: 'object', properties: { tab: { type: 'string' } }, required: ['tab'] },
  run: (input) => listHotFocus(text(asRecord(input), 'tab', 'surge') as HotFocusTab),
};
