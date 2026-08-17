import {
  screenASharesByConditions as screenASharesByConditionsService,
  type IConditionScreenerInput,
  type IConditionScreenerResult,
} from '../../market-data/condition-screener-service.js';
import type { AgentTool } from '../../tools/types.js';

/** 确定性条件选股工具：筛选逻辑由已解析的 slash 参数决定，不交由模型猜测。 */
export const screenASharesByConditions: AgentTool<IConditionScreenerInput, IConditionScreenerResult> = {
  name: 'screenASharesByConditions',
  description: '按已校验的市值、换手率、成交额、涨幅、筹码和领涨板块条件筛选真实 A 股数据。',
  inputSchema: {
    type: 'object',
    properties: {
      minTotalMarketCapYuan: { type: 'number' },
      maxTotalMarketCapYuan: { type: 'number' },
      maxTotalMarketCapYuanExclusive: { type: 'number' },
      turnoverRateMinExclusive: { type: 'number' },
      amountMinYuanExclusive: { type: 'number' },
      changePercentMin: { type: 'number' },
      changePercentMax: { type: 'number' },
      concentration90MaxExclusive: { type: 'number' },
      profitRatioMinExclusive: { type: 'number' },
      excludeST: { type: 'boolean' },
      leadingBoards: { type: 'boolean' },
      sortBy: { type: 'string', enum: ['code', 'turnoverRate'] },
      sortOrder: { type: 'string', enum: ['asc', 'desc'] },
      limit: { type: 'number' },
    },
  },
  run: (input) => screenASharesByConditionsService(input),
};
