import { getMarketReview } from './market-review-service.js';
import { getDiscoverySnapshot } from './discovery-service.js';
import { getBatchQuotes, listDailyDragonTiger, listEastmoneySurgeByDate } from './stock-client.js';
import { getConfig } from '../config-store.js';
import { chatWithOpenAICompatible } from '../llm/openai-compatible-client.js';
import { sdk } from './shared.js';
import type { IMarketReviewMetric, ITradingAdvice, ITradingAdviceOptions, ITradingAdviceSector, StockDetail, TMarketReviewReport, TMarketReviewWatchCategory } from '../../../src/shared/types.js';

// ── Data collection ──

async function collectMarketData() {
  const today = new Date().toISOString().slice(0, 10).replaceAll('-', '');

  const [review, dragonTiger, fundFlowRank, eastmoneyPool, conceptBoards] = await Promise.allSettled([
    getMarketReview(),
    listDailyDragonTiger(),
    sdk.fundFlow.rank({ indicator: 'today' }).catch(() => []),
    listEastmoneySurgeByDate(today),
    sdk.board.concept.list().catch(() => []),
  ]);

  const reviewData = review.status === 'fulfilled' ? review.value : undefined;
  const dtItems = dragonTiger.status === 'fulfilled' ? dragonTiger.value : [];
  const fundFlows = fundFlowRank.status === 'fulfilled' ? fundFlowRank.value : [];
  const poolItems = eastmoneyPool.status === 'fulfilled' ? eastmoneyPool.value : [];
  const concepts = conceptBoards.status === 'fulfilled' ? conceptBoards.value : [];

  return { reviewData, dtItems, fundFlows, poolItems, concepts, today };
}

// ── Prompt building ──

type TTradingAdviceData = Awaited<ReturnType<typeof collectMarketData>>;

function buildUserPrompt(data: TTradingAdviceData): string {
  const { reviewData, dtItems, fundFlows, poolItems, concepts } = data;

  const parts: string[] = [];
  parts.push(`你是一名 A 股短线策略师。以下是 **${reviewData?.tradeDate ?? '今日'}** 收盘后的市场数据摘要，请基于这些数据生成明日操作建议。`);

  // 一、大盘概况
  if (reviewData?.wealthEffect) {
    parts.push('\n## 一、大盘概况');
    for (const m of reviewData.wealthEffect) {
      const val = m.value !== null && m.value !== undefined
        ? (typeof m.value === 'number' ? (Number.isInteger(m.value) ? String(m.value) : m.value.toFixed(2)) : String(m.value))
        : '--';
      parts.push(`- ${m.label}：${val}${m.unit ?? ''}`);
    }
  }
  if (reviewData?.sentiment) {
    parts.push('\n全市场情绪：');
    for (const m of reviewData.sentiment) {
      const val = m.value !== null && m.value !== undefined ? `${m.value}${m.unit ?? ''}` : '--';
      parts.push(`- ${m.label}：${val}`);
    }
  }

  // 二、热门概念板块
  if (concepts.length) {
    parts.push('\n## 二、热门概念板块（Top 15）');
    const sorted = concepts
      .filter((c) => c.changePercent !== undefined && c.changePercent !== null)
      .sort((a, b) => {
        const aVal = typeof a.changePercent === 'number' ? a.changePercent : Number(a.changePercent);
        const bVal = typeof b.changePercent === 'number' ? b.changePercent : Number(b.changePercent);
        return (bVal ?? 0) - (aVal ?? 0);
      })
      .slice(0, 15);
    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i];
      parts.push(`${i + 1}. ${c.name}：${c.changePercent ?? '--'}% | 领涨：${String(c.leadingStock ?? '--')}`);
    }
  }

  // 三、资金面
  if (fundFlows.length) {
    parts.push('\n## 三、资金面（全市场主力净流入 Top 20）');
    const top20 = fundFlows.slice(0, 20);
    for (const item of top20) {
      const mainInflow = item.mainNetInflow !== undefined && item.mainNetInflow !== null
        ? `${(Number(item.mainNetInflow) / 1e8).toFixed(2)}亿`
        : '--';
      parts.push(`- ${item.name}(${item.code})：主力净流入 ${mainInflow}`);
    }
  }

  // 四、涨停情绪
  const ztItems = poolItems.filter((item) => (item.tag ?? '') === '封涨停板');
  const dtItems2 = poolItems.filter((item) => (item.tag ?? '') === '封跌停板');
  const zbItems = poolItems.filter((item) => (item.tag ?? '') === '涨停开板');
  parts.push('\n## 四、涨停情绪');
  parts.push(`- 涨停 ${ztItems.length} 家，炸板 ${zbItems.length} 家，跌停 ${dtItems2.length} 家`);

  // 连板梯队
  const heightBuckets = new Map<number, string[]>();
  for (const item of ztItems) {
    const desc = item.description ?? '';
    const match = desc.match(/(\d+)连板/);
    const h = match ? Number(match[1]) : 1;
    const list = heightBuckets.get(h) ?? [];
    list.push(item.name ?? item.code ?? '');
    heightBuckets.set(h, list);
  }
  if (heightBuckets.size) {
    parts.push('\n连板梯队：');
    const sortedHeights = [...heightBuckets.keys()].sort((a, b) => b - a);
    for (const h of sortedHeights) {
      const stocks = heightBuckets.get(h) ?? [];
      parts.push(`- ${h}板（${stocks.length}家）：${stocks.slice(0, 5).join('、')}${stocks.length > 5 ? '等' : ''}`);
    }
  }

  // 五、龙虎榜
  if (dtItems.length) {
    parts.push('\n## 五、龙虎榜（近 3 日，选取代表性席位）');
    const inst = dtItems.filter((item) => /机构|专用|基金|券商|保险|QFII/.test(item.reason)).slice(0, 5);
    const hot = dtItems.filter((item) => /游资|营业部|席位|大户/.test(item.reason)).slice(0, 5);
    if (inst.length) {
      parts.push('\n机构席位：');
      for (const item of inst) {
        parts.push(`- ${item.name}(${item.code})：净买 ${(item.netBuy / 1e8).toFixed(2)}亿 | ${item.reason}`);
      }
    }
    if (hot.length) {
      parts.push('\n活跃游资：');
      for (const item of hot) {
        parts.push(`- ${item.name}(${item.code})：净买 ${(item.netBuy / 1e8).toFixed(2)}亿 | ${item.reason}`);
      }
    }
  }

  // 六、热点方向
  if (reviewData?.hotThemes?.length) {
    parts.push('\n## 六、热点方向');
    for (const theme of reviewData.hotThemes.slice(0, 8)) {
      const changePercent = theme.changePercent !== undefined && theme.changePercent !== null
        ? `${Number(theme.changePercent) > 0 ? '+' : ''}${theme.changePercent}%`
        : '--';
      parts.push(`- ${theme.name}：${changePercent} | 涨停 ${theme.limitUpCount ?? '--'} 家${theme.leaderName ? ` | 龙头 ${theme.leaderName}` : ''}${theme.reason ? ` | ${theme.reason}` : ''}`);
    }
  }

  // 七、明日观察
  if (reviewData?.nextDayFocus?.length) {
    parts.push('\n## 七、已生成的明日观察项（供参考）');
    for (const item of reviewData.nextDayFocus) {
      parts.push(`- [${item.category}] ${item.condition}`);
    }
  }

  parts.push('\n\n请基于以上数据，以 JSON 格式输出明日操作建议。只输出 JSON，不要其他文字。');
  return parts.join('\n');
}

const SYSTEM_PROMPT = `你是一位顶级 A 股量化交易策略师，拥有 15 年短线交易经验。你的任务是根据今日市场数据，生成一份明日操作建议。

你必须基于提供的数据做出判断，如果数据不足以支撑某个结论，请诚实标注"数据不足"，不得编造。

回复必须严格使用以下 JSON 格式，不要输出任何其他内容：

{
  "starRating": <1-5 整数>,
  "starLabel": "<星级对应的简短中文描述>",
  "suggestedPosition": <0-100 整数，建议仓位百分比>,
  "positionReason": "<仓位建议的一句理由，不超过20字>",
  "suitableStrategies": ["<策略1>", "<策略2>"],
  "unsuitableStrategies": ["<策略1>", "<策略2>"],
  "keySectors": [
    {
      "name": "<板块名称>",
      "confidence": "<high|medium|low>",
      "reason": "<一句话理由，不超过15字>",
      "leaderCode": "<领涨股代码>",
      "leaderName": "<领涨股名称>"
    }
  ],
  "marketSummary": "<50字以内的市场核心矛盾概述>",
  "riskReminder": "<20字以内的风险提示>"
}

风格要求：
- 专业、冷静、数据驱动，像 Bloomberg 终端里的策略师
- 不喊单，不炒作，不夸大
- 数字必须来自数据，不得猜测
- starRating 标准：5=强烈看多（涨停家数多、赚钱效应强、热点明确），4=谨慎偏多，3=中性观望，2=偏空防御，1=强烈看空（大面积跌停、恐慌）
- suggestedPosition 参考：80-100 对应 5 星，60-79 对应 4 星，40-59 对应 3 星，20-39 对应 2 星，0-19 对应 1 星
- keySectors 输出 3-5 个最值得关注的板块`;

// ── Response parsing ──

type TAdviceQuoteResolver = (codes: string[]) => Promise<Array<Pick<StockDetail, 'code' | 'name'>>>;

function normalizeAdviceStockCode(code: string): string {
  return code.trim().replace(/^\D+/, '');
}

function cloneAdviceWithSectors(advice: ITradingAdvice, keySectors: ITradingAdviceSector[]): ITradingAdvice {
  return { ...advice, keySectors };
}

export async function reconcileAdviceLeaderStocks(
  advice: ITradingAdvice,
  quoteResolver: TAdviceQuoteResolver = getBatchQuotes,
): Promise<ITradingAdvice> {
  const codes = [
    ...new Set(
      advice.keySectors
        .map((sector) => normalizeAdviceStockCode(sector.leaderCode))
        .filter(Boolean),
    ),
  ];
  if (!codes.length) return advice;

  let quotes: Array<Pick<StockDetail, 'code' | 'name'>> = [];
  try {
    quotes = await quoteResolver(codes);
  } catch (error) {
    console.warn('[trading-advice] leader quote reconcile failed', error);
    return advice;
  }

  const quoteByCode = new Map<string, Pick<StockDetail, 'code' | 'name'>>();
  for (const quote of quotes) {
    const code = normalizeAdviceStockCode(quote.code);
    if (code && quote.name) quoteByCode.set(code, quote);
  }
  if (!quoteByCode.size) return advice;

  return cloneAdviceWithSectors(
    advice,
    advice.keySectors.map((sector) => {
      const quote = quoteByCode.get(normalizeAdviceStockCode(sector.leaderCode));
      return quote?.name ? { ...sector, leaderName: quote.name } : sector;
    }),
  );
}

function parseAdviceResponse(raw: string): ITradingAdvice {
  // Try to extract JSON from the response (in case AI adds markdown fences or preamble)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI 响应中未找到 JSON');

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('AI 响应 JSON 解析失败');
  }

  // Validate required fields
  const starRating = Number(parsed.starRating);
  if (!Number.isInteger(starRating) || starRating < 1 || starRating > 5) {
    throw new Error(`AI 返回的 starRating 无效: ${parsed.starRating}`);
  }

  const suggestedPosition = Number(parsed.suggestedPosition);
  if (!Number.isInteger(suggestedPosition) || suggestedPosition < 0 || suggestedPosition > 100) {
    throw new Error(`AI 返回的 suggestedPosition 无效: ${parsed.suggestedPosition}`);
  }

  const starLabel = String(parsed.starLabel ?? '');
  const positionReason = String(parsed.positionReason ?? '');
  const marketSummary = String(parsed.marketSummary ?? '');
  const riskReminder = String(parsed.riskReminder ?? '');

  const suitableStrategies = Array.isArray(parsed.suitableStrategies)
    ? parsed.suitableStrategies.map(String)
    : [];
  const unsuitableStrategies = Array.isArray(parsed.unsuitableStrategies)
    ? parsed.unsuitableStrategies.map(String)
    : [];

  const keySectors: ITradingAdviceSector[] = [];
  if (Array.isArray(parsed.keySectors)) {
    for (const sector of parsed.keySectors) {
      if (sector && typeof sector === 'object') {
        const s = sector as Record<string, unknown>;
        keySectors.push({
          name: String(s.name ?? ''),
          confidence: (s.confidence === 'high' || s.confidence === 'medium' || s.confidence === 'low')
            ? s.confidence as ITradingAdviceSector['confidence']
            : 'medium',
          reason: String(s.reason ?? ''),
          leaderCode: String(s.leaderCode ?? ''),
          leaderName: String(s.leaderName ?? ''),
        });
      }
    }
  }

  return {
    starRating,
    starLabel,
    suggestedPosition,
    positionReason,
    suitableStrategies,
    unsuitableStrategies,
    keySectors,
    marketSummary,
    riskReminder,
  };
}

function isIsoTradeDate(value?: string): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function compactTradeDate(date: string) {
  return date.replaceAll('-', '');
}

function isMarketReviewMetricUnit(value: string): value is NonNullable<IMarketReviewMetric['unit']> {
  return value === '家' || value === '%' || value === '板' || value === '亿' || value === '分';
}

function hasHistoricalAdviceData(data: TTradingAdviceData): boolean {
  return Boolean(
    data.reviewData?.nextDayFocus?.length ||
      data.reviewData?.hotThemes?.length ||
      data.dtItems.length ||
      data.poolItems.length ||
      data.reviewData?.sentiment?.length,
  );
}

function toMarketReviewWatchCategory(value: string): TMarketReviewWatchCategory {
  if (
    value === 'leader' ||
    value === 'theme' ||
    value === 'liquidity' ||
    value === 'sentiment' ||
    value === 'risk' ||
    value === 'northbound'
  ) {
    return value;
  }
  return 'theme';
}

async function collectHistoricalMarketData(tradeDate: string): Promise<TTradingAdviceData> {
  const snapshot = await getDiscoverySnapshot({ tradeDate });
  if (snapshot.unavailableReason) throw new Error(snapshot.unavailableReason);
  const dragonTiger = snapshot.dragonTiger;
  const dtItems = [
    ...(dragonTiger?.inst ?? []),
    ...(dragonTiger?.hot ?? []),
    ...(dragonTiger?.first ?? []),
  ].map((item, index) => ({
    id: `${tradeDate}-${item.code}-${index}`,
    date: tradeDate,
    code: item.code,
    name: item.name,
    reason: item.reason,
    changePercent: item.changePercent,
    netBuy: item.netBuy,
    buy: Math.max(item.netBuy, 0),
    sell: item.netBuy < 0 ? Math.abs(item.netBuy) : 0,
  }));
  const poolItems = await listEastmoneySurgeByDate(compactTradeDate(tradeDate));
  const reviewData: TMarketReviewReport = {
    tradeDate: snapshot.tradeDate,
    generatedAt: snapshot.generatedAt,
    dataSources: ['discovery-snapshot'],
    dataGaps: [],
    indexSummary: snapshot.marketSummary?.indices.map((item) => ({ name: item.name, changePercent: item.changePercent, amount: null })) ?? [],
    sentimentScore: snapshot.sentimentScore ?? null,
    profitDirections: [],
    lossDirections: [],
    leaders: snapshot.leaders?.map((item) => ({
      code: item.code,
      name: item.name,
      concepts: item.concepts ?? [],
      height: item.height ?? null,
      amount: item.amount ?? null,
      turnoverRate: null,
      sealAmount: null,
      changePercent: item.changePercent ?? null,
    })) ?? [],
    wealthEffect: snapshot.wealthMetrics?.map((item) => ({
      label: item.label,
      value: item.value,
      unit: isMarketReviewMetricUnit(item.unit) ? item.unit : undefined,
    })) ?? [],
    sentiment: snapshot.sentimentFactors?.map((item) => ({
      label: item.label,
      value: typeof item.value === 'number' ? item.value : null,
      unit: undefined,
    })) ?? [],
    hotThemes: snapshot.hotThemes?.map((item) => ({
      id: item.code ?? item.name,
      name: item.name,
      boardCode: item.code ?? null,
      score: null,
      changePercent: item.changePercent ?? null,
      limitUpCount: item.limitUpCount ?? null,
      reason: item.reason ?? null,
      leaderName: item.leaderName ?? null,
      leaderCode: item.leaderCode ?? null,
      leaderHeight: item.leaders?.[0]?.height ?? null,
      mainNetInflow: null,
      amount: null,
      limitUpStocks: item.leaders?.map((leader) => ({ code: leader.code, name: leader.name, height: leader.height ?? null })) ?? [],
      coreStocks: [],
      trackingNote: null,
    })) ?? [],
    nextDayFocus: snapshot.nextDayFocus?.map((item) => ({
      id: item.category,
      category: toMarketReviewWatchCategory(item.category),
      condition: item.condition,
      baseline: item.baseline ?? null,
      tone: 'neutral' as const,
    })) ?? [],
  };
  const data = { reviewData, dtItems, fundFlows: [], poolItems, concepts: [], today: compactTradeDate(tradeDate) };
  if (!hasHistoricalAdviceData(data)) throw new Error('该交易日暂无足够数据生成交易建议');
  return data;
}

function resolveAdviceTradeDate(options: ITradingAdviceOptions = {}) {
  return isIsoTradeDate(options.tradeDate) ? options.tradeDate : new Date().toISOString().slice(0, 10);
}

async function collectTradingAdviceData(tradeDate: string): Promise<TTradingAdviceData> {
  const today = new Date().toISOString().slice(0, 10);
  return tradeDate === today ? collectMarketData() : collectHistoricalMarketData(tradeDate);
}

// ── Cache ──
const adviceCache = new Map<string, ITradingAdvice>();

// ── Main export ──

export async function getTradingAdvice(options: ITradingAdviceOptions = {}): Promise<ITradingAdvice> {
  const tradeDate = resolveAdviceTradeDate(options);

  const cachedAdvice = adviceCache.get(tradeDate);
  if (cachedAdvice) return cachedAdvice;

  const data = await collectTradingAdviceData(tradeDate);

  if (!data.reviewData) {
    throw new Error('市场数据获取失败，无法生成交易建议');
  }

  const userPrompt = buildUserPrompt(data);
  const cfg = getConfig();

  const response = await chatWithOpenAICompatible(cfg.model, [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ]);

  const parsedAdvice = parseAdviceResponse(response);
  const advice = await reconcileAdviceLeaderStocks(parsedAdvice);

  adviceCache.set(tradeDate, advice);

  return advice;
}
