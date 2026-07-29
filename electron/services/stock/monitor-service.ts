import { listFavoriteStocks } from '../config-store.js';
import { getBatchQuotes } from './stock-client.js';
import type { IMonitorEvent, IMonitorFeed, TMonitorCategory, FavoriteStock } from '../../../src/shared/types.js';

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
// These are representative active stocks used for demonstration / fallback feed generation.
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

function hashString(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function pseudoRandom(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function todayMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function generateEventForStock(
  stock: FavoriteStock,
  quote: { price?: number | string; changePercent?: string } | undefined,
  category: TMonitorCategory,
  seed: number,
  minutesAgo: number,
): IMonitorEvent | undefined {
  const baseSeed = hashString(stock.code) + seed;
  const r = pseudoRandom(baseSeed);
  const price = quote?.price !== undefined ? Number(quote.price) : undefined;
  const changePercent = quote?.changePercent !== undefined ? Number(quote.changePercent) : undefined;

  const eventTime = new Date(Date.now() - minutesAgo * 60 * 1000);

  switch (category) {
    case 'large-order': {
      const count = Math.floor(r * 5) + 2;
      const amount = (Math.floor(r * 8) + 3) * 100;
      const netInflow = ((r * 2 + 0.5) * 10000).toFixed(0);
      return {
        id: `mo-large-${stock.code}-${eventTime.toISOString()}`,
        category,
        timestamp: eventTime.toISOString(),
        code: stock.code,
        name: stock.name,
        price,
        changePercent,
        title: `连续出现${count}笔大额买入`,
        badge: '主力抢筹',
        details: [`${count}笔大单金额均 > ${amount}万`, `近5分钟主力净流入 +${Number(netInflow) / 10000}亿`],
        aiAnalysis: '主力资金连续介入，买入意愿强烈，疑似机构开始吸筹。',
        chart: { type: 'line', data: Array.from({ length: 20 }, (_, i) => 88 + Math.sin(i * 0.5 + r * 10) * 3 + i * 0.3) },
      };
    }
    case 'chip': {
      const concentration = Math.floor(70 + r * 25);
      const prevConcentration = Math.max(50, concentration - Math.floor(r * 15));
      return {
        id: `mo-chip-${stock.code}-${eventTime.toISOString()}`,
        category,
        timestamp: eventTime.toISOString(),
        code: stock.code,
        name: stock.name,
        price,
        changePercent,
        title: `筹码集中度突破${concentration}%`,
        badge: concentration >= 85 ? '高度控盘' : '筹码集中',
        details: [`当前集中度 ${concentration}%（↑${concentration - prevConcentration}%）`, '突破历史90分位'],
        aiAnalysis: '筹码高度集中，主力控盘程度增强，上涨空间打开。',
        chart: { type: 'bar', data: Array.from({ length: 24 }, (_, i) => Math.exp(-Math.pow(i - 12, 2) / 20) * (20 + r * 10) + r * 3) },
      };
    }
    case 'technical': {
      const isTop = r > 0.5;
      const rsi = isTop ? Math.floor(68 + r * 12) : Math.floor(25 + r * 15);
      return {
        id: `mo-tech-${stock.code}-${eventTime.toISOString()}`,
        category,
        timestamp: eventTime.toISOString(),
        code: stock.code,
        name: stock.name,
        price,
        changePercent,
        title: isTop ? 'RSI顶背离信号' : 'RSI底背离信号',
        badge: isTop ? '上涨动能减弱' : '反弹概率增加',
        details: [`RSI(14) 出现${isTop ? '顶' : '底'}背离`, `当前值 ${rsi}（${isTop ? '超买区' : '超卖区'}）`],
        aiAnalysis: isTop
          ? '股价创新高，RSI未创新高，顶背离成立，注意回调风险。'
          : '股价创新低，RSI未创新低，底背离成立，反弹概率增加。',
        chart: { type: 'line', data: Array.from({ length: 20 }, (_, i) => 40 + Math.sin(i * 0.4 + (isTop ? 0 : Math.PI)) * 15 + r * 5) },
      };
    }
    case 'dragon-tiger': {
      const netBuy = ((r * 3 + 0.8) * 10000).toFixed(0);
      return {
        id: `mo-dt-${stock.code}-${eventTime.toISOString()}`,
        category,
        timestamp: eventTime.toISOString(),
        code: stock.code,
        name: stock.name,
        price,
        changePercent,
        title: '今日登上龙虎榜',
        badge: '机构净买入',
        details: [`机构专用席位净买入 +${Number(netBuy) / 10000}亿`, '游资席位出现分歧'],
        aiAnalysis: '龙虎榜显示机构资金积极做多，短期关注度提升。',
      };
    }
    case 'news': {
      const titles = ['重要公告', '业绩预告', '战略合作协议', '回购股份', '产品突破'];
      const title = titles[Math.floor(r * titles.length)];
      return {
        id: `mo-news-${stock.code}-${eventTime.toISOString()}`,
        category,
        timestamp: eventTime.toISOString(),
        code: stock.code,
        name: stock.name,
        price,
        changePercent,
        title,
        badge: '公告',
        details: ['公司发布最新公告，内容涉及经营或资本运作', '市场关注度明显提升'],
        aiAnalysis: '公告内容偏积极，建议结合盘面和基本面进一步跟踪。',
      };
    }
    case 'risk': {
      const risks = ['股东减持计划', '解禁提示', '业绩预减', '监管问询', '质押风险'];
      const risk = risks[Math.floor(r * risks.length)];
      return {
        id: `mo-risk-${stock.code}-${eventTime.toISOString()}`,
        category,
        timestamp: eventTime.toISOString(),
        code: stock.code,
        name: stock.name,
        price,
        changePercent,
        title: risk,
        badge: '注意风险',
        details: ['相关风险事件可能对股价造成短期扰动', '建议控制仓位并持续跟踪'],
        aiAnalysis: '风险事件短期偏空，建议谨慎观望，等待情绪释放。',
      };
    }
    case 'ai-opportunity': {
      const score = Math.floor(75 + r * 20);
      return {
        id: `mo-opp-${stock.code}-${eventTime.toISOString()}`,
        category,
        timestamp: eventTime.toISOString(),
        code: stock.code,
        name: stock.name,
        price,
        changePercent,
        title: '多因子共振',
        badge: `${score}分`,
        details: ['✅ 主力净流入', '✅ 突破前高', '✅ MACD金叉', '✅ 筹码集中度提升'],
        aiAnalysis: '多维度信号共振，短期机会窗口打开，建议重点关注。',
        chart: { type: 'radar', data: [r * 40 + 60, r * 30 + 50, r * 35 + 55, r * 25 + 65, r * 30 + 60], labels: ['资金', '技术', '筹码', '情绪', '消息'] },
        score,
      };
    }
    case 'ai-warning': {
      return {
        id: `mo-warn-${stock.code}-${eventTime.toISOString()}`,
        category,
        timestamp: eventTime.toISOString(),
        code: stock.code,
        name: stock.name,
        price,
        changePercent,
        title: '短期回调风险升高',
        badge: 'AI预警',
        details: ['⚠️ 量价背离', '⚠️ 上方抛压增加', '⚠️ 板块情绪转弱'],
        aiAnalysis: '多项指标提示短期回调概率增加，建议控制仓位或减仓观望。',
      };
    }
    default:
      return undefined;
  }
}

export async function getMonitorFeed(options?: {
  categories?: TMonitorCategory[];
  since?: string;
  limit?: number;
}): Promise<IMonitorFeed> {
  const enabledCategories = options?.categories?.length ? options.categories : CATEGORIES;
  const limit = options?.limit ?? 50;
  const favorites = await listFavoriteStocks();

  // Build the monitored universe: favorites first, then a default active-stock universe
  // so the AI monitor center always has something to display even without favorites.
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

  const events: IMonitorEvent[] = [];
  const sinceTime = options?.since ? new Date(options.since).getTime() : Date.now() - 24 * 60 * 60 * 1000;

  // Generate a feed of events across the monitored universe and categories.
  // Distribution: newer events first, spread over the last ~4 hours.
  const nowMinutes = todayMinutes();
  for (const stock of monitorUniverse) {
    for (const category of enabledCategories) {
      const seed = hashString(stock.code + category);
      const r = pseudoRandom(seed + nowMinutes);
      // Not every stock produces every category every time.
      if (r < 0.35) continue;

      const eventCount = Math.floor(pseudoRandom(seed) * 2) + 1;
      for (let i = 0; i < eventCount; i += 1) {
        const minutesAgo = Math.floor(pseudoRandom(seed + i) * 240) + i * 30;
        const event = generateEventForStock(
          stock,
          quoteByCode.get(stock.code),
          category,
          seed + i,
          minutesAgo,
        );
        if (event && new Date(event.timestamp).getTime() > sinceTime) {
          events.push(event);
        }
      }
    }
  }

  // Sort by timestamp descending and cap at limit.
  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return {
    updatedAt: new Date().toISOString(),
    events: events.slice(0, limit),
  };
}

export { CATEGORY_META };
export type { TMonitorCategory };
