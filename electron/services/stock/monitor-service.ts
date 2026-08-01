import { isChinaMarketOpen, toShanghaiMarketTime } from '../../../src/shared/market-time.js';
import { listFavoriteStocks } from '../config-store.js';
import {
  cleanupMonitorHistoryNoise,
  countMonitorHistory,
  countMonitorHistoryByCategory,
  enqueueMonitorEvents,
  flushMonitorEventQueue,
  listMonitorDates,
  listMonitorHistory,
  pruneMonitorHistory,
} from './monitor-history-store.js';
import { listRecentStockSurgeEvents } from './surge-history-store.js';
import { getStockChip } from '../market-data/market-data-store.js';
import { getAllMarketQuoteRows } from './market-page.js';
import { getBatchQuotes, getChipDistribution, listHotFocus } from './stock-client.js';
import { listStockNewsAnnouncements } from './news-client.js';
import type {
  AnnouncementItem,
  FavoriteStock,
  HotFocusItem,
  IChipDistributionResult,
  IMonitorEvent,
  IMonitorFeed,
  MarketNewsItem,
  MarketQuoteRow,
  StockDetail,
  StockSurgeEvent,
  TMonitorCategory,
} from '../../../src/shared/types.js';

const CATEGORIES: TMonitorCategory[] = [
  'large-order',
  'chip',
  'technical',
  'news',
  'risk',
  'ai-opportunity',
  'ai-warning',
];

// Default market universe monitored even when the user has no favorites.
// Events are still generated only from real quote values returned by getBatchQuotes.
const DEFAULT_MONITOR_UNIVERSE: FavoriteStock[] = [
  { code: '300476', name: '胜宏科技', createdAt: new Date().toISOString() },
  { code: '300308', name: '中际旭创', createdAt: new Date().toISOString() },
  { code: '002384', name: '东山精密', createdAt: new Date().toISOString() },
  { code: '002594', name: '比亚迪', createdAt: new Date().toISOString() },
  { code: '300750', name: '宁德时代', createdAt: new Date().toISOString() },
  { code: '600519', name: '贵州茅台', createdAt: new Date().toISOString() },
  { code: '000858', name: '五粮液', createdAt: new Date().toISOString() },
  { code: '002371', name: '北方华创', createdAt: new Date().toISOString() },
  { code: '603019', name: '中科曙光', createdAt: new Date().toISOString() },
  { code: '688981', name: '中芯国际', createdAt: new Date().toISOString() },
  { code: '600900', name: '长江电力', createdAt: new Date().toISOString() },
  { code: '601318', name: '中国平安', createdAt: new Date().toISOString() },
  { code: '000001', name: '平安银行', createdAt: new Date().toISOString() },
  { code: '300059', name: '东方财富', createdAt: new Date().toISOString() },
  { code: '002230', name: '科大讯飞', createdAt: new Date().toISOString() },
  { code: '600036', name: '招商银行', createdAt: new Date().toISOString() },
  { code: '000333', name: '美的集团', createdAt: new Date().toISOString() },
  { code: '000651', name: '格力电器', createdAt: new Date().toISOString() },
  { code: '002460', name: '赣锋锂业', createdAt: new Date().toISOString() },
  { code: '300274', name: '阳光电源', createdAt: new Date().toISOString() },
];

const CATEGORY_META: Record<TMonitorCategory, { label: string; icon: string; tone: 'positive' | 'warning' | 'danger' | 'neutral' }> = {
  'large-order': { label: '大单异动', icon: '💵', tone: 'positive' },
  chip: { label: '筹码变化', icon: '📊', tone: 'warning' },
  technical: { label: '技术信号', icon: '📈', tone: 'warning' },
  'dragon-tiger': { label: '龙虎榜', icon: '🐉', tone: 'positive' },
  news: { label: '新闻公告', icon: '📰', tone: 'neutral' },
  risk: { label: '风险预警', icon: '⚠️', tone: 'danger' },
  'ai-opportunity': { label: 'AI机会', icon: '🤖', tone: 'positive' },
  'ai-warning': { label: 'AI预警', icon: '🔴', tone: 'danger' },
};

const DETAIL_STOCK_LIMIT = 8;
const CHIP_SCAN_LIMIT = 120;
const CHIP_SIGNAL_EVENT_LIMIT = 50;
let chipScanCursor = 0;
let lastPrunedDate = '';

function numericValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value.replaceAll(',', '').replace('%', '').replace('+', '').trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function quoteChangePercent(quote: StockDetail) {
  const price = numericValue(quote.price);
  const prevClose = numericValue(quote.prevClose);
  if (price !== undefined && prevClose !== undefined && prevClose > 0) {
    return ((price - prevClose) / prevClose) * 100;
  }
  return numericValue(quote.changePercent);
}

function quotePrice(quote: StockDetail | HotFocusItem | undefined) {
  return numericValue(quote?.price);
}

function quoteName(stock: Pick<FavoriteStock, 'code' | 'name'>, quote: StockDetail | HotFocusItem | undefined) {
  return quote?.name && quote.name !== stock.code ? quote.name : stock.name;
}

function mergeQuoteMaps(...maps: Array<Map<string, StockDetail>>) {
  const merged = new Map<string, StockDetail>();
  for (const map of maps) {
    for (const [code, quote] of map.entries()) merged.set(code, { ...merged.get(code), ...quote });
  }
  return merged;
}

function marketRowToFavorite(row: MarketQuoteRow): FavoriteStock {
  return { code: row.code, name: row.name || row.code, createdAt: new Date(0).toISOString() };
}

function marketRowToStockDetail(row: MarketQuoteRow): StockDetail {
  return {
    code: row.code,
    name: row.name || row.code,
    price: row.price,
    changePercent: row.changePercent === undefined ? undefined : String(row.changePercent),
    open: row.open,
    high: row.high,
    low: row.low,
    prevClose: row.prevClose,
    marketCap: row.marketCap === undefined ? undefined : String(row.marketCap),
    turnoverRate: row.turnoverRate,
    volume: row.volume === undefined ? undefined : String(row.volume),
    turnover: row.amount === undefined ? undefined : String(row.amount),
    industry: row.industry,
  };
}

function dedupeStocks(stocks: FavoriteStock[]) {
  const seen = new Set<string>();
  return stocks.filter((stock) => stock.code && !seen.has(stock.code) && seen.add(stock.code));
}

function rotateCandidates(stocks: FavoriteStock[], limit: number) {
  if (stocks.length <= limit) return stocks;
  const start = chipScanCursor % stocks.length;
  chipScanCursor = (start + limit) % stocks.length;
  return [...stocks.slice(start), ...stocks.slice(0, start)].slice(0, limit);
}

async function buildChipScanUniverse(monitorUniverse: FavoriteStock[]) {
  const marketRows = await getAllMarketQuoteRows().catch((error) => {
    console.warn('[monitor] failed to fetch market quote candidates', error);
    return [];
  });
  const marketQuoteByCode = new Map(marketRows.map((row) => [row.code, marketRowToStockDetail(row)]));
  const marketCapCandidates = marketRows
    .filter((row) => {
      const marketCapYi = parseMarketCapYi(row.marketCap);
      if (marketCapYi === undefined || marketCapYi < 20 || marketCapYi > 100) return false;
      return numericValue(row.amount) !== 0 || numericValue(row.volume) !== 0;
    })
    .sort((a, b) => {
      const turnoverDelta = (numericValue(b.turnoverRate) ?? 0) - (numericValue(a.turnoverRate) ?? 0);
      if (turnoverDelta !== 0) return turnoverDelta;
      return Math.abs(numericValue(b.changePercent) ?? 0) - Math.abs(numericValue(a.changePercent) ?? 0);
    })
    .map(marketRowToFavorite);
  const marketStocks = dedupeStocks(marketCapCandidates);
  const rotatedMarketStocks = rotateCandidates(
    marketStocks.filter((stock) => !monitorUniverse.some((item) => item.code === stock.code)),
    Math.max(0, CHIP_SCAN_LIMIT - monitorUniverse.length),
  );
  return {
    stocks: dedupeStocks([...monitorUniverse, ...rotatedMarketStocks]).slice(0, CHIP_SCAN_LIMIT),
    quoteByCode: marketQuoteByCode,
  };
}

function isChipDistributionResult(value: unknown): value is IChipDistributionResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Partial<IChipDistributionResult>;
  return Array.isArray(result.distributions) && Array.isArray(result.trend) && typeof result.source === 'string';
}

async function collectCachedChipResults(
  stocks: FavoriteStock[],
  quoteByCode: Map<string, StockDetail>,
  timestamp: string,
  tradeDate: string,
  monitorCodes: Set<string>,
) {
  const events: IMonitorEvent[] = [];
  for (const stock of stocks) {
    const cached = await getStockChip(stock.code).catch(() => undefined);
    if (!isChipDistributionResult(cached)) continue;
    const chip = cached;
    const quote = quoteByCode.get(stock.code);
    if (monitorCodes.has(stock.code)) {
      const event = createChipEvent(stock, quote, chip, timestamp);
      if (event) events.push(event);
    }
    const surgeEvents = await listRecentStockSurgeEvents(stock.code, 30).catch(() => []);
    events.push(...createChipSignalEvents(stock, quote, chip, surgeEvents, timestamp, tradeDate));
  }
  return events;
}

function makeEventBase(
  stock: Pick<FavoriteStock, 'code' | 'name'>,
  quote: StockDetail | undefined,
  category: TMonitorCategory,
  timestamp: string,
) {
  return {
    category,
    timestamp,
    code: stock.code,
    name: quoteName(stock, quote),
    price: quotePrice(quote),
    changePercent: quote ? quoteChangePercent(quote) : undefined,
  };
}

function createQuoteEvents(
  stock: FavoriteStock,
  quote: StockDetail | undefined,
  enabledCategories: TMonitorCategory[],
  timestamp: string,
  tradeDate: string,
): IMonitorEvent[] {
  if (!quote) return [];

  const price = quotePrice(quote);
  const changePercent = quoteChangePercent(quote);
  const open = numericValue(quote.open);
  const high = numericValue(quote.high);
  const low = numericValue(quote.low);
  const turnoverRate = numericValue(quote.turnoverRate);
  if (price === undefined || changePercent === undefined) return [];

  const events: IMonitorEvent[] = [];
  const base = (category: TMonitorCategory) => makeEventBase(stock, quote, category, timestamp);
  const add = (event: IMonitorEvent) => {
    if (enabledCategories.includes(event.category)) events.push(event);
  };

  const intradayPosition = high !== undefined && low !== undefined && high > low
    ? ((price - low) / (high - low)) * 100
    : undefined;

  const strongTurnover = turnoverRate !== undefined && turnoverRate >= 2;

  if (changePercent >= 3 || (intradayPosition !== undefined && intradayPosition >= 88 && changePercent >= 1.5)) {
    add({
      ...base('technical'),
      id: `mo-tech-quote-${stock.code}-${tradeDate}`,
      title: changePercent >= 3 ? '日内强势信号' : '接近日内高位',
      badge: '实时行情',
      details: [
        `当前涨跌幅 ${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`,
        high !== undefined && low !== undefined ? `日内区间 ${low.toFixed(2)} - ${high.toFixed(2)}` : '行情区间数据暂缺',
      ],
      aiAnalysis: '该信号仅基于实时行情与日内价格区间生成，不包含未经验证的突破前高或背离判断。',
    });
  }

  if (changePercent >= 4 && open !== undefined && price >= open && intradayPosition !== undefined && intradayPosition >= 75 && strongTurnover) {
    add({
      ...base('ai-opportunity'),
      id: `mo-opp-quote-${stock.code}-${tradeDate}`,
      title: '强势量价机会',
      badge: '强信号',
      details: [
        `当前价 ${price.toFixed(2)}，较昨收 +${changePercent.toFixed(2)}%`,
        `接近日内高位，换手率 ${turnoverRate.toFixed(2)}%`,
      ],
      aiAnalysis: '涨幅、日内位置与换手率同时满足强信号条件，仍需结合板块共振和成交额验证。',
    });
  }

  if (changePercent <= -4 && (intradayPosition === undefined || intradayPosition <= 35 || (open !== undefined && price <= open))) {
    add({
      ...base('ai-warning'),
      id: `mo-warn-quote-${stock.code}-${tradeDate}`,
      title: '日内回撤风险',
      badge: '强预警',
      details: [
        `当前涨跌幅 ${changePercent.toFixed(2)}%`,
        low !== undefined ? `日内低点 ${low.toFixed(2)}` : '日内低点数据暂缺',
      ],
      aiAnalysis: '实时跌幅较大且价格处于偏弱区间，短线波动风险上升。',
    });
  }

  if (turnoverRate !== undefined && turnoverRate >= 10 && Math.abs(changePercent) >= 2) {
    add({
      ...base('risk'),
      id: `mo-risk-turnover-${stock.code}-${tradeDate}`,
      title: '高换手波动风险',
      badge: '波动提示',
      details: [`当前换手率 ${turnoverRate.toFixed(2)}%`, `当前涨跌幅 ${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`],
      aiAnalysis: '高换手叠加价格波动通常意味着分歧加大，需结合成交额和K线位置判断。',
    });
  }

  return events;
}

function createLargeOrderEvents(
  surgeItems: HotFocusItem[],
  quoteByCode: Map<string, StockDetail>,
  enabledCategories: TMonitorCategory[],
  timestamp: string,
): IMonitorEvent[] {
  if (!enabledCategories.includes('large-order')) return [];
  return surgeItems
    .filter((item) => item.code && isLargeOrderItem(item))
    .slice(0, 30)
    .map((item) => {
      const code = item.code ?? '';
      const quote = quoteByCode.get(code);
      const eventTime = item.time ? mergeTodayTime(timestamp, item.time) : timestamp;
      const stock = { code, name: item.name ?? item.title };
      const amountText = [item.amount, item.description].filter(Boolean).join(' · ');
      return {
        ...makeEventBase(stock, quote, 'large-order', eventTime),
        id: `mo-large-${item.id}`,
        title: item.tag ?? item.description ?? '大单异动',
        badge: /卖出/.test(`${item.tag ?? ''}${item.description ?? ''}${item.title}`) ? '大单卖出' : '大单买入',
        details: [item.title, amountText].filter(Boolean),
        aiAnalysis: '该事件来自实时盘口异动数据，需结合成交额、换手率和后续盘口持续性判断。',
        price: quotePrice(quote) ?? quotePrice(item),
        changePercent: quote ? quoteChangePercent(quote) : numericValue(item.changePercent),
      } satisfies IMonitorEvent;
    });
}

export function isLargeOrderItem(item: HotFocusItem) {
  const text = `${item.title} ${item.description ?? ''} ${item.tag ?? ''}`;
  return /特大单买入|特大单卖出|大笔买入|大笔卖出/.test(text) && largeOrderHands(item) >= 10000;
}

function largeOrderHands(item: HotFocusItem) {
  const text = [item.amount, item.description, item.title, item.tag].filter(isString).join(' ');
  const match = text.match(/(?:买入|卖出)?([0-9]+(?:\.[0-9]+)?)(万)?手/);
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0;
  return match[2] ? value * 10000 : value;
}

function createChipEvent(
  stock: FavoriteStock,
  quote: StockDetail | undefined,
  chip: IChipDistributionResult,
  timestamp: string,
): IMonitorEvent | undefined {
  const latest = chip.latest;
  if (!latest) return undefined;

  const trendDetails = chip.trend
    .filter((item) => item.days === 5 || item.days === 10 || item.days === 20)
    .map((item) => {
      const parts = [
        item.concentration70 === undefined ? '' : `70%集中度 ${formatRatio(item.concentration70)}`,
        item.concentration90 === undefined ? '' : `90%集中度 ${formatRatio(item.concentration90)}`,
      ].filter(Boolean);
      return parts.length ? `${item.days}日：${parts.join('，')}` : '';
    })
    .filter(Boolean);
  const details = [
    latest.avgCost === undefined ? '' : `平均成本 ${latest.avgCost.toFixed(2)}`,
    latest.profitRatio === undefined ? '' : `获利盘 ${formatRatio(latest.profitRatio)}`,
    latest.cost70 ? `70%成本区间 ${latest.cost70}` : '',
    ...trendDetails.slice(0, 2),
  ].filter(Boolean);

  return {
    ...makeEventBase(stock, quote, 'chip', timestamp),
    id: `mo-chip-${stock.code}-${latest.date ?? timestamp}`,
    title: chipTrendTitle(chip),
    badge: chip.source === 'stock-sdk' ? 'stock-sdk' : '筹码计算',
    details,
    aiAnalysis: '该事件基于真实筹码分布数据生成，需结合价格是否站稳平均成本与量能变化继续验证。',
    chart: trendDetails.length
      ? { type: 'line', data: chip.trend.map((item) => item.concentration70).filter((value): value is number => typeof value === 'number') }
      : undefined,
  };
}

function createChipSignalEvents(
  stock: FavoriteStock,
  quote: StockDetail | undefined,
  chip: IChipDistributionResult,
  surgeEvents: StockSurgeEvent[],
  timestamp: string,
  tradeDate: string,
): IMonitorEvent[] {
  const latest = chip.latest;
  const concentration90 = ratioPercent(latest?.concentration90);
  if (latest === undefined || concentration90 === undefined || concentration90 >= 15) return [];

  const baseDetails = [`90%筹码集中度 ${concentration90.toFixed(2)}%`];
  const events: IMonitorEvent[] = [];
  const base = () => makeEventBase(stock, quote, 'chip', timestamp);
  const profitRatio = ratioPercent(latest.profitRatio);
  const marketCapYi = parseMarketCapYi(quote?.marketCap);
  const recentLimitUp = findRecentLimitUpEvent(surgeEvents);
  const recentLargeBuy = findRecentLargeBuyEvent(surgeEvents.filter((event) => isWithinRecentDays(event.tradeDate, tradeDate, 7)));

  if (marketCapYi !== undefined && marketCapYi >= 20 && marketCapYi <= 100) {
    events.push({
      ...base(),
      id: `mo-chip-low-concentration-cap-${stock.code}-${tradeDate}`,
      title: '低集中度小中市值筹码信号',
      badge: '筹码+市值',
      details: [...baseDetails, `总市值 ${marketCapYi.toFixed(1)}亿`],
      aiAnalysis: '90%筹码集中度低且市值处于20亿-100亿区间，说明筹码结构较集中但仍需结合流动性和基本面验证。',
    });
  }

  if (profitRatio !== undefined && profitRatio < 30) {
    events.push({
      ...base(),
      id: `mo-chip-low-concentration-profit-${stock.code}-${tradeDate}`,
      title: '低集中度低获利盘信号',
      badge: '筹码+获利盘',
      details: [...baseDetails, `获利盘 ${profitRatio.toFixed(2)}%`],
      aiAnalysis: '90%筹码集中度低且获利盘比例低于30%，代表套牢盘压力仍需观察，不能单独作为买入依据。',
    });
  }

  if (recentLimitUp) {
    events.push({
      ...base(),
      id: `mo-chip-low-concentration-limitup-${stock.code}-${tradeDate}`,
      title: '低集中度叠加近月涨停',
      badge: '筹码+涨停',
      details: [...baseDetails, `近月涨停：${recentLimitUp.tradeDate}${recentLimitUp.time ? ` ${recentLimitUp.time}` : ''}`, recentLimitUp.tag ?? recentLimitUp.description ?? recentLimitUp.title],
      aiAnalysis: '90%筹码集中度低且近一个月出现过涨停，说明曾有真实强势异动，需继续观察涨停后的承接和回撤。',
    });
  }

  if (recentLargeBuy) {
    events.push({
      ...base(),
      id: `mo-chip-low-concentration-largebuy-${stock.code}-${tradeDate}`,
      title: '低集中度叠加大额买入',
      badge: '筹码+大单',
      details: [...baseDetails, `近周大额买入：${recentLargeBuy.tradeDate}${recentLargeBuy.time ? ` ${recentLargeBuy.time}` : ''}`, recentLargeBuy.amount ?? recentLargeBuy.description ?? recentLargeBuy.tag ?? recentLargeBuy.title],
      aiAnalysis: '90%筹码集中度低且近一周出现单笔大于1万手买入异动，资金行为值得跟踪，但仍需结合后续成交持续性。',
    });
  }

  return events;
}

export function ratioPercent(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.abs(value) <= 1 ? value * 100 : value;
}

export function parseMarketCapYi(value: number | string | undefined) {
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

export function isRecentLimitUpEvent(event: StockSurgeEvent) {
  const text = `${event.tag ?? ''} ${event.title} ${event.description ?? ''}`;
  if (/跌停|炸板|开板/.test(text)) return false;
  return /封涨停板|涨停/.test(text);
}

export function isRecentLargeBuyEvent(event: StockSurgeEvent) {
  const text = `${event.tag ?? ''} ${event.title} ${event.description ?? ''} ${event.amount ?? ''}`;
  return /买入/.test(text) && largeOrderHands(event) >= 10000;
}

function findRecentLimitUpEvent(events: StockSurgeEvent[]) {
  return events.find(isRecentLimitUpEvent);
}

function findRecentLargeBuyEvent(events: StockSurgeEvent[]) {
  return events.find(isRecentLargeBuyEvent);
}

function isWithinRecentDays(eventDate: string, tradeDate: string, days: number) {
  const eventTime = new Date(`${eventDate}T00:00:00+08:00`).getTime();
  const tradeTime = new Date(`${tradeDate}T00:00:00+08:00`).getTime();
  if (!Number.isFinite(eventTime) || !Number.isFinite(tradeTime)) return false;
  const diffDays = Math.floor((tradeTime - eventTime) / 86_400_000);
  return diffDays >= 0 && diffDays < days;
}

function chipTrendTitle(chip: IChipDistributionResult) {
  const five = chip.trend.find((item) => item.days === 5)?.concentration70;
  const twenty = chip.trend.find((item) => item.days === 20)?.concentration70;
  if (five !== undefined && twenty !== undefined) {
    if (five < twenty) return '筹码集中度收敛';
    if (five > twenty) return '筹码集中度发散';
  }
  return '筹码结构更新';
}

function isString(value: string | undefined): value is string {
  return Boolean(value);
}

function createNewsEvents(
  stock: FavoriteStock,
  quote: StockDetail | undefined,
  result: { news: MarketNewsItem[]; announcements: AnnouncementItem[] },
  timestamp: string,
): IMonitorEvent[] {
  const newsEvents = result.news.slice(0, 2).map((item) => ({
    ...makeEventBase(stock, quote, 'news', parseNewsTime(item.time, timestamp)),
    id: `mo-news-${stock.code}-${item.id}`,
    title: item.title,
    badge: item.source ?? '新闻',
    details: [item.content, item.url ? '可查看原文' : ''].filter(isString),
    aiAnalysis: '该事件来自个股新闻源，需结合公告正文、行情反应与资金面确认影响方向。',
  } satisfies IMonitorEvent));

  const announcementEvents = result.announcements.slice(0, 2).map((item, index) => ({
    ...makeEventBase(stock, quote, 'news', parseNewsTime(item.date, timestamp)),
    id: `mo-announcement-${stock.code}-${item.date}-${index}-${item.title}`,
    title: item.title,
    badge: item.type || '公告',
    details: [item.date, item.content].filter(isString),
    aiAnalysis: '该事件来自公司公告列表，需结合公告正文和后续经营数据验证实际影响。',
  } satisfies IMonitorEvent));

  return [...newsEvents, ...announcementEvents];
}

function mergeTodayTime(timestamp: string, time: string) {
  const date = new Date(timestamp);
  const [hour, minute, second = '0'] = time.split(':');
  date.setHours(Number(hour) || 0, Number(minute) || 0, Number(second) || 0, 0);
  return date.toISOString();
}

function parseNewsTime(value: string, fallback: string) {
  const text = value.trim();
  if (!text) return fallback;
  const normalized = text.includes('T') ? text : text.replace(' ', 'T');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function formatRatio(value: number) {
  const normalized = value <= 1 ? value * 100 : value;
  return `${normalized.toFixed(2)}%`;
}

function warnSettledErrors(label: string, results: PromiseSettledResult<unknown>[]) {
  const messages = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => (result.reason instanceof Error ? result.reason.message : String(result.reason)));
  if (messages.length) console.warn(`[monitor] ${label} partial failures`, messages.slice(0, 3));
}

function sortMonitorEvents(events: IMonitorEvent[]) {
  return events.sort((a, b) => {
    const timeDelta = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    if (timeDelta !== 0) return timeDelta;
    const changeA = Math.abs(numericValue(a.changePercent) ?? 0);
    const changeB = Math.abs(numericValue(b.changePercent) ?? 0);
    return changeB - changeA;
  });
}

export async function captureMonitorEvents(now = new Date(), categories: TMonitorCategory[] = CATEGORIES) {
  const timestamp = now.toISOString();
  const tradeDate = toShanghaiMarketTime(now).date;
  const favorites = await listFavoriteStocks();

  const monitorUniverse: FavoriteStock[] = [
    ...favorites,
    ...DEFAULT_MONITOR_UNIVERSE.filter((u) => !favorites.some((f) => f.code === u.code)),
  ];

  let quotes: Awaited<ReturnType<typeof getBatchQuotes>> = [];
  if (monitorUniverse.length) {
    try {
      quotes = await getBatchQuotes(monitorUniverse.map((f) => f.code));
    } catch (error) {
      console.warn('[monitor] failed to fetch universe quotes', error);
    }
  }
  let quoteByCode = new Map(quotes.map((q) => [q.code, q]));

  const detailStocks = monitorUniverse.slice(0, DETAIL_STOCK_LIMIT);
  const events = monitorUniverse.flatMap((stock) =>
    createQuoteEvents(stock, quoteByCode.get(stock.code), categories, timestamp, tradeDate),
  );

  if (categories.includes('large-order')) {
    try {
      const surgeItems = await listHotFocus('surge');
      events.push(...createLargeOrderEvents(surgeItems, quoteByCode, categories, timestamp));
    } catch (error) {
      console.warn('[monitor] failed to fetch large order events', error);
    }
  }

  if (categories.includes('chip')) {
    let chipScanStocks = detailStocks;
    try {
      const chipScanUniverse = await buildChipScanUniverse(monitorUniverse);
      chipScanStocks = chipScanUniverse.stocks;
      quoteByCode = mergeQuoteMaps(chipScanUniverse.quoteByCode, quoteByCode);
      const missingQuoteCodes = chipScanStocks.filter((stock) => !quoteByCode.has(stock.code)).map((stock) => stock.code);
      if (missingQuoteCodes.length) {
        const chipQuotes = await getBatchQuotes(missingQuoteCodes).catch((error) => {
          console.warn('[monitor] failed to fetch chip scan quotes', error);
          return [];
        });
        quoteByCode = mergeQuoteMaps(quoteByCode, new Map(chipQuotes.map((quote) => [quote.code, quote])));
      }
    } catch (error) {
      console.warn('[monitor] failed to build chip scan universe', error);
    }

    const monitorCodes = new Set(monitorUniverse.map((stock) => stock.code));
    const chipEvents = await collectCachedChipResults(chipScanStocks, quoteByCode, timestamp, tradeDate, monitorCodes);
    if (chipEvents.length) {
      events.push(...limitChipEvents(chipEvents));
    } else {
      const chipResults = await Promise.allSettled(detailStocks.map(async (stock) => {
        const [chip, surgeEvents] = await Promise.all([
          getChipDistribution(stock.code),
          listRecentStockSurgeEvents(stock.code, 30),
        ]);
        return { stock, chip, surgeEvents };
      }));
      warnSettledErrors('chip', chipResults);
      chipResults.forEach((result) => {
        if (result.status !== 'fulfilled') return;
        const { stock, chip, surgeEvents } = result.value;
        const quote = quoteByCode.get(stock.code);
        const event = createChipEvent(stock, quote, chip, timestamp);
        if (event) events.push(event);
        events.push(...createChipSignalEvents(stock, quote, chip, surgeEvents, timestamp, tradeDate));
      });
    }
  }

  if (categories.includes('news')) {
    const newsResults = await Promise.allSettled(detailStocks.map((stock) => listStockNewsAnnouncements(stock.code, 4)));
    warnSettledErrors('news', newsResults);
    newsResults.forEach((result, index) => {
      if (result.status !== 'fulfilled') return;
      const stock = detailStocks[index];
      events.push(...createNewsEvents(stock, quoteByCode.get(stock.code), result.value, timestamp));
    });
  }

  return limitQuoteSignals(sortMonitorEvents(events));
}

function limitChipEvents(events: IMonitorEvent[]) {
  const regularChipEvents = events.filter((event) => !event.id.startsWith('mo-chip-low-concentration-'));
  const signalEvents = events.filter((event) => event.id.startsWith('mo-chip-low-concentration-'));
  return [...regularChipEvents, ...signalEvents.slice(0, CHIP_SIGNAL_EVENT_LIMIT)];
}

function limitQuoteSignals(events: IMonitorEvent[]) {
  const quota: Partial<Record<TMonitorCategory, number>> = {
    'ai-opportunity': 8,
    'ai-warning': 8,
    technical: 12,
    risk: 8,
  };
  const used: Partial<Record<TMonitorCategory, number>> = {};
  return events.filter((event) => {
    const max = quota[event.category];
    if (max === undefined) return true;
    const next = (used[event.category] ?? 0) + 1;
    if (next > max) return false;
    used[event.category] = next;
    return true;
  });
}

export async function persistMonitorCapture(events: IMonitorEvent[], now = new Date()) {
  const tradeDate = toShanghaiMarketTime(now).date;
  if (events.length) enqueueMonitorEvents(events, now, tradeDate);
  if (lastPrunedDate !== tradeDate) {
    await pruneMonitorHistory(7);
    await cleanupMonitorHistoryNoise(tradeDate);
    lastPrunedDate = tradeDate;
  }
  return tradeDate;
}

export async function getMonitorFeed(options?: {
  categories?: TMonitorCategory[];
  since?: string;
  limit?: number;
  offset?: number;
  date?: string;
  mode?: 'realtime' | 'history';
}): Promise<IMonitorFeed> {
  const enabledCategories = options?.categories?.length ? options.categories : CATEGORIES;
  const limit = options?.limit ?? 50;
  const offset = Math.max(0, Math.floor(options?.offset ?? 0));
  const now = new Date();
  const timestamp = now.toISOString();
  const isTradingTime = isChinaMarketOpen(now);
  const requestedHistory = options?.mode === 'history' || Boolean(options?.date);

  await flushMonitorEventQueue();

  if (requestedHistory || !isTradingTime) {
    const availableDates = await listMonitorDates(7);
    const selectedDate = options?.date && /^\d{4}-\d{2}-\d{2}$/.test(options.date) ? options.date : availableDates[0];
    const events = selectedDate
      ? await listMonitorHistory({ date: selectedDate, categories: enabledCategories, offset, limit })
      : [];
    const total = selectedDate ? await countMonitorHistory({ date: selectedDate, categories: enabledCategories }) : 0;
    const categoryTotals = selectedDate
      ? await countMonitorHistoryByCategory({ date: selectedDate })
      : {};
    const sinceTime = options?.since ? new Date(options.since).getTime() : 0;
    return {
      updatedAt: timestamp,
      events: events.filter((event) => new Date(event.timestamp).getTime() >= sinceTime),
      mode: 'history',
      isTradingTime,
      availableDates,
      selectedDate,
      total,
      categoryTotals,
    };
  }

  let realtimeEvents: IMonitorEvent[] = [];
  try {
    realtimeEvents = await captureMonitorEvents(now, enabledCategories);
    await persistMonitorCapture(realtimeEvents, now);
    await flushMonitorEventQueue();
  } catch (error) {
    console.warn('[monitor] realtime capture failed', error);
  }

  const tradeDate = toShanghaiMarketTime(now).date;
  const sinceTime = options?.since ? new Date(options.since).getTime() : 0;
  let localEvents: IMonitorEvent[] = [];
  let localTotal = 0;
  let categoryTotals: Partial<Record<TMonitorCategory, number>> = {};
  try {
    localEvents = await listMonitorHistory({ date: tradeDate, categories: enabledCategories, offset, limit });
    localTotal = await countMonitorHistory({ date: tradeDate, categories: enabledCategories });
    categoryTotals = await countMonitorHistoryByCategory({ date: tradeDate });
  } catch (error) {
    console.warn('[monitor] failed to read local realtime history', error);
  }

  const events = localEvents.length || offset > 0 ? localEvents : realtimeEvents.slice(0, limit);
  const availableDates = await listMonitorDates(7);

  return {
    updatedAt: timestamp,
    events: events.filter((event) => new Date(event.timestamp).getTime() >= sinceTime),
    mode: 'realtime',
    isTradingTime: true,
    availableDates,
    selectedDate: tradeDate,
    total: localTotal,
    categoryTotals,
  };
}

export { CATEGORY_META };
export type { TMonitorCategory };
