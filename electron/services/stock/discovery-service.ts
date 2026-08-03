import StockSDK from 'stock-sdk';
import { getMarketReview, scoreSentiment } from './market-review-service.js';
import {
  getBatchQuotes,
  getAllMarketQuoteRows,
  getMarketPageSnapshot,
  listRecentDragonTigerDays,
  listEastmoneySurgeByDate,
} from './stock-client.js';
import { listFavoriteStocks, getConfig } from '../config-store.js';
import { chatWithOpenAICompatible } from '../llm/openai-compatible-client.js';
import { listSurgeDates, listSurgeHistory } from './surge-history-store.js';
import {
  listBoardConstituents,
  listMarketBoards,
  readDiscoverySnapshot,
  writeDiscoverySnapshot,
  getStockChip,
} from '../market-data/market-data-store.js';
import { fetchMarketIndex, normalizeIndexDate } from './market-indices.js';
import { isRemoteTradingDay, previousRemoteTradingDay } from '../market-data/providers.js';
import { resolveTradingDate } from '../market-data/trade-date-resolver.js';
import { formatMoney } from './format.js';
import { buildMonthlyThemesFromHistoricalPools } from './discovery-monthly-themes.js';
import { mergeHotThemeLeaders, reconcileHotThemeWithLocalBoard } from './discovery-hot-themes.js';
import type { IHotThemeLeader } from './discovery-hot-themes.js';
import { selectLatestMainFundFlowYi, sumNorthFundFlowYi } from './discovery-market-summary.js';
import { getMonitorFeed } from './monitor-service.js';
import { getBoardDetail } from './board-detail.js';
import type {
  HotFocusItem,
  IChipDistributionResult,
  IMarketReviewHotTheme,
  IMarketReviewLeader,
  IMarketReviewMetric,
  IMarketReviewWatchItem,
  IMonitorEvent,
} from '../../../src/shared/types.js';

const sdk = new StockSDK({ timeout: 12_000, retry: { maxRetries: 1 } });
export const DISCOVERY_CACHE_TTL_MS = 60_000;
export const DISCOVERY_WAITING_930_MESSAGE = '数据9:30更新，请稍后';
const DISCOVERY_HISTORY_LOADING_MESSAGE = '该交易日暂无本地历史数据，正在后台同步';
const DISCOVERY_SNAPSHOT_KEY = 'default';
const DISCOVERY_TRADE_DATE_SNAPSHOT_PREFIX = 'trade-date:';
const DISCOVERY_RECENT_TRADE_DAYS = 20;
let discoveryRefreshPromise: Promise<IDiscoverySnapshot> | undefined;
let discoveryRefreshTimer: NodeJS.Timeout | undefined;
let lastDiscoveryRefreshStartedAt = 0;

type TStockItem = {
  code: string;
  name: string;
  price?: string;
  changePercent?: string;
  amount?: string;
  industry?: string;
};
type TRealtimeQuote = Awaited<ReturnType<typeof getBatchQuotes>>[number];
type TDailyDragonTigerGroup = Awaited<ReturnType<typeof listRecentDragonTigerDays>>[number];
type TDiscoveryDragonTigerItem = { code: string; name: string; changePercent?: number; netBuy: number; reason: string };
type TDiscoveryDragonTigerDay = {
  date: string;
  weekday: string;
  inst: TDiscoveryDragonTigerItem[];
  hot: TDiscoveryDragonTigerItem[];
  first: TDiscoveryDragonTigerItem[];
};

export interface IDiscoverySnapshotOptions {
  tradeDate?: string;
}

export interface IDiscoverySnapshot {
  tradeDate: string;
  generatedAt: string;
  // hero gauge
  score?: number;
  scoreLabel?: string;
  scoreVerdict?: string;
  scoreTrend?: number[];
  // legacy market summary (kept for backward compatibility)
  indices?: Array<{
    code: string;
    name: string;
    price?: number | string;
    changePercent?: number | string;
  }>;
  bullets?: string[];
  wealthMetrics?: Array<{ label: string; value: number | null; unit: string }>;
  // opportunity radar
  opportunityRadar?: IOpportunityRadar;
  // new AI market summary
  marketSummary?: IMarketSummary;
  // sentiment
  sentimentScore?: number | null;
  sentimentFactors?: Array<{ label: string; value: string | number }>;
  sentimentStocks?: { zt: TStockItem[]; dt: TStockItem[]; zb: TStockItem[] };
  consecutiveStocks?: TStockItem[];
  yesterdayZt?: TStockItem[];
  yesterdayLb?: TStockItem[];
  // leaders (limit-up review)
  leaders?: Array<{
    code: string;
    name: string;
    height?: number | null;
    amount?: number | null;
    concepts?: string[];
    changePercent?: number | null;
  }>;
  // hot themes (rotation)
  hotThemes?: Array<{
    code?: string | null;
    name: string;
    score?: number | null;
    changePercent?: number | null;
    limitUpCount?: number | null;
    reason?: string | null;
    leaderName?: string | null;
    leaderCode?: string | null;
    leaders?: Array<{ code: string; name: string; height?: number | null }>;
  }>;
  // limit up stocks
  limitUps?: Array<{
    code: string;
    name: string;
    height: string;
    reason: string;
    price?: number | string;
    changePercent?: number | null;
    turnoverRate?: number | null;
  }>;
  // dragon tiger
  dragonTiger?: {
    inst: TDiscoveryDragonTigerItem[];
    hot: TDiscoveryDragonTigerItem[];
    first: TDiscoveryDragonTigerItem[];
  };
  dragonTigerHistory?: TDiscoveryDragonTigerDay[];
  tradeDates?: Array<{ date: string; weekday: string }>;
  // tomorrow preview
  nextDayFocus?: Array<{ category: string; condition: string; baseline?: number | null }>;
  // watchlist
  watchlist?: Array<{ code: string; name: string }>;
  watchlistQuotes?: Array<{ code: string; name: string; price?: number | string; changePercent?: number | string }>;
  unavailableReason?: string;
}

export interface IOpportunityRadar {
  boards: IOpportunityRadarItem[];
  stocks: IOpportunityStockRadarItem[];
}

export interface IOpportunityStockRadarItem {
  code: string;
  name: string;
  reason: string;
  changePercent?: number | null;
  amount?: number | null;
  score: number;
}

export interface IMarketSummary {
  indices: Array<{ code: string; name: string; price: number; changePercent: number }>;
  mainFundFlow: number | null;
  northFundFlow: number | null;
  limitUp: number;
  limitDown: number;
  sentimentBar: number;
  sectors: ISectorSummary[];
  opportunityRadar: IOpportunityRadarItem[];
  monthlyThemes: IMonthlyThemeItem[];
  nextWeekSectors: INextWeekSector[];
}

export interface ISectorSummary {
  code: string;
  name: string;
  changePercent: number;
  mainNetInflow: number;
  amount?: number;
  topStockName?: string;
  topStockCode?: string;
}

export interface IOpportunityRadarItem {
  code: string;
  name: string;
  ratio: number;
  changePercent: number;
  mainNetInflow: number;
}

export interface IMonthlyThemeItem {
  week: string;
  theme: string;
  leader: { code: string; name: string } | null;
}

export interface INextWeekSector {
  code: string;
  name: string;
  score: number;
  reasoning: {
    fundFlow: string;
    news: string;
    policy: string;
    technical: string;
    rotation: string;
  };
}

type TSectorFlowIndicator = 'today';
export type TLocalBoardSummary = {
  code: string;
  name: string;
  kind?: string;
  changePercent: number;
  mainNetInflow: number;
  amount?: number;
  topStockName?: string;
  topStockCode?: string;
};

type TBoardAmountCacheEntry = { amount?: number; updatedAt: number; promise?: Promise<number | undefined> };
type TBoardMainNetInflowCacheEntry = { amountYi?: number; updatedAt: number; promise?: Promise<number | undefined> };
type TFundFlowRankRow = Awaited<ReturnType<typeof sdk.fundFlow.rank>>[number];
type TOpportunityStockCandidateInput = {
  code: string;
  name: string;
  title?: string;
  details?: string[];
  changePercent: number;
  amount?: number | null;
  marketCap?: number | string;
  concentration90?: number;
  includeChipReason?: boolean;
};
type TMainFundFlowRow = Awaited<ReturnType<typeof sdk.fundFlow.market>>[number];
type TConstituentCodeRow = { code?: string | null };
type TConstituentAmountRow = { amount?: string | number | null };
type TFundFlowMainRow = { code: string; mainNetInflow: number | null };

type TLocalBoardCatalog = {
  rows: TLocalBoardSummary[];
  byCode: Map<string, TLocalBoardSummary>;
  byName: Map<string, TLocalBoardSummary>;
};

const SECTOR_FLOW_CACHE_TTL_MS = 5 * 60 * 1000;
const BOARD_AMOUNT_CACHE_TTL_MS = 5 * 60 * 1000;
const BOARD_AMOUNT_FETCH_LIMIT = 12;
const BOARD_AMOUNT_FETCH_CONCURRENCY = 3;
const BOARD_MAIN_FLOW_FETCH_LIMIT = 12;
const BOARD_MAIN_FLOW_FETCH_CONCURRENCY = 3;
const BOARD_MAIN_FLOW_CACHE_TTL_MS = 5 * 60 * 1000;
const FUND_FLOW_RANK_CACHE_TTL_MS = 60 * 1000;
const MAIN_FUND_FLOW_CACHE_TTL_MS = 5 * 60 * 1000;
const OPPORTUNITY_STOCK_CHANGE_PERCENT_LIMIT = 4;
const OPPORTUNITY_STOCK_MIN_MARKET_CAP_YI = 20;
const OPPORTUNITY_STOCK_MAX_MARKET_CAP_YI = 200;
const OPPORTUNITY_STOCK_CHIP_CONCENTRATION90_LIMIT = 15;
const OPPORTUNITY_STOCK_DISPLAY_LIMIT = 20;
const OPPORTUNITY_STOCK_MIN_DISPLAY_COUNT = 10;
const DISCOVERY_OPTIONAL_TASK_TIMEOUT_MS = 8_000;
const sectorFlowRankCache = new Map<
  TSectorFlowIndicator,
  { rows: ISectorSummary[]; updatedAt: number; promise?: Promise<ISectorSummary[]> }
>();
const boardAmountCache = new Map<string, TBoardAmountCacheEntry>();
const boardMainNetInflowCache = new Map<string, TBoardMainNetInflowCacheEntry>();
let fundFlowRankCache:
  | { rows: TFundFlowRankRow[]; updatedAt: number; promise?: Promise<TFundFlowRankRow[]> }
  | undefined;
let mainFundFlowCache:
  | { rows: TMainFundFlowRow[]; updatedAt: number; promise?: Promise<TMainFundFlowRow[]> }
  | undefined;

function sumFundFlowRankRowsYi(rows: TFundFlowRankRow[]): number | null {
  let total = 0;
  let count = 0;
  for (const row of rows) {
    if (!finiteNumber(row.mainNetInflow)) continue;
    total += row.mainNetInflow;
    count += 1;
  }
  return count ? total / 100_000_000 : null;
}

export const sumFundFlowRankRowsYiForTest = sumFundFlowRankRowsYi;

export function resetDiscoveryFundFlowCachesForTest(): void {
  mainFundFlowCache = undefined;
  fundFlowRankCache = undefined;
}

function mapMetricToFactor(m: IMarketReviewMetric): { label: string; value: string | number } {
  if (m.value === null || m.value === undefined) return { label: m.label, value: '--' };
  return { label: m.label, value: `${m.value}${m.unit ?? ''}` };
}

function mapLeader(l: IMarketReviewLeader): NonNullable<IDiscoverySnapshot['leaders']>[number] {
  return {
    code: l.code,
    name: l.name,
    height: l.height,
    amount: l.amount,
    concepts: l.concepts,
    changePercent: l.changePercent,
  };
}

function mapTheme(t: IMarketReviewHotTheme): NonNullable<IDiscoverySnapshot['hotThemes']>[number] {
  return {
    code: t.boardCode,
    name: t.name,
    score: t.score,
    changePercent: t.changePercent,
    limitUpCount: t.limitUpCount,
    reason: t.reason,
    leaderName: t.leaderName,
    leaderCode: t.leaderCode,
    leaders: t.limitUpStocks?.slice(0, 3).map((s) => ({ code: s.code, name: s.name, height: s.height })),
  };
}

function mapFocusItem(item: IMarketReviewWatchItem): NonNullable<IDiscoverySnapshot['nextDayFocus']>[number] {
  return { category: item.category, condition: item.condition, baseline: item.baseline };
}

const DRAGON_TIGER_TAB_SIZE = 20;
type TDailyDragonTigerItem = Awaited<ReturnType<typeof listRecentDragonTigerDays>>[number]['items'][number];

function toDiscoveryDragonTigerItem(item: TDailyDragonTigerItem): TDiscoveryDragonTigerItem {
  return {
    code: item.code,
    name: item.name,
    changePercent: item.changePercent,
    netBuy: item.netBuy,
    reason: item.reason,
  };
}

function selectDragonTigerRows(
  items: TDailyDragonTigerItem[],
  isPreferred: (item: TDailyDragonTigerItem) => boolean,
): TDiscoveryDragonTigerItem[] {
  return items.filter(isPreferred).slice(0, DRAGON_TIGER_TAB_SIZE).map(toDiscoveryDragonTigerItem);
}

function selectDragonTigerNetBuyRows(items: TDailyDragonTigerItem[]): TDiscoveryDragonTigerItem[] {
  return [...items]
    .filter((item) => item.netBuy > 0)
    .sort((left, right) => right.netBuy - left.netBuy || left.code.localeCompare(right.code))
    .slice(0, DRAGON_TIGER_TAB_SIZE)
    .map(toDiscoveryDragonTigerItem);
}

function buildDiscoveryDragonTiger(items: TDailyDragonTigerItem[]): NonNullable<IDiscoverySnapshot['dragonTiger']> {
  return {
    inst: selectDragonTigerRows(items, (item) => /机构|专用|基金|券商|保险|QFII/.test(item.reason)),
    hot: selectDragonTigerNetBuyRows(items),
    first: selectDragonTigerRows(items, (item) => /首次|首榜|首板|一日|日涨幅偏离值/.test(item.reason)),
  };
}

function formatDragonTigerWeekday(date: string): string {
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const parsed = new Date(`${date}T00:00:00+08:00`);
  return weekdays[parsed.getDay()] ?? '';
}

function buildDiscoveryDragonTigerHistory(
  groups: Awaited<ReturnType<typeof listRecentDragonTigerDays>>,
): TDiscoveryDragonTigerDay[] {
  return groups.map((group) => ({
    date: group.date,
    weekday: formatDragonTigerWeekday(group.date),
    ...buildDiscoveryDragonTiger(group.items),
  }));
}

export const selectDragonTigerRowsForTest = selectDragonTigerRows;
export const buildDiscoveryDragonTigerForTest = buildDiscoveryDragonTiger;
export const buildDiscoveryDragonTigerHistoryForTest = buildDiscoveryDragonTigerHistory;

type TNextWeekSectorCandidate = { name?: string; score?: number; reasoning?: Partial<INextWeekSector['reasoning']> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function withOptionalTimeout<T>(
  label: string,
  promise: Promise<T>,
  timeoutMs = DISCOVERY_OPTIONAL_TASK_TIMEOUT_MS,
): Promise<T | undefined> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<undefined>((resolve) => {
    timeout = setTimeout(() => {
      console.warn(`[discovery] optional task timed out: ${label}`);
      resolve(undefined);
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function getStringField(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === 'string' && value ? value : undefined;
}

function formatDiscoveryDataError(error: unknown): string {
  const parts: string[] = [];
  if (error instanceof Error && error.message) parts.push(error.message);
  if (isRecord(error)) {
    const code = getStringField(error, 'code');
    const provider = getStringField(error, 'provider');
    if (code) parts.push(`code=${code}`);
    if (provider) parts.push(`provider=${provider}`);
    const cause = error.cause;
    if (isRecord(cause)) {
      const causeCode = getStringField(cause, 'code');
      if (causeCode) parts.push(`cause=${causeCode}`);
    }
  }
  return parts.length ? parts.join(' ') : String(error);
}

export const formatDiscoveryDataErrorForTest = formatDiscoveryDataError;
export const withOptionalTimeoutForTest = withOptionalTimeout;

function isDiscoverySnapshot(value: unknown): value is IDiscoverySnapshot {
  if (!isRecord(value)) return false;
  return typeof value.tradeDate === 'string' && typeof value.generatedAt === 'string';
}

function hasDragonTigerRows(snapshot: IDiscoverySnapshot): boolean {
  const dragonTiger = snapshot.dragonTiger;
  const hasCurrentRows = Boolean(
    dragonTiger &&
    Array.isArray(dragonTiger.inst) &&
    Array.isArray(dragonTiger.hot) &&
    Array.isArray(dragonTiger.first) &&
    (dragonTiger.inst.length > 0 || dragonTiger.hot.length > 0 || dragonTiger.first.length > 0),
  );
  return hasCurrentRows || Boolean(snapshot.dragonTigerHistory?.length);
}

export const hasDragonTigerRowsForTest = hasDragonTigerRows;

function hasOpportunityStockRadarRows(snapshot: IDiscoverySnapshot): boolean {
  return Boolean(snapshot.opportunityRadar?.stocks.length);
}

function hasSellSideOpportunityStockRadarRows(snapshot: IDiscoverySnapshot): boolean {
  return Boolean(snapshot.opportunityRadar?.stocks.some((item) => /卖出/.test(item.reason)));
}

function hasStaleChipFilteredOpportunityStockRadarRows(snapshot: IDiscoverySnapshot): boolean {
  const stocks = snapshot.opportunityRadar?.stocks ?? [];
  return stocks.length > 0 && stocks.length < OPPORTUNITY_STOCK_MIN_DISPLAY_COUNT && stocks.some((item) => /90%筹码集中度/.test(item.reason));
}

function shouldRefreshCachedDiscoverySnapshot(snapshot: IDiscoverySnapshot, currentTradeDate: string): boolean {
  return (
    snapshot.tradeDate !== currentTradeDate ||
    !hasDragonTigerRows(snapshot) ||
    !hasOpportunityStockRadarRows(snapshot) ||
    hasSellSideOpportunityStockRadarRows(snapshot) ||
    hasStaleChipFilteredOpportunityStockRadarRows(snapshot)
  );
}

export const shouldRefreshCachedDiscoverySnapshotForTest = shouldRefreshCachedDiscoverySnapshot;

function discoveryTradeDateSnapshotKey(tradeDate: string) {
  return `${DISCOVERY_TRADE_DATE_SNAPSHOT_PREFIX}${tradeDate}`;
}

function isIsoTradeDate(value?: string): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function emptyDiscoveryDragonTiger(): NonNullable<IDiscoverySnapshot['dragonTiger']> {
  return { inst: [], hot: [], first: [] };
}

function hasDragonTigerDayRows(day?: TDiscoveryDragonTigerDay): day is TDiscoveryDragonTigerDay {
  return Boolean(day && (day.inst.length > 0 || day.hot.length > 0 || day.first.length > 0));
}

function pickCurrentDragonTigerFromHistory(
  history: TDiscoveryDragonTigerDay[],
  tradeDate: string,
): NonNullable<IDiscoverySnapshot['dragonTiger']> {
  const currentDay = history.find((day) => day.date === tradeDate);
  if (currentDay) return { inst: currentDay.inst, hot: currentDay.hot, first: currentDay.first };
  const day = history.find(hasDragonTigerDayRows);
  if (!day) return emptyDiscoveryDragonTiger();
  return { inst: day.inst, hot: day.hot, first: day.first };
}

export const pickCurrentDragonTigerFromHistoryForTest = pickCurrentDragonTigerFromHistory;

function pickDragonTigerForTradeDate(
  snapshot: IDiscoverySnapshot,
  tradeDate: string,
): NonNullable<IDiscoverySnapshot['dragonTiger']> {
  const day =
    snapshot.tradeDate === tradeDate
      ? (snapshot.dragonTigerHistory?.find((item) => item.date === tradeDate) ?? snapshot.dragonTiger)
      : snapshot.dragonTigerHistory?.find((item) => item.date === tradeDate);
  if (!day) return emptyDiscoveryDragonTiger();
  return { inst: day.inst, hot: day.hot, first: day.first };
}

function withSelectedDiscoveryTradeDate(snapshot: IDiscoverySnapshot, tradeDate: string): IDiscoverySnapshot {
  return {
    ...snapshot,
    tradeDate,
    dragonTiger: pickDragonTigerForTradeDate(snapshot, tradeDate),
  };
}

export const withSelectedDiscoveryTradeDateForTest = withSelectedDiscoveryTradeDate;

function toCachedDiscoverySnapshot(value: unknown): IDiscoverySnapshot | undefined {
  return isDiscoverySnapshot(value) ? value : undefined;
}

function shouldRefreshDiscoverySnapshot(updatedAt?: string): boolean {
  if (!updatedAt) return true;
  const updatedAtMs = new Date(updatedAt).getTime();
  return !Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs >= DISCOVERY_CACHE_TTL_MS;
}

function formatShanghaiDateKey(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function shanghaiMinutesOfDay(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const hour = value('hour');
  const minute = value('minute');
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) throw new Error('无法解析北京时间');
  return hour * 60 + minute;
}

export async function shouldHoldDiscoverySnapshotUntil930(now = new Date()): Promise<boolean> {
  const today = formatShanghaiDateKey(now);
  const minutes = shanghaiMinutesOfDay(now);
  const isTradingDay = await isRemoteTradingDay(today);
  return isTradingDay && minutes >= 8 * 60 && minutes < 9 * 60 + 30;
}

export async function shouldDeferDiscoveryRefresh(now = new Date()): Promise<boolean> {
  const today = formatShanghaiDateKey(now);
  const minutes = shanghaiMinutesOfDay(now);
  const isTradingDay = await isRemoteTradingDay(today);
  return isTradingDay && minutes < 9 * 60 + 30;
}

async function buildDiscoveryWaitingSnapshot(now = new Date()): Promise<IDiscoverySnapshot> {
  const tradeDate = formatShanghaiDateKey(now);
  const tradeDates = (await listRecentTradingDates(tradeDate)).map(toTradeDateOption);
  return {
    tradeDate,
    generatedAt: now.toISOString(),
    tradeDates,
    unavailableReason: DISCOVERY_WAITING_930_MESSAGE,
  };
}

export const buildDiscoveryWaitingSnapshotForTest = buildDiscoveryWaitingSnapshot;

function buildDiscoveryHistoryLoadingSnapshot(tradeDate: string, now = new Date()): IDiscoverySnapshot {
  return {
    tradeDate,
    generatedAt: now.toISOString(),
    tradeDates: [{ date: tradeDate, weekday: formatDragonTigerWeekday(tradeDate) }],
    unavailableReason: DISCOVERY_HISTORY_LOADING_MESSAGE,
  };
}

export const buildDiscoveryHistoryLoadingSnapshotForTest = buildDiscoveryHistoryLoadingSnapshot;

function toTradeDateOption(date: string) {
  return { date, weekday: formatDragonTigerWeekday(date) };
}

async function listRecentTradingDates(endDate: string, limit = DISCOVERY_RECENT_TRADE_DAYS): Promise<string[]> {
  if (!isIsoTradeDate(endDate)) return [];
  const dates = [endDate];
  let current = endDate;
  while (dates.length < limit) {
    current = await previousRemoteTradingDay(current);
    if (!isIsoTradeDate(current) || dates.includes(current)) break;
    dates.push(current);
  }
  return dates;
}

function compactTradeDate(date: string) {
  return date.replaceAll('-', '');
}

function addQuoteCode(codes: Set<string>, code?: string) {
  if (code && /^\d{6}$/.test(code)) codes.add(code);
}

function collectRealtimeQuoteCodes(snapshot: IDiscoverySnapshot): string[] {
  const codes = new Set<string>();
  snapshot.watchlistQuotes?.forEach((item) => addQuoteCode(codes, item.code));
  snapshot.limitUps?.forEach((item) => addQuoteCode(codes, item.code));
  snapshot.sentimentStocks?.zt.forEach((item) => addQuoteCode(codes, item.code));
  snapshot.sentimentStocks?.dt.forEach((item) => addQuoteCode(codes, item.code));
  snapshot.sentimentStocks?.zb.forEach((item) => addQuoteCode(codes, item.code));
  snapshot.consecutiveStocks?.forEach((item) => addQuoteCode(codes, item.code));
  snapshot.yesterdayZt?.forEach((item) => addQuoteCode(codes, item.code));
  snapshot.yesterdayLb?.forEach((item) => addQuoteCode(codes, item.code));
  snapshot.leaders?.forEach((item) => addQuoteCode(codes, item.code));
  return Array.from(codes);
}

function patchStockItemQuote<
  T extends { code: string; price?: number | string; changePercent?: number | string | null; industry?: string },
>(item: T, quoteByCode: Map<string, TRealtimeQuote>): T {
  const quote = quoteByCode.get(item.code);
  if (!quote) return item;
  const changePercent = parseChgPct(quote.changePercent);
  return {
    ...item,
    price: quote.price ?? item.price,
    changePercent: changePercent ?? item.changePercent,
    industry: item.industry ?? quote.industry,
  };
}

async function withRealtimeQuoteFields(snapshot: IDiscoverySnapshot): Promise<IDiscoverySnapshot> {
  const [indicesResult, stockQuotesResult] = await Promise.allSettled([
    fetchAllIndices(),
    (async () => {
      const codes = collectRealtimeQuoteCodes(snapshot);
      return codes.length ? getBatchQuotes(codes) : [];
    })(),
  ]);

  const realtimeIndices = indicesResult.status === 'fulfilled' ? indicesResult.value : undefined;
  if (indicesResult.status === 'rejected')
    console.warn('[discovery] failed to refresh cached index quotes', indicesResult.reason);
  if (stockQuotesResult.status === 'rejected')
    console.warn('[discovery] failed to refresh cached stock quotes', stockQuotesResult.reason);

  const quoteByCode = new Map(
    (stockQuotesResult.status === 'fulfilled' ? stockQuotesResult.value : []).map((quote) => [quote.code, quote]),
  );

  const next: IDiscoverySnapshot = {
    ...snapshot,
    indices: snapshot.indices,
    marketSummary: snapshot.marketSummary,
  };

  if (realtimeIndices?.length) {
    const indexByCode = new Map(realtimeIndices.map((item) => [item.code, item]));
    next.indices = snapshot.indices?.map((item) => {
      const realtime = indexByCode.get(item.code);
      return realtime ? { ...item, price: realtime.price, changePercent: realtime.changePercent } : item;
    });
    if (snapshot.marketSummary) {
      next.marketSummary = {
        ...snapshot.marketSummary,
        indices: snapshot.marketSummary.indices.map((item) => {
          const realtime = indexByCode.get(item.code);
          return realtime ? { ...item, price: realtime.price, changePercent: realtime.changePercent } : item;
        }),
      };
    }
  }

  if (quoteByCode.size) {
    next.watchlistQuotes = snapshot.watchlistQuotes?.map((item) => patchStockItemQuote(item, quoteByCode));
    next.limitUps = snapshot.limitUps?.map((item) => patchStockItemQuote(item, quoteByCode));
    next.sentimentStocks = snapshot.sentimentStocks
      ? {
          zt: snapshot.sentimentStocks.zt.map((item) => patchStockItemQuote(item, quoteByCode)),
          dt: snapshot.sentimentStocks.dt.map((item) => patchStockItemQuote(item, quoteByCode)),
          zb: snapshot.sentimentStocks.zb.map((item) => patchStockItemQuote(item, quoteByCode)),
        }
      : undefined;
    next.consecutiveStocks = snapshot.consecutiveStocks?.map((item) => patchStockItemQuote(item, quoteByCode));
    next.yesterdayZt = snapshot.yesterdayZt?.map((item) => patchStockItemQuote(item, quoteByCode));
    next.yesterdayLb = snapshot.yesterdayLb?.map((item) => patchStockItemQuote(item, quoteByCode));
    next.leaders = snapshot.leaders?.map((item) => patchStockItemQuote(item, quoteByCode));
  }

  return next;
}

interface IDiscoverySnapshotBuildResult {
  snapshot: IDiscoverySnapshot;
  historicalSnapshots: IDiscoverySnapshot[];
}

async function writeDiscoverySnapshotCaches(
  snapshot: IDiscoverySnapshot,
  historicalSnapshots: IDiscoverySnapshot[] = [],
) {
  await writeDiscoverySnapshot({ snapshot: { ...snapshot }, updatedAt: snapshot.generatedAt }, DISCOVERY_SNAPSHOT_KEY);
  if (isIsoTradeDate(snapshot.tradeDate)) {
    await writeDiscoverySnapshot(
      { snapshot: { ...snapshot }, updatedAt: snapshot.generatedAt },
      discoveryTradeDateSnapshotKey(snapshot.tradeDate),
    );
  }
  for (const historicalSnapshot of historicalSnapshots) {
    if (!isIsoTradeDate(historicalSnapshot.tradeDate) || historicalSnapshot.tradeDate === snapshot.tradeDate) continue;
    await writeDiscoverySnapshot(
      { snapshot: historicalSnapshot, updatedAt: historicalSnapshot.generatedAt },
      discoveryTradeDateSnapshotKey(historicalSnapshot.tradeDate),
    );
  }
  const historicalDates = new Set(historicalSnapshots.map((item) => item.tradeDate));
  for (const day of snapshot.dragonTigerHistory?.slice(0, DISCOVERY_RECENT_TRADE_DAYS) ?? []) {
    if (!isIsoTradeDate(day.date) || day.date === snapshot.tradeDate || historicalDates.has(day.date)) continue;
    const selected = withSelectedDiscoveryTradeDate(snapshot, day.date);
    await writeDiscoverySnapshot(
      { snapshot: selected, updatedAt: snapshot.generatedAt },
      discoveryTradeDateSnapshotKey(day.date),
    );
  }
}

export const writeDiscoverySnapshotCachesForTest = writeDiscoverySnapshotCaches;

function refreshDiscoverySnapshot(): Promise<IDiscoverySnapshot> {
  if (discoveryRefreshPromise) return discoveryRefreshPromise;
  lastDiscoveryRefreshStartedAt = Date.now();
  discoveryRefreshPromise = buildDiscoverySnapshotFresh()
    .then(async ({ snapshot, historicalSnapshots }) => {
      await writeDiscoverySnapshotCaches(snapshot, historicalSnapshots);
      return snapshot;
    })
    .finally(() => {
      discoveryRefreshPromise = undefined;
    });
  return discoveryRefreshPromise;
}

export function ensureRecentDiscoverySnapshots(): Promise<IDiscoverySnapshot> {
  return refreshDiscoverySnapshot();
}

async function triggerDiscoveryRefresh() {
  if (await shouldDeferDiscoveryRefresh()) return;
  void refreshDiscoverySnapshot().catch((error) => console.warn('[discovery] background refresh failed', error));
}

function ensureDiscoveryRefreshLoop() {
  if (discoveryRefreshTimer) return;
  discoveryRefreshTimer = setInterval(() => {
    if (Date.now() - lastDiscoveryRefreshStartedAt >= DISCOVERY_CACHE_TTL_MS) triggerDiscoveryRefresh();
  }, DISCOVERY_CACHE_TTL_MS);
}

export function stopDiscoveryRefreshLoop() {
  if (!discoveryRefreshTimer) return;
  clearInterval(discoveryRefreshTimer);
  discoveryRefreshTimer = undefined;
}

export async function getDiscoverySnapshot(options: IDiscoverySnapshotOptions = {}): Promise<IDiscoverySnapshot> {
  ensureDiscoveryRefreshLoop();
  const requestedTradeDate = isIsoTradeDate(options.tradeDate) ? options.tradeDate : undefined;

  if (requestedTradeDate) {
    const cachedForDate = await readDiscoverySnapshot(discoveryTradeDateSnapshotKey(requestedTradeDate));
    const cachedDateSnapshot = cachedForDate ? toCachedDiscoverySnapshot(cachedForDate.snapshot) : undefined;
    if (cachedDateSnapshot) return withRealtimeQuoteFields(cachedDateSnapshot);

    if (await shouldDeferDiscoveryRefresh()) return buildDiscoveryHistoryLoadingSnapshot(requestedTradeDate);

    await refreshDiscoverySnapshot();
    const refreshedCache = await readDiscoverySnapshot(discoveryTradeDateSnapshotKey(requestedTradeDate));
    const refreshedSnapshot = refreshedCache ? toCachedDiscoverySnapshot(refreshedCache.snapshot) : undefined;
    if (refreshedSnapshot) return withRealtimeQuoteFields(refreshedSnapshot);

    return buildDiscoveryHistoryLoadingSnapshot(requestedTradeDate);
  }

  if (await shouldHoldDiscoverySnapshotUntil930()) return buildDiscoveryWaitingSnapshot();

  const cached = await readDiscoverySnapshot(DISCOVERY_SNAPSHOT_KEY);
  const cachedSnapshot = cached ? toCachedDiscoverySnapshot(cached.snapshot) : undefined;

  if (cachedSnapshot && cached) {
    const currentTradeDate = await resolveTradingDate(9 * 60 + 30);
    if (
      shouldRefreshCachedDiscoverySnapshot(cachedSnapshot, currentTradeDate) &&
      !(await shouldDeferDiscoveryRefresh())
    ) {
      const snapshot = await refreshDiscoverySnapshot();
      return withRealtimeQuoteFields(snapshot);
    }
    if (shouldRefreshDiscoverySnapshot(cached.updatedAt) && !discoveryRefreshPromise) void triggerDiscoveryRefresh();
    return withRealtimeQuoteFields(cachedSnapshot);
  }

  if (await shouldDeferDiscoveryRefresh()) return buildDiscoveryWaitingSnapshot();

  const snapshot = await refreshDiscoverySnapshot();
  return withRealtimeQuoteFields(snapshot);
}

function parseJsonArray<T>(text: string, isItem: (value: unknown) => value is T): T[] {
  const parsed: unknown = JSON.parse(text);
  return Array.isArray(parsed) ? parsed.filter(isItem) : [];
}

function isNextWeekSectorCandidate(value: unknown): value is TNextWeekSectorCandidate {
  return isRecord(value);
}

export function normalizeBoardLookupName(name: string) {
  return name.replace(/行业|板块|Ⅱ|Ⅲ|III|II|\s/g, '');
}

export function buildLocalBoardCatalog(rows: TLocalBoardSummary[]): TLocalBoardCatalog {
  const byCode = new Map<string, TLocalBoardSummary>();
  const byName = new Map<string, TLocalBoardSummary>();
  for (const row of rows) {
    byCode.set(row.code, row);
    byName.set(row.name, row);
    byName.set(normalizeBoardLookupName(row.name), row);
  }
  return { rows, byCode, byName };
}

function boardNameOverlap(left: string, right: string): number {
  const leftName = normalizeBoardLookupName(left);
  const rightName = normalizeBoardLookupName(right);
  if (leftName.length < 2 || rightName.length < 2) return 0;
  const grams = new Set<string>();
  for (let index = 0; index < leftName.length - 1; index += 1) {
    grams.add(leftName.slice(index, index + 2));
  }
  let overlap = 0;
  for (let index = 0; index < rightName.length - 1; index += 1) {
    if (grams.has(rightName.slice(index, index + 2))) overlap += 1;
  }
  return overlap;
}

export function findLocalBoard(catalog: TLocalBoardCatalog, input: { code?: string; name?: string }) {
  if (input.code) {
    const byCode = catalog.byCode.get(input.code);
    if (byCode) return byCode;
  }
  const name = input.name?.trim();
  if (!name) return undefined;
  const normalized = normalizeBoardLookupName(name);
  const direct =
    catalog.byName.get(name) ??
    catalog.byName.get(normalized) ??
    catalog.rows.find((row) => {
      const rowName = normalizeBoardLookupName(row.name);
      return rowName.includes(normalized) || normalized.includes(rowName);
    });
  if (direct) return direct;

  const fuzzy = catalog.rows
    .map((row) => ({ row, overlap: boardNameOverlap(row.name, name) }))
    .filter((item) => item.overlap >= 2)
    .sort((a, b) => b.overlap - a.overlap)[0];
  return fuzzy?.row;
}

function formatMonthlyWeekLabel(index: number): string {
  return `第${index + 1}周`;
}

function isFinalWeekOfMonth(date: Date): boolean {
  const nextWeek = new Date(date);
  nextWeek.setDate(nextWeek.getDate() + 7);
  return nextWeek.getMonth() !== date.getMonth();
}

function shanghaiDateParts(now = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const year = Number(value('year'));
  const month = Number(value('month'));
  const day = Number(value('day'));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error('无法解析北京时间');
  }
  return { year, month, day };
}

function toDateKey(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

function buildCompletedMonthWeeks(now = new Date()): Array<{ label: string; dates: string[] }> {
  const { year, month, day } = shanghaiDateParts(now);
  const today = new Date(year, month - 1, day);
  const weeks: Array<{ label: string; dates: string[] }> = [];
  let startDay = 1;
  let weekIndex = 0;

  while (weekIndex < 4) {
    const start = new Date(year, month - 1, startDay);
    if (start.getMonth() !== month - 1) break;
    const end = new Date(year, month - 1, startDay + 6);
    const isCompleted = end < today || (weekIndex === 3 && isFinalWeekOfMonth(today));
    if (!isCompleted) break;

    const dates: string[] = [];
    const cursor = new Date(start);
    while (cursor <= end && cursor.getMonth() === month - 1) {
      dates.push(toDateKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push({ label: formatMonthlyWeekLabel(weekIndex), dates });
    startDay += 7;
    weekIndex += 1;
  }

  return weeks;
}

async function fetchCompletedMonthWeekPools(
  boardCatalog: TLocalBoardCatalog,
  now = new Date(),
): Promise<IMonthlyThemeItem[]> {
  const weeks = buildCompletedMonthWeeks(now);
  if (!weeks.length) return [];

  const rows = await Promise.all(
    weeks.map(async (week) => {
      const items = (await Promise.all(week.dates.map((date) => listEastmoneySurgeByDate(date)))).flat();
      return { ...week, items };
    }),
  );

  return buildMonthlyThemesFromHistoricalPools(rows, boardCatalog.rows);
}

function reconcileSectorsWithLocalBoards(sectors: ISectorSummary[], catalog: TLocalBoardCatalog): ISectorSummary[] {
  if (!catalog.rows.length) return [];
  const matched = sectors
    .map((sector) => {
      const local = findLocalBoard(catalog, sector);
      if (!local) return undefined;
      const merged: ISectorSummary = {
        ...sector,
        code: local.code,
        name: local.name,
        changePercent: local.changePercent,
      };
      if (local.amount !== undefined) merged.amount = local.amount;
      return merged;
    })
    .filter((sector): sector is ISectorSummary => Boolean(sector));
  if (matched.length) return matched;
  return catalog.rows.slice(0, 30);
}

export const reconcileSectorsWithLocalBoardsForTest = reconcileSectorsWithLocalBoards;

function toStockItem(item: HotFocusItem): TStockItem {
  return {
    code: item.code ?? '',
    name: item.name ?? item.title,
    price: item.price !== undefined ? String(item.price) : undefined,
    changePercent: item.changePercent !== undefined ? String(item.changePercent) : undefined,
    amount: item.amount !== undefined ? String(item.amount) : undefined,
    industry: parseStockItemIndustry(item.description),
  };
}

function parseStockItemIndustry(description?: string): string | undefined {
  const industry = description?.split('·')[0]?.trim();
  if (!industry || /连板|换手|封单|成交额|开板|封涨停板|封跌停板|涨停开板/.test(industry)) return undefined;
  return industry;
}

interface IResolvedYesterdaySentimentPools {
  date?: string;
  zt: TStockItem[];
  lb: TStockItem[];
}

function resolveYesterdaySentimentPools(
  recentTradeDates: string[],
  historicalPoolItems: HotFocusItem[][],
  currentTradeDate: string,
): IResolvedYesterdaySentimentPools {
  for (const [index, date] of recentTradeDates.entries()) {
    if (date === currentTradeDate) continue;
    const poolItems = historicalPoolItems[index] ?? [];
    const limitUps = poolItems.filter((item) => item.tag === '封涨停板');
    if (!limitUps.length) continue;

    return {
      date,
      zt: limitUps.map(toStockItem),
      lb: limitUps.filter((item) => parseHeight(item.description) >= 2).map(toStockItem),
    };
  }

  return { zt: [], lb: [] };
}

export const resolveYesterdaySentimentPoolsForTest = resolveYesterdaySentimentPools;

function getLimitDownThresholdPercent(code: string): number {
  const normalizedCode = code.replace(/^(sh|sz|bj)/i, '');
  return normalizedCode.startsWith('300') ? 19.8 : 9.8;
}

function toLimitDownStockItem(row: Awaited<ReturnType<typeof getAllMarketQuoteRows>>[number]): TStockItem | undefined {
  if (!row.code || !row.name) return undefined;
  const changePercent = parseChgPct(row.changePercent);
  if (changePercent === undefined || changePercent > -getLimitDownThresholdPercent(row.code)) return undefined;
  return {
    code: row.code,
    name: row.name,
    price: row.price !== undefined ? String(row.price) : undefined,
    changePercent: String(changePercent),
    amount: row.amount !== undefined ? formatMoney(row.amount) : undefined,
    industry: row.industry,
  };
}

export const toLimitDownStockItemForTest = toLimitDownStockItem;

async function listLimitDownStocksFromQuotes(): Promise<TStockItem[]> {
  const rows = await getAllMarketQuoteRows();
  const stocks = rows
    .map(toLimitDownStockItem)
    .filter((item): item is TStockItem => Boolean(item))
    .sort((a, b) => (parseChgPct(a.changePercent) ?? 0) - (parseChgPct(b.changePercent) ?? 0));
  return stocks;
}

/** Parse 连板 count from description like "6连板·换手3.2%·封单2.5亿..." */
function parseHeight(desc?: string): number {
  if (!desc) return 1;
  const match = desc.match(/(\d+)连板/);
  return match ? Number(match[1]) : 1;
}

// ponytail: changePercent from getBatchQuotes can be a string like "+1.23%", "1.23%", or a plain number.
// Parse it to a number for the frontend so Number().toFixed() doesn't produce NaN.
function parseChgPct(value?: number | string): number | undefined {
  if (value === undefined || value === null || value === '--') return undefined;
  const num = typeof value === 'string' ? Number(String(value).replace('%', '')) : Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function normalizeThemeName(name?: string | null): string {
  if (!name) return '';
  return name.replace(/行业|板块|Ⅱ|Ⅲ|II|III|\s/g, '').toLowerCase();
}

function themeMatches(themeName: string, text?: string | null): boolean {
  if (!text) return false;
  const normalized = normalizeThemeName(themeName);
  if (!normalized) return false;
  const haystack = normalizeThemeName(text);
  return haystack.includes(normalized);
}

function findLeadersFromPool(
  themeName: string,
  poolItems: HotFocusItem[],
): Array<{ code: string; name: string; height: number }> {
  const matches = poolItems
    .filter((item) => item.tag === '封涨停板' && themeMatches(themeName, item.description))
    .map((item) => ({
      code: item.code ?? '',
      name: item.name ?? item.title,
      height: parseHeight(item.description),
      changePercent: parseChgPct(item.changePercent) ?? 0,
    }))
    .filter((item) => item.code && item.name)
    .sort((a, b) => b.height - a.height || b.changePercent - a.changePercent);

  const unique: typeof matches = [];
  for (const item of matches) {
    if (!unique.some((u) => u.code === item.code)) unique.push(item);
    if (unique.length >= 3) break;
  }
  return unique;
}

function scoreLabel(s: number): string {
  if (s >= 80) return '积极 · 机会较多';
  if (s >= 60) return '偏积极 · 可关注';
  if (s >= 40) return '中性 · 观望为主';
  if (s >= 20) return '偏谨慎 · 控制仓位';
  return '谨慎 · 风险较高';
}

async function buildScoreTrend(currentTradeDate: string, currentScore: number): Promise<number[]> {
  try {
    const dates = await listSurgeDates(7);
    if (!dates.length) return [currentScore];

    const trend: number[] = [];
    for (const date of dates.slice().reverse()) {
      if (date === currentTradeDate) {
        trend.push(currentScore);
        continue;
      }
      const items = await listSurgeHistory(date, 0, 1000);
      let zt = 0;
      let dt = 0;
      let broken = 0;
      for (const item of items) {
        const tag = item.tag ?? '';
        if (tag.includes('涨停') && !tag.includes('炸板') && !tag.includes('跌停') && !tag.includes('开板')) {
          zt += 1;
        } else if (tag.includes('跌停')) {
          dt += 1;
        } else if (tag.includes('炸板') || tag.includes('开板')) {
          broken += 1;
        }
      }
      const historicalScore = scoreSentiment(0, 0, zt, dt, broken) ?? currentScore;
      trend.push(historicalScore);
    }

    // Ensure the trend ends with today's score even if the DB does not yet contain today.
    if (trend[trend.length - 1] !== currentScore) {
      trend.push(currentScore);
    }

    return trend.slice(-7);
  } catch (error) {
    console.warn('[discovery] build score trend failed', error);
    return [currentScore];
  }
}

async function generateOneSentenceVerdict(
  reviewData: Awaited<ReturnType<typeof getMarketReview>>,
  score: number,
  scoreChange: number,
): Promise<string> {
  try {
    const cfg = getConfig();
    const sentimentLines =
      reviewData.sentiment
        ?.map(
          (m) => `${m.label}：${m.value === null || m.value === undefined ? '暂无数据' : `${m.value}${m.unit ?? ''}`}`,
        )
        .join('\n') ?? '暂无数据';
    const wealthLines =
      reviewData.wealthEffect
        ?.map(
          (m) => `${m.label}：${m.value === null || m.value === undefined ? '暂无数据' : `${m.value}${m.unit ?? ''}`}`,
        )
        .join('\n') ?? '暂无数据';
    const hotThemes =
      reviewData.hotThemes
        ?.slice(0, 5)
        .map((t) => `${t.name}（涨停${t.limitUpCount ?? '--'}家${t.leaderName ? `，龙头${t.leaderName}` : ''}）`)
        .join('、') ?? '暂无数据';

    const messages = [
      {
        role: 'system' as const,
        content:
          '你是专业 A 股盘后复盘分析师。仅可使用用户消息中的真实数据，严禁编造任何数值、板块或股票。用一句话（不超过 80 字）概括当日市场情绪与机会，要求包含具体数据、热点方向，并给出可操作观察建议。不要分段，不要输出 Markdown。',
      },
      {
        role: 'user' as const,
        content: `日期：${reviewData.tradeDate}
今日机会分：${score}（较昨日 ${scoreChange >= 0 ? '+' : ''}${scoreChange}）
市场情绪：\n${sentimentLines}
赚钱效应：\n${wealthLines}
热点板块：${hotThemes}

请输出一句话研判：`,
      },
    ];

    const verdict = await chatWithOpenAICompatible(cfg.model, messages);
    return verdict.trim() || scoreLabel(score);
  } catch (error) {
    console.warn('[discovery] generate one-sentence verdict failed', error);
    return scoreLabel(score);
  }
}

// ═══════════════════════════════════════════════════════════════
//  Market Summary — real data + AI analysis
// ═══════════════════════════════════════════════════════════════

function indexCodeToName(code: string): string {
  if (code === 'sh000001') return '上证指数';
  if (code === 'sz399001') return '深证成指';
  if (code === 'sz399006') return '创业板指';
  if (code === 'bj899050') return '北证50';
  return code;
}

async function fetchAllIndices(): Promise<Array<{ code: string; name: string; price: number; changePercent: number }>> {
  const codes = ['sh000001', 'sz399001', 'sz399006', 'bj899050'];
  const results = await Promise.all(
    codes.map(async (code) => {
      try {
        const snapshot = await fetchMarketIndex(code, '1d', 1);
        if (!snapshot || typeof snapshot.price !== 'number') return undefined;
        return {
          code,
          name: indexCodeToName(code),
          price: Number(snapshot.price),
          changePercent: Number(snapshot.changePercent ?? 0),
        };
      } catch (err) {
        console.warn(`[discovery] failed to fetch index ${code}`, err);
        return undefined;
      }
    }),
  );
  return results.filter((item): item is NonNullable<typeof item> => Boolean(item));
}

async function fetchMainFundFlowRows(): Promise<TMainFundFlowRow[]> {
  const now = Date.now();
  if (mainFundFlowCache && now - mainFundFlowCache.updatedAt < MAIN_FUND_FLOW_CACHE_TTL_MS) {
    return mainFundFlowCache.rows;
  }
  if (mainFundFlowCache?.promise) return mainFundFlowCache.promise;

  const previousCache = mainFundFlowCache;
  const promise = sdk.fundFlow
    .market()
    .then((rows) => {
      mainFundFlowCache = { rows, updatedAt: Date.now() };
      return rows;
    })
    .catch((error) => {
      mainFundFlowCache = previousCache?.rows.length
        ? { rows: previousCache.rows, updatedAt: previousCache.updatedAt }
        : undefined;
      throw error;
    });
  mainFundFlowCache = { rows: previousCache?.rows ?? [], updatedAt: previousCache?.updatedAt ?? 0, promise };
  return promise;
}

async function fetchMainFundFlow(tradeDate?: string): Promise<number | null> {
  try {
    const rows = await fetchMainFundFlowRows();
    return selectLatestMainFundFlowYi(rows, tradeDate);
  } catch (err) {
    console.warn(`[discovery] main fund flow unavailable: ${formatDiscoveryDataError(err)}`);
    try {
      return sumFundFlowRankRowsYi(await fetchFundFlowRankRows());
    } catch (rankErr) {
      console.warn(`[discovery] main fund flow rank fallback unavailable: ${formatDiscoveryDataError(rankErr)}`);
      return null;
    }
  }
}

export const fetchMainFundFlowForTest = fetchMainFundFlow;

async function fetchNorthFundFlow(tradeDate?: string): Promise<number | null> {
  try {
    const rows = await sdk.northbound.summary();
    return sumNorthFundFlowYi(rows, tradeDate);
  } catch (err) {
    console.warn(`[discovery] north fund flow unavailable: ${formatDiscoveryDataError(err)}`);
    return null;
  }
}

async function fetchLocalBoardCatalog(): Promise<TLocalBoardCatalog> {
  try {
    const rows = await listMarketBoards();
    const summaries = rows
      .map((row) => ({
        code: row.code,
        name: row.name,
        kind: row.kind,
        changePercent: row.changePercent ?? 0,
        mainNetInflow: 0,
        amount: row.amount,
      }))
      .filter((row) => row.code && row.name);
    return buildLocalBoardCatalog(summaries);
  } catch {
    return buildLocalBoardCatalog([]);
  }
}

function finitePositive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function finiteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function finiteStockChangePercent(value: number | string | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  const numeric = typeof value === 'number' ? value : Number(value.replace('%', '').replace('+', ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function numericStringValue(value: string | number | null | undefined): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const parsed = Number(value.replaceAll(',', '').replace('%', '').replace('+', '').trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseMarketCapYi(value: number | string | null | undefined): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    return value > 100_000 ? value / 100_000_000 : value;
  }
  const text = value.replaceAll(',', '').trim();
  if (!text || text === '--') return undefined;
  const parsed = Number(text.replace(/万亿|亿|万/g, ''));
  if (!Number.isFinite(parsed)) return undefined;
  if (text.includes('万亿')) return parsed * 10_000;
  if (text.includes('亿')) return parsed;
  if (text.includes('万')) return parsed / 10_000;
  return parsed > 100_000 ? parsed / 100_000_000 : parsed;
}

function ratioPercent(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.abs(value) <= 1 ? value * 100 : value;
}

function isChipDistributionResult(value: unknown): value is IChipDistributionResult {
  if (!isRecord(value)) return false;
  return Array.isArray(value.distributions) && Array.isArray(value.trend) && typeof value.source === 'string';
}

async function getCachedChipConcentration90Percent(code: string): Promise<number | undefined> {
  const cached = await getStockChip(code).catch(() => undefined);
  if (!isChipDistributionResult(cached)) return undefined;
  return ratioPercent(cached.latest?.concentration90);
}

function normalizeStockCode(code?: string | null): string | undefined {
  const normalized = code?.replace(/^(sh|sz|bj)/i, '').trim();
  return normalized && /^\d{6}$/.test(normalized) ? normalized : undefined;
}

function sumConstituentMainNetInflowYi(
  constituents: TConstituentCodeRow[],
  fundFlows: TFundFlowMainRow[],
): number | undefined {
  const constituentCodes = new Set(
    constituents.map((item) => normalizeStockCode(item.code)).filter((code): code is string => Boolean(code)),
  );
  if (!constituentCodes.size) return undefined;

  const total = fundFlows.reduce(
    (sum, row) => {
      const code = normalizeStockCode(row.code);
      if (!code || !constituentCodes.has(code) || !finiteNumber(row.mainNetInflow)) return sum;
      return { value: sum.value + row.mainNetInflow, count: sum.count + 1 };
    },
    { value: 0, count: 0 },
  );

  return total.count ? total.value / 100_000_000 : undefined;
}

export const sumConstituentMainNetInflowYiForTest = sumConstituentMainNetInflowYi;

function parseMoneyTextToYuan(value: string | number | null | undefined): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') return finitePositive(value) ? value : undefined;

  const text = value.replaceAll(',', '').trim();
  if (!text || text === '--') return undefined;

  const sign = text.startsWith('-') ? -1 : 1;
  const numeric = Number(text.replace(/^[-+]/, '').replace(/万亿|亿|万/g, ''));
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  if (text.includes('万亿')) return sign * numeric * 1_000_000_000_000;
  if (text.includes('亿')) return sign * numeric * 100_000_000;
  if (text.includes('万')) return sign * numeric * 10_000;
  return sign * numeric;
}

function sumBoardConstituentAmounts(constituents: TConstituentAmountRow[]): number | undefined {
  const total = constituents.reduce(
    (sum, row) => {
      const amount = parseMoneyTextToYuan(row.amount);
      if (amount === undefined) return sum;
      return { value: sum.value + amount, count: sum.count + 1 };
    },
    { value: 0, count: 0 },
  );
  return total.count ? total.value : undefined;
}

export const parseMoneyTextToYuanForTest = parseMoneyTextToYuan;
export const sumBoardConstituentAmountsForTest = sumBoardConstituentAmounts;

function boardAmountApis(kind?: string) {
  return kind === 'concept' ? [sdk.board.concept, sdk.board.industry] : [sdk.board.industry, sdk.board.concept];
}

async function fetchBoardAmountFromRemote(board: TLocalBoardSummary): Promise<number | undefined> {
  try {
    const detail = await getBoardDetail(board.code, false, board.name);
    const amount = sumBoardConstituentAmounts(detail.constituents ?? []);
    if (amount !== undefined) return amount;
  } catch {
    // Fall through to stock-sdk real board constituent providers; keep missing amount explicit if all fail.
  }

  for (const api of boardAmountApis(board.kind)) {
    try {
      const constituents = await api.constituents(board.code);
      const amount = sumBoardConstituentAmounts(constituents);
      if (amount !== undefined) return amount;
    } catch {
      // Try the other real board namespace; keep missing amount explicit if both fail.
    }
  }
  return undefined;
}

async function fetchBoardAmount(board: TLocalBoardSummary): Promise<number | undefined> {
  const cached = boardAmountCache.get(board.code);
  const now = Date.now();
  if (cached && now - cached.updatedAt < BOARD_AMOUNT_CACHE_TTL_MS) return cached.amount;
  if (cached?.promise) return cached.promise;

  const promise = fetchBoardAmountFromRemote(board).then((amount) => {
    boardAmountCache.set(board.code, { amount, updatedAt: Date.now() });
    return amount;
  });
  boardAmountCache.set(board.code, { amount: cached?.amount, updatedAt: cached?.updatedAt ?? 0, promise });
  return promise;
}

async function enrichMissingSectorAmounts(
  sectors: ISectorSummary[],
  catalog: TLocalBoardCatalog,
): Promise<ISectorSummary[]> {
  const next = [...sectors];
  const targets = next
    .map((sector, index) => ({ sector, index, board: findLocalBoard(catalog, sector) }))
    .filter(
      (item): item is { sector: ISectorSummary; index: number; board: TLocalBoardSummary } =>
        item.sector.amount === undefined && Boolean(item.board),
    )
    .slice(0, BOARD_AMOUNT_FETCH_LIMIT);

  for (let start = 0; start < targets.length; start += BOARD_AMOUNT_FETCH_CONCURRENCY) {
    const chunk = targets.slice(start, start + BOARD_AMOUNT_FETCH_CONCURRENCY);
    const amounts = await Promise.all(chunk.map((item) => fetchBoardAmount(item.board)));
    amounts.forEach((amount, offset) => {
      if (amount !== undefined) next[chunk[offset].index] = { ...next[chunk[offset].index], amount };
    });
  }

  return next;
}

async function fetchFundFlowRankRows(): Promise<TFundFlowRankRow[]> {
  const now = Date.now();
  if (fundFlowRankCache && now - fundFlowRankCache.updatedAt < FUND_FLOW_RANK_CACHE_TTL_MS) {
    return fundFlowRankCache.rows;
  }
  if (fundFlowRankCache?.promise) return fundFlowRankCache.promise;

  const previousCache = fundFlowRankCache;
  const promise = sdk.fundFlow
    .rank({ indicator: 'today' })
    .then((rows) => {
      fundFlowRankCache = { rows, updatedAt: Date.now() };
      return rows;
    })
    .catch((error) => {
      fundFlowRankCache = previousCache?.rows.length
        ? { rows: previousCache.rows, updatedAt: previousCache.updatedAt }
        : undefined;
      throw error;
    });
  fundFlowRankCache = { rows: previousCache?.rows ?? [], updatedAt: previousCache?.updatedAt ?? 0, promise };
  return promise;
}

async function fetchBoardMainNetInflowFromRemote(
  board: TLocalBoardSummary,
  fundFlows: TFundFlowRankRow[],
): Promise<number | undefined> {
  if (!fundFlows.length) return undefined;

  for (const api of boardAmountApis(board.kind)) {
    try {
      const constituents = await api.constituents(board.code);
      const amountYi = sumConstituentMainNetInflowYi(constituents, fundFlows);
      if (amountYi !== undefined) return amountYi;
    } catch {
      // Try the other real board namespace; keep missing flow explicit if both fail.
    }
  }
  return undefined;
}

async function fetchBoardMainNetInflow(
  board: TLocalBoardSummary,
  fundFlows: TFundFlowRankRow[],
): Promise<number | undefined> {
  const cached = boardMainNetInflowCache.get(board.code);
  const now = Date.now();
  if (cached && now - cached.updatedAt < BOARD_MAIN_FLOW_CACHE_TTL_MS) return cached.amountYi;
  if (cached?.promise) return cached.promise;

  const promise = fetchBoardMainNetInflowFromRemote(board, fundFlows)
    .catch((err) => {
      console.warn(`[discovery] board main net inflow unavailable for ${board.code}: ${formatDiscoveryDataError(err)}`);
      return undefined;
    })
    .then((amountYi) => {
      boardMainNetInflowCache.set(board.code, { amountYi, updatedAt: Date.now() });
      return amountYi;
    });
  boardMainNetInflowCache.set(board.code, {
    amountYi: cached?.amountYi,
    updatedAt: cached?.updatedAt ?? 0,
    promise,
  });
  return promise;
}

async function enrichMissingSectorMainNetInflows(
  sectors: ISectorSummary[],
  catalog: TLocalBoardCatalog,
): Promise<ISectorSummary[]> {
  const next = [...sectors];
  const targets = next
    .map((sector, index) => ({ sector, index, board: findLocalBoard(catalog, sector) }))
    .filter(
      (item): item is { sector: ISectorSummary; index: number; board: TLocalBoardSummary } =>
        item.sector.mainNetInflow === 0 && Boolean(item.board),
    )
    .slice(0, BOARD_MAIN_FLOW_FETCH_LIMIT);

  let fundFlows: TFundFlowRankRow[];
  try {
    fundFlows = await fetchFundFlowRankRows();
  } catch (error) {
    console.warn(`[discovery] board main net inflow rank unavailable: ${formatDiscoveryDataError(error)}`);
    return next;
  }

  for (let start = 0; start < targets.length; start += BOARD_MAIN_FLOW_FETCH_CONCURRENCY) {
    const chunk = targets.slice(start, start + BOARD_MAIN_FLOW_FETCH_CONCURRENCY);
    const flows = await Promise.all(chunk.map((item) => fetchBoardMainNetInflow(item.board, fundFlows)));
    flows.forEach((mainNetInflow, offset) => {
      if (mainNetInflow !== undefined) {
        next[chunk[offset].index] = { ...next[chunk[offset].index], mainNetInflow };
      }
    });
  }

  return next;
}

export const enrichMissingSectorMainNetInflowsForTest = enrichMissingSectorMainNetInflows;

async function fetchSectorFlowRank(indicator: TSectorFlowIndicator = 'today'): Promise<ISectorSummary[]> {
  const cached = sectorFlowRankCache.get(indicator);
  const now = Date.now();
  if (cached && now - cached.updatedAt < SECTOR_FLOW_CACHE_TTL_MS) return cached.rows;
  if (cached?.promise) return cached.promise;

  const promise = loadSectorFlowRank(indicator)
    .then((rows) => {
      sectorFlowRankCache.set(indicator, { rows, updatedAt: Date.now() });
      return rows;
    })
    .catch(() => {
      const rows: ISectorSummary[] = [];
      sectorFlowRankCache.set(indicator, { rows, updatedAt: Date.now() });
      return rows;
    });
  sectorFlowRankCache.set(indicator, { rows: cached?.rows ?? [], updatedAt: cached?.updatedAt ?? 0, promise });
  return promise;
}

async function loadSectorFlowRank(indicator: TSectorFlowIndicator): Promise<ISectorSummary[]> {
  const rows = await sdk.fundFlow.sectorRank({ indicator });
  return rows
    .filter((r) => r.changePercent !== null && r.changePercent !== undefined)
    .map((r) => ({
      code: r.code ?? '',
      name: r.name ?? '',
      changePercent: Number(r.changePercent ?? 0),
      mainNetInflow: finiteNumber(r.mainNetInflow) ? Number(r.mainNetInflow) / 100_000_000 : 0,
      topStockName: r.topStockName,
      topStockCode: r.topStockCode,
    }))
    .filter((r) => r.code && r.name)
    .slice(0, 30);
}

function buildOpportunityRadar(sectors: ISectorSummary[]): IOpportunityRadarItem[] {
  return sectors
    .map((s) => {
      const absChg = Math.abs(s.changePercent) || 0.01;
      const ratio = s.mainNetInflow / absChg;
      return {
        code: s.code,
        name: s.name,
        ratio,
        changePercent: s.changePercent,
        mainNetInflow: s.mainNetInflow,
      };
    })
    .filter((s) => s.mainNetInflow > 0 && s.changePercent > -5 && s.changePercent < 10)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 5);
}

function mapOpportunityStockCandidate(input: TOpportunityStockCandidateInput): IOpportunityStockRadarItem | undefined {
  const marketCapYi = parseMarketCapYi(input.marketCap);
  if (
    input.marketCap !== undefined &&
    (marketCapYi === undefined ||
      marketCapYi < OPPORTUNITY_STOCK_MIN_MARKET_CAP_YI ||
      marketCapYi > OPPORTUNITY_STOCK_MAX_MARKET_CAP_YI)
  ) {
    return undefined;
  }
  if (input.changePercent >= OPPORTUNITY_STOCK_CHANGE_PERCENT_LIMIT) {
    return undefined;
  }

  const amount = input.amount ?? 0;
  const concentration90 = input.includeChipReason ? ratioPercent(input.concentration90) : undefined;
  const reasonParts = [
    input.title,
    marketCapYi === undefined ? undefined : `总市值 ${marketCapYi.toFixed(1)}亿`,
    concentration90 === undefined ? undefined : `90%筹码集中度 ${concentration90.toFixed(2)}%`,
  ].filter((item): item is string => Boolean(item));

  return {
    code: input.code,
    name: input.name,
    reason: reasonParts.join(' · '),
    changePercent: input.changePercent,
    amount,
    score: amount || marketCapYi || 0,
  };
}

function sortOpportunityStockCandidates(items: TOpportunityStockCandidateInput[]) {
  return [...items].sort((a, b) => Number(b.amount) - Number(a.amount) || a.code.localeCompare(b.code));
}

function buildOpportunityStockRadarFromLargeOrders(
  events: TOpportunityStockCandidateInput[],
): IOpportunityStockRadarItem[] {
  const baseEvents = sortOpportunityStockCandidates(events).flatMap((event) => {
    const item = mapOpportunityStockCandidate({ ...event, includeChipReason: false });
    return item ? [{ event, item }] : [];
  });

  if (baseEvents.length <= OPPORTUNITY_STOCK_MIN_DISPLAY_COUNT) {
    return baseEvents.map(({ item }) => item).slice(0, OPPORTUNITY_STOCK_DISPLAY_LIMIT);
  }

  const firstTenItems = baseEvents.slice(0, OPPORTUNITY_STOCK_MIN_DISPLAY_COUNT).map(({ item }) => item);
  const tailItems = baseEvents.slice(OPPORTUNITY_STOCK_MIN_DISPLAY_COUNT).flatMap(({ event }) => {
    const concentration90 = ratioPercent(event.concentration90);
    if (concentration90 === undefined || concentration90 >= OPPORTUNITY_STOCK_CHIP_CONCENTRATION90_LIMIT) return [];
    const item = mapOpportunityStockCandidate({ ...event, includeChipReason: true });
    return item ? [item] : [];
  });

  return [...firstTenItems, ...tailItems].slice(0, OPPORTUNITY_STOCK_DISPLAY_LIMIT);
}

function isLargeOrderBuyMonitorEvent(event: IMonitorEvent) {
  const text = [event.title, event.badge, ...event.details].filter((item): item is string => Boolean(item)).join(' ');
  return /买入/.test(text) && !/卖出/.test(text);
}

function mergeLargeOrderMonitorCandidates(
  events: IMonitorEvent[],
  marketRows: Awaited<ReturnType<typeof getAllMarketQuoteRows>>,
): TOpportunityStockCandidateInput[] {
  const quoteByCode = new Map(marketRows.map((row) => [row.code, row]));
  const byCode = new Map<string, TOpportunityStockCandidateInput>();

  for (const event of events) {
    if (event.category !== 'large-order' || !isLargeOrderBuyMonitorEvent(event)) continue;
    const changePercent = finiteStockChangePercent(event.changePercent);
    if (changePercent === null) continue;
    const quote = quoteByCode.get(event.code);
    const marketCap = quote?.marketCap;
    const candidate: TOpportunityStockCandidateInput = {
      code: event.code,
      name: event.name,
      title: event.title,
      changePercent,
      amount: numericStringValue(quote?.amount),
      marketCap,
    };
    const existing = byCode.get(event.code);
    if (!existing || Number(candidate.amount ?? 0) > Number(existing.amount ?? 0)) byCode.set(event.code, candidate);
  }

  return Array.from(byCode.values());
}

async function withCachedChipConcentration90(
  candidates: TOpportunityStockCandidateInput[],
): Promise<TOpportunityStockCandidateInput[]> {
  return Promise.all(
    candidates.map(async (candidate) => ({
      ...candidate,
      concentration90: await getCachedChipConcentration90Percent(candidate.code),
    })),
  );
}

async function buildOpportunityStockRadarFromMonitorFeed(tradeDate: string): Promise<IOpportunityStockRadarItem[]> {
  const [feed, marketRows] = await Promise.all([
    getMonitorFeed({ categories: ['large-order'], limit: 200, offset: 0, mode: 'history', date: tradeDate }),
    getAllMarketQuoteRows(),
  ]);
  const candidates = mergeLargeOrderMonitorCandidates(feed.events, marketRows);
  const candidatesWithChip =
    candidates.length > OPPORTUNITY_STOCK_MIN_DISPLAY_COUNT
      ? await withCachedChipConcentration90(candidates)
      : candidates;
  return buildOpportunityStockRadarFromLargeOrders(candidatesWithChip);
}

function buildOpportunityStockRadar(fundFlows: TFundFlowRankRow[]): IOpportunityStockRadarItem[] {
  const candidates = fundFlows.flatMap((item) => {
    const changePercent = finiteStockChangePercent(item.changePercent);
    const mainNetInflow = finiteNumber(item.mainNetInflow) ? item.mainNetInflow : null;
    const superLargeNetInflow = finiteNumber(item.superLargeNetInflow) ? item.superLargeNetInflow : null;
    const opportunityAmount = superLargeNetInflow ?? mainNetInflow;
    if (!item.code || !item.name || changePercent === null || opportunityAmount === null) return [];
    return [
      {
        code: item.code,
        name: item.name,
        reason:
          superLargeNetInflow === null
            ? `主力净流入 ${formatMoney(mainNetInflow)}`
            : `超大单净买入 ${formatMoney(superLargeNetInflow)}，主力净流入 ${formatMoney(mainNetInflow)}`,
        changePercent,
        amount: opportunityAmount,
        score: opportunityAmount,
      },
    ];
  });
  const lowChangeCandidates = candidates.filter(
    (item) => Number(item.amount) > 0 && item.changePercent < OPPORTUNITY_STOCK_CHANGE_PERCENT_LIMIT,
  );
  const displayCandidates =
    lowChangeCandidates.length >= OPPORTUNITY_STOCK_MIN_DISPLAY_COUNT
      ? lowChangeCandidates
      : candidates.filter((item) => Number(item.amount) > 0);

  return displayCandidates
    .sort((a, b) => Number(b.amount) - Number(a.amount) || a.code.localeCompare(b.code))
    .slice(0, OPPORTUNITY_STOCK_DISPLAY_LIMIT);
}

export const buildOpportunityStockRadarFromLargeOrdersForTest = buildOpportunityStockRadarFromLargeOrders;
export const mergeLargeOrderMonitorCandidatesForTest = mergeLargeOrderMonitorCandidates;
export const buildOpportunityStockRadarForTest = buildOpportunityStockRadar;

function buildDiscoveryOpportunityRadar(input: {
  boards?: IOpportunityRadarItem[];
  stocks: IOpportunityStockRadarItem[];
}): IOpportunityRadar {
  return {
    boards: input.boards ?? [],
    stocks: input.stocks,
  };
}

export const buildDiscoveryOpportunityRadarForTest = buildDiscoveryOpportunityRadar;

async function generateNextWeekSectors(
  sectors: ISectorSummary[],
  hotThemes: IMarketReviewHotTheme[],
  mainFundFlow: number | null,
  northFundFlow: number | null,
  boardCatalog: TLocalBoardCatalog,
): Promise<INextWeekSector[]> {
  try {
    const cfg = getConfig();
    const sectorText = sectors
      .slice(0, 15)
      .map(
        (s) =>
          `${s.name}(涨幅${s.changePercent >= 0 ? '+' : ''}${s.changePercent.toFixed(2)}%，资金${s.mainNetInflow >= 0 ? '+' : ''}${s.mainNetInflow.toFixed(1)}亿)`,
      )
      .join('、');
    const hotText = hotThemes
      .slice(0, 8)
      .map((t) => `${t.name}(涨停${t.limitUpCount ?? 0}家，龙头${t.leaderName ?? '--'})`)
      .join('、');

    const localBoardText = boardCatalog.rows
      .slice(0, 40)
      .map((board) => `${board.name}(${board.code})`)
      .join('、');

    const messages = [
      {
        role: 'system' as const,
        content:
          '你是 A 股策略分析师。仅使用用户提供的真实数据，从资金面、消息面/政策、技术面、板块轮动四个维度，挑选下周最可能强势的 4 个板块。输出严格 JSON 数组，每个元素包含 name（板块名，必须从“本地可打开板块”中原样选择）、score（0-100 整数）、reasoning（对象：fundFlow/news/policy/technical/rotation，每个字段 30-60 字）。严禁编造板块、股票或具体数值。',
      },
      {
        role: 'user' as const,
        content: `今日主力资金净流入：${mainFundFlow !== null ? `${mainFundFlow >= 0 ? '+' : ''}${mainFundFlow.toFixed(1)}亿` : '暂无'}
今日北向资金净流入：${northFundFlow !== null ? `${northFundFlow >= 0 ? '+' : ''}${northFundFlow.toFixed(1)}亿` : '暂无'}
今日板块表现：${sectorText}
当前热点：${hotText}
本地可打开板块：${localBoardText}

请输出 JSON：`,
      },
    ];

    const raw = await chatWithOpenAICompatible(cfg.model, messages);
    const jsonText = raw.match(/\[[\s\S]*\]/)?.[0] ?? raw;
    const parsed = parseJsonArray<TNextWeekSectorCandidate>(jsonText, isNextWeekSectorCandidate);
    return parsed
      .map((p) => ({ candidate: p, board: findLocalBoard(boardCatalog, { name: p.name }) }))
      .filter((item): item is { candidate: TNextWeekSectorCandidate; board: TLocalBoardSummary } => Boolean(item.board))
      .map(({ candidate, board }) => ({
        code: board.code,
        name: board.name,
        score: Math.max(0, Math.min(100, Math.round(candidate.score ?? 70))),
        reasoning: {
          fundFlow: candidate.reasoning?.fundFlow ?? '资金关注度一般，需持续跟踪。',
          news: candidate.reasoning?.news ?? '消息面暂无重大催化。',
          policy: candidate.reasoning?.policy ?? '政策面无明确边际变化。',
          technical: candidate.reasoning?.technical ?? '技术面处于震荡整理阶段。',
          rotation: candidate.reasoning?.rotation ?? '板块轮动中尚未形成明确主线。',
        },
      }))
      .slice(0, 4);
  } catch (err) {
    console.warn('[discovery] generate next-week sectors failed', err);
    // fallback: top sectors by inflow
    return reconcileSectorsWithLocalBoards(sectors, boardCatalog)
      .filter((s) => s.mainNetInflow > 0 || sectors.length === 0)
      .sort((a, b) => b.mainNetInflow - a.mainNetInflow || b.changePercent - a.changePercent)
      .slice(0, 4)
      .map((s) => ({
        code: s.code,
        name: s.name,
        score: 70,
        reasoning: {
          fundFlow: `今日主力净流入 ${s.mainNetInflow.toFixed(1)} 亿，资金活跃度较高。`,
          news: '建议结合最新新闻公告进一步验证催化。',
          policy: '关注相关政策面是否持续发酵。',
          technical: `板块涨跌幅 ${s.changePercent.toFixed(2)}%，技术形态需结合量能观察。`,
          rotation: '当前市场轮动较快，需观察持续性。',
        },
      }));
  }
}

async function fetchSectorLeaders(
  code: string,
): Promise<Array<{ code: string; name: string; height?: number | null }> | undefined> {
  try {
    const localItems = await listBoardConstituents(code);
    const localLeaders = localItems
      .slice(0, 3)
      .map((item) => ({ code: item.stockCode, name: item.stockName }))
      .filter((item) => item.code && item.name);
    if (localLeaders.length) return localLeaders;
  } catch {
    // Fall through to remote real board constituent providers.
  }

  const loaders = [() => sdk.board.concept.constituents(code), () => sdk.board.industry.constituents(code)];
  for (const load of loaders) {
    try {
      const items = await load();
      const leaders = items
        .filter((item) => item.code && item.name)
        .sort((a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity))
        .slice(0, 3)
        .map((item) => ({ code: item.code ?? '', name: item.name ?? '' }));
      if (leaders.length) return leaders;
    } catch {
      // Try the next real board constituent source.
    }
  }
  return undefined;
}

function buildHotThemesFromPools(poolItems: HotFocusItem[]): NonNullable<IDiscoverySnapshot['hotThemes']> {
  const groups = new Map<string, HotFocusItem[]>();
  for (const item of poolItems) {
    const boardName = item.description?.split('·')[0]?.trim();
    if (!boardName || boardName.includes('换手') || boardName.includes('封单') || boardName.includes('成交额'))
      continue;
    const rows = groups.get(boardName) ?? [];
    rows.push(item);
    groups.set(boardName, rows);
  }

  return Array.from(groups.entries())
    .map(([name, items]) => {
      const limitUpItems = items.filter((item) => item.tag === '封涨停板');
      const changeValues = items
        .map((item) => parseChgPct(item.changePercent))
        .filter((value): value is number => value !== undefined);
      const avgChange = changeValues.length
        ? changeValues.reduce((sum, value) => sum + value, 0) / changeValues.length
        : null;
      const leaders = limitUpItems
        .slice(0, 3)
        .map((item) => ({
          code: item.code ?? '',
          name: item.name ?? item.title,
          height: parseHeight(item.description),
        }))
        .filter((item) => item.code && item.name);
      return {
        code: null,
        name,
        score: limitUpItems.length * 2 + Math.max(0, Math.round(avgChange ?? 0)),
        changePercent: avgChange,
        limitUpCount: limitUpItems.length,
        reason: `${name}板块今日${limitUpItems.length}只涨停${avgChange !== null ? `，样本平均涨跌幅 ${avgChange >= 0 ? '+' : ''}${avgChange.toFixed(2)}%` : ''}。`,
        leaderName: leaders[0]?.name ?? null,
        leaderCode: leaders[0]?.code ?? null,
        leaders: leaders.length ? leaders : undefined,
      };
    })
    .filter((theme) => theme.limitUpCount > 0)
    .sort((a, b) => (b.limitUpCount ?? 0) - (a.limitUpCount ?? 0) || (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 8);
}

async function buildHotThemesFromSectors(
  sectors: ISectorSummary[],
): Promise<NonNullable<IDiscoverySnapshot['hotThemes']>> {
  const rows = sectors.slice(0, 8);
  const leaders = await Promise.all(rows.map((sector) => fetchSectorLeaders(sector.code)));
  return rows.map((sector, index) => ({
    code: sector.code,
    name: sector.name,
    score: Math.max(1, 5 - index),
    changePercent: sector.changePercent,
    limitUpCount: null,
    reason: `板块涨跌幅 ${sector.changePercent >= 0 ? '+' : ''}${sector.changePercent.toFixed(2)}%，主力净流入 ${sector.mainNetInflow >= 0 ? '+' : ''}${sector.mainNetInflow.toFixed(1)} 亿。`,
    leaderName: leaders[index]?.[0]?.name ?? null,
    leaderCode: leaders[index]?.[0]?.code ?? null,
    leaders: leaders[index],
  }));
}

async function enrichHotThemesWithLeaders(
  themes: NonNullable<IDiscoverySnapshot['hotThemes']>,
  sectors: ISectorSummary[],
  boardCatalog: TLocalBoardCatalog,
  poolItems: HotFocusItem[],
): Promise<NonNullable<IDiscoverySnapshot['hotThemes']>> {
  const enriched = await Promise.all(
    themes.map(async (theme) => {
      const board = findLocalBoard(boardCatalog, { code: theme.code ?? undefined, name: theme.name });
      const sector = sectors.find(
        (item) =>
          item.code === theme.code ||
          item.code === board?.code ||
          normalizeBoardLookupName(item.name) === normalizeBoardLookupName(theme.name),
      );
      const localTheme = reconcileHotThemeWithLocalBoard(theme, board, sector);
      if (!localTheme) return undefined;

      const poolLeaders = findLeadersFromPool(localTheme.name, poolItems);
      if (poolLeaders.length) {
        return {
          ...localTheme,
          leaders: poolLeaders,
          leaderName: poolLeaders[0].name,
          leaderCode: poolLeaders[0].code,
        };
      }

      let fallbackLeaders: IHotThemeLeader[] = [];
      if (localTheme.code) {
        fallbackLeaders = (await fetchSectorLeaders(localTheme.code)) ?? [];
      }
      return mergeHotThemeLeaders(localTheme, sector, fallbackLeaders);
    }),
  );
  return enriched.filter((theme): theme is NonNullable<IDiscoverySnapshot['hotThemes']>[number] => Boolean(theme));
}

interface IHistoricalDiscoveryBuildInput {
  tradeDate: string;
  generatedAt: string;
  poolItems: HotFocusItem[];
  dragonTiger?: NonNullable<IDiscoverySnapshot['dragonTiger']>;
  dragonTigerHistory?: TDiscoveryDragonTigerDay[];
  tradeDates: Array<{ date: string; weekday: string }>;
  indices?: IMarketSummary['indices'];
  mainFundFlow?: number | null;
  northFundFlow?: number | null;
}

function parseAmountYiFromText(value?: string): number | undefined {
  const match = value?.match(/成交额\s*([\d.]+)\s*亿/);
  const parsed = match ? Number(match[1]) : NaN;
  return Number.isFinite(parsed) ? parsed * 100_000_000 : undefined;
}

function buildHistoricalSectorsFromPools(
  poolItems: HotFocusItem[],
  hotThemes: NonNullable<IDiscoverySnapshot['hotThemes']>,
): ISectorSummary[] {
  return hotThemes.map((theme, index) => {
    const leaders = poolItems.filter((item) => item.tag === '封涨停板' && themeMatches(theme.name, item.description));
    const amount = leaders
      .map((item) => parseAmountYiFromText(item.description))
      .filter((value): value is number => value !== undefined)
      .reduce((sum, value) => sum + value, 0);
    const leader = leaders[0];
    return {
      code: theme.code ?? `historical-${index}-${theme.name}`,
      name: theme.name,
      changePercent: theme.changePercent ?? 0,
      mainNetInflow: 0,
      amount: amount || undefined,
      topStockName: leader?.name ?? leader?.title,
      topStockCode: leader?.code,
    };
  });
}

function buildLimitUpsFromPools(poolItems: HotFocusItem[]): NonNullable<IDiscoverySnapshot['limitUps']> {
  return poolItems
    .filter((item) => item.tag === '封涨停板' && item.code)
    .map((item) => ({
      code: item.code ?? '',
      name: item.name ?? item.title,
      height: `${parseHeight(item.description)}板`,
      reason: item.description ?? '涨停',
      price: item.price,
      changePercent: parseChgPct(item.changePercent) ?? null,
      turnoverRate: undefined,
    }));
}

function buildHistoricalNextDayFocus(input: {
  hotThemes: NonNullable<IDiscoverySnapshot['hotThemes']>;
  limitUpCount: number;
  limitDownCount: number;
  brokenCount: number;
  consecutiveCount: number;
  dragonTiger?: NonNullable<IDiscoverySnapshot['dragonTiger']>;
}): NonNullable<IDiscoverySnapshot['nextDayFocus']> {
  if (
    !input.limitUpCount &&
    !input.limitDownCount &&
    !input.brokenCount &&
    !input.consecutiveCount &&
    !input.hotThemes.length
  ) {
    return [];
  }
  const leader = input.hotThemes[0];
  const followUpTheme = input.hotThemes.find((theme) => theme.name !== leader?.name);
  const dragonTigerCount =
    (input.dragonTiger?.inst.length ?? 0) +
    (input.dragonTiger?.hot.length ?? 0) +
    (input.dragonTiger?.first.length ?? 0);
  return [
    {
      category: 'leader',
      condition: leader?.leaderName
        ? `观察 ${leader.leaderName} 是否继续封板或维持高位承接`
        : `观察最高连板股是否延续强度（该日连板 ${input.consecutiveCount} 家）`,
      baseline: input.consecutiveCount,
    },
    {
      category: 'theme',
      condition: followUpTheme
        ? `观察 ${followUpTheme.name} 是否出现接力与扩散`
        : leader
          ? `观察 ${leader.name} 是否继续扩散`
          : '暂无可验证热点，观察是否出现新的板块接力',
      baseline: followUpTheme?.changePercent ?? leader?.changePercent ?? null,
    },
    {
      category: 'sentiment',
      condition: `观察涨停家数是否超过该日 ${input.limitUpCount} 家`,
      baseline: input.limitUpCount,
    },
    {
      category: 'risk',
      condition: `观察炸板与跌停风险是否低于该日水平（炸板 ${input.brokenCount} 家，跌停 ${input.limitDownCount} 家）`,
      baseline: input.brokenCount + input.limitDownCount,
    },
    {
      category: 'liquidity',
      condition: `观察龙虎榜活跃度是否高于该日 ${dragonTigerCount} 条上榜线索`,
      baseline: dragonTigerCount,
    },
  ];
}

function buildDiscoverySnapshotFromHistoricalPools(input: IHistoricalDiscoveryBuildInput): IDiscoverySnapshot {
  const sentimentStocks: NonNullable<IDiscoverySnapshot['sentimentStocks']> = { zt: [], dt: [], zb: [] };
  const consecutiveStocks: TStockItem[] = [];
  for (const item of input.poolItems) {
    if (item.tag === '封涨停板') {
      const stock = toStockItem(item);
      sentimentStocks.zt.push(stock);
      if (parseHeight(item.description) >= 2) consecutiveStocks.push(stock);
    } else if (item.tag === '封跌停板') {
      sentimentStocks.dt.push(toStockItem(item));
    } else if (item.tag === '涨停开板') {
      sentimentStocks.zb.push(toStockItem(item));
    }
  }
  const brokenCount = sentimentStocks.zb.length;
  const sentimentScore = scoreSentiment(0, 0, sentimentStocks.zt.length, sentimentStocks.dt.length, brokenCount);
  const hotThemes = buildHotThemesFromPools(input.poolItems);
  const historicalSectors = buildHistoricalSectorsFromPools(input.poolItems, hotThemes);
  const limitUps = buildLimitUpsFromPools(input.poolItems);
  const dragonTiger = input.dragonTiger ?? emptyDiscoveryDragonTiger();
  const nextDayFocus = buildHistoricalNextDayFocus({
    hotThemes,
    limitUpCount: sentimentStocks.zt.length,
    limitDownCount: sentimentStocks.dt.length,
    brokenCount,
    consecutiveCount: consecutiveStocks.length,
    dragonTiger,
  });
  const boardOpportunityRadar = buildOpportunityRadar(historicalSectors);

  return {
    tradeDate: input.tradeDate,
    generatedAt: input.generatedAt,
    score: sentimentScore ?? undefined,
    scoreLabel: sentimentScore === null ? undefined : scoreLabel(sentimentScore),
    scoreVerdict: sentimentScore === null ? undefined : scoreLabel(sentimentScore),
    marketSummary: {
      indices: input.indices ?? [],
      mainFundFlow: input.mainFundFlow ?? null,
      northFundFlow: input.northFundFlow ?? null,
      limitUp: sentimentStocks.zt.length,
      limitDown: sentimentStocks.dt.length,
      sentimentBar: sentimentScore ?? 50,
      sectors: historicalSectors,
      opportunityRadar: boardOpportunityRadar,
      monthlyThemes: [],
      nextWeekSectors: [],
    },
    opportunityRadar: buildDiscoveryOpportunityRadar({
      boards: boardOpportunityRadar,
      stocks: [],
    }),
    sentimentScore,
    sentimentFactors: [
      { label: '涨停', value: `${sentimentStocks.zt.length}家` },
      { label: '跌停', value: `${sentimentStocks.dt.length}家` },
      { label: '炸板', value: `${brokenCount}家` },
      { label: '连板', value: `${consecutiveStocks.length}家` },
    ],
    sentimentStocks:
      sentimentStocks.zt.length || sentimentStocks.dt.length || sentimentStocks.zb.length ? sentimentStocks : undefined,
    consecutiveStocks: consecutiveStocks.length ? consecutiveStocks : undefined,
    hotThemes: hotThemes.length ? hotThemes : undefined,
    limitUps: limitUps.length ? limitUps : undefined,
    dragonTiger,
    dragonTigerHistory: input.dragonTigerHistory,
    tradeDates: input.tradeDates,
    nextDayFocus: nextDayFocus.length ? nextDayFocus : undefined,
  };
}

export const buildDiscoverySnapshotFromHistoricalPoolsForTest = buildDiscoverySnapshotFromHistoricalPools;

async function buildMarketSummary(
  reviewData: Awaited<ReturnType<typeof getMarketReview>> | undefined,
  pools: HotFocusItem[],
): Promise<IMarketSummary | undefined> {
  const [boardCatalog, remoteSectors] = await Promise.all([fetchLocalBoardCatalog(), fetchSectorFlowRank()]);
  const reconciledSectors = reconcileSectorsWithLocalBoards(remoteSectors, boardCatalog);
  const sectorsWithFlows = await enrichMissingSectorMainNetInflows(reconciledSectors, boardCatalog);
  const sectors = await enrichMissingSectorAmounts(sectorsWithFlows, boardCatalog);

  const tradeDate = reviewData?.tradeDate;
  const [indices, mainFundFlow, northFundFlow] = await Promise.all([
    fetchAllIndices(),
    fetchMainFundFlow(tradeDate),
    fetchNorthFundFlow(tradeDate),
  ]);

  if (!indices.length && !sectors.length) return undefined;

  const limitUp = pools.filter((item) => item.tag === '封涨停板').length;
  const limitDown = pools.filter((item) => item.tag === '封跌停板').length;
  const sentimentBar = reviewData?.sentimentScore ?? 50;
  const opportunityRadar = buildOpportunityRadar(sectors);

  const [monthlyThemesResult, nextWeekSectorsResult] = await Promise.allSettled([
    withOptionalTimeout('monthly themes', fetchCompletedMonthWeekPools(boardCatalog)),
    withOptionalTimeout(
      'next-week sectors',
      generateNextWeekSectors(sectors, reviewData?.hotThemes ?? [], mainFundFlow, northFundFlow, boardCatalog),
    ),
  ]);
  const monthlyThemes =
    monthlyThemesResult.status === 'fulfilled' && monthlyThemesResult.value ? monthlyThemesResult.value : [];
  const nextWeekSectors =
    nextWeekSectorsResult.status === 'fulfilled' && nextWeekSectorsResult.value ? nextWeekSectorsResult.value : [];

  return {
    indices,
    mainFundFlow,
    northFundFlow,
    limitUp,
    limitDown,
    sentimentBar,
    sectors,
    opportunityRadar,
    monthlyThemes,
    nextWeekSectors,
  };
}

function historyBeforeTimestamp(tradeDate: string): number | undefined {
  const timestamp = new Date(`${tradeDate}T00:00:00+08:00`).getTime() + 24 * 60 * 60 * 1000;
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

async function fetchHistoricalIndices(tradeDate: string): Promise<IMarketSummary['indices']> {
  const beforeTimestamp = historyBeforeTimestamp(tradeDate);
  if (beforeTimestamp === undefined) return [];
  const codes = ['sh000001', 'sz399001', 'sz399006', 'bj899050'];
  const results = await Promise.all(
    codes.map(async (code) => {
      try {
        const snapshot = await fetchMarketIndex(code, '1d', 120, beforeTimestamp);
        const point = snapshot?.minutes.find((item) => normalizeIndexDate(item.time) === tradeDate);
        if (!snapshot || !point) return undefined;
        return {
          code,
          name: indexCodeToName(code),
          price: point.close,
          changePercent: point.changePercent ?? 0,
        };
      } catch (error) {
        console.warn(`[discovery] failed to fetch historical index ${code} ${tradeDate}`, error);
        return undefined;
      }
    }),
  );
  return results.filter((item): item is NonNullable<typeof item> => Boolean(item));
}

async function buildHistoricalMarketSummaryExtras(
  dates: string[],
): Promise<Map<string, Pick<IHistoricalDiscoveryBuildInput, 'indices' | 'mainFundFlow' | 'northFundFlow'>>> {
  const entries = await Promise.all(
    dates.map(async (date) => {
      const [indicesResult, mainFundFlowResult, northFundFlowResult] = await Promise.allSettled([
        fetchHistoricalIndices(date),
        fetchMainFundFlow(date),
        fetchNorthFundFlow(date),
      ]);
      return [
        date,
        {
          indices: indicesResult.status === 'fulfilled' ? indicesResult.value : [],
          mainFundFlow: mainFundFlowResult.status === 'fulfilled' ? mainFundFlowResult.value : null,
          northFundFlow: northFundFlowResult.status === 'fulfilled' ? northFundFlowResult.value : null,
        },
      ] as const;
    }),
  );
  return new Map(entries);
}

async function buildDiscoverySnapshotFresh(): Promise<IDiscoverySnapshotBuildResult> {
  const favStocks = await listFavoriteStocks();
  const favCodes = favStocks.map((f) => f.code);
  const currentTradeDate = await resolveTradingDate(9 * 60 + 30);
  const recentTradeDates = await listRecentTradingDates(currentTradeDate);
  const tradeDates = recentTradeDates.map(toTradeDateOption);

  const [review, shSnapshot, szSnapshot, dragonTiger, eastmoneyPool, quoteLimitDowns, historicalPoolGroups] =
    await Promise.allSettled([
      getMarketReview(),
      getMarketPageSnapshot('sh-main'),
      getMarketPageSnapshot('sz-main'),
      listRecentDragonTigerDays(DISCOVERY_RECENT_TRADE_DAYS),
      listEastmoneySurgeByDate(compactTradeDate(currentTradeDate)),
      listLimitDownStocksFromQuotes(),
      Promise.all(recentTradeDates.map((date) => listEastmoneySurgeByDate(compactTradeDate(date)))),
    ]);

  // ── Indices ──
  const indices: IDiscoverySnapshot['indices'] = [];
  const shData = shSnapshot.status === 'fulfilled' ? shSnapshot.value : undefined;
  const szData = szSnapshot.status === 'fulfilled' ? szSnapshot.value : undefined;
  for (const idx of [...(shData?.indices ?? []), ...(szData?.indices ?? [])]) {
    if (idx.code === 'sh000001' || idx.code === 'sz399001' || idx.code === 'sz399006') {
      indices.push({ code: idx.code, name: idx.name, price: idx.price, changePercent: idx.changePercent });
    }
  }

  // ── Market summary ──
  const reviewData = review.status === 'fulfilled' ? review.value : undefined;
  const bullets: string[] = [];
  const wealthMetrics: IDiscoverySnapshot['wealthMetrics'] = [];
  if (reviewData?.wealthEffect) {
    for (const m of reviewData.wealthEffect) {
      if (m.value !== null && m.value !== undefined) {
        const displayValue =
          typeof m.value === 'number'
            ? Number.isInteger(m.value)
              ? String(m.value)
              : m.value.toFixed(2)
            : String(m.value);
        bullets.push(`${m.label}：${displayValue}${m.unit ?? ''}`);
      }
      wealthMetrics.push({ label: m.label, value: m.value, unit: m.unit ?? '' });
    }
  }
  if (reviewData?.sentiment) {
    for (const m of reviewData.sentiment) {
      if (m.value !== null && m.value !== undefined) {
        bullets.push(`${m.label}：${m.value}${m.unit ?? ''}`);
      }
    }
  }

  // ── Sentiment stocks from Eastmoney full-day pool ──
  const historicalPoolItems = historicalPoolGroups.status === 'fulfilled' ? historicalPoolGroups.value : [];
  const poolItems = eastmoneyPool.status === 'fulfilled' ? eastmoneyPool.value : (historicalPoolItems[0] ?? []);
  const sentimentStocks: IDiscoverySnapshot['sentimentStocks'] = { zt: [], dt: [], zb: [] };
  const consecutiveStocks: TStockItem[] = [];
  for (const item of poolItems) {
    const tag = item.tag ?? '';
    if (tag === '封涨停板') {
      sentimentStocks.zt.push(toStockItem(item));
      if (parseHeight(item.description) >= 2) {
        consecutiveStocks.push(toStockItem(item));
      }
    } else if (tag === '封跌停板') {
      sentimentStocks.dt.push(toStockItem(item));
    } else if (tag === '涨停开板') {
      sentimentStocks.zb.push(toStockItem(item));
    }
  }
  if (!sentimentStocks.dt.length && quoteLimitDowns.status === 'fulfilled') {
    sentimentStocks.dt.push(...quoteLimitDowns.value);
  }

  // ── Yesterday pool for 昨日涨停指数 / 昨日连板指数 ──
  const yesterdayPools = resolveYesterdaySentimentPools(recentTradeDates, historicalPoolItems, currentTradeDate);
  const yesterdayZt = yesterdayPools.zt;
  const yesterdayLb = yesterdayPools.lb;

  // ── Dragon tiger ──
  const tradeDate = reviewData?.tradeDate ?? currentTradeDate;
  const dragonTigerGroups = dragonTiger.status === 'fulfilled' ? dragonTiger.value : [];
  const dragonTigerGroupsByDate = new Map(dragonTigerGroups.map((group) => [group.date, group]));
  const dragonTigerHistory = buildDiscoveryDragonTigerHistory(
    recentTradeDates.map(
      (date) => dragonTigerGroupsByDate.get(date) ?? ({ date, items: [] } satisfies TDailyDragonTigerGroup),
    ),
  );
  const discoveryDragonTiger = pickCurrentDragonTigerFromHistory(dragonTigerHistory, tradeDate);

  // ── Watchlist quotes ──
  let watchlistQuotes: IDiscoverySnapshot['watchlistQuotes'];
  if (favCodes.length) {
    try {
      const quotes = await getBatchQuotes(favCodes);
      watchlistQuotes = quotes.map((q) => ({
        code: q.code,
        name: q.name,
        price: q.price,
        changePercent: parseChgPct(q.changePercent),
      }));
    } catch {
      watchlistQuotes = favStocks.map((f) => ({ code: f.code, name: f.name }));
    }
  } else {
    watchlistQuotes = [];
  }

  // ── Score ──
  const score = reviewData?.sentimentScore ?? undefined;
  const sentimentLabel = score !== undefined && score !== null ? scoreLabel(score) : undefined;

  // Build 7-day score trend and AI one-sentence verdict.
  let scoreTrend: number[] | undefined;
  let scoreVerdict: string | undefined;
  if (score !== undefined && score !== null && reviewData) {
    scoreTrend = await buildScoreTrend(tradeDate, score);
    const previousScore = scoreTrend.length >= 2 ? scoreTrend[scoreTrend.length - 2] : score;
    const scoreChange = score - previousScore;
    scoreVerdict = await generateOneSentenceVerdict(reviewData, score, scoreChange);
  }

  // Build limit-up leaders and enrich with live quotes.
  let limitUps: IDiscoverySnapshot['limitUps'];
  if (reviewData?.leaders?.length) {
    const leaderCodes = reviewData.leaders.map((l) => l.code);
    let quotes: Awaited<ReturnType<typeof getBatchQuotes>> = [];
    if (leaderCodes.length) {
      try {
        quotes = await getBatchQuotes(leaderCodes);
      } catch (error) {
        console.warn('[discovery] failed to fetch limit-up quotes', error);
      }
    }
    const quoteByCode = new Map(quotes.map((q) => [q.code, q]));
    limitUps = reviewData.leaders.map((l) => {
      const quote = quoteByCode.get(l.code);
      return {
        code: l.code,
        name: l.name,
        height: l.height ? `${l.height}板` : '首板',
        reason: l.concepts?.join(' + ') ?? '题材催化',
        price: quote?.price,
        changePercent:
          l.changePercent ?? (quote?.changePercent !== undefined ? Number(quote.changePercent) : undefined),
        turnoverRate: l.turnoverRate ?? (quote?.turnoverRate !== undefined ? Number(quote.turnoverRate) : undefined),
      };
    });
  }

  // Build new AI market summary.
  let marketSummary: IMarketSummary | undefined;
  try {
    marketSummary = await buildMarketSummary(reviewData, poolItems);
  } catch (err) {
    console.warn('[discovery] build market summary failed', err);
  }

  let opportunityStocks: IOpportunityStockRadarItem[] = [];
  try {
    opportunityStocks = await buildOpportunityStockRadarFromMonitorFeed(tradeDate);
  } catch (error) {
    console.warn(`[discovery] opportunity stock monitor feed unavailable: ${formatDiscoveryDataError(error)}`);
  }
  const opportunityRadar = buildDiscoveryOpportunityRadar({
    boards: marketSummary?.opportunityRadar ?? [],
    stocks: opportunityStocks,
  });

  const sectorThemes = await buildHotThemesFromSectors(marketSummary?.sectors ?? []);
  const poolThemes = buildHotThemesFromPools(poolItems);
  const baseHotThemes = reviewData?.hotThemes?.length
    ? reviewData.hotThemes.map(mapTheme)
    : sectorThemes.length
      ? sectorThemes
      : poolThemes;
  const hotThemes = await enrichHotThemesWithLeaders(
    baseHotThemes,
    marketSummary?.sectors ?? [],
    buildLocalBoardCatalog(marketSummary?.sectors ?? []),
    poolItems,
  );

  const snapshot: IDiscoverySnapshot = {
    tradeDate,
    generatedAt: new Date().toISOString(),
    score: score ?? undefined,
    scoreLabel: sentimentLabel,
    scoreVerdict: scoreVerdict ?? sentimentLabel,
    scoreTrend,
    indices: indices.length ? indices : undefined,
    bullets: bullets.length ? bullets : undefined,
    wealthMetrics: wealthMetrics.length ? wealthMetrics : undefined,
    opportunityRadar,
    marketSummary,
    sentimentScore: reviewData?.sentimentScore ?? null,
    sentimentFactors: reviewData?.sentiment
      ? reviewData.sentiment.map((m) => {
          // patch null yesterday-index values with real counts
          if (m.label === '昨日涨停指数') return { label: m.label, value: `${yesterdayZt?.length ?? '--'}家` };
          if (m.label === '昨日连板指数') return { label: m.label, value: `${yesterdayLb?.length ?? '--'}家` };
          return mapMetricToFactor(m);
        })
      : undefined,
    sentimentStocks:
      sentimentStocks.zt.length || sentimentStocks.dt.length || sentimentStocks.zb.length ? sentimentStocks : undefined,
    consecutiveStocks: consecutiveStocks.length ? consecutiveStocks : undefined,
    yesterdayZt: yesterdayZt?.length ? yesterdayZt : undefined,
    yesterdayLb: yesterdayLb?.length ? yesterdayLb : undefined,
    leaders: reviewData?.leaders?.map(mapLeader),
    hotThemes: hotThemes.length ? hotThemes : undefined,
    limitUps: limitUps?.length ? limitUps : undefined,
    dragonTiger: discoveryDragonTiger,
    dragonTigerHistory: dragonTigerHistory.length ? dragonTigerHistory : undefined,
    tradeDates,
    nextDayFocus: reviewData?.nextDayFocus?.map(mapFocusItem),
    watchlist: favStocks.map((f) => ({ code: f.code, name: f.name })),
    watchlistQuotes,
  };

  const dragonTigerHistoryByDate = new Map(dragonTigerHistory.map((day) => [day.date, day]));
  const historicalPoolItemsByDate = new Map(
    recentTradeDates.map((date, index) => [date, historicalPoolItems[index] ?? []]),
  );
  const historicalDates = recentTradeDates.filter((date) => date !== snapshot.tradeDate);
  const historicalMarketSummaryExtras = await buildHistoricalMarketSummaryExtras(historicalDates);
  const historicalSnapshots = historicalDates.map((date) =>
    buildDiscoverySnapshotFromHistoricalPools({
      tradeDate: date,
      generatedAt: snapshot.generatedAt,
      poolItems: historicalPoolItemsByDate.get(date) ?? [],
      dragonTiger: dragonTigerHistoryByDate.get(date),
      dragonTigerHistory,
      tradeDates,
      ...historicalMarketSummaryExtras.get(date),
    }),
  );

  return { snapshot, historicalSnapshots };
}
