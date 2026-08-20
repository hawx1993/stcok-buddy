import type { IBoardFundFlow, IIndustryRanking } from '../../stock/a-stock-data-runner.js';
import { runAStockDataFn } from '../../stock/a-stock-data-runner.js';
import type { AgentTool } from '../types.js';

export interface IIndustryRankingToolOutput {
  ranking: IIndustryRanking | null;
  flow: IBoardFundFlow | null;
  gaps: { ranking: boolean; flow: boolean };
}

/** 模型可调用：合并行业涨幅排名和行业资金流；两路真实数据均缺失才报错。 */
export const getIndustryRanking: AgentTool<Record<string, never>, IIndustryRankingToolOutput> = {
  name: 'getIndustryRanking',
  description: 'Fetch A-share industry change ranking and industry fund flow (a-stock-data).',
  inputSchema: { type: 'object', properties: {} },
  async run() {
    const [ranking, flow] = await Promise.allSettled([
      runAStockDataFn<IIndustryRanking>('industry_comparison', { top_n: 15 }),
      runAStockDataFn<IBoardFundFlow>('board_fund_flow', { board_type: 'industry', period: 'today', top_n: 15 }),
    ]);
    const rankingData = ranking.status === 'fulfilled' ? ranking.value : null;
    const flowData = flow.status === 'fulfilled' ? flow.value : null;
    const hasRanking = rankingData !== null && rankingData.total > 0;
    const hasFlow = flowData !== null && flowData.rows.length > 0;
    if (!hasRanking && !hasFlow) throw new Error('行业涨幅排名与行业资金流数据源均不可用');
    return {
      ranking: hasRanking ? rankingData : null,
      flow: hasFlow ? flowData : null,
      gaps: { ranking: !hasRanking, flow: !hasFlow },
    };
  },
};
