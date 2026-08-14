import { getStockChip, listBoardConstituents, listDailyBars, listLatestMarketRows, listMarketBoards, listSecurities, listStockChips, listTradeCalendar, readBoardDetail, readBoardSnapshot, readDiscoverySnapshot } from '../../market-data/market-data-store.js';
import type { AgentTool } from '../../tools/types.js';
import { asRecord, enumValue, formatError, limit, optionalText } from './input.js';

export interface ILocalQueryOutput { source: 'duckdb:market' | 'duckdb:monitor' | 'duckdb:surge'; storage: 'local'; dataset: string; rows?: unknown[]; data?: unknown; dates?: string[]; total?: number; counts?: unknown; warnings: string[]; isEmpty: boolean; }
type TMarketDataset = 'securities' | 'daily_bars' | 'trade_calendar' | 'market_rows' | 'market_boards' | 'board_constituents' | 'board_snapshot' | 'board_detail' | 'discovery_snapshot' | 'stock_chip';
const DATASETS = ['securities', 'daily_bars', 'trade_calendar', 'market_rows', 'market_boards', 'board_constituents', 'board_snapshot', 'board_detail', 'discovery_snapshot', 'stock_chip'] as const;
function localRows(dataset: string, rows: unknown[], warnings: string[]): ILocalQueryOutput { return { source: 'duckdb:market', storage: 'local', dataset, rows, warnings, isEmpty: rows.length === 0 }; }
function localData(dataset: string, data: unknown, warnings: string[]): ILocalQueryOutput { return { source: 'duckdb:market', storage: 'local', dataset, data, warnings, isEmpty: data === undefined || data === null }; }
function emptyLocal(dataset: string, warnings: string[]): ILocalQueryOutput { return { source: 'duckdb:market', storage: 'local', dataset, rows: [], warnings, isEmpty: true }; }

/** 模型可调用：在白名单范围内查询本地 stocksense-market DuckDB，不伪造缺失的市场数据。 */
export const queryLocalMarketDuckDB: AgentTool<Record<string, unknown>, ILocalQueryOutput> = {
  name: 'queryLocalMarketDuckDB',
  description: 'Query whitelisted datasets from local stocksense-market DuckDB: securities, K-line, calendar, board caches, discovery snapshot, chips.',
  inputSchema: { type: 'object', properties: { dataset: { type: 'string', enum: DATASETS }, symbol: { type: 'string' }, boardCode: { type: 'string' }, snapshotKey: { type: 'string' }, startDate: { type: 'string' }, endDate: { type: 'string' }, market: { type: 'string' }, limit: { type: 'number' } }, required: ['dataset'] },
  async run(input) {
    const record = asRecord(input);
    const dataset = enumValue<TMarketDataset>(record, 'dataset', DATASETS, 'market_rows');
    const warnings: string[] = [];
    try {
      switch (dataset) {
        case 'securities': return localRows(dataset, (await listSecurities()).slice(0, limit(record, 200, 2000)), warnings);
        case 'daily_bars': { const symbol = optionalText(record, 'symbol'); return symbol ? localRows(dataset, await listDailyBars(symbol, { startDate: optionalText(record, 'startDate'), endDate: optionalText(record, 'endDate'), limit: limit(record, 120, 500), adjustType: 'qfq' }), warnings) : emptyLocal(dataset, ['查询日 K 需要传入 symbol']); }
        case 'trade_calendar': return localRows(dataset, await listTradeCalendar({ market: optionalText(record, 'market'), startDate: optionalText(record, 'startDate'), endDate: optionalText(record, 'endDate'), limit: limit(record, 60, 500) }), warnings);
        case 'market_rows': return localRows(dataset, (await listLatestMarketRows()).slice(0, limit(record, 100, 1000)), warnings);
        case 'market_boards': return localRows(dataset, (await listMarketBoards()).slice(0, limit(record, 100, 1000)), warnings);
        case 'board_constituents': { const boardCode = optionalText(record, 'boardCode'); return boardCode ? localRows(dataset, (await listBoardConstituents(boardCode)).slice(0, limit(record, 200, 1000)), warnings) : emptyLocal(dataset, ['查询板块成分股需要传入 boardCode']); }
        case 'board_snapshot': return localData(dataset, await readBoardSnapshot(optionalText(record, 'snapshotKey') ?? 'all'), warnings);
        case 'board_detail': { const boardCode = optionalText(record, 'boardCode'); return boardCode ? localData(dataset, await readBoardDetail(boardCode), warnings) : emptyLocal(dataset, ['查询板块详情需要传入 boardCode']); }
        case 'discovery_snapshot': return localData(dataset, await readDiscoverySnapshot(optionalText(record, 'snapshotKey') ?? 'default'), warnings);
        case 'stock_chip': { const symbol = optionalText(record, 'symbol'); return symbol ? localData(dataset, await getStockChip(symbol), warnings) : localRows(dataset, await listStockChips(limit(record, 200, 1000)), warnings); }
      }
    } catch (error) {
      return emptyLocal(dataset, [`本地 market DuckDB 查询失败：${formatError(error)}`]);
    }
  },
};
