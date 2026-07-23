import type { AgentResultCard, AnnouncementItem, HotFocusItem, IStockFundFlowSnapshot, MarketNewsItem, StockDetail, TMarketReviewReport } from '../../../src/shared/types.js';
import type { HistoricalBarsResult } from '../market-data/types.js';
import type { DailyDragonTigerItem } from '../stock/stock-client.js';
import type { DagNode } from './dag-executor.js';
import type { IAgentContext, TOnToken } from './orchestrator-types.js';
import { buildStockAnalysisInput, enrichTechnicalCard, filterLargeOrders, runContextTool } from './agent-tool-runtime.js';
import { dailyDragonTigerToCard, newsAnnouncementsToCard, themeAttributionToCard } from './agent-result-cards.js';
import { fetchBoard } from './data-agent.js';
import { evidenceFromAnnouncements, evidenceFromChip, evidenceFromDragonTiger, evidenceFromFundFlow, evidenceFromHistoricalBars, evidenceFromHotFocus, evidenceFromNews, evidenceFromQuote, evidenceFromTechnical } from './evidence.js';
import { generateReport } from '../llm/index.js';
import { createMarketReviewMessages } from './market-review-prompt.js';
import { runNewsAnalysisAgent } from './news-analysis-agent.js';
import { runStockAnalysisOverview } from './stock-analysis-overview-agent.js';
import { runStockAnalysisSubAgent, stockAnalysisAgentNames } from './stock-analysis-agents.js';

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
            narrative:
              '当前 MVP 已预留持仓记忆接口。你可以在后续版本录入持仓成本、数量，系统将基于实时行情计算浮盈亏。',
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

  if (context.intent === 'market-review') {
    return [
      ...linkNodes,
      {
        id: 'market-review-data',
        agent: 'MarketReviewDataAgent',
        description: '采集全市场行情、板块资金流与涨跌停池真实数据',
        run: async (ctx) => {
          ctx.marketReview = await runContextTool<TMarketReviewReport | undefined>(ctx, 'getMarketReview', {}, () => undefined);
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
  }

  if (context.intent === 'daily-lhb') {
    return [
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
            runContextTool<HistoricalBarsResult>(
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
            ),
            runContextTool<AgentResultCard | undefined>(
              ctx,
              'getTechnicalIndicators',
              { symbol: ctx.symbol! },
              () => undefined,
            ),
            runContextTool<MarketNewsItem[]>(
              ctx,
              'getMarketNews',
              { query: ctx.quote?.name ?? ctx.symbol, page: 1, pageSize: 10 },
              () => [],
            ),
            needsLargeOrders
              ? runContextTool<HotFocusItem[]>(ctx, 'getHotFocus', { tab: 'surge' }, () => [])
              : Promise.resolve([]),
            needsChip
              ? runContextTool<unknown>(ctx, 'getStockChipDistribution', { symbol: ctx.symbol! }, () => undefined)
              : Promise.resolve(undefined),
            needsLargeOrders
              ? runContextTool<IStockFundFlowSnapshot | undefined>(
                  ctx,
                  'getStockFundFlowSnapshot',
                  { symbol: ctx.symbol! },
                  () => undefined,
                )
              : Promise.resolve(undefined),
          ]);
          const kline = historical.data;
          ctx.kline = kline;
          ctx.technical = technical?.chart
            ? technical
            : technical
              ? { ...technical, chart: { type: 'kline', data: kline } }
              : undefined;
          ctx.news = news;
          ctx.chip = chip;
          ctx.fundFlow = fundFlow;
          ctx.largeOrders = filterLargeOrders(largeOrders, ctx.symbol!);
          ctx.evidence.push(
            ...evidenceFromHistoricalBars(ctx.symbol!, historical),
            ...evidenceFromTechnical(ctx.symbol!, ctx.technical),
            ...evidenceFromNews(news),
            ...evidenceFromHotFocus(ctx.largeOrders),
            ...evidenceFromFundFlow(ctx.symbol!, fundFlow),
          );
          if (needsChip) ctx.evidence.push(...evidenceFromChip(ctx.symbol!, ctx.chip));
        },
      },
      ...analysisAgents.map((agent) => ({
        id: `analysis-${agent.name}`,
        agent: agent.label,
        description: `${agent.label}：${context.symbol}`,
        dependsOn: ['market-data'],
        run: async (ctx: IAgentContext) => {
          const shouldStream = Boolean(context.singleAgent);
          const result = await runStockAnalysisSubAgent(
            agent.name,
            buildStockAnalysisInput(ctx),
            shouldStream ? onToken : undefined,
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
          ctx.analysisOverview = await runStockAnalysisOverview(buildStockAnalysisInput(ctx), ctx.analysisResults ?? []);
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
      },
    });
  }

  return nodes;
}

