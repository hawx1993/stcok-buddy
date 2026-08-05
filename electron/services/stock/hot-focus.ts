import StockSDK from 'stock-sdk';
import type {
  AgentResultCard,
  BoardDetail,
  HotFocusItem,
  HotFocusTab,
  MarketQuoteRow,
  StockSurgeEvent,
} from '../../../src/shared/types.js';
import { isChinaMarketOpen, toShanghaiMarketTime } from '../../../src/shared/market-time.js';
import { isRemoteTradingDay, previousRemoteTradingDay } from '../market-data/providers.js';
import { listBoardConstituents, listLatestMarketRows, listMarketBoards } from '../market-data/market-data-store.js';
import type { MarketBoardRecord } from '../market-data/types.js';
import { formatMoney, formatNumber, formatPercent, pickNumber, pickString } from './format.js';
import { getBoardDetail } from './board-detail.js';
import { normalizeASymbol } from './symbols.js';
import { withTimeoutReject } from './shared.js';
import { shouldKeepSurgeItem } from './surge-large-order.js';
import type { DailyDragonTigerItem } from './dragon-tiger.js';
import {
  isSurgeHistoryClearMarkerActive,
  listRecentStockSurgeEvents,
  listSurgeHistory,
  enqueueSurgeSnapshot,
  saveIndividualSurgeHistory,
  setSurgeHistoryClearMarker,
} from './surge-history-store.js';

const sdk = new StockSDK({ timeout: 12_000, retry: { maxRetries: 1 } });

type AnyRecord = Record<string, unknown>;

export type { DailyDragonTigerItem };

export async function listHotFocus(tab: HotFocusTab): Promise<HotFocusItem[]> {
  // ponytail: user explicitly cleared surge history — keep the panel empty
  // until the marker expires so the clear action is visually effective.
  if (tab === 'surge' && isSurgeHistoryClearMarkerActive()) return [];

  try {
    if (tab === 'sector') return listSectorHot();
    if (tab === 'market') return listMarketHot();
    if (tab === 'surge') {
      try {
        const cached = await listSurgeHistory(toTradeDate(new Date()), 0, 100);
        const remote = await withTimeoutReject(listSurgeHot(), 5_000, 'surge hot timeout');
        return mergeHotFocusItems(cached, remote).slice(0, 100);
      } catch {
        try {
          const cached = await listSurgeHistory(toTradeDate(new Date()), 0, 100);
          if (cached.length) return cached;
        } catch { /* DB unavailable, fall through to global fallback */ }
      }
    } else if (tab === 'flow') {
      return listFlowHot();
    } else {
      return listStockRankHot(tab);
    }
  } catch {
    /* remote failed entirely, try DB below */
  }
  // Offline DB fallback for surge tab
  if (tab === 'surge') {
    try {
      const cached = await listSurgeHistory(toTradeDate(new Date()));
      if (cached.length) return cached;
    } catch { /* DB also unavailable */ }
  }
  return [];
}

function refreshSurgeHotInBackground() {
  // Fire-and-forget refresh; listSurgeHot queues the snapshot for batched persistence.
  listSurgeHot().catch(() => {});
}

function mergeHotFocusItems(local: HotFocusItem[], remote: HotFocusItem[]): HotFocusItem[] {
  const map = new Map<string, HotFocusItem>();
  for (const item of local) map.set(item.id, item);
  for (const item of remote) map.set(item.id, item);
  return Array.from(map.values()).sort((a, b) => surgeTimeValue(b.time) - surgeTimeValue(a.time) || b.id.localeCompare(a.id));
}

function toTradeDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function listSectorHot(): Promise<HotFocusItem[]> {
  const [industries, concepts, flows] = await Promise.allSettled([
    sdk.board.industry.list(),
    sdk.board.concept.list(),
    sdk.fundFlow.sectorRank({ indicator: 'today' }),
  ]);
  const boards = [
    ...(industries.status === 'fulfilled' ? industries.value : []),
    ...(concepts.status === 'fulfilled' ? concepts.value : []),
  ];
  if (boards.length) {
    return boards
      .sort(
        (a, b) =>
          Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0) || String(a.code).localeCompare(String(b.code)),
      )
      .slice(0, 12)
      .map((item) => ({
        id: `sector-${item.code}`,
        title: item.name,
        code: item.code,
        name: item.name,
        changePercent: formatPercent(item.changePercent ?? 0),
        amount: item.totalMarketCap ? `${(item.totalMarketCap / 100000000).toFixed(1)}亿` : undefined,
        description: item.leadingStock
          ? `领涨：${item.leadingStock}${item.leadingStockChangePercent === null ? '' : ` ${formatPercent(item.leadingStockChangePercent)}`}`
          : 'stock-sdk 板块行情',
        tag: item.code,
        type: Number(item.changePercent ?? 0) >= 0 ? 'surge' : 'plummet',
      }));
  }
  return flows.status === 'fulfilled' && flows.value.length
    ? flows.value.slice(0, 12).map((item) => ({
        id: `sector-${item.code}`,
        title: item.name,
        code: item.code,
        name: item.name,
        changePercent: item.changePercent === null ? '--' : formatPercent(item.changePercent),
        amount: item.mainNetInflow === null ? '--' : formatMoney(item.mainNetInflow),
        description: `主力净流入 ${formatMoney(item.mainNetInflow)}${item.topStockName ? `，最大净流入：${item.topStockName}` : ''}`,
        tag: item.code,
        type: Number(item.changePercent ?? 0) >= 0 ? 'surge' : 'plummet',
      }))
    : [];
}

async function listMarketHot(): Promise<HotFocusItem[]> {
  const rows = (await sdk.fundFlow.market()).slice(0, 10);
  return rows.map((item) => ({
    id: `market-${item.date}`,
    title: item.date,
    price: item.shClose ?? '--',
    changePercent: item.shChangePercent === null ? '--' : formatPercent(item.shChangePercent),
    amount: item.mainNetInflow === null ? '--' : formatMoney(item.mainNetInflow),
    description: `上证 ${formatPercent(item.shChangePercent ?? 0)} / 深证 ${formatPercent(item.szChangePercent ?? 0)}，主力净流入 ${formatMoney(item.mainNetInflow)}`,
    tag: '大盘资金',
    type: Number(item.mainNetInflow ?? 0) >= 0 ? 'surge' : 'plummet',
  }));
}

const SURGE_CACHE_TTL_MS = 30_000;
let surgeCache: { items: HotFocusItem[]; updatedAt: number } | undefined;
let surgeRequest: Promise<HotFocusItem[]> | undefined;

export function clearSurgeCache() {
  surgeCache = undefined;
  surgeRequest = undefined;
  // ponytail: delegate the clear marker to the storage layer so every read/write
  // path (today list, historical dates, individual events) observes it.
  setSurgeHistoryClearMarker();
}

async function listSurgeHot(): Promise<HotFocusItem[]> {
  const marketTime = toShanghaiMarketTime(new Date());
  // isRemoteTradingDay hits the network — wrap to avoid throwing SdkError offline
  let trading: boolean;
  try {
    trading = await isRemoteTradingDay(marketTime.date);
  } catch {
    trading = isChinaMarketOpen(new Date());
  }
  if (!trading || marketTime.minutes < 9 * 60 + 25) return [];
  const now = Date.now();
  if (surgeCache && now - surgeCache.updatedAt < SURGE_CACHE_TTL_MS) return surgeCache.items;
  if (!surgeRequest) {
    surgeRequest = fetchSurgeHot()
      .catch((err) => {
        console.warn('[hot-focus] fetchSurgeHot failed, returning empty', err instanceof Error ? err.message : String(err));
        return [] as HotFocusItem[];
      })
      .finally(() => {
        surgeRequest = undefined;
      });
  }
  return surgeRequest;
}

async function fetchSurgeHot(): Promise<HotFocusItem[]> {
  const [changesResult, poolsResult] = await Promise.allSettled([
    sdk.marketEvent.stockChanges('all'),
    listEastmoneySurgeHot(),
  ]);
  const changes = changesResult.status === 'fulfilled' ? toStockChangeHotItems(changesResult.value) : [];
  const pools = poolsResult.status === 'fulfilled' ? poolsResult.value : [];
  const items = [
    ...changes,
    ...pools.filter((pool) => !changes.some((change) => change.code === pool.code && change.tag === pool.tag)),
  ]
    .filter(shouldKeepSurgeItem)
    .sort((a, b) => surgeTimeValue(b.time) - surgeTimeValue(a.time));
  surgeCache = { items, updatedAt: Date.now() };
  enqueueSurgeSnapshot(items);
  return items;
}

export async function listStockSurgeEvents(symbolInput: string): Promise<StockSurgeEvent[]> {
  const symbol = normalizeASymbol(symbolInput);
  // ponytail: user explicitly cleared surge history — keep individual events
  // empty until the marker expires so the clear action is visually effective.
  if (isSurgeHistoryClearMarkerActive()) return [];

  // Local-first: if we already have cached events, render them immediately and
  // refresh from the network in the background. listRecentStockSurgeEvents is a
  // pure DuckDB read with no calendar network round-trips, so the skeleton is
  // not blocked on sequential remote date resolution.
  let localEvents: StockSurgeEvent[] = [];
  try {
    localEvents = await listRecentStockSurgeEvents(symbol, 7);
  } catch (error) {
    console.warn('[surge] local read failed', symbol, error);
  }
  if (localEvents.length) {
    refreshStockSurgeEventsFromRemote(symbol);
    return localEvents;
  }

  // No local cache yet: resolve the trading dates, then fetch from remote.
  const tradeDate = formatIsoDate(new Date());
  const tradeDates = await resolveLatestTradeDates(tradeDate, 6);
  if (!tradeDates.includes(tradeDate)) return [];

  const [historyResult, currentResult] = await Promise.allSettled([
    withTimeoutReject(
      sdk.marketEvent.individualChangesHistory(symbol, { days: 6 }),
      6_000,
      'individual changes timeout',
    ),
    withTimeoutReject(listSurgeHot(), 6_000, 'surge hot timeout'),
  ]);
  if (historyResult.status === 'rejected' && currentResult.status === 'rejected') {
    return [];
  }

  const historyEvents =
    historyResult.status === 'fulfilled' ? toIndividualHistoryEvents(historyResult.value, symbol) : [];
  if (historyEvents.length) {
    saveIndividualSurgeHistory(historyEvents).catch((err) =>
      console.warn('[hot-focus] save individual surge history failed', err),
    );
  }

  const mergedEvents = mergeSurgeEvents(
    symbol,
    historyEvents,
    currentResult.status === 'fulfilled' ? currentResult.value : [],
  );
  return mergedEvents.filter((item) => tradeDates.includes(item.tradeDate));
}

// ponytail: the trading calendar is stable within a day; cache the resolved
// dates so the cold path (no cached events yet) pays the sequential calendar
// network calls at most once per trade date instead of once per stock open.
let resolvedTradeDatesCache: { key: string; dates: string[]; updatedAt: number } | undefined;
const RESOLVED_TRADE_DATES_TTL_MS = 6 * 60 * 60 * 1000;

async function resolveLatestTradeDates(tradeDate: string, count: number) {
  const cached = resolvedTradeDatesCache;
  if (cached?.key === tradeDate && Date.now() - cached.updatedAt < RESOLVED_TRADE_DATES_TTL_MS) {
    return cached.dates;
  }
  const dates: string[] = [];
  let cursor = tradeDate;
  while (dates.length < count) {
    const isTrading = await isRemoteTradingDay(cursor).catch(() => !isWeekendDate(cursor));
    if (isTrading) dates.push(cursor);
    if (dates.length >= count) break;
    cursor = await previousRemoteTradingDay(cursor).catch(() => previousWeekdayDate(cursor));
  }
  resolvedTradeDatesCache = { key: tradeDate, dates, updatedAt: Date.now() };
  return dates;
}

function refreshStockSurgeEventsFromRemote(symbol: string) {
  // Fire-and-forget refresh so the next open (online or offline) sees fresh data.
  Promise.allSettled([
    withTimeoutReject(
      sdk.marketEvent.individualChangesHistory(symbol, { days: 6 }),
      10_000,
      'background individual changes timeout',
    ),
    withTimeoutReject(listSurgeHot(), 10_000, 'background surge hot timeout'),
  ])
    .then(([historyResult, currentResult]) => {
      if (historyResult.status === 'rejected' && currentResult.status === 'rejected') return;
      const historyEvents =
        historyResult.status === 'fulfilled' ? toIndividualHistoryEvents(historyResult.value, symbol) : [];
      if (historyEvents.length) {
        saveIndividualSurgeHistory(historyEvents).catch(() => {});
      }
      // current events are already queued by listSurgeHot for batched persistence.
    })
    .catch(() => {});
}

function isWeekendDate(date: string) {
  const parsed = new Date(`${date}T00:00:00+08:00`);
  const day = parsed.getDay();
  return day === 0 || day === 6;
}

function previousWeekdayDate(date: string) {
  const parsed = new Date(`${date}T00:00:00+08:00`);
  do {
    parsed.setDate(parsed.getDate() - 1);
  } while (parsed.getDay() === 0 || parsed.getDay() === 6);
  return formatIsoDate(parsed);
}

function mergeSurgeEvents(
  symbol: string,
  historyEvents: StockSurgeEvent[],
  currentItems: HotFocusItem[],
): StockSurgeEvent[] {
  const currentEvents = currentItems
    .filter((item) => item.code === symbol)
    .map((item) => toCurrentSurgeEvent(item, symbol));
  const seen = new Set<string>();
  return [...currentEvents, ...historyEvents]
    .filter((item) => {
      const key = `${item.tradeDate}-${item.time ?? ''}-${item.tag ?? ''}-${item.description ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate) || surgeTimeValue(b.time) - surgeTimeValue(a.time));
}

export function toIndividualHistoryEvents(
  history: Awaited<ReturnType<typeof sdk.marketEvent.individualChangesHistory>>,
  symbol: string,
): StockSurgeEvent[] {
  return history.days
    .filter((day) => day.available)
    .flatMap((day) =>
      day.changes.map((change, index) => {
        const reason = formatStockChangeReason(change.changeTypeLabel, change.changeType);
        const parsed = parseStockChangeInfo(change.changeType, change.info);
        return {
          id: `individual-${day.date}-${change.typeCode}-${change.time}-${index}`,
          tradeDate: day.date,
          title: history.name || symbol,
          code: symbol,
          name: history.name || undefined,
          time: change.time,
          price: change.price === null ? undefined : change.price.toFixed(2),
          changePercent: formatPercentagePoints(change.changePercent),
          amount: formatChangeHands(parsed.hands, reason),
          description: change.info,
          tag: reason,
          type: /卖|跌|跳水|下挫|低|开板/.test(change.changeTypeLabel) ? 'plummet' : 'surge',
        } satisfies StockSurgeEvent;
      }),
    );
}

function formatPercentagePoints(value: number | null): string | undefined {
  if (value === null || !Number.isFinite(value)) return undefined;
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function toCurrentSurgeEvent(item: HotFocusItem, symbol: string): StockSurgeEvent {
  return {
    ...item,
    id: `current-${item.id}`,
    tradeDate: formatIsoDate(new Date()),
    code: symbol,
  };
}

function formatIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

type EastmoneyPoolKind = 'zt' | 'zb' | 'dt';

function toStockChangeHotItems(changes: Awaited<ReturnType<typeof sdk.marketEvent.stockChanges>>): HotFocusItem[] {
  return changes
    .map((item, index) => {
      const parsed = parseStockChangeInfo(item.changeType, item.info);
      const reason = formatStockChangeReason(item.changeTypeLabel, item.changeType);
      return {
        id: `surge-${item.changeType}-${item.time}-${item.code}-${index}`,
        title: `${item.name} ${item.code}`,
        code: item.code,
        name: item.name,
        time: item.time,
        price: parsed.price === undefined ? undefined : parsed.price.toFixed(2),
        changePercent: parsed.pct === undefined ? undefined : formatPercent(parsed.pct),
        amount: formatChangeHands(parsed.hands, reason) ?? parsed.amount,
        description: reason,
        tag: reason,
        type: /卖|跌|跳水|下挫|低|开板/.test(reason) ? 'plummet' : 'surge',
      } satisfies HotFocusItem;
    })
    .filter(shouldKeepSurgeItem);
}

function parseStockChangeInfo(type: string | undefined, info: string) {
  const [first, second, third, fourth] = String(info ?? '')
    .split(',')
    .map(Number);
  if (type === 'large_buy' || type === 'large_sell')
    return {
      hands: first / 100,
      price: second,
      pct: third,
      amount: Number.isFinite(fourth) ? formatMoney(fourth) : undefined,
    };
  if (type === 'limit_up_seal' || type === 'limit_down_seal') {
    return { price: first, pct: fourth, amount: Number.isFinite(second) ? `封单${formatMoney(second)}` : undefined };
  }
  if (type === 'limit_up_open' || type === 'limit_down_open') return { price: first, pct: second };
  return { price: second, pct: Number.isFinite(third) ? third : first };
}

function formatStockChangeReason(label: string, type: string | undefined) {
  if (type === 'high_60d') return '60日新高';
  if (type === 'low_60d') return '60日新低';
  if (type === 'surge_60d' || type === 'rocket_launch' || type === 'quick_rebound') return '快速涨幅';
  if (type === 'drop_60d' || type === 'accelerate_down' || type === 'high_dive') return '快速跌幅';
  if (type === 'limit_down_seal') return '封跌停板';
  if (type === 'limit_up_seal') return '封涨停板';
  if (type === 'limit_down_open') return '跌停开板';
  if (type === 'limit_up_open') return '涨停开板';
  if (type === 'large_buy' || label === '大笔买入') return '特大单买入';
  if (type === 'large_sell' || label === '大笔卖出') return '特大单卖出';
  return label;
}

function formatChangeHands(hands: number | undefined, reason: string) {
  if (!Number.isFinite(hands) || !hands || hands <= 0) return undefined;
  const action = reason.includes('买') ? '买入' : reason.includes('卖') ? '卖出' : '';
  const size = hands >= 10000 ? `${(hands / 10000).toFixed(2).replace(/\.00$/, '')}万手` : `${hands.toFixed(0)}手`;
  return action ? `${action}${size}` : size;
}

const eastmoneyPoolConfigs: Record<
  EastmoneyPoolKind,
  { endpoint: string; sort: string; tag: string; type: HotFocusItem['type'] }
> = {
  zt: { endpoint: 'getTopicZTPool', sort: 'fbt:asc', tag: '封涨停板', type: 'surge' },
  zb: { endpoint: 'getTopicZBPool', sort: 'fbt:asc', tag: '涨停开板', type: 'volume' },
  dt: { endpoint: 'getTopicDTPool', sort: 'fund:asc', tag: '封跌停板', type: 'plummet' },
};

export async function listEastmoneySurgeByDate(date: string): Promise<HotFocusItem[]> {
  const normalized = date.replace(/-/g, '');
  if (!/^\d{8}$/.test(normalized)) return [];
  const groups = await Promise.allSettled([
    fetchEastmoneyPool('zt', normalized),
    fetchEastmoneyPool('zb', normalized),
    fetchEastmoneyPool('dt', normalized),
  ]);
  return groups.flatMap((group) => (group.status === 'fulfilled' ? group.value : []));
}

async function listEastmoneySurgeHot(): Promise<HotFocusItem[]> {
  const items = await listEastmoneySurgeByDate(formatTradeDate(new Date()));
  return items;
}

async function fetchEastmoneyPool(kind: EastmoneyPoolKind, date: string): Promise<HotFocusItem[]> {
  const config = eastmoneyPoolConfigs[kind];
  const url = new URL(`https://push2ex.eastmoney.com/${config.endpoint}`);
  url.search = new URLSearchParams({
    ut: '7eea3edcaed734bea9cbfc24409ed989',
    dpt: 'wz.ztzt',
    Pageindex: '0',
    pagesize: '10000',
    sort: config.sort,
    date,
  }).toString();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(6_000),
    headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: 'https://quote.eastmoney.com/' },
  });
  if (!response.ok) return [];

  const payload = (await response.json()) as { data?: { pool?: AnyRecord[] } | AnyRecord[] };
  const pool = Array.isArray(payload.data) ? payload.data : payload.data?.pool;
  return (pool ?? [])
    .map((row) => toEastmoneyPoolItem(row, kind, config, date))
    .filter((item): item is HotFocusItem => Boolean(item));
}

function toEastmoneyPoolItem(
  row: AnyRecord,
  kind: EastmoneyPoolKind,
  config: (typeof eastmoneyPoolConfigs)[EastmoneyPoolKind],
  date: string,
): HotFocusItem | undefined {
  const code = pickString(row, ['c', 'code']);
  const name = pickString(row, ['n', 'name']);
  if (!code || !name) return undefined;

  const price = pickNumber(row, ['p']);
  const pct = pickNumber(row, ['zdp']);
  const turnover = pickNumber(row, ['hs']);
  const amount = pickNumber(row, [kind === 'zb' ? 'amount' : 'fund', 'amount', 'fba']);
  const limitDays = pickNumber(row, ['lbc', 'days', 'ylbc']);
  const breakTimes = pickNumber(row, ['zbc', 'oc']);
  const industry = pickString(row, ['hybk']);
  const firstSeal = formatEastmoneyPoolTime(pickNumber(row, ['fbt', 'yfbt']));
  const lastSeal = formatEastmoneyPoolTime(pickNumber(row, ['lbt']));
  const eventTime = kind === 'dt' ? '15:00' : firstSeal || lastSeal;
  const details = [
    industry,
    limitDays ? `${limitDays}连板` : '',
    turnover === undefined ? '' : `换手 ${formatNumber(turnover)}%`,
    amount === undefined || amount === 0 ? '' : `${kind === 'zb' ? '成交额' : '封单'} ${formatMoney(amount)}`,
    breakTimes ? `开板 ${breakTimes}次` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    id: `em-${kind}-${date}-${code}`,
    title: `${name} ${code}`,
    code,
    name,
    time: eventTime,
    price: price === undefined ? undefined : (price / 1000).toFixed(2),
    changePercent: pct === undefined ? undefined : formatPercent(pct),
    amount: formatPoolAmount(kind, amount),
    description: details || config.tag,
    tag: config.tag,
    type: config.type,
  };
}

function formatPoolAmount(kind: EastmoneyPoolKind, amount?: number) {
  if (amount === undefined || amount === 0) return undefined;
  const text = formatMoney(amount);
  if (kind === 'zt') return `封单${text}`;
  if (kind === 'dt') return `封单${text}`;
  return `成交额${text}`;
}

function surgeTimeValue(time?: string) {
  const [hour, minute, second = '0'] = String(time ?? '').split(':');
  return (Number(hour) || 0) * 3600 + (Number(minute) || 0) * 60 + (Number(second) || 0);
}

function formatTradeDate(date: Date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

function formatEastmoneyPoolTime(value?: number) {
  if (!value) return undefined;
  const text = String(value).padStart(6, '0');
  return `${text.slice(0, 2)}:${text.slice(2, 4)}`;
}

async function listFlowHot(): Promise<HotFocusItem[]> {
  const rows = await sdk.fundFlow.sectorRank({ indicator: 'today' });
  return rows.slice(0, 16).map((item) => ({
    id: `flow-${item.code}`,
    title: item.name,
    code: item.topStockCode,
    name: item.topStockName,
    changePercent: item.changePercent === null ? '--' : formatPercent(item.changePercent),
    amount: item.mainNetInflow === null ? '--' : formatMoney(item.mainNetInflow),
    description: `主力净流入 ${formatMoney(item.mainNetInflow)}${item.topStockName ? `，最大净流入：${item.topStockName}` : ''}`,
    tag: '资金流向',
    type: Number(item.mainNetInflow ?? 0) >= 0 ? 'surge' : 'plummet',
  }));
}

async function listStockRankHot(tab: HotFocusTab): Promise<HotFocusItem[]> {
  const rows = await sdk.fundFlow.rank({ indicator: 'today' });
  return rows.slice(0, 16).map((item) => ({
    id: `${tab}-${item.code}`,
    title: item.name,
    code: item.code,
    name: item.name,
    price: item.price ?? '--',
    changePercent: item.changePercent === null ? '--' : formatPercent(item.changePercent),
    amount: item.mainNetInflow === null ? '--' : formatMoney(item.mainNetInflow),
    description:
      tab === 'diagnosis'
        ? `主力净占比 ${formatPercent(item.mainNetInflowPercent ?? 0)}，点击查看个股详情`
        : `主力净流入 ${formatMoney(item.mainNetInflow)}，超大单 ${formatMoney(item.superLargeNetInflow)}`,
    tag: tab === 'diagnosis' ? '诊股候选' : '资金策略',
    type: Number(item.mainNetInflow ?? 0) >= 0 ? 'surge' : 'plummet',
  }));
}

export async function getBoardSnapshot(keyword: string): Promise<AgentResultCard> {
  const normalizedKeyword = normalizeBoardKeyword(keyword);
  const [localBoards, latestMarketRows, sectorRank, stockFlowRank, industries, concepts] = await Promise.allSettled([
    listMarketBoards(),
    listLatestMarketRows(),
    sdk.fundFlow.sectorRank({ indicator: 'today' }),
    sdk.fundFlow.rank({ indicator: 'today' }),
    sdk.board.industry.list(),
    sdk.board.concept.list(),
  ]);

  const localBoardRows = settledLocalBoards(localBoards);
  const remoteBoards = [...settledRows(industries), ...settledRows(concepts)];
  const flows = settledRows(sectorRank);
  const latestRows = latestMarketRows.status === 'fulfilled' ? latestMarketRows.value : [];
  const matched = findMatchedBoard(normalizedKeyword, localBoardRows, [...remoteBoards, ...flows]);
  const matchedCode = readCode(matched);
  const matchedName = readName(matched);
  const matchedFlow = matched ? findMatchedFlow(matched, flows) : undefined;
  const detail = matchedCode
    ? await buildLocalBoardDetail(matchedCode, matchedName ?? normalizedKeyword, latestRows).then((localDetail) =>
        localDetail.constituents?.length ? localDetail : getBoardDetail(matchedCode, false, matchedName).catch(() => localDetail),
      )
    : undefined;
  const stockFlowByCode = new Map(
    settledRows(stockFlowRank)
      .map((row) => [normalizeASymbol(readCode(row) ?? ''), row] as const)
      .filter(([code]) => /^\d{6}$/.test(code)),
  );
  const leaders = pickLeaderStocks(detail, stockFlowByCode);
  const localAmount = sumLeaderAmount(leaders);
  const mainFlow = readMainNetInflow(matchedFlow);
  const displayFlow = mainFlow === undefined && localAmount !== undefined ? localAmount : mainFlow;
  const rank = matchedFlow ? flows.findIndex((row) => row === matchedFlow) + 1 : 0;
  const narrative = buildBoardNarrative({
    keyword: normalizedKeyword,
    matched,
    matchedFlow,
    detail,
    leaders,
    rank,
    localAmount,
  });
  const rows = leaders.length
    ? leaders.map((leader) => ({
        股票: leader.name,
        代码: leader.code,
        涨跌幅: leader.changePercent,
        成交额: leader.amount,
        换手率: leader.turnover,
        资金特征: leader.flowFeature,
      }))
    : flows.slice(0, 6).map((flow) => ({
        板块: readName(flow) ?? '--',
        主力净流入: formatMoney(readMainNetInflow(flow)),
        涨跌幅: formatPercent(readChangePercent(flow)),
        龙头股: pickString(flow, ['topStockName', 'leaderName']) ?? '--',
      }));

  return {
    title: `${normalizedKeyword}板块资金流向与龙头股表现`,
    subtitle: matched ? `匹配板块：${matchedName ?? normalizedKeyword}` : '未精确匹配板块，展示资金流排名参考',
    metrics: [
      {
        label: mainFlow === undefined && localAmount !== undefined ? '龙头成交额' : '主力净流入',
        value: mainFlow === undefined && localAmount !== undefined ? formatMoney(localAmount) : formatMoney(mainFlow),
        tone: toneByNumber(displayFlow),
      },
      {
        label: '板块涨跌幅',
        value: formatPercent(readChangePercent(matchedFlow ?? matched)),
        tone: toneByNumber(readChangePercent(matchedFlow ?? matched)),
      },
      { label: '资金流排名', value: rank > 0 ? `第 ${rank} 名` : '暂无数据', tone: 'neutral' },
    ],
    rows,
    narrative,
  };
}

function settledRows(result: PromiseSettledResult<unknown>): AnyRecord[] {
  return result.status === 'fulfilled' && Array.isArray(result.value)
    ? result.value.filter(isRecord)
    : [];
}

function settledLocalBoards(result: PromiseSettledResult<MarketBoardRecord[]>): AnyRecord[] {
  return result.status === 'fulfilled'
    ? result.value.map((row) => ({
        code: row.code,
        name: row.name,
        changePercent: row.changePercent,
        source: row.source,
      }))
    : [];
}

async function buildLocalBoardDetail(
  boardCode: string,
  boardName: string,
  latestRows: MarketQuoteRow[],
): Promise<BoardDetail> {
  const constituents = await listBoardConstituents(boardCode).catch(() => []);
  const latestByCode = new Map(latestRows.map((row) => [row.code, row]));
  return {
    code: boardCode,
    name: boardName,
    constituents: constituents
      .map((item) => {
        const latest = latestByCode.get(item.stockCode);
        return {
          code: item.stockCode,
          name: item.stockName,
          price: latest?.price ?? '--',
          changePercent: latest?.changePercent === undefined ? '--' : formatPercent(latest.changePercent),
          amount: latest?.amount === undefined ? '--' : formatMoney(latest.amount),
          turnover: latest?.turnoverRate === undefined ? '--' : `${formatNumber(latest.turnoverRate)}%`,
        };
      })
      .sort((left, right) => Number(parseDisplayNumber(right.changePercent) ?? -100) - Number(parseDisplayNumber(left.changePercent) ?? -100)),
  };
}

function sumLeaderAmount(leaders: IBoardLeaderStock[]): number | undefined {
  const values = leaders.map((leader) => leader.amountValue).filter((value): value is number => value !== undefined);
  return values.length ? values.reduce((total, value) => total + value, 0) : undefined;
}

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null;
}

function normalizeBoardKeyword(value: string): string {
  return value.replace(/板块|行业/g, '').trim() || '热点';
}

function findMatchedBoard(keyword: string, boards: AnyRecord[], flows: AnyRecord[]): AnyRecord | undefined {
  const normalized = normalizeBoardName(keyword);
  return [...boards, ...flows].find((row) => {
    const name = readName(row);
    return name ? normalizeBoardName(name) === normalized || normalizeBoardName(name).includes(normalized) : false;
  });
}

function findMatchedFlow(board: AnyRecord, flows: AnyRecord[]): AnyRecord | undefined {
  const boardCode = readCode(board);
  const boardName = readName(board);
  const normalizedName = normalizeBoardName(boardName ?? '');
  return flows.find((row) => {
    const code = readCode(row);
    const name = readName(row);
    return (boardCode && code === boardCode) || (name ? normalizeBoardName(name) === normalizedName : false);
  });
}

function readCode(row?: AnyRecord): string | undefined {
  return pickString(row ?? {}, ['code', 'boardCode', 'sectorCode'])?.toUpperCase();
}

function readName(row?: AnyRecord): string | undefined {
  return pickString(row ?? {}, ['name', 'boardName', 'sectorName']);
}

function readMainNetInflow(row?: AnyRecord): number | undefined {
  return row ? pickNumber(row, ['mainNetInflow', 'netInflow', 'today', 'mainNetAmount']) : undefined;
}

function readChangePercent(row?: AnyRecord): number | undefined {
  return row ? pickNumber(row, ['changePercent', 'pctChg', 'changeRate']) : undefined;
}

function normalizeBoardName(value: string): string {
  return value.replace(/板块|行业|概念/g, '').trim();
}

interface IBoardLeaderStock {
  code: string;
  name: string;
  changePercent: string;
  amount: string;
  amountValue?: number;
  turnover: string;
  flowFeature: string;
  score: number;
}

function pickLeaderStocks(detail: BoardDetail | undefined, stockFlowByCode: Map<string, AnyRecord>): IBoardLeaderStock[] {
  return (detail?.constituents ?? [])
    .map((row): IBoardLeaderStock => {
      const code = normalizeASymbol(row.code);
      const flow = stockFlowByCode.get(code);
      const changeValue = parseDisplayNumber(row.changePercent);
      const amountValue = parseMoneyValue(row.amount);
      const flowValue = readMainNetInflow(flow);
      return {
        code,
        name: row.name,
        changePercent: formatDisplayPercent(row.changePercent),
        amount: formatDisplayMoney(row.amount),
        amountValue,
        turnover: formatDisplayTurnover(row.turnover),
        flowFeature: flowValue === undefined ? '资金数据暂无' : `主力净流入 ${formatMoney(flowValue)}`,
        score: (changeValue ?? -100) * 10 + (flowValue === undefined ? 0 : flowValue / 100000000),
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
}

function parseDisplayNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = Number.parseFloat(value.replace('%', '').replace(/[,+]/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseMoneyValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = Number.parseFloat(value.replace(/[,+]/g, ''));
  if (!Number.isFinite(parsed)) return undefined;
  if (value.includes('亿')) return parsed * 100000000;
  if (value.includes('万')) return parsed * 10000;
  return parsed;
}

function formatDisplayPercent(value: unknown): string {
  const num = parseDisplayNumber(value);
  return num === undefined ? '--' : `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
}

function formatDisplayMoney(value: unknown): string {
  if (typeof value === 'string' && value.trim() && value !== '--') return value;
  return formatMoney(value);
}

function formatDisplayTurnover(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value;
  const num = Number(value);
  return Number.isFinite(num) ? `${formatNumber(num)}%` : '--';
}

function toneByNumber(value: number | undefined): 'up' | 'down' | 'neutral' {
  if (value === undefined || value === 0) return 'neutral';
  return value > 0 ? 'up' : 'down';
}

function buildBoardNarrative(input: {
  keyword: string;
  matched?: AnyRecord;
  matchedFlow?: AnyRecord;
  detail?: BoardDetail;
  leaders: IBoardLeaderStock[];
  rank: number;
  localAmount?: number;
}): string {
  const boardName = readName(input.matched) ?? input.detail?.name ?? input.keyword;
  const boardCode = readCode(input.matched) ?? input.detail?.code ?? '未精确匹配';
  const mainFlow = readMainNetInflow(input.matchedFlow);
  const flowText = mainFlow === undefined && input.localAmount !== undefined
    ? `暂无板块主力净流入；前五龙头成交额合计 ${formatMoney(input.localAmount)}`
    : formatMoney(mainFlow);
  const changePercent = readChangePercent(input.matchedFlow ?? input.matched);
  const leaderTable = input.leaders.length
    ? input.leaders
        .map(
          (leader) =>
            `| ${leader.name} | ${leader.code} | ${leader.changePercent} | ${leader.amount} | ${leader.turnover} | ${leader.flowFeature} |`,
        )
        .join('\n')
    : '| 暂无数据 | -- | -- | -- | -- | 成分股或资金流数据暂不可用 |';
  const negativeText = buildNegativeText(mainFlow, changePercent, input.leaders.length);
  const rating = rateBoard(mainFlow, changePercent, input.leaders.length);

  return `## 📰 核心事件
- 分析对象：${boardName}（${boardCode}）
- 数据口径：stock-sdk 行业/概念板块、今日板块资金流、成分股实时行情。

## 💰 资金流向
- 主力净流入：${flowText}
- 板块涨跌幅：${formatPercent(changePercent)}
- 市场排名：${input.rank > 0 ? `资金流排名第 ${input.rank} 名` : '暂无数据'}

## 📈 龙头股表现
| 股票 | 代码 | 涨跌幅 | 成交额 | 换手率 | 资金特征 |
| --- | --- | --- | --- | --- | --- |
${leaderTable}

## ⚠️ 利空因素
- ${negativeText}

## 🏛️ 中长期影响
- 银行板块通常受利率环境、资产质量、信贷投放与宏观预期影响；若资金持续流入并由多只龙头扩散，后续可继续观察板块持续性与成交额配合。

## 🚨 风险提示
- 数据源可能存在延迟、缺失或字段变动；盘中资金流与涨跌幅波动较大，板块成分股口径也可能随上游数据调整。

## 🎯 综合结论
- ${rating}：结论仅基于当前可用的真实资金流、板块涨跌幅与龙头股表现生成。`;
}

function buildNegativeText(mainFlow: number | undefined, changePercent: number | undefined, leaderCount: number): string {
  if (mainFlow === undefined && changePercent === undefined) return '板块资金流与涨跌幅暂无数据，暂无法识别明确利空因素。';
  if ((mainFlow ?? 0) < 0) return '板块主力资金呈净流出，短期需观察资金承接力度。';
  if ((changePercent ?? 0) < 0) return '板块涨跌幅为负，说明价格表现尚未与资金面形成一致共振。';
  if (!leaderCount) return '龙头股样本暂不可用，无法确认板块内部扩散强度。';
  return '暂无明确利空数据，仍需关注资金持续性与大盘环境变化。';
}

function rateBoard(mainFlow: number | undefined, changePercent: number | undefined, leaderCount: number): string {
  if ((mainFlow ?? 0) > 0 && (changePercent ?? 0) >= 0 && leaderCount >= 3) return '🟢 偏利好';
  if ((mainFlow ?? 0) < 0 || (changePercent ?? 0) < 0) return '🔴 偏利空';
  return '🟡 中性';
}
