import { describe, expect, it } from 'vitest';

import type { AgentRunEvent } from '../../../../../shared/types';
import { deriveAgentStatuses } from '../derived';

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
});
