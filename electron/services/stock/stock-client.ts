import StockSDK from 'stock-sdk';
import type { AgentResultCard, BoardDetail, HotFocusItem, HotFocusTab, KlinePoint, StockDetail } from '../../../src/shared/types.js';
import { formatNumber, formatPercent, pickNumber, pickString } from './format.js';
import { analyzeIndicators } from './indicators.js';
import { extractSymbolCandidate, normalizeASymbol, inferExchange, toQuoteSymbol } from './symbols.js';

const sdk = new StockSDK({ timeout: 12_000, retry: { maxRetries: 1 } });

type AnyRecord = Record<string, unknown>;

function toStockDetail(raw: unknown, fallbackCode: string): StockDetail {
  const record = (raw ?? {}) as AnyRecord;
  const code = pickString(record, ['code', '代码', 'symbol', 'f12']) ?? fallbackCode;
  const name = pickString(record, ['name', '名称', 'f14']) ?? code;
  const price = pickNumber(record, ['price', '最新价', 'lastPrice', 'close', 'f2']);
  const changePercent = pickNumber(record, ['changePercent', '涨跌幅', 'pctChg', 'f3']);
  const change = pickNumber(record, ['change', '涨跌额', 'f4']);
  const volume = pickNumber(record, ['volume', '成交量', 'f5']);
  const turnover = pickNumber(record, ['turnover', '成交额', 'amount', 'f6']);
  const pe = pickNumber(record, ['pe', 'PE', '市盈率', 'f9']);
  const pb = pickNumber(record, ['pb', 'PB', '市净率', 'f23']);
  const marketCap = pickNumber(record, ['marketCap', 'totalMarketCap', '总市值', 'f20']);

  return {
    code,
    name,
    exchange: inferExchange(code),
    price: price === undefined ? '--' : price,
    change: change === undefined ? '--' : `${change >= 0 ? '+' : ''}${formatNumber(change)}`,
    changePercent: changePercent === undefined ? '--' : formatPercent(changePercent),
    pe: pe === undefined ? '--' : formatNumber(pe),
    pb: pb === undefined ? '--' : formatNumber(pb),
    marketCap: marketCap === undefined ? '--' : `${(marketCap / 100000000).toFixed(1)}亿`,
    volume: volume === undefined ? '--' : `${(volume / 10000).toFixed(1)}万手`,
    turnover: turnover === undefined ? '--' : `${(turnover / 100000000).toFixed(2)}亿`,
    rating: {
      fundamental: '待评估',
      valuation: pe && pe < 25 ? '相对合理' : '需核查',
      tech: '待分析',
      risk: '中性',
    },
    summary: `${name}（${code}）实时行情来自 stock-sdk。当前价格 ${price === undefined ? '--' : price}，涨跌幅 ${changePercent === undefined ? '--' : formatPercent(changePercent)}。`,
  };
}

export async function resolveASymbol(input: string): Promise<string> {
  const candidate = extractSymbolCandidate(input);
  if (/^\d{6}$/.test(candidate)) return candidate;
  const result = (await sdk.search(candidate)).find((item: { code?: string; category?: string }) => item.category === 'stock' && item.code);
  return result?.code?.replace(/^\D+/, '') ?? normalizeASymbol(candidate);
}

export async function getQuote(symbolInput: string): Promise<StockDetail> {
  const symbol = normalizeASymbol(symbolInput);
  const quotes = await sdk.quotes.cn([toQuoteSymbol(symbol)]);
  return toStockDetail(quotes[0], symbol);
}

export async function getKline(symbolInput: string, limit = 120, period = '1d'): Promise<KlinePoint[]> {
  const symbol = normalizeASymbol(symbolInput);
  try {
    if (period === '15m') return getTencentMinuteKline(symbol, limit, '15');
    if (period === '1h') return getTencentMinuteKline(symbol, limit, '60');
    if (period === '4h') return aggregateKline(await getTencentMinuteKline(symbol, limit * 4, '60'), 4).slice(-limit);
    const tencent = await getTencentHistoryKline(symbol, limit, period);
    if (tencent.length) return tencent;
    const data = await sdk.kline.cn(symbol, { period: toSdkKlinePeriod(period), adjust: 'qfq' as const });
    return data.slice(-limit).map(toKlinePoint).filter((point): point is KlinePoint => Boolean(point));
  } catch {
    const klt = toEastmoneyKlt(period);
    try {
      return period === '4h' ? aggregateKline(await getEastmoneyKline(symbol, limit * 4, '60'), 4).slice(-limit) : getEastmoneyKline(symbol, limit, klt);
    } catch {
      return [];
    }
  }
}

function toSdkKlinePeriod(period: string): 'daily' | 'weekly' | 'monthly' {
  return period === '1w' ? 'weekly' : period === '1mo' ? 'monthly' : 'daily';
}

function toEastmoneyKlt(period: string) {
  return ({ '15m': '15', '1h': '60', '4h': '60', '1d': '101', '1w': '102', '1mo': '103' } as Record<string, string>)[period] ?? '101';
}

async function getEastmoneyKline(symbol: string, limit: number, klt = '101'): Promise<KlinePoint[]> {
  const market = symbol.startsWith('6') ? '1' : '0';
  const url = new URL('https://push2his.eastmoney.com/api/qt/stock/kline/get');
  url.search = new URLSearchParams({
    secid: `${market}.${symbol}`,
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    klt,
    fqt: '1',
    beg: '0',
    end: '20500101',
    lmt: String(limit),
  }).toString();
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://quote.eastmoney.com/' } });
    if (!response.ok) return [];
    const payload = await response.json() as { data?: { klines?: string[] } };
    return (payload.data?.klines ?? []).map(parseEastmoneyKline).filter((point): point is KlinePoint => Boolean(point));
  } catch {
    return [];
  }
}

async function getTencentHistoryKline(symbol: string, limit: number, period: string): Promise<KlinePoint[]> {
  const quoteSymbol = toQuoteSymbol(symbol);
  const type = period === '1w' ? 'week' : period === '1mo' ? 'month' : 'day';
  const key = `qfq${type}`;
  const url = new URL('https://ifzq.gtimg.cn/appstock/app/fqkline/get');
  url.search = new URLSearchParams({ param: `${quoteSymbol},${type},,,${limit},qfq` }).toString();
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: `https://gu.qq.com/${quoteSymbol}/gp` } });
    if (!response.ok) return [];
    const payload = await response.json() as { data?: Record<string, Record<string, unknown[]>> };
    const rows = payload.data?.[quoteSymbol]?.[key] ?? [];
    return rows.map(parseTencentKline).filter((point): point is KlinePoint => Boolean(point));
  } catch {
    return [];
  }
}

async function getTencentMinuteKline(symbol: string, limit: number, period: '15' | '60'): Promise<KlinePoint[]> {
  const quoteSymbol = toQuoteSymbol(symbol);
  const url = new URL('https://ifzq.gtimg.cn/appstock/app/kline/mkline');
  url.search = new URLSearchParams({ param: `${quoteSymbol},m${period},,${limit}` }).toString();
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: `https://gu.qq.com/${quoteSymbol}/gp` } });
    if (!response.ok) return [];
    const payload = await response.json() as { data?: Record<string, Record<string, unknown[]>> };
  const rows = payload.data?.[quoteSymbol]?.[`m${period}`] ?? [];
    return rows.map(parseTencentKline).filter((point): point is KlinePoint => Boolean(point));
  } catch {
    return [];
  }
}

function parseTencentKline(row: unknown): KlinePoint | undefined {
  if (!Array.isArray(row)) return undefined;
  const [time, open, close, high, low, volume, , amount] = row;
  const point = {
    time: String(time ?? ''),
    timestamp: parseMarketTime(String(time ?? '')),
    open: Number(open),
    close: Number(close),
    high: Number(high),
    low: Number(low),
    volume: Number(volume),
    amount: amount === undefined ? undefined : Number(amount) * 10000,
  };
  return [point.open, point.close, point.high, point.low].every(Number.isFinite) ? point : undefined;
}

function aggregateKline(data: KlinePoint[], size: number): KlinePoint[] {
  const result: KlinePoint[] = [];
  for (let i = 0; i < data.length; i += size) {
    const chunk = data.slice(i, i + size);
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    if (!first || !last) continue;
    result.push({
      time: last.time,
      timestamp: last.timestamp,
      open: first.open,
      close: last.close,
      high: Math.max(...chunk.map((item) => item.high)),
      low: Math.min(...chunk.map((item) => item.low)),
      volume: chunk.reduce((sum, item) => sum + item.volume, 0),
      amount: chunk.reduce((sum, item) => sum + (item.amount ?? 0), 0),
      change: last.close - first.open,
      changePercent: first.open ? ((last.close - first.open) / first.open) * 100 : undefined,
      turnoverRate: chunk.reduce((sum, item) => sum + (item.turnoverRate ?? 0), 0),
      pe: last.pe,
    });
  }
  return result;
}

function parseEastmoneyKline(line: string): KlinePoint | undefined {
  const [time, open, close, high, low, volume, amount, amplitude, changePercent, change, turnoverRate] = line.split(',');
  const point = {
    time,
    timestamp: parseMarketTime(time),
    open: Number(open),
    close: Number(close),
    high: Number(high),
    low: Number(low),
    volume: Number(volume),
    amount: Number(amount),
    change: Number(change),
    changePercent: Number(changePercent),
    turnoverRate: Number(turnoverRate),
  };
  void amplitude;
  return [point.open, point.close, point.high, point.low].every(Number.isFinite) ? point : undefined;
}

function parseMarketTime(value: string): number | undefined {
  const text = String(value || '').trim();
  const minute = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (minute) return new Date(`${minute[1]}-${minute[2]}-${minute[3]}T${minute[4]}:${minute[5]}:00+08:00`).getTime();
  const day = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (day) return new Date(`${day[1]}-${day[2]}-${day[3]}T00:00:00+08:00`).getTime();
  const date = Date.parse(text.includes('T') ? text : `${text}T00:00:00+08:00`);
  return Number.isFinite(date) ? date : undefined;
}

function toKlinePoint(raw: unknown): KlinePoint | undefined {
  const record = (raw ?? {}) as AnyRecord;
  const open = pickNumber(record, ['open', '开盘价']);
  const close = pickNumber(record, ['close', '收盘价']);
  const high = pickNumber(record, ['high', '最高价']);
  const low = pickNumber(record, ['low', '最低价']);
  if (open === undefined || close === undefined || high === undefined || low === undefined) return undefined;
  return {
    time: pickString(record, ['date', 'time', '日期']) ?? '',
    timestamp: pickNumber(record, ['timestamp']) ?? parseMarketTime(pickString(record, ['date', 'time', '日期']) ?? ''),
    open,
    close,
    high,
    low,
    volume: pickNumber(record, ['volume', '成交量']) ?? 0,
    amount: pickNumber(record, ['amount', '成交额']),
    change: pickNumber(record, ['change', '涨跌额']),
    changePercent: pickNumber(record, ['changePercent', '涨跌幅']),
    turnoverRate: pickNumber(record, ['turnoverRate', '换手率']),
    pe: pickNumber(record, ['pe', 'PE', '市盈率']),
  };
}

export async function getStockDetail(symbolInput: string): Promise<StockDetail> {
  try {
    const quote = await getQuote(symbolInput);
    try {
      const technical = await analyzeTechnical(symbolInput);
      return {
        ...quote,
        rating: {
          fundamental: quote.rating?.fundamental ?? '待评估',
          valuation: quote.rating?.valuation ?? '需核查',
          risk: quote.rating?.risk ?? '中性',
          tech: technical.subtitle?.includes('金叉') || technical.subtitle?.includes('站上') ? '偏多' : '中性',
        },
        summary: `${quote.summary ?? ''} ${technical.narrative ?? ''}`.trim(),
      };
    } catch {
      return quote;
    }
  } catch (error) {
    const code = normalizeASymbol(symbolInput);
    return {
      code,
      name: code,
      exchange: inferExchange(code),
      price: '--',
      changePercent: '--',
      summary: `暂时无法从 stock-sdk 获取 ${code} 的实时详情：${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}

export async function getBoardDetail(symbol: string): Promise<BoardDetail> {
  const [industries, concepts] = await Promise.all([sdk.board.industry.list(), sdk.board.concept.list()]);
  const board = [...industries, ...concepts].find((item) => item.code === symbol) ?? { code: symbol, name: symbol, changePercent: null };
  const loader = industries.some((item) => item.code === symbol) ? sdk.board.industry.constituents : sdk.board.concept.constituents;
  const rows = await loader(symbol);
  return {
    code: board.code,
    name: board.name,
    changePercent: board.changePercent === null ? '--' : formatPercent(board.changePercent),
    constituents: rows.slice(0, 80).map((item) => ({
      code: item.code,
      name: item.name,
      price: item.price ?? '--',
      changePercent: item.changePercent === null ? '--' : formatPercent(item.changePercent),
      amount: item.amount === null ? '--' : formatMoney(item.amount),
      turnover: item.turnoverRate === null ? '--' : `${formatNumber(item.turnoverRate)}%`,
    })),
  };
}

export async function analyzeTechnical(symbolInput: string): Promise<AgentResultCard> {
  const klines = await getKline(symbolInput, 140);
  return analyzeIndicators(klines);
}

export async function listHotFocus(tab: HotFocusTab): Promise<HotFocusItem[]> {
  try {
    if (tab === 'sector') return listSectorHot();
    if (tab === 'market') return listMarketHot();
    if (tab === 'surge') return listSurgeHot();
    if (tab === 'flow') return listFlowHot();
    return listStockRankHot(tab);
  } catch {
    return [];
  }
}

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
    const payload = await response.json() as { result?: { data?: AnyRecord[] } };
    const rows = (payload.result?.data ?? []).map(toDailyDragonTigerItem).filter((item): item is DailyDragonTigerItem => Boolean(item));
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
    result.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
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
      .sort((a, b) => Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0))
      .slice(0, 12)
      .map((item) => ({
        id: `sector-${item.code}`,
        title: item.name,
        code: item.code,
        name: item.name,
        changePercent: formatPercent(item.changePercent ?? 0),
        amount: item.totalMarketCap ? `${(item.totalMarketCap / 100000000).toFixed(1)}亿` : undefined,
        description: item.leadingStock ? `领涨：${item.leadingStock}${item.leadingStockChangePercent === null ? '' : ` ${formatPercent(item.leadingStockChangePercent)}`}` : 'stock-sdk 板块行情',
        tag: item.code,
        type: Number(item.changePercent ?? 0) >= 0 ? 'surge' : 'plummet',
      }));
  }
  return flows.status === 'fulfilled' && flows.value.length ? flows.value.slice(0, 12).map((item) => ({
    id: `sector-${item.code}`,
    title: item.name,
    code: item.code,
    name: item.name,
    changePercent: item.changePercent === null ? '--' : formatPercent(item.changePercent),
    amount: item.mainNetInflow === null ? '--' : formatMoney(item.mainNetInflow),
    description: `主力净流入 ${formatMoney(item.mainNetInflow)}${item.topStockName ? `，最大净流入：${item.topStockName}` : ''}`,
    tag: item.code,
    type: Number(item.changePercent ?? 0) >= 0 ? 'surge' : 'plummet',
  })) : fallbackSectorHot();
}

function fallbackSectorHot(): HotFocusItem[] {
  return [
    ['BK0475', '半导体', '+1.86%', '国产替代与AI算力链活跃'],
    ['BK0437', '酿酒行业', '+1.12%', '消费复苏预期升温'],
    ['BK0428', '证券', '+0.94%', '市场成交回暖带动券商弹性'],
    ['BK0737', '软件开发', '+0.73%', 'AI应用与信创方向轮动'],
  ].map(([code, name, changePercent, description]) => ({
    id: `sector-fallback-${code}`,
    title: name,
    code,
    name,
    changePercent,
    description,
    tag: code,
    type: String(changePercent).startsWith('-') ? 'plummet' : 'surge',
  }));
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

async function listSurgeHot(): Promise<HotFocusItem[]> {
  const [changes, pools] = await Promise.all([listStockChangeEvents(), listEastmoneySurgeHot().catch(() => [])]);
  return [...changes, ...pools.filter((pool) => !changes.some((change) => change.code === pool.code && change.tag === pool.tag))]
    .sort((a, b) => surgeTimeValue(b.time) - surgeTimeValue(a.time));
}

type EastmoneyPoolKind = 'zt' | 'zb' | 'dt';

async function listStockChangeEvents(): Promise<HotFocusItem[]> {
  const groups = await Promise.allSettled(stockChangeTypes.map((type) => withTimeout(sdk.marketEvent.stockChanges(type), [])));
  return groups.flatMap((group, groupIndex) => group.status === 'fulfilled' ? toStockChangeHotItems(group.value, groupIndex) : []);
}

function toStockChangeHotItems(changes: Awaited<ReturnType<typeof sdk.marketEvent.stockChanges>>, groupIndex: number): HotFocusItem[] {
  return changes.flatMap((item, index): HotFocusItem[] => {
    const parsed = parseStockChangeInfo(item.changeType, item.info);
    if (isLargeTrade(item.changeTypeLabel, item.changeType) && (parsed.hands ?? 0) < 10000) return [];
    const reason = formatStockChangeReason(item.changeTypeLabel, item.changeType, parsed.hands ?? 0);
    return [{
      id: `surge-${item.changeType}-${item.time}-${item.code}-${groupIndex}-${index}`,
      title: `${item.name} ${item.code}`,
      code: item.code,
      name: item.name,
      time: item.time,
      price: parsed.price === undefined ? undefined : parsed.price.toFixed(2),
      changePercent: parsed.pct === undefined ? undefined : formatPercent(parsed.pct),
      amount: parsed.amount ?? formatChangeHands(parsed.hands, reason),
      description: reason,
      tag: reason,
      type: /卖|跌|跳水|下挫|低|开板/.test(reason) ? 'plummet' : 'surge',
    }];
  });
}

const stockChangeTypes = [
  'high_60d', 'low_60d', 'rocket_launch', 'quick_rebound', 'surge_60d', 'drop_60d', 'accelerate_down', 'high_dive',
  'limit_down_seal', 'limit_up_seal', 'limit_down_open', 'limit_up_open', 'large_buy', 'large_sell',
] as const;

function withTimeout<T>(promise: Promise<T>, fallback: T, ms = 4_500) {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function parseStockChangeInfo(type: string | undefined, info: string) {
  const [first, second, third, fourth] = String(info ?? '').split(',').map(Number);
  if (type === 'large_buy' || type === 'large_sell') return { hands: first / 100, price: second, pct: third * 100 };
  if (type === 'limit_up_seal' || type === 'limit_down_seal' || type === 'limit_up_open' || type === 'limit_down_open') {
    return { price: first, pct: fourth * 100, amount: Number.isFinite(second) ? `封单${formatMoney(second)}` : undefined };
  }
  return { price: second, pct: first * 100 };
}

function isLargeTrade(label: string, type?: string) {
  return type === 'large_buy' || type === 'large_sell' || label === '大笔买入' || label === '大笔卖出';
}

function formatStockChangeReason(label: string, type: string | undefined, hands: number) {
  if (type === 'high_60d') return '60日新高';
  if (type === 'low_60d') return '60日新低';
  if (type === 'surge_60d' || type === 'rocket_launch' || type === 'quick_rebound') return '快速涨幅';
  if (type === 'drop_60d' || type === 'accelerate_down' || type === 'high_dive') return '快速跌幅';
  if (type === 'limit_down_seal') return '封跌停板';
  if (type === 'limit_up_seal') return '封涨停板';
  if (type === 'limit_down_open') return '跌停开板';
  if (type === 'limit_up_open') return '涨停开板';
  if ((type === 'large_buy' || label === '大笔买入') && hands >= 10000) return '特大单买入';
  if ((type === 'large_sell' || label === '大笔卖出') && hands >= 10000) return '特大单卖出';
  return label;
}

function formatChangeHands(hands: number | undefined, reason: string) {
  if (!Number.isFinite(hands) || !hands || hands <= 0) return undefined;
  const action = reason.includes('买') ? '买入' : reason.includes('卖') ? '卖出' : '';
  const size = hands >= 10000 ? `${(hands / 10000).toFixed(2).replace(/\.00$/, '')}万手` : `${hands.toFixed(0)}手`;
  return action ? `${action}${size}` : size;
}

const eastmoneyPoolConfigs: Record<EastmoneyPoolKind, { endpoint: string; sort: string; tag: string; type: HotFocusItem['type'] }> = {
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
  for (const date of recentTradeDateCandidates()) {
    const items = await listEastmoneySurgeByDate(date);
    if (items.length) return items;
  }
  return [];
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

  const payload = await response.json() as { data?: { pool?: AnyRecord[] } | AnyRecord[] };
  const pool = Array.isArray(payload.data) ? payload.data : payload.data?.pool;
  return (pool ?? []).map((row) => toEastmoneyPoolItem(row, kind, config, date)).filter((item): item is HotFocusItem => Boolean(item));
}

function toEastmoneyPoolItem(row: AnyRecord, kind: EastmoneyPoolKind, config: typeof eastmoneyPoolConfigs[EastmoneyPoolKind], date: string): HotFocusItem | undefined {
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
  ].filter(Boolean).join(' · ');

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

function recentTradeDateCandidates() {
  const result: string[] = [];
  const date = new Date();
  for (let i = 0; i < 7; i += 1) {
    result.push(`${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`);
    date.setDate(date.getDate() - 1);
  }
  return result;
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
    description: tab === 'diagnosis' ? `主力净占比 ${formatPercent(item.mainNetInflowPercent ?? 0)}，点击查看个股详情` : `主力净流入 ${formatMoney(item.mainNetInflow)}，超大单 ${formatMoney(item.superLargeNetInflow)}`,
    tag: tab === 'diagnosis' ? '诊股候选' : '资金策略',
    type: Number(item.mainNetInflow ?? 0) >= 0 ? 'surge' : 'plummet',
  }));
}

function formatMoney(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  const sign = num > 0 ? '+' : num < 0 ? '-' : '';
  const abs = Math.abs(num);
  if (abs >= 100000000) return `${sign}${(abs / 100000000).toFixed(2)}亿`;
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(2)}万`;
  return `${sign}${abs.toFixed(0)}`;
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
  const matched = boards.find((board) => String(board.name ?? board.boardName ?? '').includes(keyword.replace(/板块|行业/g, '')));
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
