import type { IAgentDataGap, IAgentPlan, IAgentPlanItem } from '../../../src/shared/types.js';
import type { DagNode } from './dag-executor.js';
import type { IAgentContext, TAgentIntent } from './orchestrator-types.js';

interface IPlanTemplateItem {
  id: string;
  title: string;
  reason: string;
  dataNeeds: string[];
  relatedNodeIds: string[];
  fallbackStrategy?: string;
  optional?: boolean;
}

const DEFAULT_FALLBACK = '若数据不可用，则记录数据缺口并降低该维度置信度，不用替代数据伪造结论。';

export function createInitialAgentPlan(context: IAgentContext): IAgentPlan {
  const target = context.symbol ?? context.boardKeyword;
  const items = createPlanItems(context).map((item): IAgentPlanItem => ({
    ...item,
    fallbackStrategy: item.fallbackStrategy ?? DEFAULT_FALLBACK,
    status: 'pending',
  }));

  return {
    id: `plan-${context.intent}-${target ?? 'general'}`,
    intent: context.intent,
    target,
    summary: createPlanSummary(context.intent, target),
    items,
    assumptions: createAssumptions(context),
    dataGaps: [],
    revisions: [],
  };
}

export function attachPlanNodeCoverage(plan: IAgentPlan, nodes: Array<DagNode<IAgentContext>>): IAgentPlan {
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    ...plan,
    items: plan.items.map((item) => ({
      ...item,
      relatedNodeIds: item.relatedNodeIds.filter((id) => nodeIds.has(id)),
    })),
  };
}

export function formatPlanMessage(plan: IAgentPlan): string {
  const lines = [plan.summary];
  plan.items.forEach((item, index) => {
    const needs = item.dataNeeds.length ? `（依赖：${item.dataNeeds.join('、')}）` : '';
    lines.push(`${index + 1}. ${item.title}：${item.reason}${needs}`);
  });
  const optionalText = plan.items.some((item) => item.optional) ? '\n可选数据不可用时会标注缺口，不用缺失维度输出硬结论。' : '';
  return `${lines.join('\n')}${optionalText}`;
}

export function createPlanAgentsFromNodes(nodes: Array<DagNode<IAgentContext>>) {
  const analysisAgents = nodes.filter((node) => node.id.startsWith('analysis-') && node.id !== 'analysis-report');
  const knownDataIds = new Set([
    'quote',
    'market-data',
    'market-review-data',
    'news-announcements',
    'read-links',
    'chat',
    'memory-placeholder',
    'technical',
  ]);
  const otherNodes = nodes.filter((node) => !node.id.startsWith('analysis-') && !knownDataIds.has(node.id));
  return [
    ...(nodes.some((node) => node.id === 'quote')
      ? [{ id: 'data', agent: 'DataAgent', description: '获取实时行情、K线、新闻和可选投研数据' }]
      : []),
    ...analysisAgents.map((node) => ({
      id: node.id.replace('analysis-', ''),
      agent: node.agent,
      description: node.description,
    })),
    ...otherNodes.map((node) => ({ id: node.id, agent: node.agent, description: node.description })),
    ...(nodes.some((node) => node.id === 'analysis-report')
      ? [{ id: 'report', agent: '生成投研报告', description: '汇总计划执行结果、证据和数据缺口' }]
      : []),
  ];
}

export function planNeedsNode(plan: IAgentPlan | undefined, nodeId: string): boolean {
  if (!plan) return true;
  return plan.items.some((item) => item.relatedNodeIds.includes(nodeId));
}

export function planNeedsData(plan: IAgentPlan | undefined, dataName: string): boolean {
  if (!plan) return true;
  return plan.items.some((item) => item.dataNeeds.some((need) => isSameDataNeed(need, dataName)));
}

export function planNeedsAnyData(plan: IAgentPlan | undefined, dataNames: string[]): boolean {
  if (!plan) return true;
  return dataNames.some((dataName) => planNeedsData(plan, dataName));
}

export function findPlanItemIdsByDataName(plan: IAgentPlan | undefined, dataName: string): string[] {
  if (!plan) return [];
  return plan.items
    .filter((item) => item.dataNeeds.some((need) => isSameDataNeed(need, dataName)))
    .map((item) => item.id);
}

export function shouldRunPlanNode(plan: IAgentPlan | undefined, nodeId: string): boolean {
  if (!plan) return true;
  const relatedItems = plan.items.filter((item) => item.relatedNodeIds.includes(nodeId));
  if (!relatedItems.length) return true;
  return relatedItems.some((item) => !['skipped', 'blocked', 'failed'].includes(item.status));
}

export function markPlanItemsByDataGap(plan: IAgentPlan, gaps: IAgentDataGap[]): IAgentPlan {
  if (!gaps.length) return plan;
  const gapByItemId = new Map<string, IAgentDataGap[]>();
  for (const gap of gaps) {
    for (const itemId of gap.affectedPlanItemIds) {
      gapByItemId.set(itemId, [...(gapByItemId.get(itemId) ?? []), gap]);
    }
  }

  return {
    ...plan,
    items: plan.items.map((item) => {
      if (item.status === 'failed' || item.status === 'blocked' || item.status === 'skipped') return item;
      const itemGaps = gapByItemId.get(item.id) ?? [];
      if (!itemGaps.length) return item;
      if (item.optional) return { ...item, status: 'skipped' };
      if (itemGaps.some((gap) => gap.impact === 'high' && ['failed', 'empty', 'stale'].includes(gap.status))) {
        return { ...item, status: 'blocked' };
      }
      return item;
    }),
  };
}

export function formatPlanUpdatedMessage(plan: IAgentPlan): string {
  const gaps = plan.dataGaps.map((gap) => gap.dataName).join('、');
  const changed = plan.items.filter((item) => item.status === 'skipped' || item.status === 'blocked' || item.status === 'failed');
  if (!gaps && !changed.length) return '分析计划状态已更新。';
  const changedText = changed.length ? `；已调整：${changed.map((item) => `${item.title}=${item.status}`).join('、')}` : '';
  return `已根据数据缺口${gaps ? `（${gaps}）` : ''}调整计划${changedText}。`;
}

function isSameDataNeed(need: string, dataName: string): boolean {
  return need.includes(dataName) || dataName.includes(need);
}

function createPlanItems(context: IAgentContext): IPlanTemplateItem[] {
  if (context.intent === 'analysis') return createAnalysisPlanItems(context);
  if (context.intent === 'technical') return technicalPlanItems();
  if (context.intent === 'news-announcements') return newsAnnouncementPlanItems();
  if (context.intent === 'market-review') return marketReviewPlanItems();
  if (context.intent === 'board' || context.intent === 'industry-ranking' || context.intent === 'hot-concepts') {
    return boardPlanItems(context.intent);
  }
  if (context.intent === 'theme-attribution') return themeAttributionPlanItems();
  if (context.intent === 'daily-lhb') return dragonTigerPlanItems();
  if (context.intent === 'shareholder-chip') return shareholderChipPlanItems();
  if (context.intent === 'quote') return quotePlanItems();
  if (context.intent === 'chat') return chatPlanItems(context);
  return generalPlanItems(context.intent);
}

function createAnalysisPlanItems(context: IAgentContext): IPlanTemplateItem[] {
  const query = context.query;
  const asksSelection = /值得关注|能不能买|可以买|买入|选股|关注/.test(query);
  const asksSurgeReason = /为什么涨|为何涨|异动|拉升|大涨|涨停|驱动/.test(query);
  const asksTechnical = /技术|K线|均线|MACD|KDJ|RSI|支撑|压力|形态/.test(query);
  const asksRisk = /风险|利空|暴雷|监管|减持|跌破|回撤/.test(query);

  if (asksSurgeReason) {
    return [
      item('quote-strength', '确认涨幅和成交强度', '先判断价格异动是否伴随成交额和换手放大。', ['实时行情', '成交额', '换手率'], ['quote', 'market-data']),
      item('capital-flow', '核查资金流和特大单', '异动归因需要区分主力资金、主动买卖和盘口大单是否共振。', ['资金流', '特大单'], ['market-data', 'analysis-capital'], '资金流缺失时只保留量价和事件线索，不判断主力方向。'),
      item('theme-news', '核查题材、新闻与公告', '判断拉升是否有题材、公告或新闻催化，避免只凭涨幅归因。', ['新闻', '公告', '热点题材'], ['market-data', 'analysis-sentiment']),
      item('technical-confirm', '检查短线技术结构', '确认异动是否突破关键位或只是冲高回落。', ['K线', '技术指标'], ['market-data', 'analysis-technical']),
      item('risk-check', '排除事件和监管风险', '最终结论前需确认是否存在公告、减持、监管等未排除风险。', ['公告', '风险提示'], ['analysis-report']),
    ];
  }

  if (asksTechnical) return technicalPlanItems();

  if (asksRisk) {
    return [
      item('quote-risk', '检查价格和成交异常', '先确认是否已有放量下跌、冲高回落或跌破关键位迹象。', ['实时行情', 'K线', '成交额'], ['quote', 'market-data', 'analysis-technical']),
      item('capital-risk', '检查资金流出风险', '资金面恶化会降低短期判断置信度。', ['资金流', '特大单'], ['market-data', 'analysis-capital'], '资金流缺失时仅说明资金面不可判断。'),
      item('event-risk', '核查新闻公告和监管风险', '不能把新闻公告为空解释为没有风险，只能说明数据源未返回样本。', ['新闻', '公告'], ['market-data', 'analysis-sentiment']),
      item('chip-risk', '检查筹码松动与套牢压力', '筹码结构用于识别派发、获利盘和上方压力。', ['筹码集中度'], ['market-data', 'analysis-chip'], '筹码缺失时不输出筹码风险强弱判断。', true),
      item('final-risk', '汇总风险排除结论', '最终报告需要列明已排除和无法排除的风险。', ['证据链', '数据缺口'], ['analysis-report']),
    ];
  }

  const base = [
    item('quote-strength', asksSelection ? '评估行情强度' : '确认行情基础', '先检查最新价格、涨跌幅、成交额和换手，判断是否具备关注基础。', ['实时行情', '成交额', '换手率'], ['quote', 'market-data']),
    item('technical-structure', '检查K线和技术结构', '用趋势、均线、动能和支撑压力判断短期结构。', ['K线', '技术指标'], ['market-data', 'analysis-technical']),
    item('capital-flow', '检查资金流和盘口异动', '选股和关注价值需要观察主力资金、特大单与量价是否配合。', ['资金流', '特大单'], ['market-data', 'analysis-capital'], '资金流缺失时资金面降为低置信度。'),
    item('chip-structure', '检查筹码集中度和获利盘', '筹码结构用于判断主力控盘、套牢压力和获利盘风险。', ['筹码集中度'], ['market-data', 'analysis-chip'], '筹码缺失时本轮不输出筹码强弱判断。', true),
    item('sector-news-risk', '核查板块强度、新闻公告和监管风险', '避免忽略题材退潮、公告利空、减持监管等事件风险。', ['行业/概念强度', '新闻', '公告'], ['market-data', 'analysis-fundamental', 'analysis-sentiment']),
    item('history-similarity', '参考相似形态或历史表现', '结合历史日线观察类似量价结构后的短期表现，但不外推确定性结果。', ['历史日线'], ['market-data', 'analysis-technical'], '历史样本缺失时跳过相似形态判断。', true),
    item('final-check', '最终风险排除和置信度校准', '出报告前检查结论是否都有证据，缺口是否影响评级。', ['证据链', '数据缺口', '风险提示'], ['analysis-report']),
  ];

  return base;
}

function technicalPlanItems(): IPlanTemplateItem[] {
  return [
    item('quote-base', '确认行情基础', '技术判断需要先知道最新价格、涨跌幅和成交状态。', ['实时行情'], ['quote']),
    item('kline-trend', '检查K线趋势和量价结构', '用历史K线判断趋势、放量缩量、突破或跌破。', ['K线', '成交量'], ['market-data', 'technical', 'analysis-technical'], 'K线缺失时技术形态结论标记为不可判断。'),
    item('indicator-signal', '检查均线、MACD/KDJ/RSI', '用指标确认动能和超买超卖状态。', ['技术指标'], ['market-data', 'technical', 'analysis-technical'], '指标缺失时不输出具体金叉死叉判断。'),
    item('support-pressure', '评估支撑压力和风险位', '结合近期高低点给出观察框架，避免确定性买卖指令。', ['K线', '技术指标'], ['analysis-technical', 'technical']),
  ];
}

function newsAnnouncementPlanItems(): IPlanTemplateItem[] {
  return [
    item('quote-context', '确认股票行情背景', '新闻解读需要知道当前价格和波动背景。', ['实时行情'], ['quote']),
    item('news-samples', '拉取近期新闻样本', '判断消息催化和情绪温度必须基于真实新闻标题与摘要。', ['新闻'], ['news-announcements']),
    item('announcement-samples', '核查公告和监管事件', '公告为空不能视为无风险，只能标注数据源未返回。', ['公告'], ['news-announcements']),
    item('pros-cons', '区分利好、利空和中性信息', '报告需要基于证据引用而不是主观猜测。', ['新闻', '公告', '证据链'], ['news-analysis']),
    item('risk-disclosure', '输出事件风险和数据缺口', '最终结论必须说明未能排除的事件风险。', ['数据缺口', '风险提示'], ['news-analysis']),
  ];
}

function marketReviewPlanItems(): IPlanTemplateItem[] {
  return [
    item('index-breadth', '检查指数与涨跌家数', '市场复盘先确认整体强弱和赚钱效应。', ['指数', '涨跌家数'], ['market-review-data']),
    item('sector-flow', '检查板块和资金流向', '板块强度和资金流决定行情主线持续性。', ['板块排行', '资金流'], ['market-review-data']),
    item('limit-pool', '检查涨跌停池和情绪', '涨跌停、炸板和连板结构用于判断短线情绪。', ['涨停池', '跌停池'], ['market-review-data']),
    item('market-risk', '汇总市场风险提示', '复盘不能只写上涨主线，也要说明退潮和风险。', ['风险提示'], ['market-review-report']),
  ];
}

function boardPlanItems(intent: TAgentIntent): IPlanTemplateItem[] {
  const nodeId = intent === 'industry-ranking' ? 'industry-ranking-data' : intent === 'hot-concepts' ? 'hot-concepts-data' : 'board-data';
  return [
    item('board-strength', '检查板块强度和排序', '先确认板块或概念是否真实活跃。', ['板块排行', '涨跌幅'], [nodeId]),
    item('constituents', '观察成分股扩散', '板块持续性需要看成分股是否普遍走强。', ['成分股', '热门股'], [nodeId]),
    item('flow-sustainability', '检查资金流和持续性', '资金流缺失时不能判断主线持续性。', ['资金流'], [nodeId], '资金流为空时仅说明持续性证据不足。', true),
    item('board-risk', '提示板块轮动风险', '板块热点容易轮动，结论需保留风险提示。', ['风险提示'], [nodeId]),
  ];
}

function themeAttributionPlanItems(): IPlanTemplateItem[] {
  return [
    item('hot-stocks', '拉取强势股和热门题材', '先确认热点样本来自真实异动数据。', ['强势股', '热点题材'], ['theme-attribution-data']),
    item('theme-flow', '检查题材资金流和扩散', '题材归因需要看资金和个股扩散，而不是单只股票表现。', ['资金流', '板块'], ['theme-attribution-data']),
    item('theme-risk', '识别题材退潮风险', '输出需说明样本限制和持续性风险。', ['风险提示'], ['theme-attribution-data']),
  ];
}

function dragonTigerPlanItems(): IPlanTemplateItem[] {
  return [
    item('lhb-rank', '拉取龙虎榜净买入样本', '龙虎榜解读必须基于真实上榜明细。', ['龙虎榜'], ['daily-lhb-data']),
    item('lhb-reason', '识别上榜原因和资金结构', '不同上榜原因代表不同短线含义。', ['上榜原因', '净买额'], ['daily-lhb-data']),
    item('lhb-risk', '提示短线波动风险', '龙虎榜只代表局部席位行为，不能输出确定性买卖建议。', ['风险提示'], ['daily-lhb-data']),
  ];
}

function shareholderChipPlanItems(): IPlanTemplateItem[] {
  return [
    item('holder-change', '检查股东户数变化', '股东户数可辅助判断筹码集中或分散。', ['股东户数'], ['shareholder-chip-data']),
    item('chip-detail', '检查筹码集中度和成本区间', '筹码峰用于分析控盘、套牢和获利盘。', ['筹码集中度'], ['shareholder-chip-data'], '筹码数据缺失时不输出控盘判断。'),
    item('fund-flow', '结合资金面交叉验证', '筹码变化需要结合资金流确认。', ['资金流'], ['shareholder-chip-data'], '资金流缺失时标注资金面不可判断。', true),
  ];
}

function quotePlanItems(): IPlanTemplateItem[] {
  return [item('quote', '获取实时行情', '报价问题只需要确认真实行情和基础指标。', ['实时行情'], ['quote'])];
}

function chatPlanItems(context: IAgentContext): IPlanTemplateItem[] {
  if (!context.urls.length) return [];
  return [item('read-links', '读取用户提供的链接', '普通问答中先提取链接内容，再基于链接回答。', ['链接正文'], ['read-links'])];
}

function generalPlanItems(intent: TAgentIntent): IPlanTemplateItem[] {
  return [item(`${intent}-data`, '获取相关真实数据', '按当前意图调用已有真实数据服务并记录缺口。', ['真实数据'], [])];
}

function item(
  id: string,
  title: string,
  reason: string,
  dataNeeds: string[],
  relatedNodeIds: string[],
  fallbackStrategy?: string,
  optional?: boolean,
): IPlanTemplateItem {
  return { id, title, reason, dataNeeds, relatedNodeIds, fallbackStrategy, optional };
}

function createPlanSummary(intent: TAgentIntent, target?: string): string {
  const targetText = target ? ` ${target}` : '';
  if (intent === 'analysis') return `为了回答这个投研问题，我会先制定针对${targetText}的证据检查清单：`;
  if (intent === 'technical') return `为了做技术面判断，我需要先检查${targetText}的行情、K线和指标证据：`;
  if (intent === 'news-announcements') return `为了解读新闻公告影响，我会先核查${targetText}的真实新闻、公告和风险证据：`;
  if (intent === 'market-review') return '为了完成市场复盘，我会先检查指数、板块、资金和情绪数据：';
  if (intent === 'board' || intent === 'industry-ranking' || intent === 'hot-concepts') return '为了判断板块/题材强度，我会先核查排行、资金、成分扩散和风险：';
  return '本轮将按当前意图检查可用真实数据，并标注数据缺口：';
}

function createAssumptions(context: IAgentContext): string[] {
  const assumptions: string[] = [];
  if (context.symbol) assumptions.push(`分析标的为 ${context.symbol}。`);
  if (context.boardKeyword) assumptions.push(`板块/关键词为 ${context.boardKeyword}。`);
  if (context.urls.length) assumptions.push(`用户提供 ${context.urls.length} 个链接，链接内容仅作为补充证据。`);
  assumptions.push('所有行情、新闻、板块和图表结论必须来自真实数据或明确标注缺口。');
  return assumptions;
}
