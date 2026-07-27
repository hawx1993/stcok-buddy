import StockSDK from 'stock-sdk';
import type { AgentResultCard, HotFocusItem, HotFocusTab, StockSurgeEvent } from '../../../src/shared/types.js';
import { isChinaMarketOpen, toShanghaiMarketTime } from '../../../src/shared/market-time.js';
import { isRemoteTradingDay } from '../market-data/providers.js';
import { formatMoney, formatNumber, formatPercent, pickNumber, pickString } from './format.js';
import { normalizeASymbol } from './symbols.js';
import { listStockSurgeEvents as listLocalStockSurgeEvents, listSurgeHistory, saveSurgeSnapshot } from './surge-history-store.js';

const sdk = new StockSDK({ timeout: 12_000, retry: { maxRetries: 1 } });

type AnyRecord = Record<string, unknown>;

export interface DailyDragonTigerItem {
  id: string;
  date: string;
  code: string;
  name: string;
  reason: string;
  close?: number;
  changePercent?: number;
  netBuy: number;
  buy: number;
  sell: number;
  turnover?: number;
}

export async function listHotFocus(tab: HotFocusTab): Promise<HotFocusItem[]> {
  try {
    if (tab === 'sector') return listSectorHot();
    if (tab === 'market') return listMarketHot();
    if (tab === 'surge') {
      const items = await listSurgeHot();
      if (items.length) return items;
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

function toTradeDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export async function listDailyDragonTiger(): Promise<DailyDragonTigerItem[]> {
  for (const date of recentIsoTradeDateCandidates()) {
    const url = new URL('https://datacenter-web.eastmoney.com/api/data/v1/get');
    url.search = new URLSearchParams({
      reportName: 'RPT_DAILYBILLBOARD_DETAILSNEW',
      columns: 'ALL',
      filter: `(TRADE_DATE>='${date}')(TRADE_DATE<='${date}')`,
      pageNumber: '1',
      pageSize: '500',
      sortColumns: 'BILLBOARD_NET_AMT',
      sortTypes: '-1',
      source: 'WEB',
      client: 'WEB',
    }).toString();
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: 'https://data.eastmoney.com/' },
    });
    if (!response.ok) continue;
    const payload = (await response.json()) as { result?: { data?: AnyRecord[] } };
    const rows = (payload.result?.data ?? [])
      .map(toDailyDragonTigerItem)
      .filter((item): item is DailyDragonTigerItem => Boolean(item));
    if (rows.length) return rows;
  }
  return [];
}

function toDailyDragonTigerItem(row: AnyRecord): DailyDragonTigerItem | undefined {
  const code = pickString(row, ['SECURITY_CODE']);
  const name = pickString(row, ['SECURITY_NAME_ABBR']);
  if (!code || !name) return undefined;
  const date = (pickString(row, ['TRADE_DATE']) ?? '').slice(0, 10);
  const netBuy = pickNumber(row, ['BILLBOARD_NET_AMT']) ?? 0;
  const buy = pickNumber(row, ['BILLBOARD_BUY_AMT']) ?? 0;
  const sell = pickNumber(row, ['BILLBOARD_SELL_AMT']) ?? 0;
  return {
    id: `daily-lhb-${date}-${code}`,
    date,
    code,
    name,
    reason: pickString(row, ['EXPLANATION']) ?? '',
    close: pickNumber(row, ['CLOSE_PRICE']),
    changePercent: pickNumber(row, ['CHANGE_RATE']),
    netBuy,
    buy,
    sell,
    turnover: pickNumber(row, ['TURNOVERRATE']),
  };
}

function recentIsoTradeDateCandidates() {
  const result: string[] = [];
  const date = new Date();
  for (let i = 0; i < 7; i += 1) {
    result.push(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    );
    date.setDate(date.getDate() - 1);
  }
  return result;
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
  ].sort((a, b) => surgeTimeValue(b.time) - surgeTimeValue(a.time));
  surgeCache = { items, updatedAt: Date.now() };
  saveSurgeSnapshot(items).catch((err) => console.warn('[hot-focus] save snapshot failed', err));
  return items;
}

export async function listStockSurgeEvents(symbolInput: string): Promise<StockSurgeEvent[]> {
  const symbol = normalizeASymbol(symbolInput);
  const [historyResult, currentResult] = await Promise.allSettled([
    sdk.marketEvent.individualChangesHistory(symbol, { days: 7 }),
    listSurgeHot(),
  ]);
  if (historyResult.status === 'rejected' && currentResult.status === 'rejected') {
    // ponytail: fall back to local DB when both remotes are unavailable (offline)
    console.warn('[surge] remotes unavailable, falling back to local db for', symbol);
    return listLocalStockSurgeEvents(symbol);
  }

  const historyEvents =
    historyResult.status === 'fulfilled' ? toIndividualHistoryEvents(historyResult.value, symbol) : [];
  const currentEvents =
    currentResult.status === 'fulfilled'
      ? currentResult.value.filter((item) => item.code === symbol).map((item) => toCurrentSurgeEvent(item, symbol))
      : [];
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

function toIndividualHistoryEvents(
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
  return changes.map((item, index) => {
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
    };
  });
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
  const [industries, concepts, sectorRank] = await Promise.allSettled([
    sdk.board.industry.list(),
    sdk.board.concept.list(),
    sdk.fundFlow.sectorRank({ indicator: 'today' }),
  ]);

  const boards = [
    ...(industries.status === 'fulfilled' ? (industries.value as unknown as AnyRecord[]) : []),
    ...(concepts.status === 'fulfilled' ? (concepts.value as unknown as AnyRecord[]) : []),
  ];
  const matched = boards.find((board) =>
    String(board.name ?? board.boardName ?? '').includes(keyword.replace(/板块|行业/g, '')),
  );
  const flows = sectorRank.status === 'fulfilled' ? (sectorRank.value as unknown as AnyRecord[]).slice(0, 6) : [];

  return {
    title: `${keyword}板块速览`,
    subtitle: matched ? `匹配板块：${String(matched.name ?? matched.boardName)}` : '未精确匹配板块，展示资金流排名参考',
    rows: flows.map((flow) => ({
      板块: String(flow.name ?? flow.boardName ?? flow.sectorName ?? '--'),
      净流入: String(flow.netInflow ?? flow.mainNetInflow ?? flow.today ?? '--'),
      涨跌幅: String(flow.changePercent ?? flow.pctChg ?? '--'),
    })),
    narrative: '板块数据来自 stock-sdk 行业/概念与资金流接口。若上游数据源限流或字段变动，结果会自动降级展示。',
  };
}
