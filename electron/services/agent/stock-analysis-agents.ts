import type {
  AgentResultCard,
  ChipDistribution,
  EvidenceItem,
  EvidenceSource,
  HotFocusItem,
  IAgentDataGap,
  IAgentPlan,
  IAgentPlanRevision,
  IChipDistributionResult,
  IStockFundFlowSnapshot,
  KlinePoint,
  MarketNewsItem,
  StockDetail,
  StructuredAgentFinding,
  StructuredAgentOutput,
} from '../../../src/shared/types.js';
import { generateReport } from '../llm/index.js';
import { fallbackEvidence } from './evidence.js';
import { formatDataGapsForPrompt, formatPlanRevisionsForPrompt } from './agent-reflection.js';

export type StockAnalysisAgentName = 'technical' | 'fundamental' | 'capital' | 'sentiment' | 'chip';

type AgentDimension = StructuredAgentFinding['dimension'];
type AgentStance = StructuredAgentFinding['stance'];

export type StockAnalysisInput = {
  query: string;
  symbol: string;
  stockLabel: string;
  quote?: StockDetail;
  technical?: AgentResultCard;
  kline?: KlinePoint[];
  news?: MarketNewsItem[];
  largeOrders?: HotFocusItem[];
  fundFlow?: IStockFundFlowSnapshot;
  chip?: unknown;
  evidence?: EvidenceItem[];
  plan?: IAgentPlan;
  dataGaps?: IAgentDataGap[];
  planRevisions?: IAgentPlanRevision[];
};

export type StockAnalysisResult = {
  name: StockAnalysisAgentName;
  label: string;
  output: StructuredAgentOutput;
  content: string;
};

/** 为每个子 Agent 构建只包含相关维度的输入，减少 LLM token 与响应时间 */
export function buildStockAnalysisInputForAgent(
  agentName: StockAnalysisAgentName,
  input: StockAnalysisInput,
): StockAnalysisInput {
  const base: StockAnalysisInput = {
    query: input.query,
    symbol: input.symbol,
    stockLabel: input.stockLabel,
    quote: input.quote,
    plan: input.plan,
    dataGaps: input.dataGaps,
    planRevisions: input.planRevisions,
  };

  switch (agentName) {
    case 'technical':
      return {
        ...base,
        technical: input.technical,
        kline: input.kline?.slice(-30),
        evidence: filterEvidenceFor(input.evidence, ['quote', 'kline', 'technical']),
        dataGaps: filterDataGapsFor(input.dataGaps, ['行情', 'K线', '技术指标']),
      };
    case 'fundamental':
      return {
        ...base,
        evidence: filterEvidenceFor(input.evidence, [
          'quote',
          'kline',
          'technical',
          'local-market-data',
          'remote-market-data',
        ]),
        dataGaps: filterDataGapsFor(input.dataGaps, ['行情', 'K线', '技术指标']),
      };
    case 'capital':
      return {
        ...base,
        fundFlow: input.fundFlow,
        largeOrders: input.largeOrders,
        kline: input.kline?.slice(-5),
        evidence: filterEvidenceFor(input.evidence, ['quote', 'fund-flow', 'hot-focus']),
        dataGaps: filterDataGapsFor(input.dataGaps, ['行情', '资金流', '热点/特大单']),
      };
    case 'sentiment':
      return {
        ...base,
        news: input.news,
        evidence: filterEvidenceFor(input.evidence, ['quote', 'news', 'announcement']),
        dataGaps: filterDataGapsFor(input.dataGaps, ['行情', '新闻', '公告']),
      };
    case 'chip':
      return {
        ...base,
        chip: input.chip,
        kline: input.kline?.slice(-5),
        evidence: filterEvidenceFor(input.evidence, ['quote', 'kline', 'chip']),
        dataGaps: filterDataGapsFor(input.dataGaps, ['行情', 'K线', '筹码集中度']),
      };
    default:
      return input;
  }
}

function filterEvidenceFor(evidence: EvidenceItem[] = [], sources: EvidenceSource[]): EvidenceItem[] {
  return evidence.filter((item) => sources.includes(item.source));
}

function filterDataGapsFor(gaps: IAgentDataGap[] = [], dataNames: string[]): IAgentDataGap[] {
  return gaps.filter((gap) => dataNames.some((name) => gap.dataName.includes(name) || name.includes(gap.dataName)));
}

type StockAnalysisAgentDef = {
  name: StockAnalysisAgentName;
  dimension: AgentDimension;
  label: string;
  prompt: string;
  fallback(input: StockAnalysisInput): string;
};

const agents: StockAnalysisAgentDef[] = [
  {
    name: 'technical',
    dimension: 'technical',
    label: '📈 技术面分析',
    prompt: '你是资深A股技术分析专家。基于行情、K线、技术指标，分析趋势、支撑压力、量价关系、动能和技术风险。',
    fallback: (input) =>
      input.technical?.narrative ?? '📈 技术面：K线或指标数据不足，暂只能基于现价和涨跌幅做初步判断。',
  },
  {
    name: 'fundamental',
    dimension: 'fundamental',
    label: '📊 基本面分析',
    prompt:
      '你是资深基本面分析师。基于公司行情、估值指标、行业位置和可用公开数据，分析估值、成长性、盈利质量和基本面风险；缺失的数据必须说明不可判断。',
    fallback: (input) =>
      `📊 基本面：当前可用估值指标 PE=${input.quote?.pe ?? '--'}，PB=${input.quote?.pb ?? '--'}；财报细项缺失，需结合最新定报继续核查。`,
  },
  {
    name: 'capital',
    dimension: 'capital',
    label: '💰 资金面分析',
    prompt:
      '你是A股资金面分析师。优先基于 fundFlow 输出”资金流向”小节，必须包含超大单、大单、主力合计、中单、小单净流入资金和净占比的 Markdown 表格；如有 activeBuyRatio/activeSellRatio，必须输出主动买和主动卖比例，并注明口径为盘口异动样本。表格中正数金额用 <span class=”cn-up”>+X</span> 包裹，负数金额用 <span class=”cn-down”>-X</span> 包裹。再结合成交量、成交额、近期K线、市场热度和 largeOrders 分析资金态度、量价配合、主力可能阶段和资金风险。必须单列”特大单买卖”小节：特大单定义为单笔大于10000手，基于 largeOrders 中的特大单买入/卖出事件统计买入数量、卖出数量、买入占比、卖出占比，并分析方向和持续性；如没有逐笔成交或特大单明细，必须明确说明无法精确计算，不得编造具体笔数。不要编造北向或主力净流入数据。',
    fallback: (input) => `${capitalFallback(input)}\n\n${largeOrderFallback(input)}`,
  },
  {
    name: 'sentiment',
    dimension: 'sentiment',
    label: '📰 消息面分析',
    prompt:
      '你是A股消息面分析师。基于个股快讯新闻标题与摘要、公告事件和市场舆情，分析消息面多空倾向、关键催化事件、消息驱动风险和短期情绪温度。缺失数据必须说明不可判断，不得编造新闻或事件。',
    fallback: (input) =>
      `📰 消息面：近端快讯样本 ${input.news?.length ?? 0} 条；需结合新闻正负面、公告事件和市场舆情判断，避免单凭涨跌幅下结论。`,
  },
  {
    name: 'chip',
    dimension: 'chip',
    label: '🧩 筹码分析',
    prompt:
      '你是一名A股筹码结构与主力行为分析师。只输出“🧩 筹码雷达”，不要生成综合投研报告。必须基于真实 chip 筹码分布、quote 行情和 kline 走势输出 Markdown；缺失数据必须明确写“不可判断”，不得编造筹码峰、成本区、获利盘、支撑压力或评分。\n\n固定使用“🧩 筹码雷达”及以下七个编号小节，并与本地 generateChipAnalysis 确定性输出保持一致：1. 筹码画像、2. 筹码结构、3. 多空博弈、4. 主力行为推测、5. 关键价位、6. 短线策略、7. AI评分。\n\n“1. 筹码画像”必须列出：标的、日期、平均成本、当前价格、90%/70%筹码集中度、获利比例、筹码状态、近期峰值筹码价位、套牢盘密集区、底部锁定筹码估算；如有 warnings/sourceTrace 必须输出数据源提示。\n\n“2. 筹码结构”必须说明筹码峰形态、低位核心成本和当前交易密集区。“3. 多空博弈”必须分别列出多方和空方信号。“4. 主力行为推测”必须明确无法从筹码数据直接确认主力身份，并给出当前阶段判断。“5. 关键价位”必须区分两类 Fibonacci：上涨过程中的回调支撑使用 23.6%、38.2%、50%、61.8% 回调位，公式为 H - (H-L) × 比例；上涨突破后的目标压力使用 1.0、1.272、1.414、1.618 扩展位，公式为 L + (H-L) × 比例，并输出近期最低价 L、近期最高价 H、当前价格 C、前高压力和扩展目标；若真实筹码密集区与扩展位重叠，才可输出多指标共振压力，否则必须写不可确认。缺少有效高低点时写“不可判断”。“6. 短线策略”必须列出突破和跌破条件。\n\n“7. AI评分”必须逐行输出筹码健康、短线机会和风险评分。所有数值必须来自输入数据或明确写“不可判断”，不得填充示例数值。',
    fallback: (input) => chipFallback(input),
  },
];

export function createChipUnavailableReport(input: Pick<StockAnalysisInput, 'stockLabel' | 'symbol'>): string {
  const date = new Date().toISOString().slice(0, 10);
  return `🧩 筹码雷达

## 1. 筹码画像
-------------
- 标的：${input.stockLabel}（${input.symbol}）
- 日期：${date}
- 平均成本：--
- 当前价格：--
- 筹码集中度(90%)：--
- 筹码集中度(70%)：--
- 获利比例：--
- 筹码状态：不可判断
- 近期峰值筹码价位：--
- 套牢盘密集区：--
- 底部锁定筹码估算：--

## 2. 筹码结构
-------------
不可判断：真实筹码分布数据暂不可用。

## 3. 多空博弈
-------------
> 多方：
✓ 暂无可验证的成本集中或下方筹码锁定信号

> 空方：
× 暂无可验证的获利盘或上方压力数据

## 4. 主力行为推测
-------------
无法确认主力行为

当前更符合：
数据不足，暂不判断

## 5. 关键价位
-------------
> 强支撑：--

> 生命线：--

> 强压力：--

> 📐 Fibonacci关键价位

波段：
-- → --

当前价格：
--

🟢 回撤防守位

- 斐波那契回调23.6%   --
- 斐波那契回调38.2%   --
- 斐波那契回调50%     --
- 斐波那契回调61.8%   --

🔴 上涨目标位

- 前高突破   --
- 1.272目标  --
- 1.414目标  --
- 1.618目标  --

📊 压力共振

不可确认

突破条件：
成交量放大确认

## 6. 短线策略
-------------
> 突破：--

无法判断看多增强条件

> 跌破：--

风险触发条件暂不可判断

## 7. AI评分
-------------
> 筹码健康：--

> 短线机会：--

> 风险：--

⚠️ 数据源暂不可用，以上内容不构成买卖推荐；待真实筹码数据恢复后再评估。`;
}

function chipFallback(input: StockAnalysisInput): string {
  return createChipUnavailableReport(input);
}

/** 基于本地或远程真实筹码分布直接生成结构化分析，绕过 LLM，避免编造量化字段。 */
function generateChipAnalysis(input: StockAnalysisInput, evidence: EvidenceItem[]): StructuredAgentOutput | undefined {
  const chip = input.chip as (IChipDistributionResult & { sourceTrace?: string[] }) | undefined;
  const latest = chip?.latest;
  if (!latest) return undefined;

  const points = latest.points.filter(
    (point) => Number.isFinite(point.price) && Number.isFinite(point.weight) && point.weight > 0,
  );
  const totalWeight = points.reduce((sum, point) => sum + point.weight, 0);
  if (!points.length || totalWeight <= 0) return undefined;

  const currentPrice = finiteNumber(input.quote?.price) ?? input.kline?.at(-1)?.close;
  const avgCost = finiteNumber(latest.avgCost);
  const profitRatio = finiteNumber(latest.profitRatio);
  const trend = chip.trend ?? [];
  const byDays = new Map(trend.map((item) => [Number(item.days), item]));
  const trend5 = byDays.get(5);
  const trend20 = byDays.get(20);
  const concentration70Delta = ratioDelta(trend5?.concentration70, trend20?.concentration70);
  const concentration90Delta = ratioDelta(trend5?.concentration90, trend20?.concentration90);
  const isConcentrating =
    concentration70Delta !== undefined &&
    concentration90Delta !== undefined &&
    concentration70Delta < -0.005 &&
    concentration90Delta < -0.005;
  const isDispersing =
    concentration70Delta !== undefined &&
    concentration90Delta !== undefined &&
    concentration70Delta > 0.005 &&
    concentration90Delta > 0.005;
  const priceVsAvg =
    currentPrice !== undefined && avgCost !== undefined && avgCost > 0
      ? ((currentPrice - avgCost) / avgCost) * 100
      : undefined;
  const aboveAvg = priceVsAvg !== undefined && priceVsAvg > 1;
  const belowAvg = priceVsAvg !== undefined && priceVsAvg < -1;
  const healthyProfit = profitRatio !== undefined && profitRatio > 0.3 && profitRatio < 0.85;
  const highProfit = profitRatio !== undefined && profitRatio >= 0.85;
  const peak = points.reduce((best, point) => (point.weight > best.weight ? point : best));
  const shape = classifyChipShape(points, totalWeight, currentPrice);
  const supports =
    currentPrice === undefined
      ? []
      : points.filter((point) => point.price < currentPrice).sort((a, b) => b.price - a.price);
  const pressures =
    currentPrice === undefined
      ? []
      : points.filter((point) => point.price > currentPrice).sort((a, b) => a.price - b.price);
  const firstSupport = supports[0];
  const strongSupport = maxWeightedPoint(supports);
  const firstPressure = pressures[0];
  const strongPressure = maxWeightedPoint(pressures);
  const trappedRange = currentPrice === undefined ? undefined : denseRange(pressures, totalWeight);
  const bottomLocked =
    avgCost === undefined
      ? undefined
      : weightedShare(
          points.filter((point) => point.price < avgCost),
          totalWeight,
        );
  const stage = inferChipStage({ isConcentrating, isDispersing, aboveAvg, belowAvg, healthyProfit, highProfit });
  const controlLevel = isConcentrating && aboveAvg ? '强' : isDispersing || belowAvg ? '弱' : '中';
  const chipGap =
    input.dataGaps?.some((gap) => gap.dataName.includes('筹码') || gap.userMessage.includes('筹码')) ?? false;
  const stance: StructuredAgentFinding['stance'] = chipGap
    ? 'unknown'
    : isConcentrating && aboveAvg && healthyProfit
      ? 'bullish'
      : isDispersing && (belowAvg || highProfit)
        ? 'bearish'
        : 'neutral';
  const score = stance === 'bullish' ? 72 : stance === 'bearish' ? 35 : 50;
  const warnings = [...(chip.warnings ?? []), ...(chip.sourceTrace ?? [])];
  const analysisDate = new Date().toISOString().slice(0, 10);
  const risks = buildChipRisks({ isDispersing, highProfit, belowAvg, trappedRange, warnings, chipGap });
  const fibonacci = buildFibonacciLevels(input.kline, points, currentPrice);

  const markdown = `🧩 筹码雷达

## 1. 筹码画像
-------------
- 标的：${input.stockLabel}（${input.symbol}）
- 日期：${analysisDate}
- 平均成本：${formatPrice(avgCost)}
- 当前价格：${formatPrice(currentPrice)}
- 筹码集中度(90%)：${formatRatio(latest.concentration90)}
- 筹码集中度(70%)：${formatRatio(latest.concentration70)}
- 获利比例：${formatRatio(profitRatio)}
- 筹码状态：${shape.label}
- 近期峰值筹码价位：${formatPrice(peak.price)}（占比 ${formatRatio(weightedShare([peak], totalWeight))}）
- 套牢盘密集区：${formatDenseRange(trappedRange)}
- 底部锁定筹码估算：${bottomLocked === undefined ? '--（直方图数据不足）' : `约 ${formatRatio(bottomLocked)} 位于平均成本下方`}
${warnings.length ? `- 数据源提示：${warnings.join('；')}` : ''}

## 2. 筹码结构
-------------
${shape.label}

> 低位核心成本：

${strongSupport ? formatPrice(strongSupport.price) : '--（数据不足）'}

> 当前交易密集区：

${latest.cost70 ?? formatDenseRange(trappedRange)}

## 3. 多空博弈
-------------
> 多方：

${isConcentrating ? '✓ 成本集中提升' : '× 成本集中提升未确认'}
${bottomLocked !== undefined && bottomLocked > 0 ? '✓ 下方筹码锁定' : '× 下方筹码锁定不可判断'}

> 空方：

${highProfit ? '× 获利盘过高' : profitRatio === undefined ? '× 获利盘数据不足' : '✓ 获利盘未见高位信号'}
${trappedRange ? '× 上方压力存在' : strongPressure ? '× 上方存在可识别压力' : '× 上方压力不可判断'}

## 4. 主力行为推测
-------------
当前更符合：
${stage}阶段

## 5. 关键价位
-------------
> 强支撑：

${strongSupport ? formatPrice(strongSupport.price) : '--'}

> 生命线：

${avgCost !== undefined ? formatPrice(avgCost) : '--'}

> 强压力：

${strongPressure ? formatPrice(strongPressure.price) : '--'}

${formatFibonacciLevels(fibonacci, trappedRange)}

## 6. 短线策略
-------------
> 突破：

${strongPressure ? `${formatPrice(strongPressure.price)} + 放量` : '--'}

看多增强

> 跌破：

${strongSupport ? formatPrice(strongSupport.price) : '--'}

风险增加

## 7. AI评分
-------------
> 筹码健康：

${score}

> 短线机会：

${stance === 'bullish' ? 70 : stance === 'bearish' ? 30 : 50}

> 风险：

${Math.min(90, 30 + risks.length * 15)}

风险提示：${risks.join('；')}`;

  const fallbackId = evidence[0]?.id ?? fallbackEvidence(`chip:${input.symbol}`, '筹码分布数据不足').id;
  const finding: StructuredAgentFinding = {
    id: 'chip-1',
    dimension: 'chip',
    stance,
    score: chipGap ? undefined : score,
    confidence: chipGap ? 0.3 : warnings.length ? 0.55 : 0.75,
    summary: oneLineSummary(markdown) ?? `${input.stockLabel} 筹码${shape.label}，平均成本 ${formatPrice(avgCost)}。`,
    evidenceIds: [fallbackId],
    risks,
  };
  return {
    agentName: 'chip',
    label: '🧩 筹码分析',
    findings: [finding],
    evidence,
    markdown: `### 🧩 筹码分析\n\n${markdown}`,
  };
}

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function ratioDelta(current: unknown, older: unknown): number | undefined {
  const currentNumber = finiteNumber(current);
  const olderNumber = finiteNumber(older);
  return currentNumber === undefined || olderNumber === undefined ? undefined : currentNumber - olderNumber;
}

type TChipShape = { label: '单峰密集' | '双峰填谷' | '多峰发散' | '筹码真空'; reason: string };

function classifyChipShape(points: ChipDistribution['points'], totalWeight: number, currentPrice?: number): TChipShape {
  const peak = points.reduce((best, point) => (point.weight > best.weight ? point : best));
  if (currentPrice !== undefined) {
    const nearby = weightedShare(
      points.filter((point) => Math.abs(point.price - currentPrice) / Math.max(currentPrice, 0.01) <= 0.05),
      totalWeight,
    );
    if (nearby < 0.05)
      return {
        label: '筹码真空',
        reason: `当前价±5%范围内筹码权重仅 ${formatRatio(nearby)}，价格附近缺少有效换手承接。`,
      };
  }
  const localPeaks = points.filter((point, index) => {
    const previous = points[index - 1]?.weight ?? 0;
    const next = points[index + 1]?.weight ?? 0;
    return point.weight >= previous && point.weight >= next && point.weight >= peak.weight * 0.35;
  });
  if (localPeaks.length >= 3)
    return { label: '多峰发散', reason: `识别到 ${localPeaks.length} 个相对高权重点，成本分布在多个价格带。` };
  if (localPeaks.length === 2)
    return { label: '双峰填谷', reason: '存在两个相对高权重筹码峰，中间价格带权重低于两侧，形成填谷结构。' };
  return {
    label: '单峰密集',
    reason: `最大筹码峰位于 ${formatPrice(peak.price)}，占比 ${formatRatio(weightedShare([peak], totalWeight))}，主要成本集中在单一价格带。`,
  };
}

function weightedShare(points: ChipDistribution['points'], totalWeight: number): number {
  return points.reduce((sum, point) => sum + point.weight, 0) / totalWeight;
}

function maxWeightedPoint(points: ChipDistribution['points']): ChipDistribution['points'][number] | undefined {
  return points.length ? points.reduce((best, point) => (point.weight > best.weight ? point : best)) : undefined;
}

function denseRange(
  points: ChipDistribution['points'],
  totalWeight: number,
): { low: number; high: number; share: number } | undefined {
  if (!points.length) return undefined;
  const weights = points.map((point) => point.weight).sort((a, b) => a - b);
  const threshold = weights[Math.max(0, Math.floor(weights.length * 0.75) - 1)] ?? 0;
  const dense = points.filter((point) => point.weight >= threshold && point.weight > 0);
  if (!dense.length) return undefined;
  return {
    low: Math.min(...dense.map((point) => point.price)),
    high: Math.max(...dense.map((point) => point.price)),
    share: weightedShare(dense, totalWeight),
  };
}

const FIBONACCI_RETRACEMENT_RATIOS = [0.236, 0.382, 0.5, 0.618];
const FIBONACCI_EXTENSION_RATIOS = [1, 1.272, 1.414, 1.618];

type TFibonacciLevels = {
  low: number;
  high: number;
  current?: number;
  retracement: number[];
  extension: number[];
};

function buildFibonacciLevels(
  kline: KlinePoint[] | undefined,
  points: ChipDistribution['points'],
  current?: number,
): TFibonacciLevels | undefined {
  const klineHighs = (kline ?? []).map((point) => point.high).filter(Number.isFinite);
  const klineLows = (kline ?? []).map((point) => point.low).filter(Number.isFinite);
  const pointPrices = points.map((point) => point.price).filter(Number.isFinite);
  const high = klineHighs.length ? Math.max(...klineHighs) : pointPrices.length ? Math.max(...pointPrices) : undefined;
  const low = klineLows.length ? Math.min(...klineLows) : pointPrices.length ? Math.min(...pointPrices) : undefined;
  if (high === undefined || low === undefined || high <= low) return undefined;

  const range = high - low;
  return {
    low,
    high,
    current,
    retracement: FIBONACCI_RETRACEMENT_RATIOS.map((ratio) => high - range * ratio),
    extension: FIBONACCI_EXTENSION_RATIOS.map((ratio) => low + range * ratio),
  };
}

function formatFibonacciLevels(levels?: TFibonacciLevels, trappedRange?: { low: number; high: number }): string {
  if (!levels)
    return [
      '> 📐 Fibonacci关键价位',
      '',
      '波段：',
      '-- → --',
      '',
      '当前价格：',
      '--',
      '',
      '🟢 回撤防守位',
      '',
      '- 斐波那契回调23.6%   --',
      '- 斐波那契回调38.2%   --',
      '- 斐波那契回调50%     --',
      '- 斐波那契回调61.8%   --',
      '',
      '🔴 上涨目标位',
      '',
      '- 前高突破   --',
      '- 1.272目标  --',
      '- 1.414目标  --',
      '- 1.618目标  --',
      '',
      '📊 压力共振',
      '',
      '不可确认',
      '',
      '突破条件：',
      '成交量放大确认',
    ].join('\n');

  const retracement = FIBONACCI_RETRACEMENT_RATIOS.map((ratio, index) => {
    const label = formatFibonacciRetracementRatio(ratio).padEnd(8, ' ');
    return `- 斐波那契回调${label}${formatFibonacciValue(levels.retracement[index])}`;
  });
  const extensionLabels = ['前高突破   ', '1.272目标  ', '1.414目标  ', '1.618目标  '];
  const extension = FIBONACCI_EXTENSION_RATIOS.map(
    (_, index) => `- ${extensionLabels[index]}${formatFibonacciValue(levels.extension[index])}`,
  );
  const pressureRadar = formatFibonacciPressureRadar(levels, trappedRange);

  return [
    '> 📐 Fibonacci关键价位',
    '',
    '波段：',
    `${formatFibonacciValue(levels.low)} → ${formatFibonacciValue(levels.high)}`,
    '',
    '当前价格：',
    formatFibonacciValue(levels.current),
    '',
    '🟢 回撤防守位',
    '',
    ...retracement,
    '',
    '🔴 上涨目标位',
    '',
    ...extension,
    '',
    pressureRadar,
  ].join('\n');
}

function formatFibonacciPressureRadar(levels: TFibonacciLevels, trappedRange?: { low: number; high: number }): string {
  const resonance = trappedRange
    ? levels.extension.find((price) => price >= trappedRange.low && price <= trappedRange.high)
    : undefined;
  if (!resonance || !trappedRange)
    return [
      '📊 压力共振',
      '',
      '不可确认',
      '',
      '突破条件：',
      '成交量放大确认',
    ].join('\n');
  return [
    '📊 压力共振',
    '',
    `${trappedRange.low.toFixed(2)}-${trappedRange.high.toFixed(2)}`,
    '',
    '来源：',
    '✓ 前高压力',
    '✓ 筹码密集区',
    '',
    '突破条件：',
    '成交量放大确认',
  ].join('\n');
}

function formatFibonacciRetracementRatio(ratio: number): string {
  return `${(ratio * 100).toFixed(ratio === 0.5 ? 0 : 1)}%`;
}

function formatFibonacciValue(value?: number): string {
  return value === undefined ? '--' : value.toFixed(2);
}

function formatPrice(value?: number): string {
  return value === undefined ? '--' : `${value.toFixed(2)}元`;
}

function formatSignedRatio(value?: number): string {
  return value === undefined ? '--' : `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
}

function formatLevel(point: ChipDistribution['points'][number] | undefined, totalWeight: number): string {
  return point
    ? `${formatPrice(point.price)}附近（筹码占比 ${formatRatio(weightedShare([point], totalWeight))}）`
    : '--（数据不足）';
}

function formatDenseRange(range?: { low: number; high: number; share: number }): string {
  return range
    ? `${range.low.toFixed(2)}-${range.high.toFixed(2)}元（密集点权重 ${formatRatio(range.share)}）`
    : '--（当前价格上方无可识别密集筹码）';
}

function inferChipStage(input: {
  isConcentrating: boolean;
  isDispersing: boolean;
  aboveAvg: boolean;
  belowAvg: boolean;
  healthyProfit: boolean;
  highProfit: boolean;
}): string {
  if (input.isDispersing && (input.aboveAvg || input.highProfit)) return '出货';
  if (input.isConcentrating && input.aboveAvg && input.healthyProfit) return '拉升';
  if (input.isConcentrating && input.belowAvg) return '吸筹';
  return '洗盘';
}

function buildChipRisks(input: {
  isDispersing: boolean;
  highProfit: boolean;
  belowAvg: boolean;
  trappedRange?: { low: number; high: number; share: number };
  warnings: string[];
  chipGap: boolean;
}): string[] {
  const risks: string[] = [];
  if (input.isDispersing) risks.push('90%与70%集中度同步上升，存在筹码发散或高位派发信号。');
  if (input.highProfit) risks.push('获利比例达到高位，若价格跌破第一支撑，兑现压力可能增加。');
  if (input.belowAvg) risks.push('当前价格低于平均成本，反弹可能受到套牢盘解套压力。');
  if (input.trappedRange && input.trappedRange.share >= 0.2)
    risks.push(`当前价格上方密集筹码权重约 ${formatRatio(input.trappedRange.share)}，存在明显套牢压力。`);
  if (input.warnings.length) risks.push(`数据源存在提示：${input.warnings.join('；')}`);
  if (input.chipGap) risks.push('筹码数据状态为不完整或过期降级，结论置信度已降低。');
  return risks.length ? risks : ['未发现上述筹码异常信号，但筹码分布不能替代公告、资金和风险承受能力评估。'];
}

function formatRatio(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return `${(num * 100).toFixed(1)}%`;
}

function capitalFallback(input: StockAnalysisInput) {
  if (!input.fundFlow)
    return `💰 资金面：当前成交额 ${input.quote?.turnover ?? '--'}，成交量 ${input.quote?.volume ?? '--'}；资金流细项暂不可用，不能判断超大单/大单/中小单净流向。`;
  return `💰 资金面\n\n${fundFlowMarkdown(input.fundFlow)}\n\n解读：${fundFlowInterpretation(input.fundFlow)}`;
}

function fundFlowMarkdown(flow: IStockFundFlowSnapshot) {
  const active = flow.activeSampleCount
    ? `主动买占比：${formatPercentValue(flow.activeBuyRatio)}，主动卖占比：${formatPercentValue(flow.activeSellRatio)}（口径：${flow.activeRatioSource ?? '盘口异动样本'}，样本 ${flow.activeSampleCount} 条）`
    : `主动买/主动卖比例：--（${flow.warnings?.find((item) => item.includes('主动买卖')) ?? '暂无盘口异动样本'}）`;
  return [
    `### 💰 资金流向`,
    `今日主力资金 ${flow.mainNetInflow === null ? '暂无净流入数据' : `${Number(flow.mainNetInflow) >= 0 ? '净流入' : '净流出'}约 ${formatMoneyInYi(flow.mainNetInflow)} 亿`}（截至 ${flow.date}），分结构看：`,
    '',
    '| 类型 | 净流入（亿元） | 净占比 |',
    '|---|---:|---:|',
    `| 超大单 | ${formatMoneyInYi(flow.superLargeNetInflow)} | ${formatPercentValue(flow.superLargeNetInflowPercent)} |`,
    `| 大单 | ${formatMoneyInYi(flow.largeNetInflow)} | ${formatPercentValue(flow.largeNetInflowPercent)} |`,
    `| 主力合计 | ${formatMoneyInYi(flow.mainNetInflow)} | ${formatPercentValue(flow.mainNetInflowPercent)} |`,
    `| 中单 | ${formatMoneyInYi(flow.mediumNetInflow)} | ${formatPercentValue(flow.mediumNetInflowPercent)} |`,
    `| 小单 | ${formatMoneyInYi(flow.smallNetInflow)} | ${formatPercentValue(flow.smallNetInflowPercent)} |`,
    '',
    active,
  ].join('\n');
}

function fundFlowInterpretation(flow: IStockFundFlowSnapshot) {
  if (flow.mainNetInflow === null) return '主力合计资金缺失，暂不判断资金方向。';
  const direction = flow.mainNetInflow >= 0 ? '主力资金净流入' : '主力资金净流出';
  const retail = Number(flow.mediumNetInflow ?? 0) + Number(flow.smallNetInflow ?? 0);
  if (flow.mainNetInflow < 0 && retail > 0) return `${direction}，中小单承接，短期抛压需要继续观察。`;
  if (flow.mainNetInflow > 0 && retail < 0) return `${direction}，中小单流出，资金结构偏机构/主力承接。`;
  return `${direction}，需结合成交额和后续盘口持续性确认。`;
}

function formatMoneyInYi(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  const display = `${num >= 0 ? '+' : '-'}${(Math.abs(num) / 100000000).toFixed(2)}`;
  const cls = num > 0 ? 'cn-up' : num < 0 ? 'cn-down' : '';
  return cls ? `<span class="${cls}">${display}</span>` : display;
}

function formatPercentValue(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  const display = `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
  const cls = num > 0 ? 'cn-up' : num < 0 ? 'cn-down' : '';
  return cls ? `<span class="${cls}">${display}</span>` : display;
}

function largeOrderFallback(input: StockAnalysisInput) {
  const stats = largeOrderStats(input.largeOrders);
  if (!stats.total)
    return `💼 特大单分析：当前未检索到 ${input.stockLabel} 单笔大于10000手的买入/卖出异动，无法精确统计流入/流出数量和占比；可先结合成交额 ${input.quote?.turnover ?? '--'}、成交量 ${input.quote?.volume ?? '--'} 与K线放量情况观察。`;
  return `💼 特大单分析：当前样本中单笔大于10000手的特大单共 ${stats.total} 笔，其中买入 ${stats.buy} 笔、占比 ${stats.buyPct}%，卖出 ${stats.sell} 笔、占比 ${stats.sellPct}%。${stats.buy >= stats.sell ? '样本方向偏流入，但需观察后续成交额延续。' : '样本方向偏流出，需警惕短线抛压。'}`;
}

function largeOrderStats(items: HotFocusItem[] = []) {
  const largeOrders = items.filter((item) =>
    /特大单/.test(`${item.description ?? ''}${item.tag ?? ''}${item.amount ?? ''}`),
  );
  const buy = largeOrders.filter((item) =>
    /买/.test(`${item.description ?? ''}${item.tag ?? ''}${item.amount ?? ''}`),
  ).length;
  const sell = largeOrders.filter((item) =>
    /卖/.test(`${item.description ?? ''}${item.tag ?? ''}${item.amount ?? ''}`),
  ).length;
  const total = buy + sell;
  return {
    total,
    buy,
    sell,
    buyPct: total ? ((buy / total) * 100).toFixed(1) : '0.0',
    sellPct: total ? ((sell / total) * 100).toFixed(1) : '0.0',
  };
}

export function stockAnalysisAgentNames() {
  return agents.map((agent) => ({ name: agent.name, label: agent.label }));
}

export async function runStockAnalysisSubAgent(
  name: StockAnalysisAgentName,
  input: StockAnalysisInput,
  onToken?: (token: string) => void,
  onProgress?: (message: string, percent: number) => void,
): Promise<StockAnalysisResult> {
  const agent = agents.find((item) => item.name === name)!;
  const evidence = input.evidence?.length
    ? input.evidence
    : [fallbackEvidence(`${agent.name}:${input.symbol}`, `${agent.label}证据不足`)];
  try {
    onProgress?.('准备结构化数据…', 5);

    // 筹码分析走本地确定性快速路径：数据来自 DuckDB，无需等待 LLM
    if (agent.name === 'chip') {
      const chipOutput = generateChipAnalysis(input, evidence);
      if (chipOutput) {
        onProgress?.('基于本地筹码数据生成分析…', 80);
        const normalized = { ...chipOutput, markdown: normalizeChipMarkdown(chipOutput.markdown, input) };
        await streamMarkdown(normalized.markdown, onToken);
        onProgress?.('完成', 100);
        return { name: agent.name, label: agent.label, output: normalized, content: normalized.markdown };
      }
    }

    const data = JSON.stringify(compactInput({ ...input, evidence }), null, 2);
    const gapPrompt = formatDataGapsForPrompt(input.dataGaps);
    const revisionPrompt = formatPlanRevisionsForPrompt(input.planRevisions);
    onProgress?.('调用模型分析中…', 10);
    const raw = await withProgressTicker(
      () =>
        generateReport([
          {
            role: 'system',
            content: `${agent.prompt}\n只返回 JSON，不要输出额外解释。格式：{"findings":[{"id":"${agent.name}-1","dimension":"${agent.dimension}","stance":"bullish|neutral|bearish|unknown","score":0,"confidence":0.5,"summary":"...","evidenceIds":["..."],"risks":["..."]}],"markdown":"### ${agent.label}\\n..."}。所有 evidenceIds 必须来自输入 evidence；缺失数据必须说明不足，不得编造。若输入 dataGaps 覆盖本维度，不能输出确定性强弱/方向判断，confidence 不得高于 0.4，markdown 必须说明“数据不足/不可判断/置信度降低”。markdown 控制在 300 字以内。\n\n本轮数据缺口：\n${gapPrompt}\n\n计划调整：\n${revisionPrompt}\n\n分析时必须遵守这些缺口约束。`,
          },
          {
            role: 'user',
            content: `用户问题：${input.query}\n股票：${input.stockLabel}（${input.symbol}）\n结构化数据：\n${data}`,
          },
        ]),
      (p) => onProgress?.('调用模型分析中…', p),
    );
    onProgress?.('解析模型结果…', 90);
    const output = parseStructuredAgentOutput(raw, agent, input, evidence);
    if (agent.name === 'chip') output.markdown = normalizeChipMarkdown(output.markdown, input);
    await streamMarkdown(output.markdown, onToken);
    return { name: agent.name, label: agent.label, output, content: output.markdown };
  } catch (error) {
    // ponytail: transient LLM failures (rate limit, timeout, connection) should
    // degrade to fallback rather than killing the agent node. The fallback
    // already produces a data-backed skeleton analysis — better than a red box.
    const output = fallbackStructuredAgentOutput(agent, input, evidence);
    if (agent.name === 'chip') output.markdown = normalizeChipMarkdown(output.markdown, input);
    await streamMarkdown(output.markdown, onToken);
    return { name: agent.name, label: agent.label, output, content: output.markdown };
  }
}

function withProgressTicker<T>(fn: () => Promise<T>, onProgress: (percent: number) => void): Promise<T> {
  let done = false;
  let percent = 15;
  const interval = setInterval(() => {
    if (done) return;
    // 每 3 秒前进 5%，在 10%~85% 之间缓慢增长，避免完成前显示 100%
    percent = Math.min(85, percent + 5);
    onProgress(percent);
  }, 3000);
  return fn().finally(() => {
    done = true;
    clearInterval(interval);
  });
}

export function parseStructuredAgentOutput(
  raw: string,
  agent: Pick<StockAnalysisAgentDef, 'name' | 'label' | 'dimension'> & Partial<Pick<StockAnalysisAgentDef, 'fallback'>>,
  input: StockAnalysisInput,
  evidence = input.evidence ?? [],
): StructuredAgentOutput {
  try {
    const parsed = JSON.parse(extractJson(raw)) as Partial<StructuredAgentOutput> & {
      findings?: unknown;
      markdown?: unknown;
    };
    const allowedEvidenceIds = new Set(evidence.map((item) => item.id));
    const fallbackId =
      evidence[0]?.id ?? fallbackEvidence(`${agent.name}:${input.symbol}`, `${agent.label}证据不足`).id;
    const findings = (Array.isArray(parsed.findings) ? parsed.findings : []).map((item, index) =>
      sanitizeFinding(item, agent, input, index, allowedEvidenceIds, fallbackId),
    );
    const markdown =
      typeof parsed.markdown === 'string' && parsed.markdown.trim()
        ? parsed.markdown.trim()
        : fallbackMarkdown(agent, input);
    return {
      agentName: agent.name,
      label: agent.label,
      findings: findings.length ? findings : [fallbackFinding(agent, input, fallbackId, markdown)],
      evidence,
      markdown,
    };
  } catch {
    return fallbackStructuredAgentOutput(agent, input, evidence);
  }
}

function extractJson(raw: string) {
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (match?.[1] ?? raw).trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end >= start ? text.slice(start, end + 1) : text;
}

function sanitizeFinding(
  item: unknown,
  agent: Pick<StockAnalysisAgentDef, 'name' | 'dimension'>,
  input: StockAnalysisInput,
  index: number,
  allowedEvidenceIds: Set<string>,
  fallbackId: string,
): StructuredAgentFinding {
  const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
  const evidenceIds = Array.isArray(record.evidenceIds)
    ? record.evidenceIds.map(String).filter((id) => allowedEvidenceIds.has(id))
    : [];
  const hasGap = dataGapAffectsAgent(input.dataGaps, agent.name);
  const risks = Array.isArray(record.risks)
    ? record.risks.map(String).filter(Boolean)
    : ['数据样本不足导致判断置信度有限。'];
  const gapRisks = hasGap ? (input.dataGaps ?? []).map((gap) => gap.userMessage) : [];
  return {
    id: String(record.id ?? `${agent.name}-${index + 1}`),
    dimension: sanitizeDimension(record.dimension, agent.dimension),
    stance: hasGap ? 'unknown' : sanitizeStance(record.stance),
    score: hasGap ? undefined : clamp(Number(record.score ?? 50), 0, 100),
    confidence: hasGap
      ? Math.min(0.4, clamp(Number(record.confidence ?? 0.35), 0, 1))
      : clamp(Number(record.confidence ?? 0.5), 0, 1),
    summary: hasGap
      ? `数据缺口覆盖本维度，${String(record.summary ?? '暂不形成强结论。')}`
      : String(record.summary ?? '数据不足，暂不形成强结论。'),
    evidenceIds: evidenceIds.length ? evidenceIds : [fallbackId],
    risks: [...risks, ...gapRisks].filter(Boolean),
  };
}

function dataGapAffectsAgent(gaps: IAgentDataGap[] = [], agentName: StockAnalysisAgentName): boolean {
  const namesByAgent: Record<StockAnalysisAgentName, string[]> = {
    technical: ['K线', '技术指标'],
    fundamental: ['行情'],
    capital: ['资金流', '热点/特大单'],
    sentiment: ['新闻', '公告'],
    chip: ['筹码集中度'],
  };
  const names = namesByAgent[agentName];
  return gaps.some((gap) => names.some((name) => gap.dataName.includes(name) || name.includes(gap.dataName)));
}

function fallbackStructuredAgentOutput(
  agent: Pick<StockAnalysisAgentDef, 'name' | 'label' | 'dimension'> & Partial<Pick<StockAnalysisAgentDef, 'fallback'>>,
  input: StockAnalysisInput,
  evidence: EvidenceItem[],
): StructuredAgentOutput {
  const usableEvidence = evidence.length
    ? evidence
    : [fallbackEvidence(`${agent.name}:${input.symbol}`, `${agent.label}证据不足`)];
  return {
    agentName: agent.name,
    label: agent.label,
    findings: [fallbackFinding(agent, input, usableEvidence[0].id, agent.fallback?.(input))],
    evidence: usableEvidence,
    markdown: agent.fallback ? agent.fallback(input) : fallbackMarkdown(agent, input),
  };
}

function fallbackFinding(
  agent: Pick<StockAnalysisAgentDef, 'name' | 'dimension'>,
  input: StockAnalysisInput,
  evidenceId: string,
  markdown?: string,
): StructuredAgentFinding {
  const gapRisks = input.dataGaps?.map((gap) => gap.userMessage) ?? [];
  return {
    id: `${agent.name}-fallback`,
    dimension: agent.dimension,
    stance: 'unknown',
    score: input.dataGaps?.length ? undefined : 50,
    confidence: input.dataGaps?.length ? 0.25 : 0.35,
    summary: oneLineSummary(markdown) ?? `${input.stockLabel} 当前可用数据不足，需继续补充公开信息。`,
    evidenceIds: [evidenceId],
    risks: gapRisks.length ? gapRisks : ['数据样本不足或上游接口暂不可用。'],
  };
}

function oneLineSummary(markdown?: string) {
  const text = markdown
    ?.replace(/#{1,6}\s*/g, '')
    .replace(/[|`*_>\-]/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return undefined;
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

function fallbackMarkdown(agent: Pick<StockAnalysisAgentDef, 'label'>, input: StockAnalysisInput) {
  return `### ${agent.label}\n${input.stockLabel}（${input.symbol}）当前数据不足，暂不形成强结论。`;
}

function sanitizeDimension(value: unknown, fallback: AgentDimension): AgentDimension {
  return ['technical', 'fundamental', 'capital', 'sentiment', 'chip', 'overview', 'risk'].includes(String(value))
    ? (value as AgentDimension)
    : fallback;
}

function sanitizeStance(value: unknown): AgentStance {
  return ['bullish', 'neutral', 'bearish', 'unknown'].includes(String(value)) ? (value as AgentStance) : 'unknown';
}

function clamp(value: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

async function streamMarkdown(markdown: string, onToken?: (token: string) => void) {
  if (!onToken) return;
  // 单 Agent 模式才流式输出；控制节奏约 20ms/4字符，兼顾可读性与等待感
  for (const chunk of markdown.match(/[\s\S]{1,4}/g) ?? [markdown]) {
    onToken(chunk);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function normalizeChipMarkdown(markdown: string, _input: StockAnalysisInput) {
  return markdown
    .replace(/(筹码集中度评分[:：]\s*\d+(?:\.\d+)?)(\s+)(主力控盘评分[:：])/g, '$1\n$3')
    .replace(/(主力控盘评分[:：]\s*\d+(?:\.\d+)?)(\s+)(上涨潜力评分[:：])/g, '$1\n$3')
    .replace(/(上涨潜力评分[:：]\s*\d+(?:\.\d+)?)(\s+)(风险评分[:：])/g, '$1\n$3');
}

function formatChipInput(chip: unknown) {
  if (!chip || typeof chip !== 'object') return chip;
  const record = chip as { latest?: Record<string, unknown>; trend?: Array<Record<string, unknown>> };
  return {
    ...record,
    latest: record.latest ? formatChipRecord(record.latest) : record.latest,
    trend: record.trend?.map(formatChipRecord),
  };
}

function formatChipRecord<T extends Record<string, unknown>>(record: T) {
  return {
    ...record,
    profitRatio: formatRatio(record.profitRatio),
    concentration70: formatRatio(record.concentration70),
    concentration90: formatRatio(record.concentration90),
  };
}

function compactInput(input: StockAnalysisInput) {
  // 去掉 technical 中的 chart（避免与 kline 重复），去掉 quote 中可能附带的 kline，减少 LLM token
  const technical = input.technical ? { ...input.technical, chart: undefined, stocks: undefined } : undefined;
  const quote = input.quote ? { ...input.quote, kline: undefined } : undefined;

  return {
    symbol: input.symbol,
    stockLabel: input.stockLabel,
    quote,
    technical,
    kline: input.kline?.slice(-60),
    news: input.news
      ?.slice(0, 10)
      .map((item) => ({ time: item.time, title: item.title, tags: item.tags, source: item.source })),
    chip: formatChipInput(input.chip),
    fundFlow: input.fundFlow,
    largeOrders: input.largeOrders?.map((item) => ({
      time: item.time,
      code: item.code,
      name: item.name,
      amount: item.amount,
      description: item.description,
      tag: item.tag,
      type: item.type,
    })),
    evidence: input.evidence?.map((item) => ({
      id: item.id,
      source: item.source,
      title: item.title,
      summary: item.summary,
      value: item.value,
      timestamp: item.timestamp,
    })),
    plan: input.plan
      ? {
          summary: input.plan.summary,
          items: input.plan.items.map((item) => ({ id: item.id, title: item.title, status: item.status })),
        }
      : undefined,
    dataGaps: input.dataGaps,
    planRevisions: input.planRevisions,
  };
}
