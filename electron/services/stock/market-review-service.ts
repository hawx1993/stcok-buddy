import type { HotFocusItem, IMarketReviewHotTheme, IMarketReviewLeader, IMarketReviewMetric, IMarketReviewWatchItem, TMarketReviewRating, TMarketReviewReport } from '../../../src/shared/types.js';
import { uniqueRowsByCode } from './market-review-data.js';
import { getMarketPageSnapshot, listEastmoneySurgeByDate, listHotFocus } from './stock-client.js';

const marketTabs = ['sh-main', 'sz-main', 'bj', 'gem', 'star'] as const;

export async function getMarketReview(): Promise<TMarketReviewReport> {
  const [snapshotsResult, sectorsResult, flowsResult] = await Promise.allSettled([
    Promise.all(marketTabs.map((tab) => getMarketPageSnapshot(tab))),
    listHotFocus('sector'),
    listHotFocus('flow'),
  ]);
  const snapshots = requireMarketReviewData(snapshotsResult, '全市场行情');
  const sectors = valueOrEmpty(sectorsResult);
  const flows = valueOrEmpty(flowsResult);
  const rows = uniqueRowsByCode(snapshots.flatMap((snapshot) => snapshot.rows));
  if (!rows.length) throw new Error('未获取到全市场真实行情，无法生成今日行情复盘');

  const tradeDate = snapshots.map((snapshot) => snapshot.updatedAt.slice(0, 10)).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
  const pools = await listEastmoneySurgeByDate(tradeDate.replaceAll('-', ''));
  const limitUps = pools.filter((item) => item.tag === '封涨停板');
  const broken = pools.filter((item) => item.tag === '涨停开板');
  const limitDowns = pools.filter((item) => item.tag === '封跌停板');
  const changes = rows.map((row) => asNumber(row.changePercent)).filter((value): value is number => value !== null);
  const rising = changes.filter((value) => value > 0);
  const falling = changes.filter((value) => value < 0);
  const limitUpHeights = limitUps.map((item) => readHeight(item.description));
  const strongestHeight = maxOrNull(limitUpHeights);
  const consecutiveCount = limitUpHeights.filter((value) => value !== null && value >= 2).length;
  const sentimentScore = scoreSentiment(rising.length, falling.length, limitUps.length, limitDowns.length, broken.length);
  const themes = buildThemes(sectors, flows, limitUps);
  const leaders = buildLeaders(limitUps);
  const marketAmount = sumAmounts(rows);
  const brokenRate = limitUps.length + broken.length ? broken.length / (limitUps.length + broken.length) * 100 : null;

  return {
    tradeDate,
    generatedAt: new Date().toISOString(),
    dataSources: ['stock-sdk 行情/板块/资金流', '东财涨停、炸板、跌停池（stock-client Provider）'],
    dataGaps: buildDataGaps({ pools, sectors, flows }),
    indexSummary: [],
    sentimentScore,
    sentiment: [
      metric('涨停', limitUps.length, '家'), metric('跌停', limitDowns.length, '家'), metric('炸板', broken.length, '家'),
      metric('连板', consecutiveCount, '家'), metric('最高板', strongestHeight, '板'),
      metric('昨日涨停指数', null, '%'), metric('昨日连板指数', null, '%'),
    ],
    wealthEffect: [
      metric('平均涨幅', mean(changes), '%'), metric('上涨股票', rising.length, '家'), metric('下跌股票', falling.length, '家'),
      metric('涨幅中位数', median(changes), '%'), metric('跌幅中位数', median(falling), '%'),
    ],
    profitDirections: themes.filter((theme) => (theme.changePercent ?? 0) > 0).slice(0, 4).map((theme) => theme.name),
    lossDirections: sectors.filter((item) => parsePercent(item.changePercent) !== null && parsePercent(item.changePercent)! < 0).slice(-4).map(themeName),
    hotThemes: themes,
    leaders,
    nextDayFocus: buildNextDayFocus(themes, leaders, marketAmount, limitUps.length, brokenRate),
  };
}

function requireMarketReviewData<T>(result: PromiseSettledResult<T>, label: string): T {
  if (result.status === 'fulfilled') return result.value;
  const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
  throw new Error(`${label}获取失败：${message}`);
}

function valueOrEmpty<T>(result: PromiseSettledResult<T[]>): T[] {
  return result.status === 'fulfilled' ? result.value : [];
}

function buildThemes(sectors: HotFocusItem[], flows: HotFocusItem[], limitUps: HotFocusItem[]): IMarketReviewHotTheme[] {
  const flowByName = new Map(flows.map((item) => [themeName(item), item]));
  return sectors.slice(0, 6).map((item, index) => {
    const flow = flowByName.get(themeName(item));
    const related = limitUps.filter((stock) => (stock.description ?? '').includes(themeName(item))).slice(0, 12);
    const leader = related[0] ?? null;
    const changePercent = parsePercent(item.changePercent);
    const score = ratingFromRank(index, changePercent, flow);
    return {
      id: item.code ?? item.id,
      boardCode: item.code ?? null,
      name: themeName(item), score, changePercent, limitUpCount: related.length || null,
      leaderName: leader?.name ?? null, leaderCode: leader?.code ?? null, leaderHeight: leader ? readHeight(leader.description) : null,
      mainNetInflow: parseMoney(flow?.amount), amount: parseMoney(item.amount),
      limitUpStocks: related.map((stock) => ({ code: stock.code ?? '', name: stock.name ?? stock.title, height: readHeight(stock.description) })),
      coreStocks: [item, flow].filter((value): value is HotFocusItem => Boolean(value)).map((stock) => ({ code: stock.code ?? '', name: stock.name ?? stock.title, changePercent: parsePercent(stock.changePercent) })),
      reason: item.description ?? null,
      trackingNote: leader ? `重点观察 ${leader.name ?? leader.title} 能否维持高位承接。` : null,
    };
  });
}

function buildLeaders(limitUps: HotFocusItem[]): IMarketReviewLeader[] {
  return [...limitUps]
    .sort((left, right) => (readHeight(right.description) ?? 0) - (readHeight(left.description) ?? 0))
    .slice(0, 3)
    .map((item) => ({
      code: item.code ?? '', name: item.name ?? item.title, concepts: splitConcepts(item.description), height: readHeight(item.description),
      amount: parseAmountInYi(item.description), turnoverRate: parseTurnover(item.description), sealAmount: parseSealAmount(item.amount ?? item.description), changePercent: parsePercent(item.changePercent),
    }));
}

function buildNextDayFocus(
  themes: IMarketReviewHotTheme[],
  leaders: IMarketReviewLeader[],
  marketAmount: number | null,
  limitUpCount: number,
  brokenRate: number | null,
): IMarketReviewWatchItem[] {
  const leader = leaders[0];
  const followUpTheme = themes.find((theme) => theme.name !== themes[0]?.name);
  return [
    watch('leader', 'leader', leader ? `观察 ${leader.name} 是否继续封板或维持高位承接` : '暂无可验证龙头，观察最高连板股的高位承接', leader?.height ?? null, 'up', '板'),
    watch('theme', 'theme', followUpTheme ? `观察 ${followUpTheme.name} 是否出现接力与扩散` : '暂无可验证次级热点，观察是否出现新的板块接力', followUpTheme?.changePercent ?? null, 'neutral', '%'),
    watch('liquidity', 'liquidity', marketAmount === null ? '暂无可验证成交额基准' : `观察全市场成交额是否超过今日 ${marketAmount.toFixed(0)} 亿`, marketAmount, 'neutral', '亿'),
    watch('sentiment', 'sentiment', `观察涨停家数是否超过 70 家（今日 ${limitUpCount} 家）`, limitUpCount, limitUpCount >= 70 ? 'up' : 'warn', '家'),
    watch('risk', 'risk', brokenRate === null ? '暂无可验证炸板率基准' : `观察炸板率是否低于今日 ${brokenRate.toFixed(1)}%`, brokenRate, 'down', '%'),
    watch('northbound', 'northbound', '观察北向资金是否净流入（当前数据源暂未接入可验证北向汇总）', null, 'neutral'),
  ];
}

function watch(
  id: string,
  category: IMarketReviewWatchItem['category'],
  condition: string,
  baseline: number | null,
  tone: IMarketReviewWatchItem['tone'],
  unit?: IMarketReviewWatchItem['unit'],
): IMarketReviewWatchItem {
  return { id, category, condition, baseline, tone, unit };
}

function sumAmounts(rows: Array<{ amount?: number | string }>): number | null {
  const amounts = rows.map((row) => asNumber(row.amount)).filter((value): value is number => value !== null && value > 0);
  return amounts.length ? amounts.reduce((sum, value) => sum + value, 0) / 100_000_000 : null;
}

function metric(label: string, value: number | null, unit: IMarketReviewMetric['unit']): IMarketReviewMetric { return { label, value, unit }; }
function asNumber(value: number | string | undefined): number | null { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function parsePercent(value: string | undefined): number | null { const parsed = Number(String(value ?? '').replace('%', '')); return Number.isFinite(parsed) ? parsed : null; }
function parseMoney(value: string | undefined): number | null {
  if (!value || value === '--') return null;
  const match = value.match(/([+-]?[\d.]+)\s*(亿|万)?/);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return null;
  if (match[2] === '万') return parsed / 10_000;
  return parsed;
}
function parseAmountInYi(value?: string): number | null { const match = value?.match(/成交额\s*([\d.]+)亿/); return match ? Number(match[1]) : null; }
function parseSealAmount(value?: string): number | null { const match = value?.match(/封单\s*([\d.]+)亿/); return match ? Number(match[1]) : null; }
function parseTurnover(value?: string): number | null { const match = value?.match(/换手\s*([\d.]+)%/); return match ? Number(match[1]) : null; }
function readHeight(value?: string): number | null { const match = value?.match(/(\d+)连板/); return match ? Number(match[1]) : null; }
function splitConcepts(value?: string) { return (value ?? '').split('·').map((item) => item.trim()).filter((item) => item && !/(连板|换手|封单|成交额|开板)/.test(item)).slice(0, 3); }
function themeName(item: HotFocusItem) { return item.name ?? item.title; }
function maxOrNull(values: Array<number | null>) { const items = values.filter((value): value is number => value !== null); return items.length ? Math.max(...items) : null; }
function mean(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function median(values: number[]) { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function toRating(value: number): TMarketReviewRating { return Math.max(1, Math.min(5, Math.ceil(value))) as TMarketReviewRating; }
function ratingFromRank(index: number, changePercent: number | null, flow?: HotFocusItem): TMarketReviewRating | null { if (changePercent === null && !flow) return null; return toRating(Math.max(1, 5 - index)); }
function scoreSentiment(up: number, down: number, zt: number, dt: number, broken: number) { if (!up && !down && !zt && !dt && !broken) return null; return Math.max(0, Math.min(100, Math.round(50 + (up - down) / Math.max(up + down, 1) * 30 + zt - dt * 2 - broken / 2))); }
function buildDataGaps(input: { pools: HotFocusItem[]; sectors: HotFocusItem[]; flows: HotFocusItem[] }) { return [!input.pools.length ? '涨停/炸板/跌停池' : '', !input.sectors.length ? '板块排行' : '', !input.flows.length ? '板块资金流' : '', '昨日涨停指数与昨日连板指数'].filter(Boolean); }
