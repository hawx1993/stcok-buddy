import type { AgentResultCard, AgentRunEvent, AnnouncementItem, ChatRequest, ChatResponse, ComplianceReview, EvidenceItem, HotFocusItem, IStockFundFlowSnapshot, KlinePoint, MarketNewsItem, StockDetail, StructuredAgentFinding, ToolCallRecord } from '../../../src/shared/types.js';
import { type DailyDragonTigerItem } from '../stock/stock-client.js';
import { executeDag, type DagNode } from './dag-executor.js';
import { fetchBoard } from './data-agent.js';
import { runReportAgent } from './report-agent.js';
import { runNewsAnalysisAgent } from './news-analysis-agent.js';
import { reviewComplianceStructured } from './compliance-critic.js';
import { runStockAnalysisOverview } from './stock-analysis-overview-agent.js';
import { runStockAnalysisSubAgent, stockAnalysisAgentNames, type StockAnalysisAgentName, type StockAnalysisResult } from './stock-analysis-agents.js';
import { runStoreCommand } from '../store-service.js';
import { callTool } from '../tools/tool-registry.js';
import type { HistoricalBarsResult } from '../market-data/types.js';
import { evidenceFromAnnouncements, evidenceFromChip, evidenceFromDragonTiger, evidenceFromFundFlow, evidenceFromHistoricalBars, evidenceFromHotFocus, evidenceFromNews, evidenceFromQuote, evidenceFromTechnical } from './evidence.js';

type Intent = 'quote' | 'technical' | 'analysis' | 'news-announcements' | 'theme-attribution' | 'daily-lhb' | 'board' | 'portfolio' | 'chat';

const slashCommands = [
  { name: '/综合投研报告', intent: 'analysis' as const, usage: '请输入股票代码或股票名称，例如：/综合投研报告 中公教育' },
  { name: '/新闻公告', intent: 'news-announcements' as const, usage: '请输入股票代码或股票名称，例如：/新闻公告 000858' },
  { name: '/题材归因', intent: 'theme-attribution' as const, usage: '今天哪些股票走强，主要是什么题材', allowEmptyArgs: true },
  { name: '/全市场龙虎榜', intent: 'daily-lhb' as const, usage: '今天龙虎榜哪些票净买入最多', allowEmptyArgs: true },
  { name: '/技术面分析', intent: 'analysis' as const, singleAgent: 'technical' as const, usage: '请输入股票代码或股票名称，例如：/技术面分析 000858' },
  { name: '/基本面分析', intent: 'analysis' as const, singleAgent: 'fundamental' as const, usage: '请输入股票代码或股票名称，例如：/基本面分析 000858' },
  { name: '/资金面分析', intent: 'analysis' as const, singleAgent: 'capital' as const, usage: '请输入股票代码或股票名称，例如：/资金面分析 000858' },
  { name: '/情绪面分析', intent: 'analysis' as const, singleAgent: 'sentiment' as const, usage: '请输入股票代码或股票名称，例如：/情绪面分析 000858' },
  { name: '/筹码分布', intent: 'analysis' as const, singleAgent: 'chip' as const, usage: '请输入股票代码或股票名称，例如：/筹码分布 000858' },
  { name: '/筹码分析', intent: 'analysis' as const, singleAgent: 'chip' as const, usage: '请输入股票代码或股票名称，例如：/筹码分析 000858' },
];

interface AgentContext {
  query: string;
  intent: Intent;
  urls: string[];
  symbol?: string;
  boardKeyword?: string;
  quote?: StockDetail;
  technical?: AgentResultCard;
  board?: AgentResultCard;
  kline?: KlinePoint[];
  news?: MarketNewsItem[];
  announcements?: AnnouncementItem[];
  hotFocus?: HotFocusItem[];
  chip?: unknown;
  fundFlow?: IStockFundFlowSnapshot;
  largeOrders?: HotFocusItem[];
  dailyDragonTiger?: DailyDragonTigerItem[];
  linkedPages?: Array<{ url: string; title?: string; content: string }>;
  analysisResults?: StockAnalysisResult[];
  analysisOverview?: string;
  themeAttribution?: string;
  singleAgent?: StockAnalysisAgentName;
  evidence: EvidenceItem[];
  toolCalls: ToolCallRecord[];
  findings: StructuredAgentFinding[];
  compliance?: ComplianceReview;
  emitEvent?: (event: AgentRunEvent) => void;
}

export async function runOrchestrator(request: ChatRequest, onToken?: (token: string) => void, onEvent?: (event: AgentRunEvent) => void): Promise<ChatResponse> {
  const storeResponse = await runStoreCommand(request.message);
  if (storeResponse) return storeResponse;

  const events: AgentRunEvent[] = [];
  const emitEvent = (event: AgentRunEvent) => {
    events.push(event);
    onEvent?.(event);
  };
  const command = parseSlashCommand(request.message);
  let intent = command?.intent ?? classifyIntent(request.message);
  const symbolText = command?.args ?? request.message;
  const urls = extractUrls(request.message);
  const resolvedSymbol = needsSymbol(intent) && symbolText ? await callTool('resolveStockSymbol', { query: symbolText }) : undefined;
  let symbol = typeof resolvedSymbol?.output === 'string' ? resolvedSymbol.output : (resolvedSymbol?.output as { symbol?: string } | undefined)?.symbol;
  if (!command && intent === 'chat' && isPossibleStockOnlyQuery(symbolText)) {
    const record = await callTool('resolveStockSymbol', { query: symbolText });
    const candidateOutput = record.output as { symbol?: string } | undefined;
    const candidate = candidateOutput?.symbol ?? (typeof record.output === 'string' ? record.output : '');
    if (/^\d{6}$/.test(candidate)) {
      intent = 'analysis';
      symbol = candidate;
    }
  }
  const context: AgentContext = {
    query: request.message,
    intent,
    urls,
    symbol,
    boardKeyword: extractBoardKeyword(request.message),
    singleAgent: command?.singleAgent,
    evidence: [],
    toolCalls: [],
    findings: [],
    emitEvent,
  };

  if (command && !command.args && !command.allowEmptyArgs) return commandUsageResponse(request, command.usage);

  emitEvent(command ? {
    type: 'command_detected',
    title: 'Command 识别',
    message: `${command.name}${command.args ? ` ${command.args}` : ''}`,
    command: { name: command.name, args: command.args, mode: command.singleAgent ? '单 Agent 分析' : '多 Agent 协同分析' },
  } : {
    type: 'intent_detected',
    title: '意图识别',
    message: `${intentLabel(intent)}${symbol ? `：${symbol}` : ''}`,
    intent: { name: intentLabel(intent), target: symbol ?? context.boardKeyword, mode: intent === 'analysis' ? '多 Agent 协同分析' : '单流程分析' },
  });

  const nodes = buildDag(context, onToken);
  emitEvent({
    type: 'plan_created',
    title: '分析计划',
    message: `1. 识别用户意图\n2. 解析股票代码 / 板块 / 关键词\n3. 调用必要工具获取数据\n4. 分配子 Agent 专项分析\n5. 汇总证据并生成投研结论`,
    progress: { current: 0, total: nodes.length },
  });

  let completedSteps = 0;
  await executeDag(nodes, context, (step) => {
    if (step.status === 'completed' || step.status === 'error') completedSteps += 1;
    emitEvent({
      type: step.status === 'running' ? 'subagent_started' : 'subagent_completed',
      title: step.status === 'running' ? '子 Agent 启动' : '子 Agent 结果',
      message: step.description,
      step,
      subAgent: { name: step.agent, description: step.description, status: step.status, summary: step.detail },
      progress: { current: completedSteps, total: nodes.length },
    });
  });

  const draft = context.singleAgent && context.analysisResults?.[0]
    ? context.analysisResults[0].content
    : context.themeAttribution ?? context.analysisOverview ?? await runReportAgent({
      query: buildReportQuery(request.message, context.linkedPages),
      intent,
      quote: context.quote,
      technical: context.technical,
      board: context.board,
      news: context.news,
      announcements: context.announcements,
      linkedPages: context.linkedPages,
    }, onToken);
  const review = reviewComplianceStructured({ text: draft, evidence: context.evidence, findings: context.findings });
  context.compliance = review;
  const content = review.revisedText;
  const result = context.board ?? enrichTechnicalCard(context.technical, context.quote) ?? quoteToCard(context.quote);

  emitEvent({
    type: 'summary_completed',
    title: '汇总完成',
    message: `工具调用：${context.toolCalls.length} 次\n子 Agent：${(context.analysisResults?.length ?? 0) || nodes.length} 个\n有效证据：${dedupeEvidence(context.evidence).length} 条\n数据缺口：${dataGaps(context).join('、') || '无明确缺口'}`,
    evidence: dedupeEvidence(context.evidence),
  });
  emitEvent({ type: 'final_answer', title: '最终结论', message: content, result, stock: context.quote, evidence: context.evidence, findings: context.findings });

  return {
    events,
    message: {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content,
      createdAt: new Date().toISOString(),
      runEvents: events,
      steps: events.map((event) => event.step).filter((step): step is NonNullable<typeof step> => Boolean(step)),
      result,
      evidence: context.evidence,
      findings: context.findings,
      toolCalls: context.toolCalls,
      compliance: context.compliance,
    },
  };
}

function parseSlashCommand(query: string) {
  const text = query.trim();
  const command = slashCommands.find((item) => text === item.name || text.startsWith(`${item.name} `));
  if (!command) return undefined;
  return { ...command, args: text.slice(command.name.length).trim() };
}

function commandUsageResponse(_request: ChatRequest, usage: string): ChatResponse {
  const message: ChatResponse['message'] = {
    id: `assistant-${Date.now()}`,
    role: 'assistant',
    content: usage,
    createdAt: new Date().toISOString(),
  };
  return { events: [{ type: 'final_answer', message: usage }], message };
}

function buildDag(context: AgentContext, onToken?: (token: string) => void): DagNode<AgentContext>[] {
  const linkNodes: DagNode<AgentContext>[] = context.urls.length ? [{
    id: 'read-links',
    agent: 'WebTool',
    description: `读取用户提供的 ${context.urls.length} 个链接`,
    run: async (ctx) => {
      const pages = await Promise.all(ctx.urls.map((url) => runContextTool<{ url: string; title?: string; content: string } | undefined>(ctx, 'readUrl', { url }, () => undefined)));
      ctx.linkedPages = pages.filter((page): page is { url: string; title?: string; content: string } => Boolean(page));
      ctx.evidence.push(...ctx.linkedPages.map((page, index) => ({
        id: `url-${index + 1}`,
        source: 'url' as const,
        title: page.title ?? page.url,
        summary: page.content.slice(0, 240),
        url: page.url,
        raw: { title: page.title },
      })));
    },
  }] : [];

  if (context.intent === 'board') {
    return [
      ...linkNodes,
      {
        id: 'board-data',
        agent: 'DataAgent',
        description: `拉取 ${context.boardKeyword ?? '相关'} 板块与资金流数据`,
        run: async (ctx) => {
          ctx.board = await fetchBoard(ctx.boardKeyword ?? '资金');
        },
      },
    ];
  }

  if (context.intent === 'portfolio') {
    return [
      ...linkNodes,
      {
        id: 'memory-placeholder',
        agent: 'MemoryAgent',
        description: '检查本地持仓记忆（MVP：提示用户后续可录入持仓）',
        run: async (ctx) => {
          ctx.board = {
            title: '持仓记忆',
            narrative: '当前 MVP 已预留持仓记忆接口。你可以在后续版本录入持仓成本、数量，系统将基于实时行情计算浮盈亏。',
          };
        },
      },
    ];
  }

  if (context.intent === 'theme-attribution') {
    return [
      ...linkNodes,
      {
        id: 'theme-attribution-data',
        agent: 'a-stock-data',
        description: '拉取今日强势股、热点题材与资金流数据',
        run: async (ctx) => {
          const [surge, sector, flow] = await Promise.all([
            runContextTool<HotFocusItem[]>(ctx, 'getHotFocus', { tab: 'surge' }, () => []),
            runContextTool<HotFocusItem[]>(ctx, 'getHotFocus', { tab: 'sector' }, () => []),
            runContextTool<HotFocusItem[]>(ctx, 'getHotFocus', { tab: 'flow' }, () => []),
          ]);
          ctx.hotFocus = [...surge, ...sector, ...flow];
          ctx.evidence.push(...evidenceFromHotFocus(ctx.hotFocus));
          ctx.board = themeAttributionToCard(surge, sector, flow);
          ctx.themeAttribution = ctx.board.narrative;
        },
      },
    ];
  }

  if (context.intent === 'daily-lhb') {
    return [
      ...linkNodes,
      {
        id: 'daily-lhb-data',
        agent: 'a-stock-data',
        description: '拉取全市场龙虎榜净买入排名',
        run: async (ctx) => {
          ctx.dailyDragonTiger = await runContextTool<DailyDragonTigerItem[]>(ctx, 'getDragonTiger', { limit: 500 }, () => []);
          ctx.evidence.push(...evidenceFromDragonTiger(ctx.dailyDragonTiger));
          ctx.board = dailyDragonTigerToCard(ctx.dailyDragonTiger);
          ctx.analysisOverview = ctx.board.narrative;
        },
      },
    ];
  }

  if (!context.symbol) {
    return [
      ...linkNodes,
      {
        id: 'chat',
        agent: 'Orchestrator',
        description: '未识别到股票代码，转为普通投研问答',
        run: async () => undefined,
      },
    ];
  }

  const nodes: DagNode<AgentContext>[] = [
    ...linkNodes,
    {
      id: 'quote',
      agent: 'DataAgent',
      description: `获取 ${context.symbol} 实时行情`,
      run: async (ctx) => {
        ctx.quote = await runContextTool<StockDetail | undefined>(ctx, 'getStockQuote', { symbol: ctx.symbol! }, () => undefined);
        ctx.evidence.push(...evidenceFromQuote(ctx.quote));
      },
    },
  ];

  if (context.intent === 'news-announcements') {
    nodes.push(
      {
        id: 'news-announcements',
        agent: 'a-stock-data',
        description: `拉取 ${context.symbol} 最近新闻和公告`,
        dependsOn: ['quote'],
        run: async (ctx) => {
          const data = await runContextTool<{ news: MarketNewsItem[]; announcements: AnnouncementItem[] }>(ctx, 'getStockNewsAnnouncements', { symbol: ctx.symbol!, limit: 10 }, () => ({ news: [], announcements: [] }));
          ctx.news = data.news;
          ctx.announcements = data.announcements;
          ctx.evidence.push(...evidenceFromNews(ctx.news), ...evidenceFromAnnouncements(ctx.announcements));
          ctx.board = newsAnnouncementsToCard(ctx.quote, data.news, data.announcements);
        },
      },
      {
        id: 'news-analysis',
        agent: 'NewsAnalysisAgent',
        description: `解读 ${context.symbol} 新闻公告利好利空`,
        dependsOn: ['news-announcements'],
        run: async (ctx) => {
          ctx.analysisOverview = await runNewsAnalysisAgent({ stock: ctx.quote, news: ctx.news, announcements: ctx.announcements }, onToken);
        },
      },
    );
    return nodes;
  }

  if (context.intent === 'analysis') {
    const analysisAgents = context.singleAgent
      ? stockAnalysisAgentNames().filter((agent) => agent.name === context.singleAgent)
      : stockAnalysisAgentNames();

    const needsLargeOrders = analysisAgents.some((agent) => agent.name === 'capital');
    const needsChip = analysisAgents.some((agent) => agent.name === 'chip');

    nodes.push(
      {
        id: 'market-data',
        agent: 'DataAgent',
        description: `拉取 ${context.symbol} K线、指标与新闻样本`,
        dependsOn: ['quote'],
        run: async (ctx) => {
          const [historical, technical, news, largeOrders, chip, fundFlow] = await Promise.all([
            runContextTool<HistoricalBarsResult>(ctx, 'getHistoricalDailyBars', { symbol: ctx.symbol!, limit: 120, adjustType: 'qfq' }, () => ({ data: [], meta: { source: 'fallback', storage: 'local', freshness: 'fallback', isComplete: false, warnings: ['历史日线获取失败'], adjustType: 'qfq' } })),
            runContextTool<AgentResultCard | undefined>(ctx, 'getTechnicalIndicators', { symbol: ctx.symbol! }, () => undefined),
            runContextTool<MarketNewsItem[]>(ctx, 'getMarketNews', { query: ctx.quote?.name ?? ctx.symbol, page: 1, pageSize: 10 }, () => []),
            needsLargeOrders ? runContextTool<HotFocusItem[]>(ctx, 'getHotFocus', { tab: 'surge' }, () => []) : Promise.resolve([]),
            needsChip ? runContextTool<unknown>(ctx, 'getStockChipDistribution', { symbol: ctx.symbol! }, () => undefined) : Promise.resolve(undefined),
            needsLargeOrders ? runContextTool<IStockFundFlowSnapshot | undefined>(ctx, 'getStockFundFlowSnapshot', { symbol: ctx.symbol! }, () => undefined) : Promise.resolve(undefined),
          ]);
          const kline = historical.data;
          ctx.kline = kline;
          ctx.technical = technical?.chart ? technical : technical ? { ...technical, chart: { type: 'kline', data: kline } } : undefined;
          ctx.news = news;
          ctx.chip = chip;
          ctx.fundFlow = fundFlow;
          ctx.largeOrders = filterLargeOrders(largeOrders, ctx.symbol!);
          ctx.evidence.push(...evidenceFromHistoricalBars(ctx.symbol!, historical), ...evidenceFromTechnical(ctx.symbol!, ctx.technical), ...evidenceFromNews(news), ...evidenceFromHotFocus(ctx.largeOrders), ...evidenceFromFundFlow(ctx.symbol!, fundFlow));
          if (needsChip) ctx.evidence.push(...evidenceFromChip(ctx.symbol!, ctx.chip));
        },
      },
      ...analysisAgents.map((agent) => ({
        id: `analysis-${agent.name}`,
        agent: agent.label,
        description: `${agent.label}：${context.symbol}`,
        dependsOn: ['market-data'],
        run: async (ctx: AgentContext) => {
          const shouldStream = Boolean(context.singleAgent);
          const result = await runStockAnalysisSubAgent(agent.name, stockAnalysisInput(ctx), shouldStream ? onToken : undefined);
          ctx.analysisResults = [...(ctx.analysisResults ?? []), result];
          ctx.evidence.push(...result.output.evidence);
          ctx.findings.push(...result.output.findings);
        },
      })),
    );

    if (!context.singleAgent) {
      nodes.push({
        id: 'analysis-overview',
        agent: '汇总分析Agent',
        description: `汇总 ${context.symbol} 五维分析结果`,
        dependsOn: analysisAgents.map((agent) => `analysis-${agent.name}`),
        run: async (ctx) => {
          ctx.analysisOverview = await runStockAnalysisOverview(stockAnalysisInput(ctx), ctx.analysisResults ?? [], onToken);
        },
      });
    }
  }

  if (context.intent === 'technical') {
    nodes.push({
      id: 'technical',
      agent: 'AnalysisAgent',
      description: `计算 ${context.symbol} MACD/KDJ/均线与信号`,
      dependsOn: ['quote'],
      run: async (ctx) => {
        ctx.technical = await runContextTool<AgentResultCard | undefined>(ctx, 'getTechnicalIndicators', { symbol: ctx.symbol! }, () => undefined);
        ctx.evidence.push(...evidenceFromTechnical(ctx.symbol!, ctx.technical));
      },
    });
  }

  return nodes;
}

function extractUrls(text: string) {
  return [...new Set([...text.matchAll(/https?:\/\/[^\s，。；、)）]+/g)].map((match) => match[0]))];
}

function buildReportQuery(query: string, pages?: Array<{ url: string; title?: string; content: string }>) {
  if (!pages?.length) return query;
  let used = 0;
  const blocks = pages.map((page, index) => {
    const remaining = Math.max(0, 8000 - used);
    const content = page.content.slice(0, Math.min(4000, remaining));
    used += content.length;
    return ` ${index + 1}. 标题：${page.title ?? '未提取'}\nURL：${page.url}\n正文摘录：\n${content}`;
  }).filter((block) => block.trim());
  return `${query}\n\n用户提供的链接内容：\n${blocks.join('\n\n')}`;
}

function classifyIntent(query: string): Intent {
  if (/全市场龙虎榜|龙虎榜.*净买入|净买入.*龙虎榜/.test(query)) return 'daily-lhb';
  if (/题材归因|哪些股票走强|主要是什么题材/.test(query)) return 'theme-attribution';
  if (hasStock(query) && /新闻|公告/.test(query)) return 'news-announcements';
  if (/持仓|我买|成本|盈亏|记住/.test(query)) return 'portfolio';
  if (/板块|行业|选股|资金流|北向|热点/.test(query)) return 'board';
  if (/MACD|KDJ|K线|均线|技术|走势|金叉|死叉/.test(query)) return 'technical';
  if (/股价|行情|现价|多少|涨跌/.test(query)) return 'quote';
  if (hasStock(query) && (/分析|诊股|个股分析|帮我看看|看看/.test(query) || isStockOnlyQuery(query))) return 'analysis';
  return 'chat';
}

function hasStock(query: string) {
  return /\d{6}|[一-龥]{2,}(?:股份|教育|银行|证券|科技|时代|茅台|五粮液|老窖)/.test(query);
}

function isStockOnlyQuery(query: string) {
  return /^\s*(?:\d{6}|[一-龥]{2,}(?:股份|教育|银行|证券|科技|时代|茅台|五粮液|老窖))\s*$/.test(query);
}

function isPossibleStockOnlyQuery(query: string) {
  return /^\s*(?:\d{6}|[A-Za-z0-9一-龥]{2,12})\s*$/.test(query);
}

function needsSymbol(intent: Intent) {
  return intent === 'quote' || intent === 'technical' || intent === 'analysis' || intent === 'news-announcements';
}

function intentLabel(intent: Intent) {
  return { quote: '行情查询', technical: '技术诊股', analysis: '五维个股分析', 'news-announcements': '新闻公告', 'theme-attribution': '题材归因', 'daily-lhb': '全市场龙虎榜', board: '板块分析', portfolio: '持仓管理', chat: '普通问答' }[intent];
}

function stockAnalysisInput(ctx: AgentContext) {
  return {
    query: buildReportQuery(ctx.query, ctx.linkedPages),
    symbol: ctx.symbol!,
    stockLabel: ctx.quote?.name ?? ctx.symbol!,
    quote: ctx.quote,
    technical: ctx.technical,
    kline: ctx.kline,
    news: ctx.news,
    chip: ctx.chip,
    fundFlow: ctx.fundFlow,
    largeOrders: ctx.largeOrders,
    evidence: dedupeEvidence(ctx.evidence),
  };
}

async function runContextTool<T>(ctx: AgentContext, name: string, input: unknown, fallback: () => T): Promise<T> {
  const startedAt = new Date().toISOString();
  ctx.emitEvent?.({
    type: 'tool_started',
    title: '工具调用',
    message: `正在执行 ${name}`,
    toolCall: { id: `tool-pending-${startedAt}-${name}`, toolName: name, input, inputSummary: summarizeEventValue(input), startedAt },
    tool: { name, inputSummary: summarizeEventValue(input), status: 'running' },
  });
  const record = await callTool(name, input);
  ctx.toolCalls.push(record);
  ctx.emitEvent?.({
    type: record.error ? 'tool_failed' : 'tool_completed',
    title: record.error ? '工具失败' : '工具结果',
    message: record.error ? `${name} 失败，已使用兜底策略继续分析` : `${name} completed`,
    toolCall: record,
    tool: { name, inputSummary: record.inputSummary, outputSummary: record.outputSummary, status: record.error ? 'failed' : 'success', error: record.error },
  });
  if (!record.error) ctx.emitEvent?.({
    type: 'evidence_added',
    title: '证据更新',
    message: `${name} 返回可用数据`,
    evidence: dedupeEvidence(ctx.evidence),
  });
  return record.error ? fallback() : record.output as T;
}

function summarizeEventValue(value: unknown) {
  if (value === undefined) return undefined;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.replace(/\s+/g, ' ').slice(0, 300);
}

function dataGaps(ctx: AgentContext) {
  const gaps: string[] = [];
  if (needsSymbol(ctx.intent) && !ctx.quote) gaps.push('行情');
  if ((ctx.intent === 'analysis' || ctx.intent === 'technical') && !ctx.technical) gaps.push('技术指标');
  if ((ctx.intent === 'analysis' || ctx.intent === 'news-announcements') && !ctx.news?.length) gaps.push('新闻');
  if (ctx.intent === 'news-announcements' && !ctx.announcements?.length) gaps.push('公告');
  return gaps;
}

function dedupeEvidence(items: EvidenceItem[]) {
  return items.filter((item, index, arr) => arr.findIndex((other) => other.id === item.id) === index);
}

function filterLargeOrders(items: HotFocusItem[], symbol: string) {
  return items.filter((item) => item.code === symbol && /特大单/.test(`${item.description ?? ''}${item.tag ?? ''}${item.amount ?? ''}`));
}

function extractBoardKeyword(query: string) {
  const match = query.match(/([一-龥A-Za-z0-9]+)(板块|行业)/);
  if (match) return match[1];
  if (query.includes('北向')) return '北向资金';
  if (query.includes('资金')) return '资金流';
  return '热点';
}

function enrichTechnicalCard(card?: AgentResultCard, quote?: StockDetail): AgentResultCard | undefined {
  if (!card) return undefined;
  return quote ? { ...card, stocks: [quote] } : card;
}

function quoteToCard(quote?: StockDetail): AgentResultCard | undefined {
  if (!quote) return undefined;
  return {
    title: `${quote.name}（${quote.code}）行情`,
    subtitle: `${quote.exchange ?? 'A股'} · ${quote.changePercent ?? '--'}`,
    metrics: [
      { label: '现价', value: String(quote.price ?? '--') },
      { label: '涨跌幅', value: quote.changePercent ?? '--', tone: quote.changePercent?.startsWith('-') ? 'down' : 'up' },
      { label: 'PE', value: String(quote.pe ?? '--') },
      { label: '成交额', value: quote.turnover ?? '--' },
    ],
    narrative: quote.summary,
    stocks: [quote],
  };
}

function themeAttributionToCard(surge: HotFocusItem[], sectors: HotFocusItem[], flows: HotFocusItem[]): AgentResultCard {
  const strong = surge.filter((item) => item.type !== 'plummet').slice(0, 12);
  const weak = surge.filter((item) => item.type === 'plummet').slice(0, 5);
  const hotSectors = sectors.slice(0, 8);
  const flowLeaders = flows.slice(0, 6);
  const themes = [...new Set([...hotSectors.map(themeName), ...flowLeaders.map(themeName)].filter(Boolean))].slice(0, 6);
  const conclusion = strong.length >= 8 && hotSectors.length >= 3 ? '🟢 偏利好' : strong.length ? '🟡 中性' : '🔴 偏利空';
  const narrative = [
    '# 题材归因',
    '',
    '## 📰 核心事件',
    strong.length ? strong.slice(0, 8).map((item) => `- 📈 ${item.name ?? item.title}${item.code ? `（${item.code}）` : ''}：${[item.changePercent, item.description || item.tag].filter(Boolean).join('，') || '今日表现较强。'}`).join('\n') : '- 今日暂未检索到明确强势股样本。',
    '',
    '## ✅ 利好因素',
    themes.length ? themes.map((name) => `- 🌐 ${name}：在热点板块或资金流榜单中靠前，说明题材关注度较高。`).join('\n') : '- 🟡 暂未形成清晰题材共振，更多是个股层面的短线异动。',
    flowLeaders.length ? `- 💰 资金线索：${flowLeaders.slice(0, 3).map((item) => `${themeName(item)}${item.amount ? ` ${item.amount}` : ''}`).join('、')}。` : '',
    '',
    '## ⚠️ 利空因素',
    weak.length ? weak.map((item) => `- 📉 ${item.name ?? item.title}：${item.description || item.tag || '出现走弱或负反馈，需要警惕题材分化。'}`).join('\n') : '- ⚡ 若强势股主要来自涨停池或异动池，持续性仍需看封单、换手和次日承接。',
    '',
    '## 📈 短期影响',
    strong.length ? `- 📅 今日强势样本集中在 ${themes.slice(0, 3).join('、') || '局部热点'}，短线交易重点看龙头股是否继续扩散到后排。` : '- 📅 热点强度不足，短期更适合观察资金是否重新聚焦。',
    '',
    '## 🏛️ 中长期影响',
    themes.length ? `- 🗓️ 只有同时具备产业逻辑、业绩兑现和资金持续流入的方向，才可能从短线题材演化为中期主线；当前重点跟踪 ${themes.slice(0, 3).join('、')}。` : '- 🗓️ 当前数据不足以支持中长期主线判断，需继续跟踪板块资金和公告验证。',
    '',
    '## 🚨 风险提示',
    '- ⚡ 题材归因基于盘中/当日公开行情与资金榜单，可能受数据源延迟、停牌、复牌和涨跌停制度影响。',
    '- 📜 若题材依赖政策、订单或公告催化，需等待正式公告和后续业绩验证。',
    '',
    '## 🎯 综合结论',
    `${conclusion}：今日走强股票主要围绕 ${themes.join('、') || '局部热点'} 展开。以上内容来自 a-stock-data 行情、热点和资金流公开接口，仅供研究参考。`,
  ].filter(Boolean).join('\n');

  return {
    title: '题材归因',
    subtitle: `强势股 ${strong.length} 只 · 热点题材 ${themes.length} 个`,
    metrics: [
      { label: '强势股', value: `${strong.length}只`, tone: strong.length ? 'up' : 'neutral' },
      { label: '热点题材', value: `${themes.length}个`, tone: themes.length ? 'up' : 'neutral' },
      { label: '资金榜', value: `${flowLeaders.length}条` },
    ],
    rows: [
      ...strong.slice(0, 10).map((item) => ({ 类型: '强势股', 名称: item.name ?? item.title, 代码: item.code ?? '', 涨跌幅: item.changePercent ?? '', 归因: item.description || item.tag || '' })),
      ...hotSectors.slice(0, 6).map((item) => ({ 类型: '热点题材', 名称: themeName(item), 代码: item.tag ?? item.code ?? '', 涨跌幅: item.changePercent ?? '', 归因: item.description || '' })),
    ],
    narrative,
  };
}

function dailyDragonTigerToCard(items: DailyDragonTigerItem[]): AgentResultCard {
  const date = items[0]?.date ?? new Date().toISOString().slice(0, 10);
  const leaders = items.filter((item) => item.netBuy > 0).slice(0, 10);
  const top = leaders.slice(0, 5);
  const conclusion = leaders.length ? '🟢 偏利好' : items.length ? '🟡 中性' : '🟡 中性';
  const narrative = [
    '# 全市场龙虎榜',
    '',
    '## 📰 核心事件',
    items.length ? `- 📄 ${date} 龙虎榜共检索到 ${items.length} 条上榜记录，按净买入额降序展示。` : '- 📄 暂未检索到今日龙虎榜数据，可能是非交易日或盘后数据尚未更新。',
    leaders.length ? top.map((item, index) => `- 💰 ${index + 1}. ${item.name}（${item.code}）：净买入 ${formatMoney(item.netBuy)}，${item.reason || '上榜原因待补充'}。`).join('\n') : '',
    '',
    '## ✅ 利好因素',
    leaders.length ? `- 💰 前 ${Math.min(leaders.length, 10)} 只净买入个股合计 ${formatMoney(leaders.reduce((sum, item) => sum + item.netBuy, 0))}，说明部分短线资金集中度较高。` : '- 🟡 当前未看到明确净买入领先样本，资金方向偏观望。',
    top.length ? `- 📈 涨跌幅靠前样本：${top.map((item) => `${item.name}${item.changePercent === undefined ? '' : ` ${formatSignedPercent(item.changePercent)}`}`).join('、')}。` : '',
    '',
    '## ⚠️ 利空因素',
    items.some((item) => item.netBuy < 0) ? `- 📉 仍有 ${items.filter((item) => item.netBuy < 0).length} 条记录为净卖出，龙虎榜内部资金分歧不能忽视。` : '- ⚡ 龙虎榜资金通常偏短线，净买入不等于趋势确认。',
    '- ⚡ 高换手上榜个股波动较大，次日承接比当日净买入更关键。',
    '',
    '## 📈 短期影响',
    leaders.length ? `- 📅 短线重点观察 ${top.map((item) => item.name).join('、')} 的开盘溢价、成交额延续和席位回流情况。` : '- 📅 数据不足时，短期更适合等待盘后龙虎榜更新后再判断。',
    '',
    '## 🏛️ 中长期影响',
    '- 🗓️ 龙虎榜反映交易结构而非基本面趋势，中长期判断仍需结合公告、行业景气和业绩兑现。',
    '',
    '## 🚨 风险提示',
    '- ⚡ 龙虎榜数据来自东财数据中心公开接口，存在盘后更新延迟、非交易日为空、字段调整等风险。',
    '- 📜 本结果仅用于投研线索筛选，不构成投资建议。',
    '',
    '## 🎯 综合结论',
    `${conclusion}：${leaders.length ? `今日龙虎榜净买入主要集中在 ${top.map((item) => item.name).join('、')}。` : '当前未形成清晰的龙虎榜净买入主线。'}后续重点看资金是否连续回流。`,
  ].filter(Boolean).join('\n');

  return {
    title: '全市场龙虎榜',
    subtitle: `${date} · 净买入前 ${leaders.length || 0} 条`,
    metrics: [
      { label: '上榜记录', value: `${items.length}条` },
      { label: '净买入', value: `${leaders.length}条`, tone: leaders.length ? 'up' : 'neutral' },
      { label: 'TOP净买', value: leaders[0] ? formatMoney(leaders[0].netBuy) : '--', tone: leaders[0] ? 'up' : 'neutral' },
    ],
    rows: items.slice(0, 20).map((item, index) => ({
      排名: index + 1,
      代码: item.code,
      名称: item.name,
      上榜原因: item.reason,
      收盘价: item.close ?? '--',
      涨跌幅: item.changePercent === undefined ? '--' : formatSignedPercent(item.changePercent),
      净买入: formatMoney(item.netBuy),
      买入: formatMoney(item.buy),
      卖出: formatMoney(item.sell),
      换手率: item.turnover === undefined ? '--' : `${item.turnover.toFixed(2)}%`,
    })),
    narrative,
  };
}

function formatMoney(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  const sign = num > 0 ? '+' : num < 0 ? '-' : '';
  const abs = Math.abs(num);
  if (abs >= 100000000) return `${sign}${(abs / 100000000).toFixed(2)}亿`;
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(2)}万`;
  return `${sign}${abs.toFixed(0)}`;
}

function formatSignedPercent(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function themeName(item: HotFocusItem) {
  return item.name ?? item.title.replace(/\s+\d{6}$/, '');
}

function newsAnnouncementsToCard(quote: StockDetail | undefined, news: MarketNewsItem[], announcements: AnnouncementItem[]): AgentResultCard {
  const title = quote ? `${quote.name}（${quote.code}）新闻公告` : '新闻公告';
  return {
    title,
    subtitle: `新闻 ${news.length} 条 · 公告 ${announcements.length} 条`,
    metrics: [
      { label: '新闻', value: `${news.length}条` },
      { label: '公告', value: `${announcements.length}条` },
    ],
    rows: [
      ...news.map((item) => ({ 类型: '新闻', 时间: item.time, 来源: item.source ?? '', 标题: item.title, 链接: item.url ?? '' })),
      ...announcements.map((item) => ({ 类型: '公告', 时间: item.date, 来源: item.type, 标题: item.title, 链接: item.url })),
    ],
    narrative: [
      `### ${title}`,
      '',
      '#### 近期新闻',
      news.length ? news.map((item) => `- ${item.time || '--'}｜${item.source || '东方财富'}｜${item.title}${item.content ? `：${item.content}` : ''}${item.url ? ` [查看](${item.url})` : ''}`).join('\n') : '- 暂无可用新闻。',
      '',
      '#### 近期公告',
      announcements.length ? announcements.map((item) => `- ${item.date || '--'}｜${item.type || '公告'}｜${item.title}${item.url ? ` [查看](${item.url})` : ''}`).join('\n') : '- 暂无可用公告。',
      '',
      '以上内容来自 a-stock-data 指定的东财个股新闻与巨潮公告公开接口，仅供研究参考，不构成投资建议。',
    ].join('\n'),
    stocks: quote ? [quote] : undefined,
  };
}
