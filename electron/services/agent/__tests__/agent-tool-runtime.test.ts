import { describe, expect, it, vi } from 'vitest';

vi.mock('../../tools/tool-registry', () => ({
  callTool: vi.fn(),
}));

import type { AgentRunEvent, ToolCallRecord } from '../../../../src/shared/types.js';
import { callTool } from '../../tools/tool-registry.js';
import { createInitialAgentPlan } from '../agent-planning.js';
import {
  createDataStatuses,
  createSkippedDataStatus,
  inferToolDataStatus,
  isEmptyToolOutput,
  runContextTool,
} from '../agent-tool-runtime.js';
import type { IAgentContext } from '../orchestrator-types.js';

const mockedCallTool = vi.mocked(callTool);

function record(partial: Partial<ToolCallRecord>): ToolCallRecord {
  return {
    id: 'tool-1',
    toolName: 'getStockQuote',
    input: {},
    startedAt: '2026-08-05T00:00:00.000Z',
    ...partial,
  };
}

function createContext(): IAgentContext {
  const context: IAgentContext = {
    query: '分析 600519',
    intent: 'analysis',
    urls: [],
    symbol: '600519',
    evidence: [],
    toolCalls: [],
    findings: [],
    emitEvent: vi.fn(),
  };
  context.plan = createInitialAgentPlan(context);
  return context;
}

describe('agent-tool-runtime 数据状态记录', () => {
  it('runContextTool 在工具失败时写入 dataStatuses 并提示已记录数据缺口', async () => {
    const context = createContext();
    mockedCallTool.mockResolvedValueOnce(record({ error: '接口超时', toolName: 'getStockQuote' }));

    const result = await runContextTool(context, 'getStockQuote', { symbol: '600519' }, () => undefined);

    expect(result).toBeUndefined();
    expect(context.dataStatuses?.[0]).toEqual(expect.objectContaining({ dataName: '行情', status: 'failed' }));
    expect(context.toolCalls).toHaveLength(1);
    expect(vi.mocked(context.emitEvent)).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('已记录数据缺口') }),
    );
  });

  it('识别空数组、空对象和常见空结构', () => {
    expect(isEmptyToolOutput([])).toBe(true);
    expect(isEmptyToolOutput({})).toBe(true);
    expect(isEmptyToolOutput({ data: [] })).toBe(true);
    expect(isEmptyToolOutput({ news: [], announcements: [] })).toBe(true);
    expect(isEmptyToolOutput({ rows: [{ id: 1 }] })).toBe(false);
  });

  it('识别 partial、stale 和 available 状态', () => {
    expect(inferToolDataStatus({ meta: { isComplete: false, warnings: [] } })).toBe('partial');
    expect(inferToolDataStatus({ meta: { freshness: 'fallback', isComplete: false } })).toBe('stale');
    expect(inferToolDataStatus({ warnings: ['样本不足'] })).toBe('partial');
    expect(inferToolDataStatus({ rows: [{ id: 1 }] })).toBe('available');
  });

  it('runContextTool 发出工具开始和完成事件并包含工具名', async () => {
    const context = createContext();
    mockedCallTool.mockResolvedValueOnce(record({ output: { rows: [{ id: 1 }] }, outputSummary: 'rows:1' }));

    await runContextTool(context, 'getStockQuote', { symbol: '600519' }, () => undefined);

    expect(vi.mocked(context.emitEvent)).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tool_started', tool: expect.objectContaining({ name: 'getStockQuote' }) }),
    );
    expect(vi.mocked(context.emitEvent)).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tool_completed', tool: expect.objectContaining({ name: 'getStockQuote' }) }),
    );
  });

  it('工具原始结果仅保留在执行链路，进度记录只保留摘要', async () => {
    const context = createContext();
    const emittedEvents: AgentRunEvent[] = [];
    context.emitEvent = (event) => emittedEvents.push(event);
    const rawInput = { dataset: 'stock_snapshot', limit: 5000 };
    const rawOutput = { rows: [{ code: '600519', name: '贵州茅台', payload: '完整工具结果' }] };
    mockedCallTool.mockResolvedValueOnce(
      record({
        input: rawInput,
        inputSummary: 'dataset=stock_snapshot limit=5000',
        output: rawOutput,
        outputSummary: '返回 1 条股票快照',
      }),
    );

    const result = await runContextTool(context, 'getStockQuote', rawInput, () => ({ rows: [] }));

    expect(result).toBe(rawOutput);
    expect(context.toolCalls).toEqual([
      expect.objectContaining({
        inputSummary: 'dataset=stock_snapshot limit=5000',
        outputSummary: '返回 1 条股票快照',
      }),
    ]);
    expect(context.toolCalls[0]?.input).toBeUndefined();
    expect(context.toolCalls[0]?.output).toBeUndefined();

    const startedEvent = emittedEvents.find((event) => event.type === 'tool_started');
    expect(startedEvent?.toolCall?.input).toBeUndefined();
    expect(startedEvent?.toolCall?.output).toBeUndefined();
    expect(startedEvent?.toolCall?.inputSummary).toBe('{"dataset":"stock_snapshot","limit":5000}');

    const completedEvent = emittedEvents.find((event) => event.type === 'tool_completed');
    expect(completedEvent?.toolCall?.input).toBeUndefined();
    expect(completedEvent?.toolCall?.output).toBeUndefined();
    expect(completedEvent?.toolCall?.outputSummary).toBe('返回 1 条股票快照');
  });

  it('新闻公告复合输出会分别记录缺口', () => {
    const statuses = createDataStatuses(createContext(), 'getStockNewsAnnouncements', 'tool-2', {
      news: [{ title: '新闻' }],
      announcements: [],
    });

    expect(statuses.map((status) => [status.dataName, status.status])).toEqual([
      ['新闻', 'available'],
      ['公告', 'empty'],
    ]);
  });

  it('筹码本地优先工具会映射到筹码集中度数据状态', () => {
    const statuses = createDataStatuses(createContext(), 'getStockChipDistributionLocalFirst', 'tool-3', {
      latest: { concentration90: 0.18, concentration70: 0.12 },
      recent: [{ date: '2026-08-05' }],
    });

    expect(statuses[0]).toEqual(expect.objectContaining({ dataName: '筹码集中度', status: 'available' }));
  });

  it('筹码数据源切换追踪不会把可用真实结果标记为 partial', () => {
    const statuses = createDataStatuses(createContext(), 'getStockChipDistributionLocalFirst', 'tool-4', {
      latest: { concentration90: 0.18, concentration70: 0.12 },
      recent: [{ date: '2026-08-05' }],
      source: 'a-stock-data',
      freshness: 'current',
      sourceTrace: ['本地缓存不存在', 'stock-sdk 失败，已切换 a-stock-data'],
      warnings: [],
    });

    expect(statuses[0]).toEqual(expect.objectContaining({ dataName: '筹码集中度', status: 'available' }));
  });

  it('完整但零命中的条件选股不会被记录为数据缺口', () => {
    const statuses = createDataStatuses(createContext(), 'screenASharesByConditions', 'tool-condition-empty', {
      isComplete: true,
      rows: [],
      matchedCount: 0,
      returnedCount: 0,
      warnings: [],
    });

    expect(statuses[0]).toEqual(expect.objectContaining({ dataName: '条件选股', status: 'available' }));
  });

  it('完整但零命中的本地选股不会被记录为数据缺口', () => {
    const statuses = createDataStatuses(createContext(), 'screenLocalAStocks', 'tool-local-screen-empty', {
      source: 'duckdb:market',
      storage: 'local',
      rows: [],
      matchedCount: 0,
      returnedCount: 0,
      warnings: [],
      isEmpty: true,
    });

    expect(statuses[0]).toEqual(expect.objectContaining({ dataName: '本地选股/筹码筛选', status: 'available' }));
  });

  it('联网搜索工具会映射到联网搜索数据状态', () => {
    const statuses = createDataStatuses(createContext(), 'webSearch', 'tool-web-search', {
      query: '半导体 催化',
      results: [{ title: '新闻', url: 'https://example.com', snippet: '摘要' }],
      warnings: [],
    });

    expect(statuses[0]).toEqual(expect.objectContaining({ dataName: '联网搜索', status: 'available' }));
  });

  it('市值筛选工具会映射到 A 股市值筛选数据状态', () => {
    const statuses = createDataStatuses(createContext(), 'screenASharesByMarketCap', 'tool-4', {
      rows: [{ code: '600001', marketCapYi: 50 }],
      warnings: ['部分股票缺少市值'],
    });

    expect(statuses[0]).toEqual(expect.objectContaining({ dataName: 'A股市值筛选', status: 'partial' }));
  });

  it('跳过状态会绑定计划项且不会被视为可用', () => {
    const status = createSkippedDataStatus(createContext(), 'getStockChipDistribution', '筹码集中度', '计划跳过');

    expect(status.status).toBe('skipped');
    expect(status.relatedPlanItemIds).toContain('chip-structure');
  });
});
