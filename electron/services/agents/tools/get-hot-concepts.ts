import type { IEmHotRankItem, IThsHotStock } from '../../stock/a-stock-data-runner.js';
import { runAStockDataFn } from '../../stock/a-stock-data-runner.js';
import type { AgentTool } from '../types.js';

export interface IHotConceptsToolOutput {
  source: 'ths_hot_list' | 'em_hot_rank';
  list: IThsHotStock[] | IEmHotRankItem[];
}

/** 模型可调用：优先同花顺热榜，失败后查询东方财富人气榜，均为真实数据。 */
export const getHotConcepts: AgentTool<Record<string, never>, IHotConceptsToolOutput> = {
  name: 'getHotConcepts',
  description: 'Fetch today hot stocks with concept tags (a-stock-data: ths_hot_list → em_hot_rank).',
  inputSchema: { type: 'object', properties: {} },
  async run() {
    const ths = await runAStockDataFn<IThsHotStock[]>('ths_hot_list', { period: 'hour' }).catch(() => null);
    if (ths && ths.length > 0) return { source: 'ths_hot_list', list: ths };
    const em = await runAStockDataFn<IEmHotRankItem[]>('em_hot_rank', { top: 30 }).catch(() => null);
    if (em && em.length > 0) return { source: 'em_hot_rank', list: em };
    throw new Error('热门股数据源暂不可用（同花顺热榜与东财人气榜均失败）');
  },
};
