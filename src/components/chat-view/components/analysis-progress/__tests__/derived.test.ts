import { describe, expect, it } from 'vitest';

import type { AgentRunEvent } from '../../../../../shared/types';
import { deriveAgentStatuses, deriveSteps, formatProgressSummary } from '../derived';

describe('formatProgressSummary 进度摘要', () => {
  it('完成后只显示步骤数，不再显示会继续累加的耗时', () => {
    expect(
      formatProgressSummary({
        preparing: false,
        pending: false,
        terminal: 3,
        total: 3,
        elapsedSec: 120,
      }),
    ).toBe('3/3 步骤');
  });

  it('运行中保留步骤数和实时耗时', () => {
    expect(
      formatProgressSummary({
        preparing: false,
        pending: true,
        terminal: 1,
        total: 3,
        elapsedSec: 8,
      }),
    ).toBe('1/3 步骤 · 8s');
  });
});

describe('deriveSteps 步骤列表推导', () => {
  it('保留计划外长步骤描述，不主动截断为省略号', () => {
    const description = '先查本地 DuckDB，再按 stock-sdk 和 a-stock-data 补充分析';
    const steps = deriveSteps([
      {
        type: 'plan_created',
        progress: { current: 0, total: 1 },
        plan: { agents: [{ id: 'a-stock-data-agent', agent: 'a-stock-data', description }] },
      },
      {
        type: 'subagent_completed',
        step: { id: 'a-stock-data-agent', agent: 'a-stock-data', description, status: 'completed' },
        subAgent: { name: 'a-stock-data', status: 'completed' },
      },
    ]);

    expect(steps[0].label).toBe(description);
    expect(steps[0].label).not.toContain('…');
  });
});

describe('自由提问数据源步骤推导', () => {
  it('DuckDB 数据可用时按顺序显示远程数据源已跳过', () => {
    const events: AgentRunEvent[] = [
      {
        type: 'plan_created',
        progress: { current: 0, total: 1 },
        plan: { agents: [{ id: 'a-stock-data-agent', agent: 'a-stock-data', description: '先查本地 DuckDB' }] },
      },
      {
        type: 'subagent_started',
        step: { id: 'a-stock-data-agent', agent: 'a-stock-data', description: '自由提问投研', status: 'running' },
        subAgent: { name: 'a-stock-data', status: 'running' },
      },
      {
        type: 'tool_started',
        tool: { name: 'queryLocalDuckDBData', status: 'running' },
      },
      {
        type: 'tool_completed',
        tool: { name: 'queryLocalDuckDBData', status: 'success' },
      },
      {
        type: 'subagent_completed',
        step: { id: 'a-stock-data-agent', agent: 'a-stock-data', description: '自由提问投研', status: 'completed' },
        subAgent: { name: 'a-stock-data', status: 'completed' },
      },
    ];

    expect(deriveSteps(events)).toEqual([
      { id: 'provider-duckdb', label: '1. DuckDB 本地库数据可用', status: 'completed' },
      { id: 'provider-stock-sdk', label: '2. stock-sdk 已跳过', status: 'skipped' },
      { id: 'provider-a-stock-data', label: '3. a-stock-data 已跳过', status: 'skipped' },
    ]);
  });

  it('a-stock-data 已完成时将未调用的 stock-sdk 标记为已跳过', () => {
    const events: AgentRunEvent[] = [
      {
        type: 'plan_created',
        progress: { current: 0, total: 1 },
        plan: { agents: [{ id: 'a-stock-data-agent', agent: 'a-stock-data', description: '先查本地 DuckDB' }] },
      },
      {
        type: 'tool_completed',
        tool: { name: 'queryLocalDuckDBData', status: 'success' },
      },
      {
        type: 'tool_completed',
        tool: { name: 'getHotConcepts', status: 'success' },
      },
      {
        type: 'final_answer',
        message: '分析完成',
      },
    ];

    expect(deriveSteps(events)).toEqual([
      { id: 'provider-duckdb', label: '1. DuckDB 本地库数据可用', status: 'completed' },
      { id: 'provider-stock-sdk', label: '2. stock-sdk 已跳过', status: 'skipped' },
      { id: 'provider-a-stock-data', label: '3. a-stock-data 数据可用', status: 'completed' },
    ]);
  });

  it('DuckDB 不足时显示 stock-sdk 正在补充', () => {
    const events: AgentRunEvent[] = [
      {
        type: 'plan_created',
        progress: { current: 0, total: 1 },
        plan: { agents: [{ id: 'a-stock-data-agent', agent: 'a-stock-data', description: '先查本地 DuckDB' }] },
      },
      {
        type: 'subagent_started',
        step: { id: 'a-stock-data-agent', agent: 'a-stock-data', description: '自由提问投研', status: 'running' },
        subAgent: { name: 'a-stock-data', status: 'running' },
      },
      {
        type: 'tool_completed',
        tool: { name: 'queryLocalDuckDBData', status: 'success' },
      },
      {
        type: 'tool_started',
        tool: { name: 'getStockQuoteLocalFirst', status: 'running' },
      },
    ];

    expect(deriveSteps(events).map((step) => [step.id, step.status])).toEqual([
      ['provider-duckdb', 'completed'],
      ['provider-stock-sdk', 'running'],
      ['provider-a-stock-data', 'pending'],
    ]);
  });

  it('同一数据源阶段已有完成工具后，后续工具开始不会让进度回退', () => {
    const events: AgentRunEvent[] = [
      {
        type: 'plan_created',
        progress: { current: 0, total: 1 },
        plan: { agents: [{ id: 'a-stock-data-agent', agent: 'a-stock-data', description: '先查本地 DuckDB' }] },
      },
      {
        type: 'subagent_started',
        step: { id: 'a-stock-data-agent', agent: 'a-stock-data', description: '自由提问投研', status: 'running' },
        subAgent: { name: 'a-stock-data', status: 'running' },
      },
      {
        type: 'tool_completed',
        tool: { name: 'queryLocalDuckDBData', status: 'success' },
      },
      {
        type: 'tool_started',
        tool: { name: 'queryLocalSurgeDuckDB', status: 'running' },
      },
    ];

    expect(deriveSteps(events).map((step) => [step.id, step.status])).toEqual([
      ['provider-duckdb', 'completed'],
      ['provider-stock-sdk', 'pending'],
      ['provider-a-stock-data', 'pending'],
    ]);
  });
});

describe('deriveAgentStatuses 协作行推导', () => {
  it('计划外 LocalDuckDBAgent 启动时新增本地 DuckDB 行', () => {
    const events: AgentRunEvent[] = [
      {
        type: 'plan_created',
        progress: { current: 0, total: 1 },
        plan: { agents: [{ id: 'a-stock-data-agent', agent: 'a-stock-data', description: '调用 a-stock-data' }] },
      },
      {
        type: 'subagent_started',
        message: '查询本地 DuckDB 数据库中...',
        step: {
          id: 'local-duckdb',
          agent: 'LocalDuckDBAgent',
          description: '查询本地 DuckDB 数据库',
          status: 'running',
          startedAt: '2026-08-04T10:00:00.000Z',
        },
        subAgent: {
          name: '本地 DuckDB 数据库',
          description: '查询本地 DuckDB 数据库',
          status: 'running',
        },
      },
    ];

    const agents = deriveAgentStatuses(events);

    expect(agents).toHaveLength(2);
    expect(agents[1]).toMatchObject({
      id: 'local-duckdb',
      label: '本地 DuckDB 数据库',
      status: 'running',
      progressMessage: '查询本地 DuckDB 数据库中...',
    });
  });

  it('计划外 LocalDuckDBAgent 完成时展示完成状态和耗时', () => {
    const events: AgentRunEvent[] = [
      {
        type: 'plan_created',
        progress: { current: 0, total: 1 },
        plan: { agents: [{ id: 'a-stock-data-agent', agent: 'a-stock-data', description: '调用 a-stock-data' }] },
      },
      {
        type: 'subagent_started',
        message: '查询本地 DuckDB 数据库中...',
        step: {
          id: 'local-duckdb',
          agent: 'LocalDuckDBAgent',
          description: '查询本地 DuckDB 数据库',
          status: 'running',
        },
        subAgent: {
          name: '本地 DuckDB 数据库',
          status: 'running',
        },
      },
      {
        type: 'subagent_completed',
        message: '本地 DuckDB 查询完成',
        step: {
          id: 'local-duckdb',
          agent: 'LocalDuckDBAgent',
          description: '查询本地 DuckDB 数据库',
          status: 'completed',
          elapsed: 0.6,
        },
        subAgent: {
          name: '本地 DuckDB 数据库',
          status: 'completed',
          elapsed: 0.6,
        },
      },
    ];

    const duckdbAgent = deriveAgentStatuses(events).find((agent) => agent.id === 'local-duckdb');

    expect(duckdbAgent).toMatchObject({
      label: '本地 DuckDB 数据库',
      status: 'completed',
      elapsed: 0.6,
    });
    expect(duckdbAgent?.progressMessage).toBeUndefined();
  });

  it('运行中的 agent-item 显示当前正在调用的工具', () => {
    const events: AgentRunEvent[] = [
      {
        type: 'plan_created',
        progress: { current: 0, total: 1 },
        plan: { agents: [{ id: 'a-stock-data-agent', agent: 'a-stock-data', description: '调用 a-stock-data' }] },
      },
      {
        type: 'subagent_started',
        message: '先查本地 DuckDB',
        step: {
          id: 'a-stock-data-agent',
          agent: 'a-stock-data',
          description: '自由提问投研',
          status: 'running',
        },
        subAgent: { name: 'a-stock-data', status: 'running' },
      },
      {
        type: 'tool_started',
        message: '正在执行 queryLocalDuckDBData',
        tool: { name: 'queryLocalDuckDBData', status: 'running' },
      },
    ];

    const agent = deriveAgentStatuses(events).find((item) => item.id === 'a-stock-data-agent');

    expect(agent?.progressMessage).toBe('正在查询 DuckDB 本地库');
  });

  it('工具失败时 agent-item 显示失败的工具名', () => {
    const events: AgentRunEvent[] = [
      {
        type: 'plan_created',
        progress: { current: 0, total: 1 },
        plan: { agents: [{ id: 'a-stock-data-agent', agent: 'a-stock-data', description: '调用 a-stock-data' }] },
      },
      {
        type: 'subagent_started',
        step: {
          id: 'a-stock-data-agent',
          agent: 'a-stock-data',
          description: '自由提问投研',
          status: 'running',
        },
        subAgent: { name: 'a-stock-data', status: 'running' },
      },
      {
        type: 'tool_failed',
        message: 'getStockQuoteLocalFirst 失败',
        tool: { name: 'getStockQuoteLocalFirst', status: 'failed', error: '接口超时' },
      },
    ];

    const agent = deriveAgentStatuses(events).find((item) => item.id === 'a-stock-data-agent');

    expect(agent?.progressMessage).toBe('工具失败：getStockQuoteLocalFirst');
  });
});
