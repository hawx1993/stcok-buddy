import type { AgentResultCard, EvidenceItem, HotFocusItem, KlinePoint, MarketNewsItem, StockDetail, StructuredAgentFinding, StructuredAgentOutput } from '../../../src/shared/types.js';
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
  chip?: unknown;
  evidence?: EvidenceItem[];
};

export type StockAnalysisResult = {
  name: StockAnalysisAgentName;
  label: string;
  output: StructuredAgentOutput;
  content: string;
};

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
    fallback: (input) => input.technical?.narrative ?? '📈 技术面：K线或指标数据不足，暂只能基于现价和涨跌幅做初步判断。',
  },
  {
    name: 'fundamental',
    dimension: 'fundamental',
    label: '📊 基本面分析',
    prompt: '你是资深基本面分析师。基于公司行情、估值指标、行业位置和可用公开数据，分析估值、成长性、盈利质量和基本面风险；缺失的数据必须说明不可判断。',
    fallback: (input) => `📊 基本面：当前可用估值指标 PE=${input.quote?.pe ?? '--'}，PB=${input.quote?.pb ?? '--'}；财报细项缺失，需结合最新定报继续核查。`,
  },
  {
    name: 'capital',
    dimension: 'capital',
    label: '💰 资金面分析',
    prompt: '你是A股资金面分析师。基于成交量、成交额、近期K线、市场热度和 largeOrders，分析资金态度、量价配合、主力可能阶段和资金风险。必须单列“特大单买卖”小节：特大单定义为单笔大于10000手，基于 largeOrders 中的特大单买入/卖出事件统计买入数量、卖出数量、买入占比、卖出占比，并分析方向和持续性；如没有逐笔成交或特大单明细，必须明确说明无法精确计算，不得编造具体笔数。不要编造北向或主力净流入数据。',
    fallback: (input) => `${capitalFallback(input)}\n\n${largeOrderFallback(input)}`,
  },
  {
    name: 'sentiment',
    dimension: 'sentiment',
    label: '🌡️ 情绪面分析',
    prompt: '你是市场舆情与情绪分析专家。基于新闻标题、板块热度、涨跌幅和成交活跃度，判断情绪温度、催化因素和情绪风险。',
    fallback: (input) => `🌡️ 情绪面：近端新闻样本 ${input.news?.length ?? 0} 条；需结合新闻正负面和板块热度判断，避免单凭涨跌幅下结论。`,
  },
  {
    name: 'chip',
    dimension: 'chip',
    label: '🧩 筹码分析',
    prompt: '你是一名拥有20年经验的A股主力行为分析师和筹码分析专家。只输出“🧩 筹码分析”，不要生成综合投研报告。请根据 chip 筹码数据、quote 行情和 kline 走势，分析个股当前的筹码结构、主力控盘情况以及未来走势。输出 Markdown，并固定使用这些小节标题：## 🎯 筹码集中度、## ⛰️ 筹码峰结构、## 📍 平均成本、## 💰 获利盘、## 🐳 主力控盘、## ⚠️ 套牢压力、## 🧭 走势推演、## 🚨 风险提示、## 🎯 综合结论。\n\n在“## 🎯 筹码集中度”下必须用 Markdown 表格输出，不要合并成一句话，不要用小数；并且必须分别分析70%和90%筹码集中度，不能只分析70%：\n# 筹码集中度变化\n\n| 周期 | 70%筹码集中度 | 90%筹码集中度 |\n|---|---:|---:|\n| 5日 | x.x% | x.x% |\n| 10日 | x.x% | x.x% |\n| 20日 | x.x% | x.x% |\n\n在“综合评分”处必须换行显示，每项独占一行：\n筹码集中度评分：xx\n主力控盘评分：xx\n上涨潜力评分：xx\n风险评分：xx\n\n分析要求：1）当前筹码结构特征：单峰密集、双峰密集、多峰发散、高位密集、低位密集；2）筹码集中度趋势：比较最近5日、10日、20日的70%/90%筹码集中度变化，判断筹码持续集中还是发散，主力是在吸筹、锁仓或派发；3）主力控盘：控盘等级弱/中/强、持仓稳定性、是否高度控盘；4）获利盘与套牢盘：获利盘健康度、上方套牢压力、下方支撑力度；5）未来5个交易日和20个交易日走势推演；6）风险提示：筹码松动、高位派发、套牢盘抛压；7）最后给出总体结论：【强烈看多】/【偏多】/【中性】/【偏空】/【强烈看空】并说明核心理由。缺失数据必须说明不可判断，不得编造。',
    fallback: (input) => chipFallback(input),
  },
];

function chipFallback(input: StockAnalysisInput) {
  const chip = input.chip as { latest?: { profitRatio?: number; avgCost?: number; cost70?: string; cost90?: string; concentration70?: number; concentration90?: number }; trend?: Array<{ days: number; concentration70?: number; concentration90?: number }> } | undefined;
  const latest = chip?.latest;
  if (!latest) return `🧩 筹码分析：当前未检索到 ${input.stockLabel} 的筹码分布数据，无法判断筹码结构和主力控盘情况。`;
  const trend = chip?.trend?.map((item) => `${item.days}日70%集中度=${formatRatio(item.concentration70)}，90%集中度=${formatRatio(item.concentration90)}`).join('；') || '集中度趋势样本不足';
  const trendText = chipTrendSummary(input.chip);
  return `🧩 筹码分析\n\n## 🎯 筹码集中度\n${trend}\n${trendText ? `\n${trendText}` : ''}\n\n## ⛰️ 筹码峰结构\n70%成本区间 ${latest.cost70 ?? '--'}，90%成本区间 ${latest.cost90 ?? '--'}。\n\n## 📍 平均成本\n当前平均成本 ${formatMaybeNumber(latest.avgCost)}。\n\n## 💰 获利盘\n当前获利盘 ${formatRatio(latest.profitRatio)}。\n\n## 🐳 主力控盘\n需结合价格是否站稳平均成本、筹码集中度是否收敛判断控盘强弱。\n\n## ⚠️ 套牢压力\n重点观察上方90%成本区间高位附近抛压。`;
}

function formatRatio(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return `${(num * 100).toFixed(1)}%`;
}

function formatMaybeNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(2) : '--';
}

function capitalFallback(input: StockAnalysisInput) {
  return `💰 资金面：当前成交额 ${input.quote?.turnover ?? '--'}，成交量 ${input.quote?.volume ?? '--'}；资金流细项缺失时，结论以量价和特大单异动样本为主。`;
}

function largeOrderFallback(input: StockAnalysisInput) {
  const stats = largeOrderStats(input.largeOrders);
  if (!stats.total) return `💼 特大单分析：当前未检索到 ${input.stockLabel} 单笔大于10000手的买入/卖出异动，无法精确统计流入/流出数量和占比；可先结合成交额 ${input.quote?.turnover ?? '--'}、成交量 ${input.quote?.volume ?? '--'} 与K线放量情况观察。`;
  return `💼 特大单分析：当前样本中单笔大于10000手的特大单共 ${stats.total} 笔，其中买入 ${stats.buy} 笔、占比 ${stats.buyPct}%，卖出 ${stats.sell} 笔、占比 ${stats.sellPct}%。${stats.buy >= stats.sell ? '样本方向偏流入，但需观察后续成交额延续。' : '样本方向偏流出，需警惕短线抛压。'}`;
}

function largeOrderStats(items: HotFocusItem[] = []) {
  const largeOrders = items.filter((item) => /特大单/.test(`${item.description ?? ''}${item.tag ?? ''}${item.amount ?? ''}`));
  const buy = largeOrders.filter((item) => /买/.test(`${item.description ?? ''}${item.tag ?? ''}${item.amount ?? ''}`)).length;
  const sell = largeOrders.filter((item) => /卖/.test(`${item.description ?? ''}${item.tag ?? ''}${item.amount ?? ''}`)).length;
  const total = buy + sell;
  return { total, buy, sell, buyPct: total ? ((buy / total) * 100).toFixed(1) : '0.0', sellPct: total ? ((sell / total) * 100).toFixed(1) : '0.0' };
}

export function stockAnalysisAgentNames() {
  return agents.map((agent) => ({ name: agent.name, label: agent.label }));
}

export async function runStockAnalysisSubAgent(name: StockAnalysisAgentName, input: StockAnalysisInput, onToken?: (token: string) => void): Promise<StockAnalysisResult> {
  const agent = agents.find((item) => item.name === name)!;
  const evidence = input.evidence?.length ? input.evidence : [fallbackEvidence(`${agent.name}:${input.symbol}`, `${agent.label}证据不足`)];
  try {
    const data = JSON.stringify(compactInput({ ...input, evidence }), null, 2);
    const raw = await generateReport([
      {
        role: 'system',
        content: `${agent.prompt}\n只返回 JSON，不要输出额外解释。格式：{"findings":[{"id":"${agent.name}-1","dimension":"${agent.dimension}","stance":"bullish|neutral|bearish|unknown","score":0,"confidence":0.5,"summary":"...","evidenceIds":["..."],"risks":["..."]}],"markdown":"### ${agent.label}\\n..."}。所有 evidenceIds 必须来自输入 evidence；缺失数据必须说明不足，不得编造。markdown 控制在 300 字以内。`,
      },
      { role: 'user', content: `用户问题：${input.query}\n股票：${input.stockLabel}（${input.symbol}）\n结构化数据：\n${data}` },
    ]);
    const output = parseStructuredAgentOutput(raw, agent, input, evidence);
    if (agent.name === 'chip') output.markdown = normalizeChipMarkdown(output.markdown, input);
    await streamMarkdown(output.markdown, onToken);
    return { name: agent.name, label: agent.label, output, content: output.markdown };
  } catch {
    const output = fallbackStructuredAgentOutput(agent, input, evidence);
    if (agent.name === 'chip') output.markdown = normalizeChipMarkdown(output.markdown, input);
    await streamMarkdown(output.markdown, onToken);
    return { name: agent.name, label: agent.label, output, content: output.markdown };
  }
}

export function parseStructuredAgentOutput(raw: string, agent: Pick<StockAnalysisAgentDef, 'name' | 'label' | 'dimension'> & Partial<Pick<StockAnalysisAgentDef, 'fallback'>>, input: StockAnalysisInput, evidence = input.evidence ?? []): StructuredAgentOutput {
  try {
    const parsed = JSON.parse(extractJson(raw)) as Partial<StructuredAgentOutput> & { findings?: unknown; markdown?: unknown };
    const allowedEvidenceIds = new Set(evidence.map((item) => item.id));
    const fallbackId = evidence[0]?.id ?? fallbackEvidence(`${agent.name}:${input.symbol}`, `${agent.label}证据不足`).id;
    const findings = (Array.isArray(parsed.findings) ? parsed.findings : []).map((item, index) => sanitizeFinding(item, agent, index, allowedEvidenceIds, fallbackId));
    const markdown = typeof parsed.markdown === 'string' && parsed.markdown.trim() ? parsed.markdown.trim() : fallbackMarkdown(agent, input);
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

function sanitizeFinding(item: unknown, agent: Pick<StockAnalysisAgentDef, 'name' | 'dimension'>, index: number, allowedEvidenceIds: Set<string>, fallbackId: string): StructuredAgentFinding {
  const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
  const evidenceIds = Array.isArray(record.evidenceIds) ? record.evidenceIds.map(String).filter((id) => allowedEvidenceIds.has(id)) : [];
  return {
    id: String(record.id ?? `${agent.name}-${index + 1}`),
    dimension: sanitizeDimension(record.dimension, agent.dimension),
    stance: sanitizeStance(record.stance),
    score: clamp(Number(record.score ?? 50), 0, 100),
    confidence: clamp(Number(record.confidence ?? 0.5), 0, 1),
    summary: String(record.summary ?? '数据不足，暂不形成强结论。'),
    evidenceIds: evidenceIds.length ? evidenceIds : [fallbackId],
    risks: Array.isArray(record.risks) ? record.risks.map(String).filter(Boolean) : ['数据样本不足导致判断置信度有限。'],
  };
}

function fallbackStructuredAgentOutput(agent: Pick<StockAnalysisAgentDef, 'name' | 'label' | 'dimension'> & Partial<Pick<StockAnalysisAgentDef, 'fallback'>>, input: StockAnalysisInput, evidence: EvidenceItem[]): StructuredAgentOutput {
  const usableEvidence = evidence.length ? evidence : [fallbackEvidence(`${agent.name}:${input.symbol}`, `${agent.label}证据不足`)];
  return {
    agentName: agent.name,
    label: agent.label,
    findings: [fallbackFinding(agent, input, usableEvidence[0].id, agent.fallback?.(input))],
    evidence: usableEvidence,
    markdown: agent.fallback ? agent.fallback(input) : fallbackMarkdown(agent, input),
  };
}

function fallbackFinding(agent: Pick<StockAnalysisAgentDef, 'name' | 'dimension'>, input: StockAnalysisInput, evidenceId: string, markdown?: string): StructuredAgentFinding {
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
  return ['technical', 'fundamental', 'capital', 'sentiment', 'chip', 'overview', 'risk'].includes(String(value)) ? value as AgentDimension : fallback;
}

function sanitizeStance(value: unknown): AgentStance {
  return ['bullish', 'neutral', 'bearish', 'unknown'].includes(String(value)) ? value as AgentStance : 'unknown';
}

function clamp(value: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

async function streamMarkdown(markdown: string, onToken?: (token: string) => void) {
  if (!onToken) return;
  for (const chunk of markdown.match(/[\s\S]{1,8}/g) ?? [markdown]) {
    onToken(chunk);
    await new Promise((resolve) => setTimeout(resolve, 35));
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
  const trend = chip && typeof chip === 'object' ? (chip as { trend?: Array<{ days?: number; concentration70?: unknown; concentration90?: unknown }> }).trend : undefined;
  if (!trend?.length) return '';
  const byDays = new Map(trend.map((item) => [Number(item.days), item]));
  return `${['# 筹码集中度变化', '', '| 周期 | 70%筹码集中度 | 90%筹码集中度 |', '|---|---:|---:|', ...[5, 10, 20].map((days) => {
    const item = byDays.get(days);
    return `| ${days}日 | ${formatRatio(item?.concentration70)} | ${formatRatio(item?.concentration90)} |`;
  })].join('\n').trim()}\n\n${chipTrendSummary(chip)}`;
}

function chipTrendSummary(chip: unknown) {
  const trend = chip && typeof chip === 'object' ? (chip as { trend?: Array<{ days?: number; concentration70?: unknown; concentration90?: unknown }> }).trend : undefined;
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
  return {
    symbol: input.symbol,
    stockLabel: input.stockLabel,
    quote: input.quote,
    technical: input.technical,
    kline: input.kline?.slice(-60),
    news: input.news?.slice(0, 10).map((item) => ({ time: item.time, title: item.title, tags: item.tags, source: item.source })),
    chip: formatChipInput(input.chip),
    largeOrders: input.largeOrders?.map((item) => ({ time: item.time, code: item.code, name: item.name, amount: item.amount, description: item.description, tag: item.tag, type: item.type })),
    evidence: input.evidence?.map((item) => ({ id: item.id, source: item.source, title: item.title, summary: item.summary, value: item.value, timestamp: item.timestamp })),
  };
}
