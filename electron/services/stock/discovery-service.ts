import { getMarketReview } from './market-review-service.js';
import { getBatchQuotes, getMarketPageSnapshot, listDailyDragonTiger, listEastmoneySurgeByDate } from './stock-client.js';
import { listFavoriteStocks, getConfig } from '../config-store.js';
import { chatWithOpenAICompatible } from '../llm/openai-compatible-client.js';
import { listSurgeDates, listSurgeHistory } from './surge-history-store.js';
import type {
  HotFocusItem,
  IMarketReviewHotTheme,
  IMarketReviewLeader,
  IMarketReviewMetric,
  IMarketReviewWatchItem,
} from '../../../src/shared/types.js';

type TStockItem = { code: string; name: string; price?: string; changePercent?: string; amount?: string };

export interface IDiscoverySnapshot {
  tradeDate: string;
  generatedAt: string;
  // hero gauge
  score?: number;
  scoreLabel?: string;
  scoreVerdict?: string;
  scoreTrend?: number[];
  // market summary
  indices?: Array<{
    code: string;
    name: string;
    price?: number | string;
    changePercent?: number | string;
  }>;
  bullets?: string[];
  wealthMetrics?: Array<{ label: string; value: number | null; unit: string }>;
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
    inst: Array<{ code: string; name: string; changePercent?: number; netBuy: number; reason: string }>;
    hot: Array<{ code: string; name: string; changePercent?: number; netBuy: number; reason: string }>;
    north: Array<{ code: string; name: string; changePercent?: number; netBuy: number; reason: string }>;
  };
  // tomorrow preview
  nextDayFocus?: Array<{ category: string; condition: string; baseline?: number | null }>;
  // watchlist
  watchlist?: Array<{ code: string; name: string }>;
  watchlistQuotes?: Array<{ code: string; name: string; price?: number | string; changePercent?: number | string }>;
}

function mapMetricToFactor(m: IMarketReviewMetric): { label: string; value: string | number } {
  if (m.value === null || m.value === undefined) return { label: m.label, value: '--' };
  return { label: m.label, value: `${m.value}${m.unit ?? ''}` };
}

function mapLeader(l: IMarketReviewLeader): NonNullable<IDiscoverySnapshot['leaders']>[number] {
  return { code: l.code, name: l.name, height: l.height, amount: l.amount, concepts: l.concepts, changePercent: l.changePercent };
}

function mapTheme(t: IMarketReviewHotTheme): NonNullable<IDiscoverySnapshot['hotThemes']>[number] {
  return {
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

function toStockItem(item: HotFocusItem): TStockItem {
  return {
    code: item.code ?? '',
    name: item.name ?? item.title,
    price: item.price !== undefined ? String(item.price) : undefined,
    changePercent: item.changePercent !== undefined ? String(item.changePercent) : undefined,
    amount: item.amount !== undefined ? String(item.amount) : undefined,
  };
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

function yyyymmdd(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

function offsetDate(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function scoreLabel(s: number): string {
  if (s >= 80) return '积极 · 机会较多';
  if (s >= 60) return '偏积极 · 可关注';
  if (s >= 40) return '中性 · 观望为主';
  if (s >= 20) return '偏谨慎 · 控制仓位';
  return '谨慎 · 风险较高';
}

function scoreSentiment(up: number, down: number, zt: number, dt: number, broken: number) {
  if (!up && !down && !zt && !dt && !broken) return null;
  return Math.max(0, Math.min(100, Math.round(50 + (up - down) / Math.max(up + down, 1) * 30 + zt - dt * 2 - broken / 2)));
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
    const sentimentLines = reviewData.sentiment
      ?.map((m) => `${m.label}：${m.value === null || m.value === undefined ? '暂无数据' : `${m.value}${m.unit ?? ''}`}`)
      .join('\n') ?? '暂无数据';
    const wealthLines = reviewData.wealthEffect
      ?.map((m) => `${m.label}：${m.value === null || m.value === undefined ? '暂无数据' : `${m.value}${m.unit ?? ''}`}`)
      .join('\n') ?? '暂无数据';
    const hotThemes = reviewData.hotThemes
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

export async function getDiscoverySnapshot(): Promise<IDiscoverySnapshot> {
  const favStocks = await listFavoriteStocks();
  const favCodes = favStocks.map((f) => f.code);

  const today = new Date().toISOString().slice(0, 10).replaceAll('-', '');

  const [review, shSnapshot, szSnapshot, dragonTiger, eastmoneyPool] = await Promise.allSettled([
    getMarketReview(),
    getMarketPageSnapshot('sh-main'),
    getMarketPageSnapshot('sz-main'),
    listDailyDragonTiger(),
    listEastmoneySurgeByDate(today),
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
        const displayValue = typeof m.value === 'number' ? (Number.isInteger(m.value) ? String(m.value) : m.value.toFixed(2)) : String(m.value);
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
  const poolItems = eastmoneyPool.status === 'fulfilled' ? eastmoneyPool.value : [];
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

  // ── Yesterday pool for 昨日涨停指数 / 昨日连板指数 ──
  let yesterdayZt: TStockItem[] | undefined;
  let yesterdayLb: TStockItem[] | undefined;
  const yesterday = yyyymmdd(offsetDate(-1));
  try {
    const ydayPool = await listEastmoneySurgeByDate(yesterday);
    yesterdayZt = ydayPool
      .filter((item) => item.tag === '封涨停板')
      .map(toStockItem);
    yesterdayLb = ydayPool
      .filter((item) => item.tag === '封涨停板' && parseHeight(item.description) >= 2)
      .map(toStockItem);
  } catch (err) {
    console.warn('[discovery] failed to fetch yesterday pool', err);
  }

  // ── Dragon tiger ──
  const dtItems = dragonTiger.status === 'fulfilled' ? dragonTiger.value : [];
  const dtInst = dtItems.filter((item) => /机构|专用|基金|券商|保险|QFII/.test(item.reason)).slice(0, 5).map((item) => ({ code: item.code, name: item.name, changePercent: item.changePercent, netBuy: item.netBuy, reason: item.reason }));
  const dtHot = dtItems.filter((item) => /游资|营业部|席位|大户/.test(item.reason)).slice(0, 5).map((item) => ({ code: item.code, name: item.name, changePercent: item.changePercent, netBuy: item.netBuy, reason: item.reason }));
  const dtNorth = dtItems.filter((item) => /北向|深股通|沪股通|深港通|沪港通/.test(item.reason)).slice(0, 5).map((item) => ({ code: item.code, name: item.name, changePercent: item.changePercent, netBuy: item.netBuy, reason: item.reason }));
  const dtFill = dtItems.filter((item) => !dtInst.some((d) => d.code === item.code) && !dtHot.some((d) => d.code === item.code) && !dtNorth.some((d) => d.code === item.code)).slice(0, 5).map((item) => ({ code: item.code, name: item.name, changePercent: item.changePercent, netBuy: item.netBuy, reason: item.reason }));

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
  const tradeDate = reviewData?.tradeDate ?? new Date().toISOString().slice(0, 10);

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
        changePercent: l.changePercent ?? (quote?.changePercent !== undefined ? Number(quote.changePercent) : undefined),
        turnoverRate: l.turnoverRate ?? (quote?.turnoverRate !== undefined ? Number(quote.turnoverRate) : undefined),
      };
    });
  }

  return {
    tradeDate,
    generatedAt: new Date().toISOString(),
    score: score ?? undefined,
    scoreLabel: sentimentLabel,
    scoreVerdict: scoreVerdict ?? sentimentLabel,
    scoreTrend,
    indices: indices.length ? indices : undefined,
    bullets: bullets.length ? bullets : undefined,
    wealthMetrics: wealthMetrics.length ? wealthMetrics : undefined,
    sentimentScore: reviewData?.sentimentScore ?? null,
    sentimentFactors: reviewData?.sentiment
      ? reviewData.sentiment.map((m) => {
          // patch null yesterday-index values with real counts
          if (m.label === '昨日涨停指数') return { label: m.label, value: `${yesterdayZt?.length ?? '--'}家` };
          if (m.label === '昨日连板指数') return { label: m.label, value: `${yesterdayLb?.length ?? '--'}家` };
          return mapMetricToFactor(m);
        })
      : undefined,
    sentimentStocks: (sentimentStocks.zt.length || sentimentStocks.dt.length || sentimentStocks.zb.length) ? sentimentStocks : undefined,
    consecutiveStocks: consecutiveStocks.length ? consecutiveStocks : undefined,
    yesterdayZt: yesterdayZt?.length ? yesterdayZt : undefined,
    yesterdayLb: yesterdayLb?.length ? yesterdayLb : undefined,
    leaders: reviewData?.leaders?.map(mapLeader),
    hotThemes: reviewData?.hotThemes?.map(mapTheme),
    limitUps: limitUps?.length ? limitUps : undefined,
    dragonTiger: { inst: dtInst.length ? dtInst : dtFill.slice(0, 3), hot: dtHot.length ? dtHot : dtFill.slice(3, 5), north: dtNorth.length ? dtNorth : [] },
    nextDayFocus: reviewData?.nextDayFocus?.map(mapFocusItem),
    watchlist: favStocks.map((f) => ({ code: f.code, name: f.name })),
    watchlistQuotes,
  };
}
