import StockSDK from 'stock-sdk';
import { getMarketReview, scoreSentiment } from './market-review-service.js';
import { getBatchQuotes, getMarketPageSnapshot, listDailyDragonTiger, listEastmoneySurgeByDate } from './stock-client.js';
import { listFavoriteStocks, getConfig } from '../config-store.js';
import { chatWithOpenAICompatible } from '../llm/openai-compatible-client.js';
import { listSurgeDates, listSurgeHistory } from './surge-history-store.js';
import { listMarketBoards } from '../market-data/market-data-store.js';
import { fetchMarketIndex } from './market-indices.js';
import { buildMonthlyThemesFromHistoricalPools } from './discovery-monthly-themes.js';
import type {
  HotFocusItem,
  IMarketReviewHotTheme,
  IMarketReviewLeader,
  IMarketReviewMetric,
  IMarketReviewWatchItem,
} from '../../../src/shared/types.js';

const sdk = new StockSDK({ timeout: 12_000, retry: { maxRetries: 1 } });

type TStockItem = { code: string; name: string; price?: string; changePercent?: string; amount?: string };

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
export type TLocalBoardSummary = { code: string; name: string; changePercent: number; mainNetInflow: number };

type TLocalBoardCatalog = {
  rows: TLocalBoardSummary[];
  byCode: Map<string, TLocalBoardSummary>;
  byName: Map<string, TLocalBoardSummary>;
};

const SECTOR_FLOW_CACHE_TTL_MS = 5 * 60 * 1000;
const sectorFlowRankCache = new Map<
  TSectorFlowIndicator,
  { rows: ISectorSummary[]; updatedAt: number; promise?: Promise<ISectorSummary[]> }
>();

function mapMetricToFactor(m: IMarketReviewMetric): { label: string; value: string | number } {
  if (m.value === null || m.value === undefined) return { label: m.label, value: '--' };
  return { label: m.label, value: `${m.value}${m.unit ?? ''}` };
}

function mapLeader(l: IMarketReviewLeader): NonNullable<IDiscoverySnapshot['leaders']>[number] {
  return { code: l.code, name: l.name, height: l.height, amount: l.amount, concepts: l.concepts, changePercent: l.changePercent };
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

type TNextWeekSectorCandidate = { name?: string; score?: number; reasoning?: Partial<INextWeekSector['reasoning']> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseJsonArray<T>(text: string, isItem: (value: unknown) => value is T): T[] {
  const parsed: unknown = JSON.parse(text);
  return Array.isArray(parsed) ? parsed.filter(isItem) : [];
}

function isNextWeekSectorCandidate(value: unknown): value is TNextWeekSectorCandidate {
  return isRecord(value);
}

export function normalizeBoardLookupName(name: string) {
  return name.replace(/行业|板块|Ⅱ|Ⅲ|II|III|\s/g, '');
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

function findLocalBoard(catalog: TLocalBoardCatalog, input: { code?: string; name?: string }) {
  if (input.code) {
    const byCode = catalog.byCode.get(input.code);
    if (byCode) return byCode;
  }
  const name = input.name?.trim();
  if (!name) return undefined;
  const normalized = normalizeBoardLookupName(name);
  return catalog.byName.get(name)
    ?? catalog.byName.get(normalized)
    ?? catalog.rows.find((row) => {
      const rowName = normalizeBoardLookupName(row.name);
      return rowName.includes(normalized) || normalized.includes(rowName);
    });
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

  const rows = await Promise.all(weeks.map(async (week) => {
    const items = (await Promise.all(week.dates.map((date) => listEastmoneySurgeByDate(date)))).flat();
    return { ...week, items };
  }));

  return buildMonthlyThemesFromHistoricalPools(rows, boardCatalog.rows);
}

function reconcileSectorsWithLocalBoards(sectors: ISectorSummary[], catalog: TLocalBoardCatalog): ISectorSummary[] {
  if (!catalog.rows.length) return [];
  const matched = sectors
    .map((sector) => {
      const local = findLocalBoard(catalog, sector);
      return local ? { ...sector, code: local.code, name: local.name } : undefined;
    })
    .filter((sector): sector is ISectorSummary => Boolean(sector));
  if (matched.length) return matched;
  return catalog.rows.slice(0, 30);
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

async function fetchMainFundFlow(): Promise<number | null> {
  try {
    const rows = await sdk.fundFlow.market();
    const latest = rows
      .filter((r) => r.mainNetInflow !== null && r.mainNetInflow !== undefined)
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0];
    return latest ? Number(latest.mainNetInflow) / 100_000_000 : null;
  } catch (err) {
    console.warn('[discovery] main fund flow fetch failed', err);
    return null;
  }
}

async function fetchNorthFundFlow(): Promise<number | null> {
  try {
    const rows = await sdk.northbound.summary();
    const north = rows.find((r) => r.direction?.includes('北向') || r.direction?.includes('North'));
    return north?.netInflow !== null && north?.netInflow !== undefined ? Number(north.netInflow) / 100_000_000 : null;
  } catch (err) {
    console.warn('[discovery] north fund flow fetch failed', err);
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
        changePercent: row.changePercent ?? 0,
        mainNetInflow: 0,
      }))
      .filter((row) => row.code && row.name);
    return buildLocalBoardCatalog(summaries);
  } catch {
    return buildLocalBoardCatalog([]);
  }
}

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
      mainNetInflow: r.mainNetInflow !== null && r.mainNetInflow !== undefined ? Number(r.mainNetInflow) / 100_000_000 : 0,
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
      .map((s) => `${s.name}(涨幅${s.changePercent >= 0 ? '+' : ''}${s.changePercent.toFixed(2)}%，资金${s.mainNetInflow >= 0 ? '+' : ''}${s.mainNetInflow.toFixed(1)}亿)`)
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

async function fetchSectorLeaders(code: string): Promise<Array<{ code: string; name: string; height?: number | null }> | undefined> {
  const loaders = [
    () => sdk.board.concept.constituents(code),
    () => sdk.board.industry.constituents(code),
  ];
  for (const load of loaders) {
    try {
      const items = await load();
      const leaders = items
        .slice(0, 3)
        .map((item) => ({ code: item.code ?? '', name: item.name ?? '' }))
        .filter((item) => item.code && item.name);
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
    if (!boardName || boardName.includes('换手') || boardName.includes('封单') || boardName.includes('成交额')) continue;
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
        .map((item) => ({ code: item.code ?? '', name: item.name ?? item.title, height: parseHeight(item.description) }))
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

async function buildHotThemesFromSectors(sectors: ISectorSummary[]): Promise<NonNullable<IDiscoverySnapshot['hotThemes']>> {
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

async function buildMarketSummary(
  reviewData: Awaited<ReturnType<typeof getMarketReview>> | undefined,
  pools: HotFocusItem[],
): Promise<IMarketSummary | undefined> {
  const [boardCatalog, remoteSectors] = await Promise.all([
    fetchLocalBoardCatalog(),
    fetchSectorFlowRank(),
  ]);
  const sectors = reconcileSectorsWithLocalBoards(remoteSectors, boardCatalog);

  const [indices, mainFundFlow, northFundFlow] = await Promise.all([
    fetchAllIndices(),
    fetchMainFundFlow(),
    fetchNorthFundFlow(),
  ]);

  if (!indices.length && !sectors.length) return undefined;

  const limitUp = pools.filter((item) => item.tag === '封涨停板').length;
  const limitDown = pools.filter((item) => item.tag === '封跌停板').length;
  const sentimentBar = reviewData?.sentimentScore ?? 50;
  const opportunityRadar = buildOpportunityRadar(sectors);

  const [monthlyThemes, nextWeekSectors] = await Promise.all([
    fetchCompletedMonthWeekPools(boardCatalog),
    generateNextWeekSectors(sectors, reviewData?.hotThemes ?? [], mainFundFlow, northFundFlow, boardCatalog),
  ]);

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

  // Build new AI market summary.
  let marketSummary: IMarketSummary | undefined;
  try {
    marketSummary = await buildMarketSummary(reviewData, poolItems);
  } catch (err) {
    console.warn('[discovery] build market summary failed', err);
  }

  const sectorThemes = await buildHotThemesFromSectors(marketSummary?.sectors ?? []);
  const poolThemes = buildHotThemesFromPools(poolItems);
  const hotThemes = reviewData?.hotThemes?.length
    ? reviewData.hotThemes.map(mapTheme)
    : sectorThemes.length
      ? sectorThemes
      : poolThemes;

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
    sentimentStocks: (sentimentStocks.zt.length || sentimentStocks.dt.length || sentimentStocks.zb.length) ? sentimentStocks : undefined,
    consecutiveStocks: consecutiveStocks.length ? consecutiveStocks : undefined,
    yesterdayZt: yesterdayZt?.length ? yesterdayZt : undefined,
    yesterdayLb: yesterdayLb?.length ? yesterdayLb : undefined,
    leaders: reviewData?.leaders?.map(mapLeader),
    hotThemes: hotThemes.length ? hotThemes : undefined,
    limitUps: limitUps?.length ? limitUps : undefined,
    dragonTiger: { inst: dtInst.length ? dtInst : dtFill.slice(0, 3), hot: dtHot.length ? dtHot : dtFill.slice(3, 5), north: dtNorth.length ? dtNorth : [] },
    nextDayFocus: reviewData?.nextDayFocus?.map(mapFocusItem),
    watchlist: favStocks.map((f) => ({ code: f.code, name: f.name })),
    watchlistQuotes,
  };
}
