/**
 * 超短线技术选股智能体的工具白名单与「意图 → 参数」映射（无运行时依赖，可单测）。
 * 复用 a-stock-data-agent-tools 的 parseToolCall 解析 LLM 输出的 {"tool","input"}。
 */

export interface IToolSpec {
  name: string;
  description: string;
}

export type TStockPickerIntentId = 'trend-strength' | 'chip-control' | 'limit-up-potential' | 'custom';

export interface IStockPickerIntentTemplate {
  id: Exclude<TStockPickerIntentId, 'custom'>;
  label: string;
  description: string;
  patterns: RegExp[];
  primaryTool: string;
  primaryInput: Record<string, unknown>;
  followupTools: string[];
  criteriaText: string[];
  answerHint: string;
  dataGapHint?: string;
}

export interface IResolvedStockPickerIntent {
  id: TStockPickerIntentId;
  label: string;
  description: string;
  primaryTool?: string;
  primaryInput?: Record<string, unknown>;
  followupTools: string[];
  criteriaText: string[];
  answerHint: string;
  dataGapHint?: string;
  matchedTemplate?: IStockPickerIntentTemplate;
}

/**
 * 选股智能体可调用的真实数据工具（仅以下白名单）。描述会注入 system prompt，
 * 因此必须写清参数与取数顺序，避免 LLM 乱填 input。
 */
export const STOCK_PICKER_TOOLBOX: IToolSpec[] = [
  {
    name: 'screenLocalAStocks',
    description:
      '全市场本地宽筛 A 股（基于本地 DuckDB 行情快照 + 筹码缓存），超短线初筛第一步必用。支持 changePercentMin/Max、turnoverRateMin/Max、concentration90Max/Min、concentration70Max/Min、profitRatioMin、chipLookbackDays、chipMatchMode(latest/all/any)、limit、sortBy(changePercent/concentration90/amount/turnoverRate)、sortOrder(asc/desc)、includeST(默认 false 排除 ST)。例如：换手率>8% 且 90%筹码集中度<20% 且非ST：{turnoverRateMin:8, concentration90Max:20, includeST:false, limit:300}；最近5天筹码持续集中：{chipLookbackDays:5, chipMatchMode:"all", concentration90Max:20, limit:300}。',
  },
  {
    name: 'screenASharesByMarketCap',
    description:
      '按市值区间全市场筛选（DuckDB→stock-sdk→a-stock-data），支持换手率区间过滤。输入 {minMarketCap?, maxMarketCap?, turnoverRateMin?, turnoverRateMax?, unit?, marketCapField?, limit?, includeST?, sortOrder?}。超短小盘思路可用，例如流通市值<50亿且换手>10%：{maxMarketCap:50, unit:"yi", marketCapField:"circulating", turnoverRateMin:10, limit:500}。',
  },
  {
    name: 'getTechnicalIndicators',
    description:
      '获取个股技术指标摘要（MACD 金叉/死叉、KDJ、均线多头排列、量比、BOLL 等），用于验证候选股技术形态。输入 {symbol}。精筛阶段对 screenLocalAStocks 返回的 Top N 逐只调用。',
  },
  {
    name: 'getStockChipDistributionLocalFirst',
    description:
      '获取个股筹码分布（90%/70% 集中度、获利比例、成本单峰密集度），本地 DuckDB 优先。超短线关注成本单峰、90% 集中度低、获利比例高。输入 {symbol, days?}。',
  },
  {
    name: 'getStockFundFlowLocalFirst',
    description:
      '获取个股主力资金流（主力净流入、大单/特大单），本地优先。超短线关注主力净流入为正、大单持续买入。输入 {symbol}。',
  },
  {
    name: 'getStockSurgeEventsLocalFirst',
    description:
      '获取个股异动/盘口大单（游资痕迹、快速拉盘/跳水、大笔买卖），本地 DuckDB 优先。用于判断是否有资金异动与游资参与。输入 {symbol, days?, limit?, minHands?}。',
  },
  {
    name: 'getDragonTiger',
    description:
      '获取个股龙虎榜上榜记录与游资席位（买方营业部、机构专用），用于判断是否获一线游资参与。输入 {symbol}。',
  },
  { name: 'getHotConcepts', description: '获取今日热门题材与概念归属，用于判断候选股是否踩中当日热点。无需输入。' },
  { name: 'getMarketReview', description: '获取全市场情绪、涨停梯队、热点板块，用于判断超短线情绪周期与板块效应。无需输入。' },
  {
    name: 'readUrl',
    description:
      '读取指定 URL 正文（Firecrawl/Crawl4AI/直接抓取），用于核查个股消息催化。需配合 webSearch 返回的链接或用户给定链接，输入 {url}。',
  },
  {
    name: 'webSearch',
    description:
      '联网搜索题材/消息催化（Tavily/Serper 等，需配置 API Key）。返回相关链接与摘要，可再调用 readUrl 读取正文。输入 {query, maxResults?}。未配置搜索 API 时返回数据缺口提示，不得编造。',
  },
];

const DEFAULT_CUSTOM_INTENT: IResolvedStockPickerIntent = {
  id: 'custom',
  label: '自定义超短线选股',
  description: '用户描述了复合选股需求，由模型在工具白名单内自主拆解真实数据条件。',
  followupTools: ['screenLocalAStocks', 'getTechnicalIndicators', 'getStockChipDistributionLocalFirst', 'getStockFundFlowLocalFirst'],
  criteriaText: ['按用户自然语言条件拆解宽筛参数', '先全市场宽筛，再对候选股做技术/筹码/资金精筛'],
  answerHint: '先说明已按用户描述拆解条件；只基于真实工具结果输出候选清单，数据不足时说明缺口。',
};

export const STOCK_PICKER_INTENT_TEMPLATES: readonly IStockPickerIntentTemplate[] = [
  {
    id: 'trend-strength',
    label: '趋势强势',
    description: '寻找短线趋势强、成交活跃、具备多头结构验证价值的股票。',
    patterns: [/强势股|趋势强|走势强|强势票|多头|放量|量价齐升|突破/],
    primaryTool: 'screenLocalAStocks',
    primaryInput: {
      changePercentMin: 3,
      changePercentMax: 9.8,
      turnoverRateMin: 5,
      includeST: false,
      limit: 120,
      sortBy: 'turnoverRate',
      sortOrder: 'desc',
    },
    followupTools: ['getTechnicalIndicators', 'getStockFundFlowLocalFirst', 'getHotConcepts'],
    criteriaText: ['涨幅 3%–9.8%', '换手率 > 5%', '排除 ST', '后续验证均线多头、MACD/KDJ 和主力资金'],
    answerHint: '对用户表达为「多头排列 + 放量活跃 + 资金配合」；技术指标未返回时，不输出具体金叉/均线结论。',
  },
  {
    id: 'chip-control',
    label: '筹码集中 / 主力控盘',
    description: '寻找筹码集中、获利盘较高、后续可用资金流验证主力控盘迹象的股票。',
    patterns: [/主力控盘|控盘|筹码集中|筹码高度集中|获利盘|单峰密集|集中度.*票|集中.*筹码/],
    primaryTool: 'screenLocalAStocks',
    primaryInput: {
      concentration90Max: 15,
      profitRatioMin: 80,
      includeST: false,
      limit: 120,
      sortBy: 'concentration90',
      sortOrder: 'asc',
    },
    followupTools: ['getStockChipDistributionLocalFirst', 'getStockFundFlowLocalFirst', 'getStockSurgeEventsLocalFirst'],
    criteriaText: ['90% 筹码集中度 < 15%', '获利比例 > 80%', '排除 ST', '后续验证主力/超大单净流入是否为正'],
    answerHint: '对用户表达为「筹码高度集中 + 获利盘较高 + 资金流验证」；资金流未返回时，只能说控盘迹象缺少资金面确认。',
  },
  {
    id: 'limit-up-potential',
    label: '连板潜力',
    description: '寻找短线情绪、涨停梯队和热点题材中可能具备连板观察价值的股票。',
    patterns: [/连板|能连板|连板潜力|一进二|二进三|首板|打板|涨停接力|接力票/],
    primaryTool: 'getMarketReview',
    primaryInput: {},
    followupTools: ['getHotConcepts', 'screenLocalAStocks', 'getStockSurgeEventsLocalFirst', 'getDragonTiger'],
    criteriaText: ['先读取真实市场复盘、涨停梯队和热点板块', '再筛选高换手、高涨幅、资金异动候选', '必要时验证龙虎榜和个股异动'],
    answerHint: '对用户表达为「情绪周期 + 涨停梯队 + 题材热度 + 资金异动」；不得把缺失字段当作已满足条件。',
    dataGapHint: '当前工具未稳定提供昨日首板、封单金额和竞价高开字段；若结果中没有这些真实字段，必须明确标注缺口，不得编造。',
  },
];

const ALLOWED_STOCK_PICKER_TOOLS = new Set(STOCK_PICKER_TOOLBOX.map((tool) => tool.name));

export function isStockPickerToolAllowed(toolName: string): boolean {
  return ALLOWED_STOCK_PICKER_TOOLS.has(toolName);
}

export function resolveStockPickerIntent(query: string): IResolvedStockPickerIntent {
  const template = STOCK_PICKER_INTENT_TEMPLATES.find((item) => item.patterns.some((pattern) => pattern.test(query)));
  if (!template) return DEFAULT_CUSTOM_INTENT;
  return {
    id: template.id,
    label: template.label,
    description: template.description,
    primaryTool: template.primaryTool,
    primaryInput: template.primaryInput,
    followupTools: template.followupTools,
    criteriaText: template.criteriaText,
    answerHint: template.answerHint,
    dataGapHint: template.dataGapHint,
    matchedTemplate: template,
  };
}

export function buildStockPickerIntentPromptPart(intent: IResolvedStockPickerIntent): string {
  const primaryTool = intent.primaryTool
    ? `${intent.primaryTool}，建议输入：${JSON.stringify(intent.primaryInput ?? {})}`
    : '由模型按用户条件在工具白名单内选择';
  const followupTools = intent.followupTools.length ? intent.followupTools.join('、') : '无固定后续工具';
  const dataGapHint = intent.dataGapHint ? `\n能力缺口约束：${intent.dataGapHint}` : '';
  return `当前用户意图已映射为「${intent.label}」。
内部筛选条件：${intent.criteriaText.join('；')}。
建议首个真实数据工具：${primaryTool}。
建议后续精筛工具：${followupTools}。
输出提示：${intent.answerHint}${dataGapHint}
面向用户时只解释「意图和筛选条件」，不要暴露 JSON 参数名；所有股票、价格、指标、资金和榜单必须来自真实工具结果。`;
}

export { parseToolCall } from './a-stock-data-agent-tools.js';
