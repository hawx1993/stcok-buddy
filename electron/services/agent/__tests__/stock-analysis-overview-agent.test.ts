import { describe, expect, it, vi } from 'vitest';

vi.mock('../../llm/index.js', () => ({
  generateReport: vi.fn(() => {
    throw new Error('模型不可用');
  }),
}));

vi.mock('../../llm/openai-compatible-client.js', () => ({
  isLlmRequestError: () => false,
}));

import type { IAgentDataGap, IAgentPlan } from '../../../../src/shared/types.js';
import { runStockAnalysisOverview } from '../stock-analysis-overview-agent.js';
import type { StockAnalysisResult } from '../stock-analysis-agents.js';

const plan: IAgentPlan = {
  id: 'plan-analysis-600001',
  intent: 'analysis',
  target: '600001',
  summary: '测试计划',
  assumptions: [],
  items: [
    {
      id: 'technical-structure',
      title: '检查K线和技术结构',
      reason: '技术判断需要K线',
      dataNeeds: ['K线'],
      status: 'failed',
      relatedNodeIds: ['market-data'],
    },
  ],
  dataGaps: [],
  revisions: [],
};

const gap: IAgentDataGap = {
  id: 'gap-kline',
  dataName: 'K线',
  status: 'empty',
  reason: 'K线为空',
  affectedPlanItemIds: ['technical-structure'],
  impact: 'high',
  userMessage: 'K线数据为空，技术判断需降低置信度。',
};

const result: StockAnalysisResult = {
  name: 'technical',
  label: '📈 技术面分析',
  content: '技术数据不足',
  output: {
    agentName: 'technical',
    label: '📈 技术面分析',
    findings: [
      {
        id: 'technical-1',
        dimension: 'technical',
        stance: 'unknown',
        confidence: 0.25,
        summary: 'K线数据不足',
        evidenceIds: ['fallback-1'],
        risks: ['数据缺口'],
      },
    ],
    evidence: [{ id: 'fallback-1', source: 'fallback', title: 'K线不足' }],
    markdown: '### 技术面\n数据不足',
  },
};

describe('股票综合报告数据缺口兜底', () => {
  it('fallback overview 包含计划回顾、数据缺口与风险排除', async () => {
    const report = await runStockAnalysisOverview(
      {
        query: '分析测试股',
        symbol: '600001',
        stockLabel: '测试股',
        plan,
        dataGaps: [gap],
        planRevisions: [{ id: 'r1', reason: '数据采集后计划反思', changes: ['降低置信度'], createdAt: '2026-08-05T00:00:00.000Z' }],
      },
      [result],
    );

    expect(report).toContain('### 🧭 分析计划回顾');
    expect(report).toContain('### ⚠️ 数据缺口与影响');
    expect(report).toContain('### 🚨 风险排除');
    expect(report).toContain('K线数据为空');
    expect(report).toContain('暂不硬评分');
  });
});
