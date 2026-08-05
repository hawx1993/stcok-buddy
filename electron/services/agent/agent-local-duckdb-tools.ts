import type {
  ChipDistribution,
  HotFocusItem,
  IChipDistributionResult,
  TMonitorCategory,
} from '../../../src/shared/types.js';
import {
  getMarketDataStats,
  getStockChip,
  listBoardConstituents,
  listDailyBars,
  listLatestMarketRows,
  listMarketBoards,
  listSecurities,
  listStockChips,
  listTradeCalendar,
  readBoardDetail,
  readBoardSnapshot,
  readDiscoverySnapshot,
} from '../market-data/market-data-store.js';
import { countMonitorHistory, countMonitorHistoryByCategory, listMonitorDates, listMonitorHistory } from '../stock/monitor-history-store.js';
import { largeOrderHands } from '../stock/surge-large-order.js';
import { listRecentStockSurgeEvents, listStockSurgeEventsByTradeDates, listSurgeDates, listSurgeHistory } from '../stock/surge-history-store.js';
import type { AgentTool } from '../tools/types.js';

type TSortBy = 'changePercent' | 'concentration90' | 'amount' | 'turnoverRate';
type TSortOrder = 'asc' | 'desc';
type TChipMatchMode = 'latest' | 'all' | 'any';
type TSurgeOrderSide = 'buy' | 'sell' | 'all';
type TMarketDataset =
  | 'securities'
  | 'daily_bars'
  | 'trade_calendar'
  | 'market_rows'
  | 'market_boards'
  | 'board_constituents'
  | 'board_snapshot'
  | 'board_detail'
  | 'discovery_snapshot'
  | 'stock_chip';

interface IScreenLocalAStocksInput {
  changePercentMin?: number;
  changePercentMax?: number;
  concentration90Max?: number;
  concentration90Min?: number;
  concentration70Max?: number;
  concentration70Min?: number;
  profitRatioMin?: number;
  chipLookbackDays?: number;
  chipMatchMode?: TChipMatchMode;
  limit?: number;
  sortBy?: TSortBy;
  sortOrder?: TSortOrder;
  includeST?: boolean;
}

interface IScreenLocalAStockRow {
  code: string;
  name: string;
  industry?: string;
  price?: number;
  changePercent?: number;
  turnoverRate?: number;
  amount?: number;
  concentration90Percent?: number;
  concentration70Percent?: number;
  profitRatioPercent?: number;
  chipDate?: string;
  chipLookbackDays?: number;
  chipMatchedDays?: number;
  recentConcentration90Percent?: number[];
  recentConcentration70Percent?: number[];
}

interface IScreenLocalAStocksOutput {
  source: 'duckdb:market';
  storage: 'local';
  latestTradeDate?: string;
  rows: IScreenLocalAStockRow[];
  matchedCount: number;
  returnedCount: number;
  warnings: string[];
  isEmpty: boolean;
}

interface ILocalQueryOutput {
  source: 'duckdb:market' | 'duckdb:monitor' | 'duckdb:surge';
  storage: 'local';
  dataset: string;
  rows?: unknown[];
  data?: unknown;
  dates?: string[];
  total?: number;
  counts?: unknown;
  warnings: string[];
  isEmpty: boolean;
}

const MONITOR_CATEGORIES: readonly TMonitorCategory[] = [
  'large-order',
  'chip',
  'technical',
  'dragon-tiger',
  'news',
  'risk',
  'ai-opportunity',
  'ai-warning',
];

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

function text(input: Record<string, unknown>, key: string, fallback = '') {
  const value = input[key];
  return typeof value === 'string' ? value : fallback;
}

function optionalText(input: Record<string, unknown>, key: string) {
  const value = text(input, key).trim();
  return value || undefined;
}

function num(input: Record<string, unknown>, key: string, fallback: number) {
  const value = Number(input[key]);
  return Number.isFinite(value) ? value : fallback;
}

function optionalNum(input: Record<string, unknown>, key: string) {
  const value = Number(input[key]);
  return Number.isFinite(value) ? value : undefined;
}

function bool(input: Record<string, unknown>, key: string, fallback = false) {
  const value = input[key];
  return typeof value === 'boolean' ? value : fallback;
}

function limit(input: Record<string, unknown>, fallback = 50, max = 1000) {
  return Math.max(1, Math.min(max, Math.floor(num(input, 'limit', fallback))));
}

function enumValue<T extends string>(input: Record<string, unknown>, key: string, allowed: readonly T[], fallback: T) {
  const value = input[key];
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback;
}

function stringArray(input: Record<string, unknown>, key: string) {
  const value = input[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function monitorCategories(input: Record<string, unknown>) {
  const categories = stringArray(input, 'categories').filter((item): item is TMonitorCategory =>
    MONITOR_CATEGORIES.includes(item as TMonitorCategory),
  );
  return categories.length ? categories : undefined;
}

interface ISurgeOrderFilter {
  side: TSurgeOrderSide;
  minHands?: number;
}

type TSurgeOrderFields = Pick<HotFocusItem, 'amount' | 'description' | 'tag' | 'title'>;

function buildSurgeOrderFilter(input: Record<string, unknown>): ISurgeOrderFilter {
  const minHands = optionalNum(input, 'minHands');
  return {
    side: enumValue(input, 'side', ['buy', 'sell', 'all'] as const, 'all'),
    minHands: minHands === undefined ? undefined : Math.max(1, Math.floor(minHands)),
  };
}

function isSurgeOrderFilterActive(filter: ISurgeOrderFilter) {
  return filter.side !== 'all' || filter.minHands !== undefined;
}

function surgeOrderText(item: TSurgeOrderFields) {
  return [item.title, item.description, item.tag, item.amount]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ');
}

function matchesSurgeOrderSide(item: TSurgeOrderFields, side: TSurgeOrderSide) {
  if (side === 'all') return true;
  const textValue = surgeOrderText(item);
  if (side === 'buy') return /买入|大笔买入|特大单买入/.test(textValue) && !/卖出|大笔卖出|特大单卖出/.test(textValue);
  return /卖出|大笔卖出|特大单卖出/.test(textValue) && !/买入|大笔买入|特大单买入/.test(textValue);
}

function filterSurgeOrders<T extends TSurgeOrderFields>(rows: T[], filter: ISurgeOrderFilter) {
  if (!isSurgeOrderFilterActive(filter)) return rows;
  return rows.filter((item) => {
    if (!matchesSurgeOrderSide(item, filter.side)) return false;
    return filter.minHands === undefined || largeOrderHands(item) >= filter.minHands;
  });
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function ratioPercent(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.abs(value) <= 1 ? value * 100 : value;
}

function isChipDistributionResult(value: unknown): value is IChipDistributionResult {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<IChipDistributionResult>;
  return Array.isArray(record.distributions) && Array.isArray(record.trend);
}

function buildScreenInput(input: unknown): IScreenLocalAStocksInput {
  const record = asRecord(input);
  return {
    changePercentMin: optionalNum(record, 'changePercentMin'),
    changePercentMax: optionalNum(record, 'changePercentMax'),
    concentration90Max: optionalNum(record, 'concentration90Max'),
    concentration90Min: optionalNum(record, 'concentration90Min'),
    concentration70Max: optionalNum(record, 'concentration70Max'),
    concentration70Min: optionalNum(record, 'concentration70Min'),
    profitRatioMin: optionalNum(record, 'profitRatioMin'),
    chipLookbackDays: Math.max(1, Math.min(60, Math.floor(num(record, 'chipLookbackDays', 1)))),
    chipMatchMode: enumValue(record, 'chipMatchMode', ['latest', 'all', 'any'] as const, 'latest'),
    limit: limit(record, 50, 500),
    sortBy: enumValue(record, 'sortBy', ['changePercent', 'concentration90', 'amount', 'turnoverRate'] as const, 'changePercent'),
    sortOrder: enumValue(record, 'sortOrder', ['asc', 'desc'] as const, 'desc'),
    includeST: bool(record, 'includeST'),
  };
}

function passesNumberRange(value: number | undefined, min?: number, max?: number) {
  if (min === undefined && max === undefined) return true;
  if (value === undefined) return false;
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

function sortValue(row: IScreenLocalAStockRow, sortBy: TSortBy) {
  switch (sortBy) {
    case 'concentration90':
      return row.concentration90Percent;
    case 'amount':
      return row.amount;
    case 'turnoverRate':
      return row.turnoverRate;
    case 'changePercent':
      return row.changePercent;
  }
}

function hasChipRangeCondition(options: IScreenLocalAStocksInput): boolean {
  return options.concentration90Min !== undefined
    || options.concentration90Max !== undefined
    || options.concentration70Min !== undefined
    || options.concentration70Max !== undefined;
}

function chipItemPassesRanges(
  item: { concentration90?: number; concentration70?: number },
  options: IScreenLocalAStocksInput,
): boolean {
  const concentration90Percent = ratioPercent(item.concentration90);
  const concentration70Percent = ratioPercent(item.concentration70);
  return passesNumberRange(concentration90Percent, options.concentration90Min, options.concentration90Max)
    && passesNumberRange(concentration70Percent, options.concentration70Min, options.concentration70Max);
}

function recentChipWindow(result: IChipDistributionResult, options: IScreenLocalAStocksInput): ChipDistribution[] {
  const days = options.chipLookbackDays ?? 1;
  if ((options.chipMatchMode ?? 'latest') === 'latest') return result.latest ? [result.latest] : [];
  return result.distributions.slice(-days);
}

function countChipMatches(result: IChipDistributionResult, options: IScreenLocalAStocksInput): number {
  const window = recentChipWindow(result, options);
  if (!hasChipRangeCondition(options)) return window.length;
  return window.filter((item) => chipItemPassesRanges(item, options)).length;
}

function chipWindowPasses(result: IChipDistributionResult, options: IScreenLocalAStocksInput): boolean {
  const mode = options.chipMatchMode ?? 'latest';
  const window = recentChipWindow(result, options);
  if (!hasChipRangeCondition(options)) return true;
  if (!window.length) return false;
  if (mode === 'all' && window.length < (options.chipLookbackDays ?? 1)) return false;
  const matches = countChipMatches(result, options);
  if (mode === 'any') return matches > 0;
  if (mode === 'all') return matches === window.length;
  return matches > 0;
}

function windowPercents(
  result: IChipDistributionResult,
  key: 'concentration90' | 'concentration70',
  options: IScreenLocalAStocksInput,
): number[] {
  return recentChipWindow(result, options)
    .map((item) => ratioPercent(item[key]))
    .filter((value): value is number => value !== undefined);
}

export const screenLocalAStocks: AgentTool<IScreenLocalAStocksInput, IScreenLocalAStocksOutput> = {
  name: 'screenLocalAStocks',
  description: 'Screen all A-shares from local DuckDB by quote snapshot and chip distribution conditions. Prefer for market-wide local screening.',
  inputSchema: {
    type: 'object',
    properties: {
      changePercentMin: { type: 'number' },
      changePercentMax: { type: 'number' },
      concentration90Max: { type: 'number' },
      concentration90Min: { type: 'number' },
      concentration70Max: { type: 'number' },
      concentration70Min: { type: 'number' },
      profitRatioMin: { type: 'number' },
      chipLookbackDays: { type: 'number' },
      chipMatchMode: { type: 'string', enum: ['latest', 'all', 'any'] },
      limit: { type: 'number' },
      sortBy: { type: 'string', enum: ['changePercent', 'concentration90', 'amount', 'turnoverRate'] },
      sortOrder: { type: 'string', enum: ['asc', 'desc'] },
      includeST: { type: 'boolean' },
    },
  },
  async run(input) {
    const options = buildScreenInput(input);
    const warnings: string[] = [];
    const [marketRowsResult, chipsResult, statsResult] = await Promise.allSettled([
      listLatestMarketRows(),
      listStockChips(10000),
      getMarketDataStats(),
    ]);
    const marketRows = marketRowsResult.status === 'fulfilled' ? marketRowsResult.value : [];
    const chips = chipsResult.status === 'fulfilled' ? chipsResult.value : [];
    const stats = statsResult.status === 'fulfilled' ? statsResult.value : undefined;
    if (marketRowsResult.status === 'rejected') warnings.push(`本地行情快照读取失败：${formatError(marketRowsResult.reason)}`);
    if (chipsResult.status === 'rejected') warnings.push(`本地筹码缓存读取失败：${formatError(chipsResult.reason)}`);
    if (statsResult.status === 'rejected') warnings.push(`本地行情统计读取失败：${formatError(statsResult.reason)}`);

    const chipBySymbol = new Map(chips.map((item) => [item.symbol, item]));
    let missingChipCount = 0;
    let missingChipConcentrationCount = 0;
    const matched = marketRows
      .filter((row) => options.includeST || !/^\*?ST/i.test(row.name))
      .map((row): IScreenLocalAStockRow | undefined => {
        const chipRecord = chipBySymbol.get(row.code);
        if (!chipRecord) {
          missingChipCount += 1;
          return undefined;
        }
        if (!isChipDistributionResult(chipRecord.data)) {
          missingChipConcentrationCount += 1;
          return undefined;
        }
        const latest = chipRecord.data.latest;
        const concentration90Percent = ratioPercent(latest?.concentration90);
        const concentration70Percent = ratioPercent(latest?.concentration70);
        const profitRatioPercent = ratioPercent(latest?.profitRatio);
        if (hasChipRangeCondition(options) && !chipWindowPasses(chipRecord.data, options)) return undefined;
        if (!passesNumberRange(row.changePercent, options.changePercentMin, options.changePercentMax)) return undefined;
        if (!passesNumberRange(profitRatioPercent, options.profitRatioMin, undefined)) return undefined;
        const recentConcentration90Percent = windowPercents(chipRecord.data, 'concentration90', options);
        const recentConcentration70Percent = windowPercents(chipRecord.data, 'concentration70', options);
        return {
          code: row.code,
          name: row.name,
          industry: row.industry,
          price: row.price,
          changePercent: row.changePercent,
          turnoverRate: row.turnoverRate,
          amount: row.amount,
          concentration90Percent,
          concentration70Percent,
          profitRatioPercent,
          chipDate: latest?.date,
          chipLookbackDays: options.chipLookbackDays,
          chipMatchedDays: countChipMatches(chipRecord.data, options),
          recentConcentration90Percent,
          recentConcentration70Percent,
        };
      })
      .filter((item): item is IScreenLocalAStockRow => item !== undefined)
      .sort((a, b) => {
        const left = sortValue(a, options.sortBy ?? 'changePercent') ?? Number.NEGATIVE_INFINITY;
        const right = sortValue(b, options.sortBy ?? 'changePercent') ?? Number.NEGATIVE_INFINITY;
        return (options.sortOrder ?? 'desc') === 'asc' ? left - right : right - left;
      });

    if (!marketRows.length) warnings.push('本地 DuckDB 暂无可用市场快照数据');
    if (!chips.length) warnings.push('本地 DuckDB 暂无可用筹码缓存数据');
    if (missingChipCount > 0) warnings.push(`${missingChipCount} 只股票缺少本地筹码缓存，未纳入筹码条件筛选`);
    if (missingChipConcentrationCount > 0) warnings.push(`${missingChipConcentrationCount} 只股票缺少有效筹码集中度，未纳入筹码条件筛选`);

    const rows = matched.slice(0, options.limit ?? 50);
    return {
      source: 'duckdb:market',
      storage: 'local',
      latestTradeDate: stats?.latestTradeDate,
      rows,
      matchedCount: matched.length,
      returnedCount: rows.length,
      warnings,
      isEmpty: rows.length === 0,
    };
  },
};

export const queryLocalMarketDuckDB: AgentTool<Record<string, unknown>, ILocalQueryOutput> = {
  name: 'queryLocalMarketDuckDB',
  description: 'Query whitelisted datasets from local stocksense-market DuckDB: securities, K-line, calendar, board caches, discovery snapshot, chips.',
  inputSchema: {
    type: 'object',
    properties: {
      dataset: { type: 'string', enum: ['securities', 'daily_bars', 'trade_calendar', 'market_rows', 'market_boards', 'board_constituents', 'board_snapshot', 'board_detail', 'discovery_snapshot', 'stock_chip'] },
      symbol: { type: 'string' },
      boardCode: { type: 'string' },
      snapshotKey: { type: 'string' },
      startDate: { type: 'string' },
      endDate: { type: 'string' },
      market: { type: 'string' },
      limit: { type: 'number' },
    },
    required: ['dataset'],
  },
  async run(input) {
    const record = asRecord(input);
    const dataset = enumValue<TMarketDataset>(record, 'dataset', ['securities', 'daily_bars', 'trade_calendar', 'market_rows', 'market_boards', 'board_constituents', 'board_snapshot', 'board_detail', 'discovery_snapshot', 'stock_chip'] as const, 'market_rows');
    const warnings: string[] = [];
    try {
      switch (dataset) {
        case 'securities': {
          const rows = (await listSecurities()).slice(0, limit(record, 200, 2000));
          return localRows('duckdb:market', dataset, rows, warnings);
        }
        case 'daily_bars': {
          const symbol = optionalText(record, 'symbol');
          if (!symbol) return emptyLocal('duckdb:market', dataset, ['查询日 K 需要传入 symbol']);
          const rows = await listDailyBars(symbol, {
            startDate: optionalText(record, 'startDate'),
            endDate: optionalText(record, 'endDate'),
            limit: limit(record, 120, 500),
            adjustType: 'qfq',
          });
          return localRows('duckdb:market', dataset, rows, warnings);
        }
        case 'trade_calendar':
          return localRows('duckdb:market', dataset, await listTradeCalendar({
            market: optionalText(record, 'market'),
            startDate: optionalText(record, 'startDate'),
            endDate: optionalText(record, 'endDate'),
            limit: limit(record, 60, 500),
          }), warnings);
        case 'market_rows':
          return localRows('duckdb:market', dataset, (await listLatestMarketRows()).slice(0, limit(record, 100, 1000)), warnings);
        case 'market_boards':
          return localRows('duckdb:market', dataset, (await listMarketBoards()).slice(0, limit(record, 100, 1000)), warnings);
        case 'board_constituents': {
          const boardCode = optionalText(record, 'boardCode');
          if (!boardCode) return emptyLocal('duckdb:market', dataset, ['查询板块成分股需要传入 boardCode']);
          return localRows('duckdb:market', dataset, (await listBoardConstituents(boardCode)).slice(0, limit(record, 200, 1000)), warnings);
        }
        case 'board_snapshot': {
          const data = await readBoardSnapshot(optionalText(record, 'snapshotKey') ?? 'all');
          return localData('duckdb:market', dataset, data, warnings);
        }
        case 'board_detail': {
          const boardCode = optionalText(record, 'boardCode');
          if (!boardCode) return emptyLocal('duckdb:market', dataset, ['查询板块详情需要传入 boardCode']);
          return localData('duckdb:market', dataset, await readBoardDetail(boardCode), warnings);
        }
        case 'discovery_snapshot': {
          const data = await readDiscoverySnapshot(optionalText(record, 'snapshotKey') ?? 'default');
          return localData('duckdb:market', dataset, data, warnings);
        }
        case 'stock_chip': {
          const symbol = optionalText(record, 'symbol');
          if (!symbol) return localRows('duckdb:market', dataset, await listStockChips(limit(record, 200, 1000)), warnings);
          return localData('duckdb:market', dataset, await getStockChip(symbol), warnings);
        }
      }
    } catch (error) {
      return emptyLocal('duckdb:market', dataset, [`本地 market DuckDB 查询失败：${formatError(error)}`]);
    }
  },
};

export const queryLocalMonitorDuckDB: AgentTool<Record<string, unknown>, ILocalQueryOutput> = {
  name: 'queryLocalMonitorDuckDB',
  description: 'Query local stocksense-monitor DuckDB monitor history and category counts.',
  inputSchema: {
    type: 'object',
    properties: {
      date: { type: 'string' },
      categories: { type: 'array', items: { type: 'string' } },
      offset: { type: 'number' },
      limit: { type: 'number' },
      includeCounts: { type: 'boolean' },
    },
  },
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
      return {
        source: 'duckdb:monitor',
        storage: 'local',
        dataset: 'ai_monitor_events',
        rows,
        total: includeCounts ? await countMonitorHistory({ date, categories }) : undefined,
        counts: includeCounts ? await countMonitorHistoryByCategory({ date, categories }) : undefined,
        warnings: rows.length ? warnings : ['本地 monitor DuckDB 未查到符合条件的监控历史'],
        isEmpty: rows.length === 0,
      };
    } catch (error) {
      return emptyLocal('duckdb:monitor', 'ai_monitor_events', [`本地 monitor DuckDB 查询失败：${formatError(error)}`]);
    }
  },
};

export const queryLocalSurgeDuckDB: AgentTool<Record<string, unknown>, ILocalQueryOutput> = {
  name: 'queryLocalSurgeDuckDB',
  description: 'Query local stocksense-surge DuckDB stock_surge_events by date or stock code.',
  inputSchema: {
    type: 'object',
    properties: {
      date: { type: 'string' },
      code: { type: 'string' },
      tradeDates: { type: 'array', items: { type: 'string' } },
      keepDays: { type: 'number' },
      offset: { type: 'number' },
      limit: { type: 'number' },
      side: { type: 'string', enum: ['buy', 'sell', 'all'] },
      minHands: { type: 'number' },
    },
  },
  async run(input) {
    const record = asRecord(input);
    const code = optionalText(record, 'code');
    const date = optionalText(record, 'date');
    const orderFilter = buildSurgeOrderFilter(record);
    const warnings: string[] = [];
    try {
      if (code) {
        const tradeDates = stringArray(record, 'tradeDates');
        const allRows = tradeDates.length
          ? await listStockSurgeEventsByTradeDates(code, tradeDates)
          : await listRecentStockSurgeEvents(code, Math.max(1, Math.min(60, Math.floor(num(record, 'keepDays', 7)))));
        const rows = filterSurgeOrders(allRows, orderFilter).slice(0, limit(record, 100, 1000));
        const emptyWarnings = allRows.length
          ? ['本地 surge DuckDB 未查到符合手数/方向条件的该股票异动历史']
          : ['本地 surge DuckDB 未查到该股票异动历史'];
        return localRows('duckdb:surge', 'stock_surge_events', rows, rows.length ? warnings : emptyWarnings);
      }
      if (date) {
        const allRows = await listSurgeHistory(date, num(record, 'offset', 0), limit(record, 100, 1000));
        const rows = filterSurgeOrders(allRows, orderFilter);
        const emptyWarnings = allRows.length
          ? ['本地 surge DuckDB 未查到符合手数/方向条件的该日期异动历史']
          : ['本地 surge DuckDB 未查到该日期异动历史'];
        return localRows('duckdb:surge', 'stock_surge_events', rows, rows.length ? warnings : emptyWarnings);
      }
      if (isSurgeOrderFilterActive(orderFilter)) {
        const keepDays = Math.max(1, Math.min(30, Math.floor(num(record, 'keepDays', 7))));
        const dates = await listSurgeDates(keepDays);
        const allRows = (
          await Promise.all(dates.map((tradeDate) => listSurgeHistory(tradeDate, 0, 1000)))
        ).flat();
        const rows = filterSurgeOrders(allRows, orderFilter).slice(0, limit(record, 100, 1000));
        const emptyWarnings = dates.length
          ? ['本地 surge DuckDB 近期异动历史未查到符合手数/方向条件的样本']
          : ['本地 surge DuckDB 暂无异动历史日期'];
        return localRows('duckdb:surge', 'stock_surge_events', rows, rows.length ? warnings : emptyWarnings);
      }
      const dates = await listSurgeDates(limit(record, 7, 30));
      return { source: 'duckdb:surge', storage: 'local', dataset: 'stock_surge_events', dates, warnings: dates.length ? warnings : ['本地 surge DuckDB 暂无异动历史日期'], isEmpty: dates.length === 0 };
    } catch (error) {
      return emptyLocal('duckdb:surge', 'stock_surge_events', [`本地 surge DuckDB 查询失败：${formatError(error)}`]);
    }
  },
};

function localRows(source: ILocalQueryOutput['source'], dataset: string, rows: unknown[], warnings: string[]): ILocalQueryOutput {
  return { source, storage: 'local', dataset, rows, warnings, isEmpty: rows.length === 0 };
}

function localData(source: ILocalQueryOutput['source'], dataset: string, data: unknown, warnings: string[]): ILocalQueryOutput {
  return { source, storage: 'local', dataset, data, warnings, isEmpty: data === undefined || data === null };
}

function emptyLocal(source: ILocalQueryOutput['source'], dataset: string, warnings: string[]): ILocalQueryOutput {
  return { source, storage: 'local', dataset, rows: [], warnings, isEmpty: true };
}
