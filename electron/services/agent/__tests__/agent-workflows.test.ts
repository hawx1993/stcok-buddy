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

vi.mock('../../../electron-runtime.js', () => ({
  app: {
    getPath: () => os.tmpdir(),
    isPackaged: false,
  },
}));

vi.mock('../../tools/tool-registry.js', () => ({
  callTool: vi.fn(),
}));

vi.mock('../../llm/posthog-client.js', () => ({
  captureEvent: vi.fn(),
}));

vi.mock('../../llm/posthog-langchain-handler.js', () => ({
  PostHogCallbackHandler: vi.fn(),
}));

vi.mock('../../llm/openai-compatible-client.js', () => ({
  chatWithOpenAICompatible: vi.fn(),
}));

vi.mock('../../config-store.js', () => ({
  getConfig: vi.fn(() => ({ model: {} })),
}));

vi.mock('../../llm/index.js', () => ({
  generateReport: vi.fn(),
}));

import type { HotFocusItem, ToolCallRecord } from '../../../../src/shared/types.js';
import { callTool } from '../../tools/tool-registry.js';
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
      if (toolName === 'getStockSurgeEventsLocalFirst') return { ...record(toolName, { rows: [localLargeOrder] }), input };
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
