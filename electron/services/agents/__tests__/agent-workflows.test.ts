import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => {
  const electron = {
    app: {
      getPath: () => os.tmpdir(),
      isPackaged: false,
    },
  };
  return { ...electron, default: electron };
});

vi.mock('../../../electron-runtime', () => ({
  app: {
    getPath: () => os.tmpdir(),
    isPackaged: false,
  },
}));

vi.mock('../tool-registry', () => ({
  callTool: vi.fn(),
}));

vi.mock('../../llm/posthog-client', () => ({
  captureEvent: vi.fn(),
}));

vi.mock('../../llm/posthog-langchain-handler', () => ({
  PostHogCallbackHandler: vi.fn(),
}));

vi.mock('../../llm/openai-compatible-client', () => ({
  chatWithOpenAICompatible: vi.fn(),
}));

vi.mock('../../stock-db/config-store', () => ({
  getConfig: vi.fn(() => ({ model: {} })),
}));

vi.mock('../../llm/index', () => ({
  generateReport: vi.fn(),
}));

const coverageMocks = vi.hoisted(() => ({
  runDataCoverageAgent: vi.fn(() =>
    Promise.resolve({
      ok: true,
      minCoverage: 5000,
      needsChips: false,
      before: { securities: 5000, snapshots: 5000, dailyBarSymbols: 0, chips: 1152 },
      after: { securities: 5000, snapshots: 5000, dailyBarSymbols: 0, chips: 1152 },
      hydrated: { securities: 0, snapshots: 0, dailyBarSymbols: 0, chips: 0 },
      warnings: [],
      elapsedMs: 1,
    }),
  ),
}));

vi.mock('../data-coverage-agent', () => coverageMocks);

import type { HotFocusItem, ToolCallRecord } from '../../../../src/shared/types.js';
import { callTool } from '../tool-registry.js';
import { createInitialAgentPlan } from '../agent-planning.js';
import { buildAgentWorkflow } from '../agent-workflows.js';
import type { IAgentContext } from '../orchestrator-types.js';

const mockedCallTool = vi.mocked(callTool);

function record(toolName: string, output: unknown): ToolCallRecord {
  return {
    id: `tool-${toolName}`,
    toolName,
    input: {},
    output,
    startedAt: '2026-08-05T00:00:00.000Z',
    endedAt: '2026-08-05T00:00:00.000Z',
  };
}

function createContext(): IAgentContext {
  const context: IAgentContext = {
    query: '分析 600519 有没有超大买入手数',
    intent: 'analysis',
    urls: [],
    symbol: '600519',
    quote: { code: '600519', name: '贵州茅台' },
    evidence: [],
    toolCalls: [],
    findings: [],
    emitEvent: vi.fn(),
  };
  context.plan = createInitialAgentPlan(context);
  return context;
}

describe('agent workflow market-data', () => {
  it('筹码分析使用五天 freshness 的本地优先筹码工具', async () => {
    mockedCallTool.mockImplementation(async (toolName, input) => {
      if (toolName === 'getStockChipDistributionLocalFirst') {
        return {
          ...record(toolName, {
            latest: { date: '2026-08-10', avgCost: 10, profitRatio: 0.6, points: [{ price: 10, weight: 1 }] },
            distributions: [],
            trend: [{ days: 5, concentration70: 0.1, concentration90: 0.2 }],
            source: 'stock-sdk',
            freshness: 'current',
            sourceTrace: ['stock-sdk 返回真实数据'],
            warnings: [],
            isEmpty: false,
          }),
          input,
        };
      }
      if (toolName === 'getHistoricalDailyBars') return record(toolName, { data: [], meta: { warnings: [] } });
      if (toolName === 'getStockNewsAnnouncements') return record(toolName, { news: [], announcements: [] });
      if (toolName === 'getTechnicalIndicators') return record(toolName, undefined);
      if (toolName === 'getStockFundFlowSnapshot') return record(toolName, undefined);
      if (toolName === 'getHotFocus') return record(toolName, []);
      if (toolName === 'getStockSurgeEventsLocalFirst') return record(toolName, { rows: [] });
      return record(toolName, undefined);
    });

    const context = createContext();
    context.query = '分析 600519 筹码';
    context.plan = createInitialAgentPlan(context);
    const marketDataNode = buildAgentWorkflow(context).find((node) => node.id === 'market-data');
    if (!marketDataNode) throw new Error('market-data node missing');

    await marketDataNode.run(context);

    expect(mockedCallTool).toHaveBeenCalledWith('getStockChipDistributionLocalFirst', { symbol: '600519', days: 20 });
    expect(context.plan?.items.find((item) => item.id === 'chip-structure')?.status).not.toBe('skipped');
  });

  it('资金面需要特大单时会调用个股异动本地优先工具并合并到 largeOrders', async () => {
    const localLargeOrder: HotFocusItem = {
      id: 'local-surge-1',
      title: '贵州茅台 600519',
      code: '600519',
      name: '贵州茅台',
      time: '10:01',
      amount: '买入1.2万手',
      description: '特大单买入',
      tag: '特大单买入',
      type: 'surge',
    };

    mockedCallTool.mockImplementation(async (toolName, input) => {
      if (toolName === 'getHotFocus') return record(toolName, []);
      if (toolName === 'getStockSurgeEventsLocalFirst')
        return { ...record(toolName, { rows: [localLargeOrder] }), input };
      if (toolName === 'getHistoricalDailyBars') return record(toolName, { data: [], meta: { warnings: [] } });
      if (toolName === 'getStockNewsAnnouncements') return record(toolName, { news: [], announcements: [] });
      if (toolName === 'getTechnicalIndicators') return record(toolName, undefined);
      if (toolName === 'getStockChipDistribution') return record(toolName, undefined);
      if (toolName === 'getStockFundFlowSnapshot') return record(toolName, undefined);
      return record(toolName, undefined);
    });

    const context = createContext();
    const marketDataNode = buildAgentWorkflow(context).find((node) => node.id === 'market-data');
    if (!marketDataNode) throw new Error('market-data node missing');

    await marketDataNode.run(context);

    expect(mockedCallTool).toHaveBeenCalledWith(
      'getStockSurgeEventsLocalFirst',
      expect.objectContaining({ symbol: '600519', days: 7, limit: 200, minHands: 10000 }),
    );
    expect(context.largeOrders).toEqual([localLargeOrder]);
  });
});

describe('条件选股工作流', () => {
  it('筹码条件不把全市场筹码补齐作为 DataCoverage 阻塞前置条件', async () => {
    coverageMocks.runDataCoverageAgent.mockClear();
    const context = createContext();
    context.query = '查找90%筹码集中度小于18%、70%筹码集中度小于14%的个股';
    context.intent = 'condition-screener';
    context.symbol = undefined;
    context.plan = createInitialAgentPlan(context);
    const coverageNode = buildAgentWorkflow(context).find((item) => item.id === 'data-coverage');
    if (!coverageNode) throw new Error('data-coverage node missing');

    await coverageNode.run(context);

    expect(coverageNode.description).not.toContain('含筹码');
    expect(coverageMocks.runDataCoverageAgent).toHaveBeenCalledWith(context, {
      minCoverage: 5000,
      needsChips: false,
      requireDailyBars: false,
    });
  });

  it('使用确定性工具执行并展示参数名自动纠正提示', async () => {
    mockedCallTool.mockImplementation(async (toolName, input) => {
      if (toolName === 'screenASharesByConditions') {
        return {
          ...record(toolName, {
            source: 'duckdb+stock-sdk+a-stock-data',
            storage: 'local',
            freshness: 'current',
            isComplete: true,
            latestTradeDate: '2026-08-17',
            rows: [
              {
                code: '600001',
                name: '条件命中股',
                exchange: 'SH',
                industry: '新能源',
                turnoverRate: 9,
                amountYuan: 300_000_000,
                totalMarketCapYuan: 5_000_000_000,
                dataSource: 'stock-sdk',
              },
              {
                code: '600002',
                name: '成交额最高股',
                exchange: 'SH',
                industry: '新能源',
                turnoverRate: 10,
                amountYuan: 450_000_000,
                totalMarketCapYuan: 6_000_000_000,
                dataSource: 'stock-sdk',
              },
              {
                code: '600003',
                name: '半导体样本',
                exchange: 'SH',
                industry: '半导体',
                turnoverRate: 11,
                amountYuan: 250_000_000,
                totalMarketCapYuan: 7_000_000_000,
                dataSource: 'stock-sdk',
              },
            ],
            matchedCount: 3,
            returnedCount: 3,
            totalCandidates: 100,
            leadingBoards: [],
            sourceStats: {
              duckdbMatched: 0,
              stockSdkMatched: 3,
              aStockDataMatched: 0,
              missingQuoteFields: 0,
              missingChipData: 0,
            },
            warnings: [],
            isEmpty: false,
          }),
          input,
        };
      }
      return record(toolName, undefined);
    });

    const context = createContext();
    context.query = '/条件选股 --换首率>8% --成交额>2亿';
    context.intent = 'condition-screener';
    context.symbol = undefined;
    context.plan = createInitialAgentPlan(context);
    const node = buildAgentWorkflow(context).find((item) => item.id === 'condition-screener');
    if (!node) throw new Error('condition-screener node missing');

    await node.run(context);

    expect(mockedCallTool).toHaveBeenCalledWith('screenASharesByConditions', {
      turnoverRateMinExclusive: 8,
      amountMinYuanExclusive: 200_000_000,
    });
    const emitEvent = context.emitEvent;
    if (!emitEvent) throw new Error('condition screener emitEvent missing');
    expect(vi.mocked(emitEvent).mock.calls).toContainEqual([
      expect.objectContaining({
        type: 'progress_updated',
        progress: { current: 10, total: 100 },
        subAgent: expect.objectContaining({ name: 'ConditionScreener', status: 'running' }),
      }),
    ]);
    const analysisOverview = context.analysisOverview;
    if (!analysisOverview) throw new Error('condition screener analysis overview missing');
    expect(analysisOverview).toContain('条件命中股');
    expect(analysisOverview).toContain('换手率 > 8%');
    expect(analysisOverview).toContain('## ⚠️ 参数提示');
    expect(analysisOverview).toContain('已将参数“--换首率>8%”识别为“--换手率>8%”。');
    expect(analysisOverview).toContain(
      '| 代码 | 名称 | 所属板块 | 涨幅 | 换手率 | 成交额 | 成交量 | 总市值 | 流通市值 | 90%筹码 | 70%筹码 |',
    );
    expect(analysisOverview.match(/\| 代码 \| 名称 \| 所属板块 \|/g)).toHaveLength(1);
    expect(analysisOverview).toContain(
      '所属板块分布：新能源（2只，占展示样本66.7%）、半导体（1只，占展示样本33.3%）。',
    );
    expect(analysisOverview).toContain('成交额较大个股：成交额最高股（600002，+4.50亿）');
    expect(analysisOverview).not.toContain('## 📰 核心事件');
    expect(context.board?.subtitle).toBe('换手率 > 8% · 成交额 > 2 亿');
    expect(context.board?.rows).toBeUndefined();
    expect(context.board?.narrative).toBeUndefined();
  });

  it('完整零命中时说明筛选已执行，不误报数据缺口', async () => {
    mockedCallTool.mockImplementation(async (toolName, input) => {
      if (toolName === 'screenASharesByConditions') {
        return {
          ...record(toolName, {
            source: 'duckdb+stock-sdk+a-stock-data',
            storage: 'local',
            freshness: 'current',
            isComplete: true,
            latestTradeDate: '2026-08-17',
            rows: [],
            matchedCount: 0,
            returnedCount: 0,
            totalCandidates: 100,
            leadingBoards: [],
            sourceStats: {
              duckdbMatched: 0,
              stockSdkMatched: 0,
              aStockDataMatched: 0,
              missingQuoteFields: 0,
              missingChipData: 0,
            },
            warnings: [],
            isEmpty: true,
          }),
          input,
        };
      }
      return record(toolName, undefined);
    });

    const context = createContext();
    context.query = '/条件选股 --换手率>8% --成交额>2亿';
    context.intent = 'condition-screener';
    context.symbol = undefined;
    context.plan = createInitialAgentPlan(context);
    const node = buildAgentWorkflow(context).find((item) => item.id === 'condition-screener');
    if (!node) throw new Error('condition-screener node missing');

    await node.run(context);

    expect(context.analysisOverview).toContain('## 🎯 综合结论');
    expect(context.analysisOverview).toContain('已完整执行当前真实数据筛选，未发现符合全部条件的股票。');
    expect(context.analysisOverview).not.toContain('| 代码 | 名称 |');
    expect(context.analysisOverview).not.toContain('筛选数据存在缺口');
    expect(context.board?.rows).toBeUndefined();
    expect(context.dataStatuses?.[0]).toEqual(expect.objectContaining({ status: 'available' }));
  });
});

describe('超短线选股工作流', () => {
  it('stock-picker 意图挂载 stock-picker-agent 节点', () => {
    const context = createContext();
    context.query = '帮我找强势股';
    context.intent = 'stock-picker';
    context.symbol = undefined;
    context.plan = createInitialAgentPlan(context);

    const nodes = buildAgentWorkflow(context);

    expect(nodes.map((node) => node.id)).toContain('stock-picker-agent');
    expect(nodes.find((node) => node.id === 'stock-picker-agent')?.agent).toBe('stock-picker');
  });

  it('stock-picker 初始计划包含宽筛、精筛和风险缺口项', () => {
    const context = createContext();
    context.query = '找主力控盘的票';
    context.intent = 'stock-picker';
    context.symbol = undefined;

    const plan = createInitialAgentPlan(context);

    expect(plan.items.map((item) => item.id)).toEqual([
      'intent-decompose',
      'market-wide-screen',
      'candidate-refine',
      'risk-and-gap',
    ]);
    expect(plan.items.find((item) => item.id === 'market-wide-screen')?.relatedNodeIds).toContain('stock-picker-agent');
  });
});
