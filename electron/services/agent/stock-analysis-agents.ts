import type {
  AgentResultCard,
  ChipDistribution,
  EvidenceItem,
  EvidenceSource,
  HotFocusItem,
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
  };

  switch (agentName) {
    case 'technical':
      return {
        ...base,
        technical: input.technical,
        kline: input.kline?.slice(-30),
        evidence: filterEvidenceFor(input.evidence, ['quote', 'kline', 'technical']),
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
      };
    case 'capital':
      return {
        ...base,
        fundFlow: input.fundFlow,
        largeOrders: input.largeOrders,
        kline: input.kline?.slice(-5),
        evidence: filterEvidenceFor(input.evidence, ['quote', 'fund-flow', 'hot-focus']),
      };
    case 'sentiment':
      return {
        ...base,
        news: input.news,
        evidence: filterEvidenceFor(input.evidence, ['quote', 'news', 'announcement']),
      };
    case 'chip':
      return {
        ...base,
        chip: input.chip,
        kline: input.kline?.slice(-5),
        evidence: filterEvidenceFor(input.evidence, ['quote', 'kline', 'chip']),
      };
    default:
      return input;
  }
}

function filterEvidenceFor(evidence: EvidenceItem[] = [], sources: EvidenceSource[]): EvidenceItem[] {
  return evidence.filter((item) => sources.includes(item.source));
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
      '你是A股消息面分析师。基于个股快讯新闻标题与摘要、公告事件、板块热度和市场舆情，分析消息面多空倾向、关键催化事件、消息驱动风险和短期情绪温度。缺失数据必须说明不可判断，不得编造新闻或事件。',
    fallback: (input) =>
      `📰 消息面：近端快讯样本 ${input.news?.length ?? 0} 条；需结合新闻正负面、公告事件和板块热度判断，避免单凭涨跌幅下结论。`,
  },
  {
    name: 'chip',
    dimension: 'chip',
    label: '🧩 筹码分析',
    prompt:
      '你是一名拥有20年经验的A股主力行为分析师和筹码分析专家。只输出“🧩 筹码分析”，不要生成综合投研报告。请根据 chip 筹码数据、quote 行情和 kline 走势，分析个股当前的筹码结构、主力控盘情况以及未来走势。输出 Markdown，并固定使用这些小节标题：## 🎯 筹码集中度、## ⛰️ 筹码峰结构、## 📍 平均成本、## 💰 获利盘、## 🐳 主力控盘、## ⚠️ 套牢压力、## 🧭 走势推演、## 🚨 风险提示、## 🎯 综合结论。\n\n在“## 🎯 筹码集中度”下必须用 Markdown 表格输出，不要合并成一句话，不要用小数；并且必须分别分析70%和90%筹码集中度，不能只分析70%：\n# 筹码集中度变化\n\n| 周期 | 70%筹码集中度 | 90%筹码集中度 |\n|---|---:|---:|\n| 5日 | x.x% | x.x% |\n| 10日 | x.x% | x.x% |\n| 20日 | x.x% | x.x% |\n\n在“综合评分”处必须换行显示，每项独占一行：\n筹码集中度评分：xx\n主力控盘评分：xx\n上涨潜力评分：xx\n风险评分：xx\n\n分析要求：1）当前筹码结构特征：单峰密集、双峰密集、多峰发散、高位密集、低位密集；2）筹码集中度趋势：比较最近5日、10日、20日的70%/90%筹码集中度变化，判断筹码持续集中还是发散，主力是在吸筹、锁仓或派发；3）主力控盘：控盘等级弱/中/强、持仓稳定性、是否高度控盘；4）获利盘与套牢盘：获利盘健康度、上方套牢压力、下方支撑力度；5）未来5个交易日和20个交易日走势推演；6）风险提示：筹码松动、高位派发、套牢盘抛压；7）最后给出总体结论：【强烈看多】/【偏多】/【中性】/【偏空】/【强烈看空】并说明核心理由。缺失数据必须说明不可判断，不得编造。',
    fallback: (input) => chipFallback(input),
  },
];

function chipFallback(input: StockAnalysisInput) {
  const chip = input.chip as
    | {
        latest?: {
          profitRatio?: number;
          avgCost?: number;
          cost70?: string;
          cost90?: string;
          concentration70?: number;
          concentration90?: number;
        };
        trend?: Array<{ days: number; concentration70?: number; concentration90?: number }>;
      }
    | undefined;
  const latest = chip?.latest;
  if (!latest) return `🧩 筹码分析：当前未检索到 ${input.stockLabel} 的筹码分布数据，无法判断筹码结构和主力控盘情况。`;
  const trend =
    chip?.trend
      ?.map(
        (item) =>
          `${item.days}日70%集中度=${formatRatio(item.concentration70)}，90%集中度=${formatRatio(item.concentration90)}`,
      )
      .join('；') || '集中度趋势样本不足';
  const trendText = chipTrendSummary(input.chip);
  return `🧩 筹码分析\n\n## 🎯 筹码集中度\n${trend}\n${trendText ? `\n${trendText}` : ''}\n\n## ⛰️ 筹码峰结构\n70%成本区间 ${latest.cost70 ?? '--'}，90%成本区间 ${latest.cost90 ?? '--'}。\n\n## 📍 平均成本\n当前平均成本 ${formatMaybeNumber(latest.avgCost)}。\n\n## 💰 获利盘\n当前获利盘 ${formatRatio(latest.profitRatio)}。\n\n## 🐳 主力控盘\n需结合价格是否站稳平均成本、筹码集中度是否收敛判断控盘强弱。\n\n## ⚠️ 套牢压力\n重点观察上方90%成本区间高位附近抛压。`;
}

/** 基于本地筹码分布数据直接生成分析结论，绕过 LLM，5s 内完成 */
function generateChipAnalysis(input: StockAnalysisInput, evidence: EvidenceItem[]): StructuredAgentOutput | undefined {
  const chip = input.chip as IChipDistributionResult | undefined;
  const latest = chip?.latest;
  if (!latest) return undefined;

  const quote = input.quote;
  const close = Number(quote?.price) ?? (input.kline?.length ? input.kline[input.kline.length - 1].close : undefined);
  const avgCost = Number(latest.avgCost);
  const profitRatio = Number(latest.profitRatio);
  const cost70 = parseCostRange(latest.cost70);
  const cost90 = parseCostRange(latest.cost90);
  const trend = chip?.trend ?? [];
  const byDays = new Map(trend.map((item) => [Number(item.days), item]));
  const c5 = byDays.get(5);
  const c20 = byDays.get(20);
  const conc70_5 = Number(c5?.concentration70);
  const conc70_20 = Number(c20?.concentration70);
  const conc90_5 = Number(c5?.concentration90);
  const conc90_20 = Number(c20?.concentration90);

  // 集中度趋势：数值越小代表筹码越集中
  const conc70Delta = Number.isFinite(conc70_5) && Number.isFinite(conc70_20) ? conc70_20 - conc70_5 : undefined;
  const conc90Delta = Number.isFinite(conc90_5) && Number.isFinite(conc90_20) ? conc90_20 - conc90_5 : undefined;
  const isConcentrating =
    conc70Delta !== undefined && conc90Delta !== undefined ? conc70Delta < -0.01 && conc90Delta < -0.02 : undefined;
  const isDispersing =
    conc70Delta !== undefined && conc90Delta !== undefined ? conc70Delta > 0.01 && conc90Delta > 0.02 : undefined;

  // 价格相对平均成本
  const priceVsAvg =
    Number.isFinite(close) && Number.isFinite(avgCost) ? ((close - avgCost) / avgCost) * 100 : undefined;
  const aboveAvg = priceVsAvg !== undefined ? priceVsAvg > 1 : undefined;
  const belowAvg = priceVsAvg !== undefined ? priceVsAvg < -1 : undefined;

  // 获利盘健康度
  const profitHealthy = Number.isFinite(profitRatio) ? profitRatio > 0.3 && profitRatio < 0.85 : undefined;
  const highProfit = Number.isFinite(profitRatio) ? profitRatio >= 0.85 : undefined;
  const lowProfit = Number.isFinite(profitRatio) ? profitRatio <= 0.2 : undefined;

  // 峰型与控盘
  const peakType = inferChipPeakType(cost70, cost90, isConcentrating);
  const controlLevel = inferControlLevel(isConcentrating, isDispersing, profitRatio, aboveAvg, belowAvg);

  // 综合立场
  let stance: StructuredAgentFinding['stance'] = 'neutral';
  let score = 50;
  if (isConcentrating && aboveAvg && profitHealthy) {
    stance = 'bullish';
    score = 72;
  } else if (isConcentrating && aboveAvg && lowProfit) {
    stance = 'bullish';
    score = 65;
  } else if (isDispersing && belowAvg) {
    stance = 'bearish';
    score = 32;
  } else if (isDispersing && highProfit) {
    stance = 'bearish';
    score = 38;
  } else if (isConcentrating) {
    stance = 'bullish';
    score = 58;
  } else if (isDispersing) {
    stance = 'bearish';
    score = 42;
  }

  const latestDate = latest.date ? `（${latest.date}）` : '';
  const trendRows = [5, 10, 20]
    .map((days) => {
      const item = byDays.get(days);
      return `| ${days}日 | ${formatRatio(item?.concentration70)} | ${formatRatio(item?.concentration90)} |`;
    })
    .join('\n');

  const trendText =
    conc70Delta !== undefined
      ? `70%筹码集中度变化：5日 ${formatRatio(c5?.concentration70)} → 20日 ${formatRatio(c20?.concentration70)}。\n90%筹码集中度变化：5日 ${formatRatio(c5?.concentration90)} → 20日 ${formatRatio(c20?.concentration90)}。`
      : '集中度趋势样本不足，仅展示最新筹码结构。';

  const supportText =
    cost70?.low !== undefined
      ? `70%成本区间下沿 ${cost70.low.toFixed(2)} 元附近构成短期支撑，90%成本区间下沿 ${cost90?.low?.toFixed(2) ?? '--'} 元附近构成中期支撑。`
      : '成本区间数据不足，支撑判断受限。';

  const pressureText =
    cost90?.high !== undefined && Number.isFinite(close)
      ? `上方 ${cost90.high.toFixed(2)} 元附近为 90% 筹码套牢压力区，当前收盘价 ${close.toFixed(2)} 元 ${close > cost90.high * 0.98 ? '已接近或突破该压力区，需关注解套抛压' : '距离该压力区仍有空间'}。`
      : '套牢压力数据不足。';

  const outlook5 =
    stance === 'bullish'
      ? '筹码趋于集中且价格站稳平均成本，短期若量能配合有望延续反弹，上方关注 90% 成本区间上沿压力。'
      : stance === 'bearish'
        ? '筹码趋于发散或价格低于平均成本，短期套牢盘与获利兑现压力并存，易冲高回落或维持震荡偏弱。'
        : '筹码结构变化不显著，短期大概率围绕平均成本震荡，等待方向选择。';

  const outlook20 =
    stance === 'bullish'
      ? '中期筹码若持续集中且获利盘保持合理水平，主力锁仓意愿较强，股价有望沿成本中枢上行。'
      : stance === 'bearish'
        ? '中期若集中度持续发散且高位套牢盘未能消化，股价可能重回成本区间下沿甚至继续探底。'
        : '中期维持区间震荡概率较大，需结合基本面与资金面确认突破方向。';

  const risks: string[] = [];
  if (isDispersing) risks.push('筹码趋于发散，可能存在派发迹象。');
  if (highProfit) risks.push('获利盘比例过高，存在获利回吐抛压。');
  if (belowAvg) risks.push('价格低于平均成本，套牢盘解套前上行阻力较大。');
  if (controlLevel === '弱') risks.push('主力控盘度低，股价易受大盘情绪影响。');
  if (risks.length === 0) risks.push('筹码结构总体平稳，但仍需关注突发消息与大盘波动。');

  const conclusionText =
    stance === 'bullish'
      ? '【偏多】筹码集中度向好，主力控盘迹象明显，价格站稳平均成本，短期具备上攻基础。'
      : stance === 'bearish'
        ? '【偏空】筹码趋于发散或价格低于平均成本，套牢压力与派发风险并存。'
        : '【中性】筹码结构尚未出现明确方向信号，建议继续观察量能与集中度变化。';

  const markdown = `## 🎯 筹码集中度
# 筹码集中度变化

| 周期 | 70%筹码集中度 | 90%筹码集中度 |
|---|---:|---:|
${trendRows}

${trendText}

## ⛰️ 筹码峰结构
${peakType}。70%成本区间 ${latest.cost70 ?? '--'}，90%成本区间 ${latest.cost90 ?? '--'}。

## 📍 平均成本
最新平均成本 ${formatMaybeNumber(latest.avgCost)} 元${latestDate}。当前收盘价 ${close !== undefined ? close.toFixed(2) : '--'} 元，${priceVsAvg !== undefined ? `较平均成本 ${priceVsAvg >= 0 ? '+' : ''}${priceVsAvg.toFixed(2)}%` : '相对位置待确认'}。

## 💰 获利盘
当前获利盘 ${formatRatio(latest.profitRatio)}。${profitHealthy ? '获利盘处于相对健康区间，抛压可控。' : highProfit ? '获利盘比例偏高，需警惕短线兑现。' : lowProfit ? '获利盘比例偏低，套牢盘占主导。' : '获利盘状态需结合价格位置综合判断。'}

## 🐳 主力控盘
控盘等级：${controlLevel}。${isConcentrating ? '近 20 日筹码持续集中，显示主力锁仓或吸筹迹象。' : isDispersing ? '近 20 日筹码趋于发散，需警惕派发。' : '近期筹码集中度变化不显著，控盘状态中性。'}

## ⚠️ 套牢压力
${pressureText} ${supportText}

## 🧭 走势推演
**未来 5 个交易日**：${outlook5}

**未来 20 个交易日**：${outlook20}

## 🚨 风险提示
${risks.map((r) => `- ${r}`).join('\n')}

## 🎯 综合结论
${conclusionText}

筹码集中度评分：${score.toFixed(0)}
主力控盘评分：${controlLevel === '强' ? 75 : controlLevel === '中' ? 55 : 35}
上涨潜力评分：${stance === 'bullish' ? 70 : stance === 'bearish' ? 30 : 50}
风险评分：${risks.length > 2 ? 65 : risks.length > 0 ? 45 : 30}`;

  const fallbackId = evidence[0]?.id ?? fallbackEvidence(`chip:${input.symbol}`, '筹码分布数据不足').id;
  const finding: StructuredAgentFinding = {
    id: 'chip-1',
    dimension: 'chip',
    stance,
    score,
    confidence: 0.72,
    summary:
      oneLineSummary(markdown) ??
      `${input.stockLabel} 筹码${isConcentrating ? '趋于集中' : isDispersing ? '趋于发散' : '结构平稳'}，平均成本 ${formatMaybeNumber(latest.avgCost)}，获利盘 ${formatRatio(latest.profitRatio)}。`,
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

function parseCostRange(range?: string) {
  if (!range) return undefined;
  const match = range.match(/([\d.]+)\s*[-~～]\s*([\d.]+)/);
  if (!match) return undefined;
  const low = Number(match[1]);
  const high = Number(match[2]);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return undefined;
  return { low, high, width: high - low };
}

function inferChipPeakType(
  cost70: ReturnType<typeof parseCostRange>,
  cost90: ReturnType<typeof parseCostRange>,
  isConcentrating: boolean | undefined,
) {
  if (!cost70 || !cost90) return '成本区间数据不足，无法精确判断筹码峰型';
  const ratio = cost90.width / Math.max(cost70.width, 0.001);
  if (ratio < 1.6) {
    return `筹码呈单峰密集形态，${isConcentrating === true ? '且集中度持续收敛，主力吸筹或锁仓概率较高' : isConcentrating === false ? '但集中度在发散，需警惕派发' : '峰型集中但趋势尚不明确'}`;
  }
  if (ratio < 2.4) {
    return '筹码呈双峰形态，可能存在套牢峰与获利峰对峙，方向选择取决于量能突破';
  }
  return '筹码呈多峰发散形态，持仓成本分散，短期难以形成统一方向';
}

function inferControlLevel(
  isConcentrating: boolean | undefined,
  isDispersing: boolean | undefined,
  profitRatio: number,
  aboveAvg: boolean | undefined,
  belowAvg: boolean | undefined,
) {
  if (isConcentrating === true && aboveAvg && profitRatio > 0.3 && profitRatio < 0.85) return '强';
  if (isConcentrating === true && (aboveAvg || belowAvg) && profitRatio <= 0.85) return '中';
  if (isDispersing === true || profitRatio >= 0.9 || belowAvg) return '弱';
  return '中';
}

function formatRatio(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return `${(num * 100).toFixed(1)}%`;
}

function formatPercentNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? (num * 100).toFixed(1) : '--';
}

function formatMaybeNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(2) : '--';
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
    onProgress?.('调用模型分析中…', 10);
    const raw = await withProgressTicker(
      () =>
        generateReport([
          {
            role: 'system',
            content: `${agent.prompt}\n只返回 JSON，不要输出额外解释。格式：{"findings":[{"id":"${agent.name}-1","dimension":"${agent.dimension}","stance":"bullish|neutral|bearish|unknown","score":0,"confidence":0.5,"summary":"...","evidenceIds":["..."],"risks":["..."]}],"markdown":"### ${agent.label}\\n..."}。所有 evidenceIds 必须来自输入 evidence；缺失数据必须说明不足，不得编造。markdown 控制在 300 字以内。`,
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
      sanitizeFinding(item, agent, index, allowedEvidenceIds, fallbackId),
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
  index: number,
  allowedEvidenceIds: Set<string>,
  fallbackId: string,
): StructuredAgentFinding {
  const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
  const evidenceIds = Array.isArray(record.evidenceIds)
    ? record.evidenceIds.map(String).filter((id) => allowedEvidenceIds.has(id))
    : [];
  return {
    id: String(record.id ?? `${agent.name}-${index + 1}`),
    dimension: sanitizeDimension(record.dimension, agent.dimension),
    stance: sanitizeStance(record.stance),
    score: clamp(Number(record.score ?? 50), 0, 100),
    confidence: clamp(Number(record.confidence ?? 0.5), 0, 1),
    summary: String(record.summary ?? '数据不足，暂不形成强结论。'),
    evidenceIds: evidenceIds.length ? evidenceIds : [fallbackId],
    risks: Array.isArray(record.risks)
      ? record.risks.map(String).filter(Boolean)
      : ['数据样本不足导致判断置信度有限。'],
  };
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
  return {
    id: `${agent.name}-fallback`,
    dimension: agent.dimension,
    stance: 'unknown',
    score: 50,
    confidence: 0.35,
    summary: oneLineSummary(markdown) ?? `${input.stockLabel} 当前可用数据不足，需继续补充公开信息。`,
    evidenceIds: [evidenceId],
    risks: ['数据样本不足或上游接口暂不可用。'],
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
  // 单 Agent 模式才流式输出；控制单字延迟避免 UI 等待过久
  for (const chunk of markdown.match(/[\s\S]{1,8}/g) ?? [markdown]) {
    onToken(chunk);
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
}

function normalizeChipMarkdown(markdown: string, input: StockAnalysisInput) {
  const block = chipTrendBlock(input.chip);
  let text = markdown;
  if (block) {
    text = /##\s*🎯\s*筹码集中度/.test(text)
      ? text.replace(/(##\s*🎯\s*筹码集中度\s*)[\s\S]*?(?=\n##\s*(?:⛰️|📍|💰|🐳|⚠️|🧭|🚨|🎯)|$)/, `$1\n${block}\n`)
      : /#\s*筹码集中度变化[\s\S]*?(?=\n##\s*(?:⛰️|📍|💰|🐳|⚠️|🧭|🚨|🎯)|$)/.test(text)
        ? text.replace(/#\s*筹码集中度变化[\s\S]*?(?=\n##\s*(?:⛰️|📍|💰|🐳|⚠️|🧭|🚨|🎯)|$)/, block)
        : `${block}\n\n${text}`;
  }
  return text
    .replace(/(筹码集中度评分[:：]\s*\d+(?:\.\d+)?)(\s+)(主力控盘评分[:：])/g, '$1\n$3')
    .replace(/(主力控盘评分[:：]\s*\d+(?:\.\d+)?)(\s+)(上涨潜力评分[:：])/g, '$1\n$3')
    .replace(/(上涨潜力评分[:：]\s*\d+(?:\.\d+)?)(\s+)(风险评分[:：])/g, '$1\n$3');
}

function chipTrendBlock(chip: unknown) {
  const trend =
    chip && typeof chip === 'object'
      ? (chip as { trend?: Array<{ days?: number; concentration70?: unknown; concentration90?: unknown }> }).trend
      : undefined;
  if (!trend?.length) return '';
  const byDays = new Map(trend.map((item) => [Number(item.days), item]));
  return `${[
    '# 筹码集中度变化',
    '',
    '| 周期 | 70%筹码集中度 | 90%筹码集中度 |',
    '|---|---:|---:|',
    ...[5, 10, 20].map((days) => {
      const item = byDays.get(days);
      return `| ${days}日 | ${formatRatio(item?.concentration70)} | ${formatRatio(item?.concentration90)} |`;
    }),
  ]
    .join('\n')
    .trim()}\n\n${chipTrendSummary(chip)}`;
}

function chipTrendSummary(chip: unknown) {
  const trend =
    chip && typeof chip === 'object'
      ? (chip as { trend?: Array<{ days?: number; concentration70?: unknown; concentration90?: unknown }> }).trend
      : undefined;
  if (!trend?.length) return '';
  const byDays = new Map(trend.map((item) => [Number(item.days), item]));
  const five = byDays.get(5);
  const twenty = byDays.get(20);
  return [
    `70%筹码集中度变化：5日 ${formatRatio(five?.concentration70)} → 20日 ${formatRatio(twenty?.concentration70)}。`,
    `90%筹码集中度变化：5日 ${formatRatio(five?.concentration90)} → 20日 ${formatRatio(twenty?.concentration90)}。`,
  ].join('\n');
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
  };
}
