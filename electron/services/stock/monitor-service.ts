import { listFavoriteStocks } from '../config-store.js';
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
  StockDetail,
  TMonitorCategory,
} from '../../../src/shared/types.js';

const CATEGORIES: TMonitorCategory[] = [
  'large-order',
  'chip',
  'technical',
  'dragon-tiger',
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

  if (changePercent >= 2 || (intradayPosition !== undefined && intradayPosition >= 82 && changePercent > 0)) {
    add({
      ...base('technical'),
      id: `mo-tech-quote-${stock.code}-${timestamp}`,
      title: changePercent >= 2 ? '日内涨幅走强' : '接近日内高位',
      badge: '实时行情',
      details: [
        `当前涨跌幅 ${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`,
        high !== undefined && low !== undefined ? `日内区间 ${low.toFixed(2)} - ${high.toFixed(2)}` : '行情区间数据暂缺',
      ],
      aiAnalysis: '该信号仅基于实时行情与日内价格区间生成，不包含未经验证的突破前高或背离判断。',
    });
  }

  if (changePercent >= 1.5 && open !== undefined && price >= open) {
    add({
      ...base('ai-opportunity'),
      id: `mo-opp-quote-${stock.code}-${timestamp}`,
      title: '日内量价走强',
      badge: '行情信号',
      details: [
        `当前价 ${price.toFixed(2)}，较昨收 ${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`,
        `当前价${price >= open ? '高于或等于' : '低于'}开盘价 ${open.toFixed(2)}`,
      ],
      aiAnalysis: '实时涨跌幅与开盘价关系偏强，建议继续结合K线、成交量和板块表现核对。',
    });
  }

  if (changePercent <= -2) {
    add({
      ...base('ai-warning'),
      id: `mo-warn-quote-${stock.code}-${timestamp}`,
      title: '日内回撤风险',
      badge: '行情预警',
      details: [
        `当前涨跌幅 ${changePercent.toFixed(2)}%`,
        low !== undefined ? `日内低点 ${low.toFixed(2)}` : '日内低点数据暂缺',
      ],
      aiAnalysis: '实时跌幅较大，短线波动风险上升。',
    });
  }

  if (turnoverRate !== undefined && turnoverRate >= 8) {
    add({
      ...base('risk'),
      id: `mo-risk-turnover-${stock.code}-${timestamp}`,
      title: '换手率偏高',
      badge: '波动提示',
      details: [`当前换手率 ${turnoverRate.toFixed(2)}%`, `当前涨跌幅 ${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`],
      aiAnalysis: '高换手通常意味着分歧加大，需结合成交额和K线位置判断。',
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

function isLargeOrderItem(item: HotFocusItem) {
  const text = `${item.title} ${item.description ?? ''} ${item.tag ?? ''}`;
  return /特大单买入|特大单卖出|大笔买入|大笔卖出/.test(text);
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

export async function getMonitorFeed(options?: {
  categories?: TMonitorCategory[];
  since?: string;
  limit?: number;
}): Promise<IMonitorFeed> {
  const enabledCategories = options?.categories?.length ? options.categories : CATEGORIES;
  const limit = options?.limit ?? 50;
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
  const quoteByCode = new Map(quotes.map((q) => [q.code, q]));

  const timestamp = new Date().toISOString();
  const sinceTime = options?.since ? new Date(options.since).getTime() : 0;
  const detailStocks = monitorUniverse.slice(0, DETAIL_STOCK_LIMIT);
  const events = monitorUniverse.flatMap((stock) =>
    createQuoteEvents(stock, quoteByCode.get(stock.code), enabledCategories, timestamp),
  );

  if (enabledCategories.includes('large-order')) {
    try {
      const surgeItems = await listHotFocus('surge');
      events.push(...createLargeOrderEvents(surgeItems, quoteByCode, enabledCategories, timestamp));
    } catch (error) {
      console.warn('[monitor] failed to fetch large order events', error);
    }
  }

  if (enabledCategories.includes('chip')) {
    const chipResults = await Promise.allSettled(detailStocks.map((stock) => getChipDistribution(stock.code)));
    warnSettledErrors('chip', chipResults);
    chipResults.forEach((result, index) => {
      if (result.status !== 'fulfilled') return;
      const stock = detailStocks[index];
      const event = createChipEvent(stock, quoteByCode.get(stock.code), result.value, timestamp);
      if (event) events.push(event);
    });
  }

  if (enabledCategories.includes('news')) {
    const newsResults = await Promise.allSettled(detailStocks.map((stock) => listStockNewsAnnouncements(stock.code, 4)));
    warnSettledErrors('news', newsResults);
    newsResults.forEach((result, index) => {
      if (result.status !== 'fulfilled') return;
      const stock = detailStocks[index];
      events.push(...createNewsEvents(stock, quoteByCode.get(stock.code), result.value, timestamp));
    });
  }

  events.sort((a, b) => {
    const timeDelta = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    if (timeDelta !== 0) return timeDelta;
    const changeA = Math.abs(numericValue(a.changePercent) ?? 0);
    const changeB = Math.abs(numericValue(b.changePercent) ?? 0);
    return changeB - changeA;
  });

  return {
    updatedAt: timestamp,
    events: events.filter((event) => new Date(event.timestamp).getTime() >= sinceTime).slice(0, limit),
  };
}

export { CATEGORY_META };
export type { TMonitorCategory };
