import type { HotFocusItem } from '../../../../src/shared/types.js';
import { largeOrderHands } from '../../stock/surge-large-order.js';
import { listRecentStockSurgeEvents, listStockSurgeEventsByTradeDates, listSurgeDates, listSurgeHistory, listSurgeHistoryAll } from '../../stock/surge-history-store.js';
import type { AgentTool } from '../../tools/types.js';
import type { ILocalQueryOutput } from './query-local-market-duckdb.js';
import { asRecord, enumValue, formatError, limit, num, optionalNum, optionalText, stringArray } from './input.js';

type TSurgeOrderSide = 'buy' | 'sell' | 'all';
interface ISurgeOrderFilter { side: TSurgeOrderSide; minHands?: number; }
type TSurgeOrderFields = Pick<HotFocusItem, 'amount' | 'description' | 'tag' | 'title'>;
function buildSurgeOrderFilter(input: Record<string, unknown>): ISurgeOrderFilter { const minHands = optionalNum(input, 'minHands'); return { side: enumValue(input, 'side', ['buy', 'sell', 'all'] as const, 'all'), minHands: minHands === undefined ? undefined : Math.max(1, Math.floor(minHands)) }; }
function isSurgeOrderFilterActive(filter: ISurgeOrderFilter) { return filter.side !== 'all' || filter.minHands !== undefined; }
function surgeOrderText(item: TSurgeOrderFields) { return [item.title, item.description, item.tag, item.amount].filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join(' '); }
function matchesSurgeOrderSide(item: TSurgeOrderFields, side: TSurgeOrderSide) { if (side === 'all') return true; const textValue = surgeOrderText(item); return side === 'buy' ? /买入|大笔买入|特大单买入/.test(textValue) && !/卖出|大笔卖出|特大单卖出/.test(textValue) : /卖出|大笔卖出|特大单卖出/.test(textValue) && !/买入|大笔买入|特大单买入/.test(textValue); }
function filterSurgeOrders<T extends TSurgeOrderFields>(rows: T[], filter: ISurgeOrderFilter) { return isSurgeOrderFilterActive(filter) ? rows.filter((item) => matchesSurgeOrderSide(item, filter.side) && (filter.minHands === undefined || largeOrderHands(item) >= filter.minHands)) : rows; }
function withTradeDate<T>(rows: T[], tradeDate: string): Array<T & { tradeDate: string }> { return rows.map((row) => ({ ...row, tradeDate })); }
function surgeOrderTimeValue(time?: string): number { const [hour, minute, second = '0'] = String(time ?? '').split(':'); return (Number(hour) || 0) * 3600 + (Number(minute) || 0) * 60 + (Number(second) || 0); }
function isBetterSurgeOrderRow(candidate: { id?: string; time?: string; changePercent?: string }, current: { id?: string; time?: string; changePercent?: string }): boolean { const candidateHasPct = Boolean(candidate.changePercent?.trim()); const currentHasPct = Boolean(current.changePercent?.trim()); if (candidateHasPct !== currentHasPct) return candidateHasPct; const candidateTime = surgeOrderTimeValue(candidate.time); const currentTime = surgeOrderTimeValue(current.time); return candidateTime !== currentTime ? candidateTime > currentTime : String(candidate.id ?? '').localeCompare(String(current.id ?? '')) > 0; }
function dedupeSurgeOrdersByStock<T extends { code?: string; id?: string; time?: string; changePercent?: string; tradeDate?: string }>(rows: T[]): T[] { const best = new Map<string, T>(); for (const row of rows) { if (!row.code) best.set(`__no-code-${best.size}`, row); else { const current = best.get(row.code); if (!current || isBetterSurgeOrderRow(row, current)) best.set(row.code, row); } } return Array.from(best.values()).sort((a, b) => { const dateCmp = String(b.tradeDate ?? '').localeCompare(String(a.tradeDate ?? '')); if (dateCmp !== 0) return dateCmp; const timeCmp = surgeOrderTimeValue(b.time) - surgeOrderTimeValue(a.time); return timeCmp !== 0 ? timeCmp : String(b.id ?? '').localeCompare(String(a.id ?? '')); }); }
function localRows(rows: unknown[], warnings: string[]): ILocalQueryOutput { return { source: 'duckdb:surge', storage: 'local', dataset: 'stock_surge_events', rows, warnings, isEmpty: rows.length === 0 }; }
function emptyLocal(warnings: string[]): ILocalQueryOutput { return localRows([], warnings); }

/** 模型可调用：查询本地异动库，可按买卖方向和手数筛选并在全市场去重股票。 */
export const queryLocalSurgeDuckDB: AgentTool<Record<string, unknown>, ILocalQueryOutput> = {
  name: 'queryLocalSurgeDuckDB',
  description: 'Query local stocksense-surge DuckDB stock_surge_events by date or stock code.',
  inputSchema: { type: 'object', properties: { date: { type: 'string' }, code: { type: 'string' }, tradeDates: { type: 'array', items: { type: 'string' } }, keepDays: { type: 'number' }, offset: { type: 'number' }, limit: { type: 'number' }, side: { type: 'string', enum: ['buy', 'sell', 'all'] }, minHands: { type: 'number' } } },
  async run(input) {
    const record = asRecord(input);
    const code = optionalText(record, 'code');
    const date = optionalText(record, 'date');
    const orderFilter = buildSurgeOrderFilter(record);
    const aggregateByStock = isSurgeOrderFilterActive(orderFilter) && !code;
    const warnings: string[] = [];
    try {
      if (code) {
        const tradeDates = stringArray(record, 'tradeDates');
        const allRows = tradeDates.length ? await listStockSurgeEventsByTradeDates(code, tradeDates) : await listRecentStockSurgeEvents(code, Math.max(1, Math.min(60, Math.floor(num(record, 'keepDays', 7)))));
        const rows = filterSurgeOrders(allRows, orderFilter).slice(0, limit(record, 100, 1000));
        return localRows(rows, rows.length ? warnings : allRows.length ? ['本地 surge DuckDB 未查到符合手数/方向条件的该股票异动历史'] : ['本地 surge DuckDB 未查到该股票异动历史']);
      }
      if (date) {
        const allRows = isSurgeOrderFilterActive(orderFilter) ? await listSurgeHistoryAll(date) : await listSurgeHistory(date, num(record, 'offset', 0), limit(record, 100, 1000));
        const dated = withTradeDate(filterSurgeOrders(allRows, orderFilter), date);
        const rows = (aggregateByStock ? dedupeSurgeOrdersByStock(dated) : dated).slice(0, limit(record, 100, 1000));
        return localRows(rows, rows.length ? warnings : allRows.length ? ['本地 surge DuckDB 未查到符合手数/方向条件的该日期异动历史'] : ['本地 surge DuckDB 未查到该日期异动历史']);
      }
      if (isSurgeOrderFilterActive(orderFilter)) {
        const dates = await listSurgeDates(Math.max(1, Math.min(30, Math.floor(num(record, 'keepDays', 7)))));
        const allRows = (await Promise.all(dates.map(async (tradeDate) => withTradeDate(await listSurgeHistoryAll(tradeDate), tradeDate)))).flat();
        const rows = dedupeSurgeOrdersByStock(filterSurgeOrders(allRows, orderFilter)).slice(0, limit(record, 100, 1000));
        return localRows(rows, rows.length ? warnings : dates.length ? ['本地 surge DuckDB 近期异动历史未查到符合手数/方向条件的样本'] : ['本地 surge DuckDB 暂无异动历史日期']);
      }
      const dates = await listSurgeDates(limit(record, 7, 30));
      return { source: 'duckdb:surge', storage: 'local', dataset: 'stock_surge_events', dates, warnings: dates.length ? warnings : ['本地 surge DuckDB 暂无异动历史日期'], isEmpty: dates.length === 0 };
    } catch (error) {
      return emptyLocal([`本地 surge DuckDB 查询失败：${formatError(error)}`]);
    }
  },
};
