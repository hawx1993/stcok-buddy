import { describe, expect, it, vi } from 'vitest';

vi.mock('../../tools/tool-registry.js', () => ({
  callTool: vi.fn(),
}));

import type { ToolCallRecord } from '../../../../src/shared/types.js';
import { callTool } from '../../tools/tool-registry.js';
import { createInitialAgentPlan } from '../agent-planning.js';
import { createDataStatuses, createSkippedDataStatus, inferToolDataStatus, isEmptyToolOutput, runContextTool } from '../agent-tool-runtime.js';
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

  it('新闻公告复合输出会分别记录缺口', () => {
    const statuses = createDataStatuses(
      createContext(),
      'getStockNewsAnnouncements',
      'tool-2',
      { news: [{ title: '新闻' }], announcements: [] },
    );

    expect(statuses.map((status) => [status.dataName, status.status])).toEqual([
      ['新闻', 'available'],
      ['公告', 'empty'],
    ]);
  });

  it('筹码本地优先工具会映射到筹码集中度数据状态', () => {
    const statuses = createDataStatuses(
      createContext(),
      'getStockChipDistributionLocalFirst',
      'tool-3',
      { latest: { concentration90: 0.18, concentration70: 0.12 }, recent: [{ date: '2026-08-05' }] },
    );

    expect(statuses[0]).toEqual(expect.objectContaining({ dataName: '筹码集中度', status: 'available' }));
  });

  it('市值筛选工具会映射到 A 股市值筛选数据状态', () => {
    const statuses = createDataStatuses(
      createContext(),
      'screenASharesByMarketCap',
      'tool-4',
      { rows: [{ code: '600001', marketCapYi: 50 }], warnings: ['部分股票缺少市值'] },
    );

    expect(statuses[0]).toEqual(expect.objectContaining({ dataName: 'A股市值筛选', status: 'partial' }));
  });

  it('跳过状态会绑定计划项且不会被视为可用', () => {
    const status = createSkippedDataStatus(createContext(), 'getStockChipDistribution', '筹码集中度', '计划跳过');

    expect(status.status).toBe('skipped');
    expect(status.relatedPlanItemIds).toContain('chip-structure');
  });
});
