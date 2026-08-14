import type { ChipDistribution, IChipDistributionResult } from '../../../../src/shared/types.js';
import { getMarketDataStats, listLatestMarketRows, listStockChips } from '../../market-data/market-data-store.js';
import type { AgentTool } from '../../tools/types.js';
import { asRecord, bool, enumValue, formatError, limit, num, optionalNum } from './input.js';

type TSortBy = 'changePercent' | 'concentration90' | 'amount' | 'turnoverRate';
type TSortOrder = 'asc' | 'desc';
type TChipMatchMode = 'latest' | 'all' | 'any';
interface IScreenLocalAStocksInput { changePercentMin?: number; changePercentMax?: number; concentration90Max?: number; concentration90Min?: number; concentration70Max?: number; concentration70Min?: number; profitRatioMin?: number; chipLookbackDays?: number; chipMatchMode?: TChipMatchMode; limit?: number; sortBy?: TSortBy; sortOrder?: TSortOrder; includeST?: boolean; }
interface IScreenLocalAStockRow { code: string; name: string; industry?: string; price?: number; changePercent?: number; turnoverRate?: number; amount?: number; concentration90Percent?: number; concentration70Percent?: number; profitRatioPercent?: number; chipDate?: string; chipLookbackDays?: number; chipMatchedDays?: number; recentConcentration90Percent?: number[]; recentConcentration70Percent?: number[]; }
interface IScreenLocalAStocksOutput { source: 'duckdb:market'; storage: 'local'; latestTradeDate?: string; rows: IScreenLocalAStockRow[]; matchedCount: number; returnedCount: number; warnings: string[]; isEmpty: boolean; }

function isChipDistributionResult(value: unknown): value is IChipDistributionResult { if (!value || typeof value !== 'object') return false; const record = value as Partial<IChipDistributionResult>; return Array.isArray(record.distributions) && Array.isArray(record.trend); }
function ratioPercent(value: number | undefined) { return value === undefined || !Number.isFinite(value) ? undefined : Math.abs(value) <= 1 ? value * 100 : value; }
function passesNumberRange(value: number | undefined, min?: number, max?: number) { return !(min !== undefined && (value === undefined || value < min)) && !(max !== undefined && (value === undefined || value > max)); }
function hasChipRangeCondition(options: IScreenLocalAStocksInput) { return options.concentration90Min !== undefined || options.concentration90Max !== undefined || options.concentration70Min !== undefined || options.concentration70Max !== undefined; }
function recentChipWindow(result: IChipDistributionResult, options: IScreenLocalAStocksInput): ChipDistribution[] { const days = options.chipLookbackDays ?? 1; return (options.chipMatchMode ?? 'latest') === 'latest' ? result.latest ? [result.latest] : [] : result.distributions.slice(-days); }
function chipItemPassesRanges(item: { concentration90?: number; concentration70?: number }, options: IScreenLocalAStocksInput) { return passesNumberRange(ratioPercent(item.concentration90), options.concentration90Min, options.concentration90Max) && passesNumberRange(ratioPercent(item.concentration70), options.concentration70Min, options.concentration70Max); }
function countChipMatches(result: IChipDistributionResult, options: IScreenLocalAStocksInput) { const window = recentChipWindow(result, options); return hasChipRangeCondition(options) ? window.filter((item) => chipItemPassesRanges(item, options)).length : window.length; }
function chipWindowPasses(result: IChipDistributionResult, options: IScreenLocalAStocksInput) { const mode = options.chipMatchMode ?? 'latest'; const window = recentChipWindow(result, options); if (!hasChipRangeCondition(options)) return true; if (!window.length || (mode === 'all' && window.length < (options.chipLookbackDays ?? 1))) return false; const matches = countChipMatches(result, options); return mode === 'any' ? matches > 0 : mode === 'all' ? matches === window.length : matches > 0; }
function windowPercents(result: IChipDistributionResult, key: 'concentration90' | 'concentration70', options: IScreenLocalAStocksInput) { return recentChipWindow(result, options).map((item) => ratioPercent(item[key])).filter((value): value is number => value !== undefined); }
function buildScreenInput(input: unknown): IScreenLocalAStocksInput { const record = asRecord(input); return { changePercentMin: optionalNum(record, 'changePercentMin'), changePercentMax: optionalNum(record, 'changePercentMax'), concentration90Max: optionalNum(record, 'concentration90Max'), concentration90Min: optionalNum(record, 'concentration90Min'), concentration70Max: optionalNum(record, 'concentration70Max'), concentration70Min: optionalNum(record, 'concentration70Min'), profitRatioMin: optionalNum(record, 'profitRatioMin'), chipLookbackDays: Math.max(1, Math.min(60, Math.floor(num(record, 'chipLookbackDays', 1)))), chipMatchMode: enumValue(record, 'chipMatchMode', ['latest', 'all', 'any'] as const, 'latest'), limit: limit(record, 50, 500), sortBy: enumValue(record, 'sortBy', ['changePercent', 'concentration90', 'amount', 'turnoverRate'] as const, 'changePercent'), sortOrder: enumValue(record, 'sortOrder', ['asc', 'desc'] as const, 'desc'), includeST: bool(record, 'includeST') }; }
function sortValue(row: IScreenLocalAStockRow, sortBy: TSortBy) { switch (sortBy) { case 'concentration90': return row.concentration90Percent; case 'amount': return row.amount; case 'turnoverRate': return row.turnoverRate; case 'changePercent': return row.changePercent; } }

/** 模型可调用：仅基于本地真实市场快照与筹码缓存执行全市场条件选股。 */
export const screenLocalAStocks: AgentTool<IScreenLocalAStocksInput, IScreenLocalAStocksOutput> = {
  name: 'screenLocalAStocks',
  description: 'Screen all A-shares from local DuckDB by quote snapshot and chip distribution conditions. Prefer for market-wide local screening.',
  inputSchema: { type: 'object', properties: { changePercentMin: { type: 'number' }, changePercentMax: { type: 'number' }, concentration90Max: { type: 'number' }, concentration90Min: { type: 'number' }, concentration70Max: { type: 'number' }, concentration70Min: { type: 'number' }, profitRatioMin: { type: 'number' }, chipLookbackDays: { type: 'number' }, chipMatchMode: { type: 'string', enum: ['latest', 'all', 'any'] }, limit: { type: 'number' }, sortBy: { type: 'string', enum: ['changePercent', 'concentration90', 'amount', 'turnoverRate'] }, sortOrder: { type: 'string', enum: ['asc', 'desc'] }, includeST: { type: 'boolean' } } },
  async run(input) {
    const options = buildScreenInput(input);
    const warnings: string[] = [];
    const [marketRowsResult, chipsResult, statsResult] = await Promise.allSettled([listLatestMarketRows(), listStockChips(10000), getMarketDataStats()]);
    const marketRows = marketRowsResult.status === 'fulfilled' ? marketRowsResult.value : [];
    const chips = chipsResult.status === 'fulfilled' ? chipsResult.value : [];
    const stats = statsResult.status === 'fulfilled' ? statsResult.value : undefined;
    if (marketRowsResult.status === 'rejected') warnings.push(`本地行情快照读取失败：${formatError(marketRowsResult.reason)}`);
    if (chipsResult.status === 'rejected') warnings.push(`本地筹码缓存读取失败：${formatError(chipsResult.reason)}`);
    if (statsResult.status === 'rejected') warnings.push(`本地行情统计读取失败：${formatError(statsResult.reason)}`);
    const chipBySymbol = new Map(chips.map((item) => [item.symbol, item]));
    let missingChipCount = 0;
    let missingChipConcentrationCount = 0;
    const matched = marketRows.filter((row) => options.includeST || !/^\*?ST/i.test(row.name)).map((row): IScreenLocalAStockRow | undefined => {
      const chipRecord = chipBySymbol.get(row.code);
      if (!chipRecord) { missingChipCount += 1; return undefined; }
      if (!isChipDistributionResult(chipRecord.data)) { missingChipConcentrationCount += 1; return undefined; }
      const latest = chipRecord.data.latest;
      const concentration90Percent = ratioPercent(latest?.concentration90);
      const concentration70Percent = ratioPercent(latest?.concentration70);
      const profitRatioPercent = ratioPercent(latest?.profitRatio);
      if (hasChipRangeCondition(options) && !chipWindowPasses(chipRecord.data, options)) return undefined;
      if (!passesNumberRange(row.changePercent, options.changePercentMin, options.changePercentMax) || !passesNumberRange(profitRatioPercent, options.profitRatioMin, undefined)) return undefined;
      return { code: row.code, name: row.name, industry: row.industry, price: row.price, changePercent: row.changePercent, turnoverRate: row.turnoverRate, amount: row.amount, concentration90Percent, concentration70Percent, profitRatioPercent, chipDate: latest?.date, chipLookbackDays: options.chipLookbackDays, chipMatchedDays: countChipMatches(chipRecord.data, options), recentConcentration90Percent: windowPercents(chipRecord.data, 'concentration90', options), recentConcentration70Percent: windowPercents(chipRecord.data, 'concentration70', options) };
    }).filter((item): item is IScreenLocalAStockRow => item !== undefined).sort((a, b) => { const left = sortValue(a, options.sortBy ?? 'changePercent') ?? Number.NEGATIVE_INFINITY; const right = sortValue(b, options.sortBy ?? 'changePercent') ?? Number.NEGATIVE_INFINITY; return (options.sortOrder ?? 'desc') === 'asc' ? left - right : right - left; });
    if (!marketRows.length) warnings.push('本地 DuckDB 暂无可用市场快照数据');
    if (!chips.length) warnings.push('本地 DuckDB 暂无可用筹码缓存数据');
    if (missingChipCount > 0) warnings.push(`${missingChipCount} 只股票缺少本地筹码缓存，未纳入筹码条件筛选`);
    if (missingChipConcentrationCount > 0) warnings.push(`${missingChipConcentrationCount} 只股票缺少有效筹码集中度，未纳入筹码条件筛选`);
    const rows = matched.slice(0, options.limit ?? 50);
    return { source: 'duckdb:market', storage: 'local', latestTradeDate: stats?.latestTradeDate, rows, matchedCount: matched.length, returnedCount: rows.length, warnings, isEmpty: rows.length === 0 };
  },
};
