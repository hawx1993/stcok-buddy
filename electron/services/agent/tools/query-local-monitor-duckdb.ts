import type { TMonitorCategory } from '../../../../src/shared/types.js';
import { countMonitorHistory, countMonitorHistoryByCategory, listMonitorDates, listMonitorHistory } from '../../stock/monitor-history-store.js';
import type { AgentTool } from '../../tools/types.js';
import type { ILocalQueryOutput } from './query-local-market-duckdb.js';
import { asRecord, bool, formatError, limit, num, optionalText, stringArray } from './input.js';

const MONITOR_CATEGORIES: readonly TMonitorCategory[] = ['large-order', 'chip', 'technical', 'dragon-tiger', 'news', 'risk', 'ai-opportunity', 'ai-warning'];
function monitorCategories(input: Record<string, unknown>) { const categories = stringArray(input, 'categories').filter((item): item is TMonitorCategory => MONITOR_CATEGORIES.includes(item as TMonitorCategory)); return categories.length ? categories : undefined; }
function emptyLocal(warnings: string[]): ILocalQueryOutput { return { source: 'duckdb:monitor', storage: 'local', dataset: 'ai_monitor_events', rows: [], warnings, isEmpty: true }; }

/** 模型可调用：查询本地 AI 监控事件及分类统计；无记录时明确返回空状态。 */
export const queryLocalMonitorDuckDB: AgentTool<Record<string, unknown>, ILocalQueryOutput> = {
  name: 'queryLocalMonitorDuckDB',
  description: 'Query local stocksense-monitor DuckDB monitor history and category counts.',
  inputSchema: { type: 'object', properties: { date: { type: 'string' }, categories: { type: 'array', items: { type: 'string' } }, offset: { type: 'number' }, limit: { type: 'number' }, includeCounts: { type: 'boolean' } } },
  async run(input) {
    const record = asRecord(input);
    const date = optionalText(record, 'date');
    const warnings: string[] = [];
    try {
      if (!date) {
        const dates = await listMonitorDates(limit(record, 7, 30));
        return { source: 'duckdb:monitor', storage: 'local', dataset: 'ai_monitor_events', dates, warnings: dates.length ? warnings : ['本地 monitor DuckDB 暂无监控历史日期'], isEmpty: dates.length === 0 };
      }
      const categories = monitorCategories(record);
      const rows = await listMonitorHistory({ date, categories, offset: num(record, 'offset', 0), limit: limit(record, 50, 1000) });
      const includeCounts = bool(record, 'includeCounts');
      return { source: 'duckdb:monitor', storage: 'local', dataset: 'ai_monitor_events', rows, total: includeCounts ? await countMonitorHistory({ date, categories }) : undefined, counts: includeCounts ? await countMonitorHistoryByCategory({ date, categories }) : undefined, warnings: rows.length ? warnings : ['本地 monitor DuckDB 未查到符合条件的监控历史'], isEmpty: rows.length === 0 };
    } catch (error) {
      return emptyLocal([`本地 monitor DuckDB 查询失败：${formatError(error)}`]);
    }
  },
};
