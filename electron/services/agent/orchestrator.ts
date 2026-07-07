import type { AgentResultCard, AgentRunEvent, AnnouncementItem, ChatRequest, ChatResponse, HotFocusItem, KlinePoint, MarketNewsItem, StockDetail } from '../../../src/shared/types.js';
import { getKline, listHotFocus, resolveASymbol } from '../stock/stock-client.js';
import { listMarketNews, listStockNewsAnnouncements } from '../stock/news-client.js';
import { executeDag, type DagNode } from './dag-executor.js';
import { fetchBoard, fetchQuote } from './data-agent.js';
import { runTechnicalAnalysis } from './analysis-agent.js';
import { runReportAgent } from './report-agent.js';
import { runNewsAnalysisAgent } from './news-analysis-agent.js';
import { reviewCompliance } from './risk-agent.js';
import { runStockAnalysisOverview } from './stock-analysis-overview-agent.js';
import { runStockAnalysisSubAgent, stockAnalysisAgentNames, type StockAnalysisAgentName, type StockAnalysisResult } from './stock-analysis-agents.js';

type Intent = 'quote' | 'technical' | 'analysis' | 'news-announcements' | 'theme-attribution' | 'board' | 'portfolio' | 'chat';

const slashCommands = [
  { name: '/综合投研报告', intent: 'analysis' as const, usage: '请输入股票代码或股票名称，例如：/综合投研报告 中公教育' },
  { name: '/新闻公告', intent: 'news-announcements' as const, usage: '请输入股票代码或股票名称，例如：/新闻公告 000858' },
  { name: '/题材归因', intent: 'theme-attribution' as const, usage: '今天哪些股票走强，主要是什么题材', allowEmptyArgs: true },
  { name: '/技术面分析', intent: 'analysis' as const, singleAgent: 'technical' as const, usage: '请输入股票代码或股票名称，例如：/技术面分析 000858' },
  { name: '/基本面分析', intent: 'analysis' as const, singleAgent: 'fundamental' as const, usage: '请输入股票代码或股票名称，例如：/基本面分析 000858' },
  { name: '/资金面分析', intent: 'analysis' as const, singleAgent: 'capital' as const, usage: '请输入股票代码或股票名称，例如：/资金面分析 000858' },
  { name: '/情绪面分析', intent: 'analysis' as const, singleAgent: 'sentiment' as const, usage: '请输入股票代码或股票名称，例如：/情绪面分析 000858' },
  { name: '/龙虎榜分析', intent: 'analysis' as const, singleAgent: 'lhb' as const, usage: '请输入股票代码或股票名称，例如：/龙虎榜分析 000858' },
];

interface AgentContext {
  query: string;
  intent: Intent;
  symbol?: string;
  boardKeyword?: string;
  quote?: StockDetail;
  technical?: AgentResultCard;
  board?: AgentResultCard;
  kline?: KlinePoint[];
  news?: MarketNewsItem[];
  announcements?: AnnouncementItem[];
  hotFocus?: HotFocusItem[];
  analysisResults?: StockAnalysisResult[];
  analysisOverview?: string;
  themeAttribution?: string;
  singleAgent?: StockAnalysisAgentName;
}

export async function runOrchestrator(request: ChatRequest, onToken?: (token: string) => void): Promise<ChatResponse> {
  const events: AgentRunEvent[] = [];
  const command = parseSlashCommand(request.message);
  let intent = command?.intent ?? classifyIntent(request.message);
  const symbolText = command?.args ?? request.message;
  let symbol = needsSymbol(intent) && symbolText ? await resolveASymbol(symbolText) : undefined;
  if (!command && intent === 'chat' && isPossibleStockOnlyQuery(symbolText)) {
    const candidate = await resolveASymbol(symbolText);
    if (/^\d{6}$/.test(candidate)) {
      intent = 'analysis';
      symbol = candidate;
    }
  }
  const context: AgentContext = {
    query: request.message,
    intent,
    symbol,
    boardKeyword: extractBoardKeyword(request.message),
    singleAgent: command?.singleAgent,
  };

  if (command && !command.args && !command.allowEmptyArgs) return commandUsageResponse(request, command.usage);

  const nodes = buildDag(context, onToken);
  events.push({
    type: 'plan_created',
    message: `识别为 ${intentLabel(intent)}，规划 ${nodes.length} 个可审计步骤。`,
  });

  await executeDag(nodes, context, (step) => {
    events.push({ type: step.status === 'running' ? 'step_started' : 'step_completed', step });
  });

  const draft = context.singleAgent && context.analysisResults?.[0]
    ? context.analysisResults[0].content
    : context.themeAttribution ?? context.analysisOverview ?? await runReportAgent({
      query: request.message,
      intent,
      quote: context.quote,
      technical: context.technical,
      board: context.board,
      news: context.news,
      announcements: context.announcements,
    }, onToken);
  const content = reviewCompliance(draft);
  const result = context.board ?? (context.technical && context.quote ? { ...context.technical, stocks: [context.quote] } : context.technical) ?? quoteToCard(context.quote);

  events.push({ type: 'final_answer', message: content, result, stock: context.quote });

  return {
    events,
    message: {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content,
      createdAt: new Date().toISOString(),
      steps: events.map((event) => event.step).filter((step): step is NonNullable<typeof step> => Boolean(step)),
      result,
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
  if (context.intent === 'board') {
    return [
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
      {
        id: 'theme-attribution-data',
        agent: 'a-stock-data',
        description: '拉取今日强势股、热点题材与资金流数据',
        run: async (ctx) => {
          const [surge, sector, flow] = await Promise.all([
            listHotFocus('surge').catch(() => []),
            listHotFocus('sector').catch(() => []),
            listHotFocus('flow').catch(() => []),
          ]);
          ctx.hotFocus = [...surge, ...sector, ...flow];
          ctx.board = themeAttributionToCard(surge, sector, flow);
          ctx.themeAttribution = ctx.board.narrative;
        },
      },
    ];
  }

  if (!context.symbol) {
    return [
      {
        id: 'chat',
        agent: 'Orchestrator',
        description: '未识别到股票代码，转为普通投研问答',
        run: async () => undefined,
      },
    ];
  }

  const nodes: DagNode<AgentContext>[] = [
    {
      id: 'quote',
      agent: 'DataAgent',
      description: `获取 ${context.symbol} 实时行情`,
      run: async (ctx) => {
        ctx.quote = await fetchQuote(ctx.symbol!);
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
          const { news, announcements } = await listStockNewsAnnouncements(ctx.symbol!, 10);
          ctx.news = news;
          ctx.announcements = announcements;
          ctx.board = newsAnnouncementsToCard(ctx.quote, news, announcements);
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

    nodes.push(
      {
        id: 'market-data',
        agent: 'DataAgent',
        description: `拉取 ${context.symbol} K线、指标与新闻样本`,
        dependsOn: ['quote'],
        run: async (ctx) => {
          const [kline, technical, news] = await Promise.all([
            getKline(ctx.symbol!, 120).catch(() => []),
            runTechnicalAnalysis(ctx.symbol!).catch(() => undefined),
            listMarketNews(ctx.quote?.name ?? ctx.symbol, 1, 10).then((page) => page.items).catch(() => []),
          ]);
          ctx.kline = kline;
          ctx.technical = technical?.chart ? technical : technical ? { ...technical, chart: { type: 'kline', data: kline } } : undefined;
          ctx.news = news;
        },
      },
      ...analysisAgents.map((agent) => ({
        id: `analysis-${agent.name}`,
        agent: agent.label,
        description: `${agent.label}：${context.symbol}`,
        dependsOn: ['market-data'],
        run: async (ctx: AgentContext) => {
          const result = await runStockAnalysisSubAgent(agent.name, stockAnalysisInput(ctx), context.singleAgent ? onToken : undefined);
          ctx.analysisResults = [...(ctx.analysisResults ?? []), result];
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
        ctx.technical = await runTechnicalAnalysis(ctx.symbol!);
      },
    });
  }

  return nodes;
}

function classifyIntent(query: string): Intent {
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
  return { quote: '行情查询', technical: '技术诊股', analysis: '五维个股分析', 'news-announcements': '新闻公告', 'theme-attribution': '题材归因', board: '板块分析', portfolio: '持仓管理', chat: '普通问答' }[intent];
}

function stockAnalysisInput(ctx: AgentContext) {
  return {
    query: ctx.query,
    symbol: ctx.symbol!,
    stockLabel: ctx.quote?.name ?? ctx.symbol!,
    quote: ctx.quote,
    technical: ctx.technical,
    kline: ctx.kline,
    news: ctx.news,
  };
}

function extractBoardKeyword(query: string) {
  const match = query.match(/([一-龥A-Za-z0-9]+)(板块|行业)/);
  if (match) return match[1];
  if (query.includes('北向')) return '北向资金';
  if (query.includes('资金')) return '资金流';
  return '热点';
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
