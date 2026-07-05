import type { AgentResultCard, AgentRunEvent, ChatRequest, ChatResponse, StockDetail } from '../../../src/shared/types.js';
import { normalizeASymbol } from '../stock/symbols.js';
import { executeDag, type DagNode } from './dagExecutor.js';
import { fetchBoard, fetchQuote } from './dataAgent.js';
import { runTechnicalAnalysis } from './analysisAgent.js';
import { runReportAgent } from './reportAgent.js';
import { reviewCompliance } from './riskAgent.js';

type Intent = 'quote' | 'technical' | 'board' | 'portfolio' | 'chat';

interface AgentContext {
  query: string;
  intent: Intent;
  symbol?: string;
  boardKeyword?: string;
  quote?: StockDetail;
  technical?: AgentResultCard;
  board?: AgentResultCard;
}

export async function runOrchestrator(request: ChatRequest): Promise<ChatResponse> {
  const events: AgentRunEvent[] = [];
  const intent = classifyIntent(request.message);
  const context: AgentContext = {
    query: request.message,
    intent,
    symbol: needsSymbol(intent) ? normalizeASymbol(request.message) : undefined,
    boardKeyword: extractBoardKeyword(request.message),
  };

  const nodes = buildDag(context);
  events.push({
    type: 'plan_created',
    message: `识别为 ${intentLabel(intent)}，规划 ${nodes.length} 个可审计步骤。`,
  });

  await executeDag(nodes, context, (step) => {
    events.push({ type: step.status === 'running' ? 'step_started' : 'step_completed', step });
  });

  const draft = await runReportAgent({
    query: request.message,
    intent,
    quote: context.quote,
    technical: context.technical,
    board: context.board,
  });
  const content = reviewCompliance(draft);
  const result = context.board ?? context.technical ?? quoteToCard(context.quote);

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

function buildDag(context: AgentContext): DagNode<AgentContext>[] {
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
  if (/持仓|我买|成本|盈亏|记住/.test(query)) return 'portfolio';
  if (/板块|行业|选股|资金流|北向|热点/.test(query)) return 'board';
  if (/分析|诊股|走势|金叉|死叉|MACD|KDJ|K线|均线|技术/.test(query)) return 'technical';
  if (/股价|行情|现价|多少|涨跌/.test(query)) return 'quote';
  return /\d{6}|茅台|五粮液|宁德|招行|招商银行/.test(query) ? 'quote' : 'chat';
}

function needsSymbol(intent: Intent) {
  return intent === 'quote' || intent === 'technical';
}

function intentLabel(intent: Intent) {
  return { quote: '行情查询', technical: '技术诊股', board: '板块分析', portfolio: '持仓管理', chat: '普通问答' }[intent];
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
