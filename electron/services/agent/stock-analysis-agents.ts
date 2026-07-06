import type { AgentResultCard, KlinePoint, MarketNewsItem, StockDetail } from '../../../src/shared/types.js';
import { generateReport } from '../llm/index.js';

export type StockAnalysisAgentName = 'technical' | 'fundamental' | 'capital' | 'sentiment' | 'lhb';

export type StockAnalysisInput = {
  query: string;
  symbol: string;
  stockLabel: string;
  quote?: StockDetail;
  technical?: AgentResultCard;
  kline?: KlinePoint[];
  news?: MarketNewsItem[];
};

export type StockAnalysisResult = {
  name: StockAnalysisAgentName;
  label: string;
  content: string;
};

type StockAnalysisAgentDef = {
  name: StockAnalysisAgentName;
  label: string;
  prompt: string;
  fallback(input: StockAnalysisInput): string;
};

const agents: StockAnalysisAgentDef[] = [
  {
    name: 'technical',
    label: '技术面分析',
    prompt: '你是资深A股技术分析专家。基于行情、K线、技术指标，分析趋势、支撑压力、量价关系、动能和技术风险。',
    fallback: (input) => input.technical?.narrative ?? '技术面：K线或指标数据不足，暂只能基于现价和涨跌幅做初步判断。',
  },
  {
    name: 'fundamental',
    label: '基本面分析',
    prompt: '你是资深基本面分析师。基于公司行情、估值指标、行业位置和可用公开数据，分析估值、成长性、盈利质量和基本面风险；缺失的数据必须说明不可判断。',
    fallback: (input) => `基本面：当前可用估值指标 PE=${input.quote?.pe ?? '--'}，PB=${input.quote?.pb ?? '--'}；财报细项缺失，需结合最新定报继续核查。`,
  },
  {
    name: 'capital',
    label: '资金面分析',
    prompt: '你是A股资金面分析师。基于成交量、成交额、近期K线和市场热度，分析资金态度、量价配合、主力可能阶段和资金风险；不要编造北向或主力净流入数据。',
    fallback: (input) => `资金面：当前成交额 ${input.quote?.turnover ?? '--'}，成交量 ${input.quote?.volume ?? '--'}；缺少逐笔资金流，结论以量价估算为主。`,
  },
  {
    name: 'sentiment',
    label: '情绪面分析',
    prompt: '你是市场舆情与情绪分析专家。基于新闻标题、板块热度、涨跌幅和成交活跃度，判断情绪温度、催化因素和情绪风险。',
    fallback: (input) => `情绪面：近端新闻样本 ${input.news?.length ?? 0} 条；需结合新闻正负面和板块热度判断，避免单凭涨跌幅下结论。`,
  },
  {
    name: 'lhb',
    label: '龙虎榜分析',
    prompt: '你是龙虎榜解读专家。基于可用龙虎榜、涨跌幅、成交量和换手线索判断游资/机构信号；如没有龙虎榜明细，必须明确说明无法确认席位行为。',
    fallback: () => '龙虎榜：当前未接入近10日席位明细，无法确认机构/游资席位行为；需后续补充龙虎榜数据源。',
  },
];

export function stockAnalysisAgentNames() {
  return agents.map((agent) => ({ name: agent.name, label: agent.label }));
}

export async function runStockAnalysisSubAgent(name: StockAnalysisAgentName, input: StockAnalysisInput): Promise<StockAnalysisResult> {
  const agent = agents.find((item) => item.name === name)!;
  try {
    const data = JSON.stringify(compactInput(input), null, 2);
    const content = await generateReport([
      { role: 'system', content: `${agent.prompt}\n输出中文 Markdown，控制在 300 字以内。只基于输入数据，不编造缺失字段。` },
      { role: 'user', content: `用户问题：${input.query}\n股票：${input.stockLabel}（${input.symbol}）\n结构化数据：\n${data}` },
    ]);
    return { name: agent.name, label: agent.label, content };
  } catch {
    return { name: agent.name, label: agent.label, content: agent.fallback(input) };
  }
}

function compactInput(input: StockAnalysisInput) {
  return {
    symbol: input.symbol,
    stockLabel: input.stockLabel,
    quote: input.quote,
    technical: input.technical,
    kline: input.kline?.slice(-60),
    news: input.news?.slice(0, 10).map((item) => ({ time: item.time, title: item.title, tags: item.tags, source: item.source })),
  };
}
