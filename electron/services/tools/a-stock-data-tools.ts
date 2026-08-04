import {
  type IBoardFundFlow,
  type IDividendHistoryRow,
  type IEmHotRankItem,
  type IHolderNumberChangeRow,
  type IIndustryRanking,
  type IThsHotStock,
  runAStockDataFn,
} from '../stock/a-stock-data-runner.js';
import type { AgentTool } from './types.js';

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

function text(input: Record<string, unknown>, key: string, fallback = '') {
  return String(input[key] ?? fallback);
}

/** 行业排名 + 行业资金流，任一源成功即返回，两者皆缺才抛错（由 callTool 记录 error，上层走空状态）。 */
export interface IIndustryRankingToolOutput {
  ranking: IIndustryRanking | null;
  flow: IBoardFundFlow | null;
  gaps: { ranking: boolean; flow: boolean };
}

export interface IHotConceptsToolOutput {
  source: 'ths_hot_list' | 'em_hot_rank';
  list: IThsHotStock[] | IEmHotRankItem[];
}

export const getHolderNumberChange: AgentTool<{ symbol: string }, IHolderNumberChangeRow[]> = {
  name: 'getHolderNumberChange',
  description: 'Fetch A-share shareholder count change history (a-stock-data).',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  run: (input) =>
    runAStockDataFn<IHolderNumberChangeRow[]>('holder_num_change', { code: text(asRecord(input), 'symbol') }),
};

export const getDividendHistory: AgentTool<{ symbol: string }, IDividendHistoryRow[]> = {
  name: 'getDividendHistory',
  description: 'Fetch A-share dividend/transfer history (a-stock-data).',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  run: (input) =>
    runAStockDataFn<IDividendHistoryRow[]>('dividend_history', { code: text(asRecord(input), 'symbol') }),
};

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
    if (!hasRanking && !hasFlow) {
      throw new Error('行业涨幅排名与行业资金流数据源均不可用');
    }
    return {
      ranking: hasRanking ? rankingData : null,
      flow: hasFlow ? flowData : null,
      gaps: { ranking: !hasRanking, flow: !hasFlow },
    };
  },
};

export const getHotConcepts: AgentTool<Record<string, never>, IHotConceptsToolOutput> = {
  name: 'getHotConcepts',
  description: 'Fetch today hot stocks with concept tags (a-stock-data: ths_hot_list → em_hot_rank).',
  inputSchema: { type: 'object', properties: {} },
  async run() {
    const ths = await runAStockDataFn<IThsHotStock[]>('ths_hot_list', { period: 'hour' }).catch(() => null);
    if (ths && ths.length > 0) {
      return { source: 'ths_hot_list', list: ths };
    }
    const em = await runAStockDataFn<IEmHotRankItem[]>('em_hot_rank', { top: 30 }).catch(() => null);
    if (em && em.length > 0) {
      return { source: 'em_hot_rank', list: em };
    }
    throw new Error('热门股数据源暂不可用（同花顺热榜与东财人气榜均失败）');
  },
};
