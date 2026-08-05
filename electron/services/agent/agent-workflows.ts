import type {
  AgentResultCard,
  AnnouncementItem,
  HotFocusItem,
  IChipDistributionResult,
  IStockFundFlowSnapshot,
  MarketNewsItem,
  StockDetail,
  TMarketReviewReport,
} from '../../../src/shared/types.js';
import type { HistoricalBarsResult } from '../market-data/types.js';
import type { IHolderNumberChangeRow } from '../stock/a-stock-data-runner.js';
import type { DailyDragonTigerItem } from '../stock/stock-client.js';
import type { IHotConceptsToolOutput, IIndustryRankingToolOutput } from '../tools/a-stock-data-tools.js';
import type { DagNode } from './dag-executor.js';
import type { IAgentContext, TOnToken } from './orchestrator-types.js';
import { buildStockAnalysisInput, createSkippedDataStatus, filterLargeOrders, runContextTool } from './agent-tool-runtime.js';
import {
  createPlanAgentsFromNodes,
  formatPlanUpdatedMessage,
  planNeedsAnyData,
  planNeedsData,
  planNeedsNode,
  shouldRunPlanNode,
} from './agent-planning.js';
import { reflectOnPlanAfterData } from './agent-reflection.js';
import { callTool } from '../tools/tool-registry.js';
import {
  dailyDragonTigerToCard,
  holderChipToCard,
  hotConceptsToCard,
  industryRankingToCard,
  newsAnnouncementsToCard,
  themeAttributionToCard,
} from './agent-result-cards.js';
import { fetchBoard } from './data-agent.js';
import {
  evidenceFromAnnouncements,
  evidenceFromBoardCard,
  evidenceFromChip,
  evidenceFromDragonTiger,
  evidenceFromFundFlow,
  evidenceFromHistoricalBars,
  evidenceFromHolderChange,
  evidenceFromHotConcepts,
  evidenceFromHotFocus,
  evidenceFromIndustryRanking,
  evidenceFromNews,
  evidenceFromQuote,
  evidenceFromTechnical,
} from './evidence.js';
import { generateReport } from '../llm/index.js';
import { agenticAStockDataAnswer } from './a-stock-data-agent.js';
import { isStockRelatedQuestion } from './intent-routing.js';
import { createMarketReviewMessages } from './market-review-prompt.js';
import { createDirectAnswerMessages, createPlainQuestionMessages } from './plain-question-prompt.js';
import { runNewsAnalysisAgent } from './news-analysis-agent.js';
import { runStockAnalysisOverview } from './stock-analysis-overview-agent.js';
import {
  buildStockAnalysisInputForAgent,
  runStockAnalysisSubAgent,
  stockAnalysisAgentNames,
} from './stock-analysis-agents.js';

function isSymbolResult(value: unknown): value is { symbol?: string } {
  return typeof value === 'object' && value !== null;
}

function emitReflectionEvents(ctx: IAgentContext, nodes: DagNode<IAgentContext>[], reason: string) {
  const reflection = reflectOnPlanAfterData(ctx, reason);
  if (reflection.passed) return;
  for (const gap of reflection.dataGaps) {
    ctx.emitEvent?.({
      type: 'data_gap_detected',
      title: '数据缺口',
      message: gap.userMessage,
      dataGap: gap,
    });
  }
  const plan = {
    agents: createPlanAgentsFromNodes(nodes),
    items: ctx.plan?.items,
    dataGaps: ctx.plan?.dataGaps,
    revisions: ctx.plan?.revisions,
    summary: ctx.plan?.summary,
  };
  ctx.emitEvent?.({
    type: 'plan_updated',
    title: '计划调整',
    message: ctx.plan ? formatPlanUpdatedMessage(ctx.plan) : '关键数据缺口已记录，后续分析会降低相关维度置信度。',
    plan,
    reflection,
  });
  ctx.emitEvent?.({
    type: 'reflection_completed',
    title: '数据后反思',
    message: '已根据数据缺口调整后续分析计划。',
    plan,
    reflection,
  });
}

function recordSkippedData(ctx: IAgentContext, toolName: string, dataName: string, reason: string) {
  ctx.dataStatuses = [...(ctx.dataStatuses ?? []), createSkippedDataStatus(ctx, toolName, dataName, reason)];
}

export function buildAgentWorkflow(context: IAgentContext, onToken?: TOnToken): DagNode<IAgentContext>[] {
  const linkNodes: DagNode<IAgentContext>[] = context.urls.length
    ? [
        {
          id: 'read-links',
          agent: 'WebTool',
          description: `读取用户提供的 ${context.urls.length} 个链接`,
          run: async (ctx) => {
            const pages = await Promise.all(
              ctx.urls.map((url) =>
                runContextTool<{ url: string; title?: string; content: string } | undefined>(
                  ctx,
                  'readUrl',
                  { url },
                  () => undefined,
                ),
              ),
            );
            ctx.linkedPages = pages.filter((page): page is { url: string; title?: string; content: string } =>
              Boolean(page),
            );
            ctx.evidence.push(
              ...ctx.linkedPages.map((page, index) => ({
                id: `url-${index + 1}`,
                source: 'url' as const,
                title: page.title ?? page.url,
                summary: page.content.slice(0, 240),
                url: page.url,
                raw: { title: page.title },
              })),
            );
          },
        },
      ]
    : [];

  if (context.intent === 'board') {
    const nodes: DagNode<IAgentContext>[] = [
      ...linkNodes,
      {
        id: 'board-data',
        agent: 'DataAgent',
        description: `拉取 ${context.boardKeyword ?? '相关'} 板块与资金流数据`,
        run: async (ctx) => {
          ctx.board = await fetchBoard(ctx.boardKeyword ?? '资金');
          ctx.analysisOverview = ctx.board.narrative ?? '';
          ctx.evidence.push(...evidenceFromBoardCard(ctx.board));
          emitReflectionEvents(ctx, nodes, 'board-data');
        },
      },
    ];
    return nodes;
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
            narrative:
              '当前 MVP 已预留持仓记忆接口。你可以在后续版本录入持仓成本、数量，系统将基于实时行情计算浮盈亏。',
          };
        },
      },
    ];
  }

  if (context.intent === 'theme-attribution') {
    const nodes: DagNode<IAgentContext>[] = [
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
          emitReflectionEvents(ctx, nodes, 'theme-attribution-data');
        },
      },
    ];
    return nodes;
  }

  if (context.intent === 'market-review') {
    const nodes: DagNode<IAgentContext>[] = [
      ...linkNodes,
      {
        id: 'market-review-data',
        agent: 'MarketReviewDataAgent',
        description: '采集全市场行情、板块资金流与涨跌停池真实数据',
        run: async (ctx) => {
          ctx.marketReview = await runContextTool<TMarketReviewReport | undefined>(
            ctx,
            'getMarketReview',
            {},
            () => undefined,
          );
          emitReflectionEvents(ctx, nodes, 'market-review-data');
        },
      },
      {
        id: 'market-review-report',
        agent: '生成市场复盘',
        description: '基于真实数据生成今日行情复盘',
        dependsOn: ['market-review-data'],
        run: async (ctx) => {
          if (!ctx.marketReview) {
            ctx.analysisOverview = '今日行情复盘数据源暂不可用，请稍后重试。';
            return;
          }
          ctx.analysisOverview = await generateReport(createMarketReviewMessages(ctx.marketReview));
        },
      },
    ];
    return nodes;
  }

  if (context.intent === 'daily-lhb') {
    const nodes: DagNode<IAgentContext>[] = [
      ...linkNodes,
      {
        id: 'daily-lhb-data',
        agent: 'a-stock-data',
        description: '拉取全市场龙虎榜净买入排名',
        run: async (ctx) => {
          ctx.dailyDragonTiger = await runContextTool<DailyDragonTigerItem[]>(
            ctx,
            'getDragonTiger',
            { limit: 500 },
            () => [],
          );
          ctx.evidence.push(...evidenceFromDragonTiger(ctx.dailyDragonTiger));
          ctx.board = dailyDragonTigerToCard(ctx.dailyDragonTiger);
          ctx.analysisOverview = ctx.board.narrative;
          emitReflectionEvents(ctx, nodes, 'daily-lhb-data');
        },
      },
    ];
    return nodes;
  }

  if (context.intent === 'shareholder-chip') {
    const nodes: DagNode<IAgentContext>[] = [
      ...linkNodes,
      {
        id: 'shareholder-chip-data',
        agent: 'a-stock-data',
        description: `拉取 ${context.symbol} 股东户数、筹码集中度与资金面`,
        run: async (ctx) => {
          const [quote, holder, chip, flow] = await Promise.all([
            runContextTool<StockDetail | undefined>(
              ctx,
              'getStockQuote',
              { symbol: ctx.symbol! },
              () => undefined,
            ),
            runContextTool<IHolderNumberChangeRow[] | undefined>(
              ctx,
              'getHolderNumberChange',
              { symbol: ctx.symbol! },
              () => undefined,
            ),
            runContextTool<IChipDistributionResult | undefined>(
              ctx,
              'getStockChipDistribution',
              { symbol: ctx.symbol! },
              () => undefined,
            ),
            runContextTool<IStockFundFlowSnapshot | undefined>(
              ctx,
              'getStockFundFlowSnapshot',
              { symbol: ctx.symbol! },
              () => undefined,
            ),
          ]);
          ctx.quote = quote;
          ctx.chip = chip;
          ctx.fundFlow = flow;
          ctx.evidence.push(
            ...evidenceFromQuote(quote),
            ...evidenceFromHolderChange(ctx.symbol!, holder),
            ...evidenceFromChip(ctx.symbol!, chip),
            ...evidenceFromFundFlow(ctx.symbol!, flow),
          );
          ctx.board = holderChipToCard({ quote, holder, chip, flow });
          const hasKeyData = Boolean(holder?.length) || Boolean(chip);
          ctx.analysisOverview = hasKeyData
            ? await generateReport(createPlainQuestionMessages(ctx))
            : '该股股东户数与筹码数据源暂不可用，请稍后重试。';
          emitReflectionEvents(ctx, nodes, 'shareholder-chip-data');
        },
      },
    ];
    return nodes;
  }

  if (context.intent === 'hot-concepts') {
    const nodes: DagNode<IAgentContext>[] = [
      ...linkNodes,
      {
        id: 'hot-concepts-data',
        agent: 'a-stock-data',
        description: '拉取今日热门股与概念归属',
        run: async (ctx) => {
          const hot = await runContextTool<IHotConceptsToolOutput | undefined>(ctx, 'getHotConcepts', {}, () => undefined);
          ctx.evidence.push(...evidenceFromHotConcepts(hot?.list, hot?.source));
          ctx.board = hotConceptsToCard({ source: hot?.source, list: hot?.list ?? [] });
          ctx.analysisOverview =
            hot?.list.length
              ? await generateReport(createPlainQuestionMessages(ctx))
              : '今日热门股数据源暂不可用，请稍后重试。';
          emitReflectionEvents(ctx, nodes, 'hot-concepts-data');
        },
      },
    ];
    return nodes;
  }

  if (context.intent === 'industry-ranking') {
    const nodes: DagNode<IAgentContext>[] = [
      ...linkNodes,
      {
        id: 'industry-ranking-data',
        agent: 'a-stock-data',
        description: '拉取今日行业涨幅与资金流排名',
        run: async (ctx) => {
          const data = await runContextTool<IIndustryRankingToolOutput | undefined>(
            ctx,
            'getIndustryRanking',
            {},
            () => undefined,
          );
          ctx.evidence.push(...evidenceFromIndustryRanking(data?.ranking, data?.flow));
          ctx.board = industryRankingToCard({ ranking: data?.ranking, flow: data?.flow });
          const hasData = Boolean(data?.ranking?.total) || Boolean(data?.flow?.rows.length);
          ctx.analysisOverview = hasData
            ? await generateReport(createPlainQuestionMessages(ctx))
            : '今日行业涨幅数据源暂不可用，请稍后重试。';
          emitReflectionEvents(ctx, nodes, 'industry-ranking-data');
        },
      },
    ];
    return nodes;
  }

  if (context.intent === 'a-stock-data-agent') {
    return [
      ...linkNodes,
      {
        id: 'a-stock-data-agent',
        agent: 'a-stock-data',
        description: '先查本地 DuckDB，再按 stock-sdk/a-stock-data 补充分析...',
        run: async (ctx) => {
          // 预解析股票代码（如「茅台」→600519），帮助智能体直接调用个股工具；market 级问题无代码则跳过
          const resolved = await callTool('resolveStockSymbol', { query: ctx.query });
          const out = resolved?.output;
          if (isSymbolResult(out) && /^\d{6}$/.test(out.symbol ?? '')) ctx.symbol = out.symbol;
          ctx.analysisOverview = await agenticAStockDataAnswer(ctx);
        },
      },
    ];
  }

  if (!context.symbol) {
    const stockRelated = isStockRelatedQuestion(context.query);
    return [
      ...linkNodes,
      {
        id: 'chat',
        agent: stockRelated ? 'a-stock-data' : 'Orchestrator',
        description: stockRelated
          ? '识别为 A 股相关问题，调用 a-stock-data 真实数据回答'
          : '非股票问题，由大模型直接回答',
        run: async (ctx) => {
          ctx.analysisOverview = stockRelated
            ? await agenticAStockDataAnswer(ctx)
            : await generateReport(createDirectAnswerMessages(ctx.query));
        },
      },
    ];
  }

  const nodes: DagNode<IAgentContext>[] = [
    ...linkNodes,
    {
      id: 'quote',
      agent: 'DataAgent',
      description: `获取 ${context.symbol} 实时行情`,
      run: async (ctx) => {
        ctx.quote = await runContextTool<StockDetail | undefined>(
          ctx,
          'getStockQuote',
          { symbol: ctx.symbol! },
          () => undefined,
        );
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
          const data = await runContextTool<{ news: MarketNewsItem[]; announcements: AnnouncementItem[] }>(
            ctx,
            'getStockNewsAnnouncements',
            { symbol: ctx.symbol!, limit: 10 },
            () => ({ news: [], announcements: [] }),
          );
          ctx.news = data.news;
          ctx.announcements = data.announcements;
          ctx.evidence.push(...evidenceFromNews(ctx.news), ...evidenceFromAnnouncements(ctx.announcements));
          ctx.board = newsAnnouncementsToCard(ctx.quote, data.news, data.announcements);
          emitReflectionEvents(ctx, nodes, 'news-announcements');
        },
      },
      {
        id: 'news-analysis',
        agent: 'NewsAnalysisAgent',
        description: `解读 ${context.symbol} 新闻公告利好利空`,
        dependsOn: ['news-announcements'],
        run: async (ctx) => {
          ctx.analysisOverview = await runNewsAnalysisAgent(
            { stock: ctx.quote, news: ctx.news, announcements: ctx.announcements },
            onToken,
          );
        },
      },
    );
    return nodes;
  }

  if (context.intent === 'analysis') {
    const allAnalysisAgents = context.singleAgent
      ? stockAnalysisAgentNames().filter((agent) => agent.name === context.singleAgent)
      : stockAnalysisAgentNames();
    const analysisAgents = allAnalysisAgents.filter((agent) => planNeedsNode(context.plan, `analysis-${agent.name}`));

    const needsKline = planNeedsAnyData(context.plan, ['K线', '历史日线', '技术指标']);
    const needsTechnical = planNeedsAnyData(context.plan, ['技术指标', 'K线']);
    const needsNews = planNeedsAnyData(context.plan, ['新闻', '公告', '热点题材', '行业/概念强度']);
    const needsLargeOrders = planNeedsAnyData(context.plan, ['特大单', '热点/特大单', '资金流']);
    const needsChip = planNeedsData(context.plan, '筹码集中度');
    const needsFundFlow = planNeedsData(context.plan, '资金流');

    nodes.push(
      {
        id: 'market-data',
        agent: 'DataAgent',
        description: `拉取 ${context.symbol} K线、指标与新闻样本`,
        dependsOn: ['quote'],
        run: async (ctx) => {
          const [historical, technical, stockNewsResult, hotLargeOrders, localSurge, chip, fundFlow] = await Promise.all([
            needsKline
              ? runContextTool<HistoricalBarsResult>(
                  ctx,
                  'getHistoricalDailyBars',
                  { symbol: ctx.symbol!, limit: 120, adjustType: 'qfq' },
                  () => ({
                    data: [],
                    meta: {
                      source: 'fallback',
                      storage: 'local',
                      freshness: 'fallback',
                      isComplete: false,
                      warnings: ['历史日线获取失败'],
                      adjustType: 'qfq',
                    },
                  }),
                )
              : Promise.resolve(undefined),
            needsTechnical
              ? runContextTool<AgentResultCard | undefined>(
                  ctx,
                  'getTechnicalIndicators',
                  { symbol: ctx.symbol! },
                  () => undefined,
                )
              : Promise.resolve(undefined),
            needsNews
              ? runContextTool<{ news: MarketNewsItem[]; announcements: AnnouncementItem[] }>(
                  ctx,
                  'getStockNewsAnnouncements',
                  { symbol: ctx.symbol!, limit: 10 },
                  () => ({ news: [], announcements: [] }),
                )
              : Promise.resolve(undefined),
            needsLargeOrders
              ? runContextTool<HotFocusItem[]>(ctx, 'getHotFocus', { tab: 'surge' }, () => [])
              : Promise.resolve([]),
            needsLargeOrders
              ? runContextTool<{ rows?: HotFocusItem[] } | undefined>(
                  ctx,
                  'getStockSurgeEventsLocalFirst',
                  { symbol: ctx.symbol!, days: 7, limit: 200, minHands: 10000 },
                  () => undefined,
                )
              : Promise.resolve(undefined),
            needsChip
              ? runContextTool<unknown>(ctx, 'getStockChipDistribution', { symbol: ctx.symbol! }, () => undefined)
              : Promise.resolve(undefined),
            needsFundFlow
              ? runContextTool<IStockFundFlowSnapshot | undefined>(
                  ctx,
                  'getStockFundFlowSnapshot',
                  { symbol: ctx.symbol! },
                  () => undefined,
                )
              : Promise.resolve(undefined),
          ]);
          const kline = historical?.data ?? [];
          ctx.kline = needsKline ? kline : undefined;
          ctx.technical = technical?.chart
            ? technical
            : technical
              ? { ...technical, chart: { type: 'kline', data: kline } }
              : undefined;
          ctx.news = stockNewsResult?.news ?? [];
          ctx.announcements = stockNewsResult?.announcements ?? [];
          ctx.chip = chip;
          ctx.fundFlow = fundFlow;
          ctx.largeOrders = filterLargeOrders([...(localSurge?.rows ?? []), ...hotLargeOrders], ctx.symbol!);
          if (historical) ctx.evidence.push(...evidenceFromHistoricalBars(ctx.symbol!, historical));
          if (needsTechnical) ctx.evidence.push(...evidenceFromTechnical(ctx.symbol!, ctx.technical));
          if (needsNews) ctx.evidence.push(...evidenceFromNews(ctx.news), ...evidenceFromAnnouncements(ctx.announcements));
          if (needsLargeOrders) ctx.evidence.push(...evidenceFromHotFocus(ctx.largeOrders));
          if (needsFundFlow) ctx.evidence.push(...evidenceFromFundFlow(ctx.symbol!, fundFlow));
          if (needsChip) ctx.evidence.push(...evidenceFromChip(ctx.symbol!, ctx.chip));
          if (!needsChip && planNeedsNode(ctx.plan, 'analysis-chip')) {
            recordSkippedData(ctx, 'getStockChipDistribution', '筹码集中度', '当前计划未要求筹码维度，已跳过。');
          }
          emitReflectionEvents(ctx, nodes, 'market-data');
        },
      },
      ...analysisAgents.map((agent) => ({
        id: `analysis-${agent.name}`,
        agent: agent.label,
        description: `${agent.label}：${context.symbol}`,
        dependsOn: ['market-data'],
        run: async (ctx: IAgentContext) => {
          if (!shouldRunPlanNode(ctx.plan, `analysis-${agent.name}`)) {
            recordSkippedData(ctx, `analysis-${agent.name}`, agent.label, '数据缺口导致该分析维度本轮跳过。');
            return;
          }
          const shouldStream = Boolean(context.singleAgent);
          const result = await runStockAnalysisSubAgent(
            agent.name,
            buildStockAnalysisInputForAgent(agent.name, buildStockAnalysisInput(ctx)),
            shouldStream ? onToken : undefined,
            (message, percent) => {
              ctx.emitEvent?.({
                type: 'progress_updated',
                title: `${agent.label} 进度`,
                message,
                progress: { current: Math.round(percent), total: 100 },
                step: { id: `analysis-${agent.name}`, agent: agent.label, description: message, status: 'running' },
                subAgent: { name: agent.label, description: message, status: 'running' },
              });
            },
          );
          ctx.analysisResults = [...(ctx.analysisResults ?? []), result];
          ctx.evidence.push(...result.output.evidence);
          ctx.findings.push(...result.output.findings);
          ctx.emitEvent?.({
            type: 'intermediate_result',
            title: `${agent.label} 中间结论`,
            message: result.content.slice(0, 200),
            intermediateResult: {
              agentName: agent.name,
              label: agent.label,
              markdown: result.output.markdown,
              findings: result.output.findings,
            },
          });
        },
      })),
    );

    if (!context.singleAgent) {
      nodes.push({
        id: 'analysis-report',
        agent: '生成投研报告',
        description: `汇总五维分析结果并生成 ${context.symbol} 综合投研报告`,
        dependsOn: analysisAgents.map((agent) => `analysis-${agent.name}`),
        run: async (ctx) => {
          ctx.analysisOverview = await runStockAnalysisOverview(
            buildStockAnalysisInput(ctx),
            ctx.analysisResults ?? [],
          );
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
        ctx.technical = await runContextTool<AgentResultCard | undefined>(
          ctx,
          'getTechnicalIndicators',
          { symbol: ctx.symbol! },
          () => undefined,
        );
        ctx.evidence.push(...evidenceFromTechnical(ctx.symbol!, ctx.technical));
        emitReflectionEvents(ctx, nodes, 'technical');
      },
    });
  }

  return nodes;
}
