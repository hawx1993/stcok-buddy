import { describe, expect, it } from 'vitest';

import type { DagNode } from '../dag-executor.js';
import type { IAgentContext } from '../orchestrator-types.js';
import {
  attachPlanNodeCoverage,
  createInitialAgentPlan,
  findPlanItemIdsByDataName,
  formatPlanMessage,
  markPlanItemsByDataGap,
  planNeedsData,
  shouldRunPlanNode,
} from '../agent-planning.js';

function createContext(partial: Partial<IAgentContext> = {}): IAgentContext {
  return {
    query: '分析 600519 值不值得关注',
    intent: 'analysis',
    urls: [],
    symbol: '600519',
    evidence: [],
    toolCalls: [],
    findings: [],
    ...partial,
  };
}

function createNode(id: string): DagNode<IAgentContext> {
  return {
    id,
    agent: id,
    description: id,
    run: async () => undefined,
  };
}

describe('agent-planning 分析计划', () => {
  it('会为综合分析生成真实数据检查清单和默认兜底策略', () => {
    const plan = createInitialAgentPlan(createContext());

    expect(plan.intent).toBe('analysis');
    expect(plan.target).toBe('600519');
    expect(plan.items.length).toBeGreaterThan(3);
    expect(plan.items.every((item) => item.status === 'pending')).toBe(true);
    expect(plan.items.every((item) => Boolean(item.fallbackStrategy))).toBe(true);
    expect(plan.items.find((item) => item.id === 'quote-strength')?.fallbackStrategy).toContain('不用替代数据伪造结论');
    expect(plan.assumptions).toContain('分析标的为 600519。');
  });

  it('会按实际 DAG 节点过滤计划覆盖范围', () => {
    const plan = createInitialAgentPlan(createContext());
    const covered = attachPlanNodeCoverage(plan, [createNode('quote'), createNode('market-data')]);

    expect(covered.items.flatMap((item) => item.relatedNodeIds).every((id) => ['quote', 'market-data'].includes(id))).toBe(
      true,
    );
    expect(covered.items.some((item) => item.relatedNodeIds.includes('analysis-report'))).toBe(false);
  });

  it('会根据数据名称定位受影响的计划项并格式化说明', () => {
    const plan = createInitialAgentPlan(createContext({ intent: 'technical', query: '分析 600519 技术面' }));
    const affected = findPlanItemIdsByDataName(plan, 'K线');
    const message = formatPlanMessage(plan);

    expect(affected).toContain('kline-trend');
    expect(message).toContain('为了做技术面判断');
    expect(message).toContain('K线');
  });

  it('会用数据需求判断计划是否需要对应工具', () => {
    const plan = createInitialAgentPlan(createContext());

    expect(planNeedsData(plan, '筹码集中度')).toBe(true);
    expect(planNeedsData(plan, '资金流')).toBe(true);
    expect(planNeedsData(plan, '不存在的数据')).toBe(false);
  });

  it('会根据数据缺口跳过可选计划项并阻塞高影响计划项', () => {
    const plan = createInitialAgentPlan(createContext());
    const next = markPlanItemsByDataGap(plan, [
      {
        id: 'gap-chip',
        dataName: '筹码集中度',
        status: 'empty',
        reason: '筹码为空',
        affectedPlanItemIds: ['chip-structure'],
        impact: 'medium',
        userMessage: '筹码为空。',
      },
      {
        id: 'gap-kline',
        dataName: 'K线',
        status: 'failed',
        reason: 'K线失败',
        affectedPlanItemIds: ['technical-structure'],
        impact: 'high',
        userMessage: 'K线失败。',
      },
    ]);

    expect(next.items.find((item) => item.id === 'chip-structure')?.status).toBe('skipped');
    expect(next.items.find((item) => item.id === 'technical-structure')?.status).toBe('blocked');
    expect(shouldRunPlanNode(next, 'analysis-chip')).toBe(false);
  });
});
