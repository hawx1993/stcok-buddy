import { describe, expect, it } from 'vitest';

import type { IAgentDataStatus } from '../../../../src/shared/types.js';
import { createInitialAgentPlan } from '../agent-planning.js';
import {
  createDataGapFromStatus,
  formatDataGapsForPrompt,
  reflectBeforeFinalReport,
  reflectOnPlanAfterData,
} from '../agent-reflection.js';
import type { IAgentContext } from '../orchestrator-types.js';

function createContext(dataStatuses: IAgentDataStatus[] = []): IAgentContext {
  const context: IAgentContext = {
    query: '分析 600519 值不值得关注',
    intent: 'analysis',
    urls: [],
    symbol: '600519',
    evidence: [],
    toolCalls: [],
    findings: [],
    dataStatuses,
  };
  context.plan = createInitialAgentPlan(context);
  return context;
}

describe('agent-reflection 数据缺口反思', () => {
  it('工具失败状态会生成数据缺口并定位影响计划项', () => {
    const context = createContext();
    const status: IAgentDataStatus = {
      id: 'status-1',
      toolName: 'getStockQuote',
      dataName: '行情',
      status: 'failed',
      reason: '接口超时',
      relatedPlanItemIds: [],
      recordId: 'tool-1',
    };

    const gap = createDataGapFromStatus(status, context.plan);

    expect(gap).toEqual(expect.objectContaining({ dataName: '行情', status: 'failed', impact: 'high' }));
    expect(gap?.affectedPlanItemIds).toContain('quote-strength');
  });

  it('partial 和 stale 状态会生成计划调整', () => {
    const context = createContext([
      {
        id: 'status-1',
        toolName: 'getHistoricalDailyBars',
        dataName: 'K线',
        status: 'stale',
        reason: '历史日线过期',
        relatedPlanItemIds: ['technical-structure'],
      },
      {
        id: 'status-2',
        toolName: 'getStockFundFlowSnapshot',
        dataName: '资金流',
        status: 'partial',
        reason: '主动买卖样本不足',
        relatedPlanItemIds: ['capital-flow'],
      },
    ]);

    const reflection = reflectOnPlanAfterData(context, 'market-data');

    expect(reflection.passed).toBe(false);
    expect(reflection.dataGaps.map((gap) => gap.dataName)).toEqual(['K线', '资金流']);
    expect(reflection.revisions[0].changes.join('')).toContain('降低置信度');
    expect(context.plan?.dataGaps).toHaveLength(2);
  });

  it('最终反思会合并合规问题和数据缺口并格式化给 prompt', () => {
    const context = createContext([
      {
        id: 'status-1',
        toolName: 'getStockNewsAnnouncements',
        dataName: '新闻',
        status: 'empty',
        reason: '新闻为空',
        relatedPlanItemIds: ['sector-news-risk'],
      },
    ]);

    const reflection = reflectBeforeFinalReport(context, ['已追加风险提示']);

    expect(reflection.passed).toBe(false);
    expect(reflection.issues).toContain('已追加风险提示');
    expect(formatDataGapsForPrompt(reflection.dataGaps)).toContain('新闻');
    expect(context.finalReflection?.dataGaps[0].userMessage).toContain('新闻');
  });

  it('筹码缺失时会把可选筹码计划项标记为跳过', () => {
    const context = createContext([
      {
        id: 'status-chip',
        toolName: 'getStockChipDistribution',
        dataName: '筹码集中度',
        status: 'empty',
        reason: '筹码为空',
        relatedPlanItemIds: ['chip-structure'],
      },
    ]);

    reflectOnPlanAfterData(context, 'market-data');

    expect(context.plan?.items.find((item) => item.id === 'chip-structure')?.status).toBe('skipped');
  });

  it('最终反思会发现缺少有效证据和确定性建议', () => {
    const context = createContext();
    context.analysisOverview = '必须买入，后续必涨。';
    context.findings.push({
      id: 'technical-1',
      dimension: 'technical',
      stance: 'bullish',
      confidence: 0.8,
      summary: '趋势偏强',
      evidenceIds: ['missing'],
      risks: [],
    });

    const reflection = reflectBeforeFinalReport(context, []);

    expect(reflection.issues.join('')).toContain('缺少有效证据引用');
    expect(reflection.issues.join('')).toContain('确定性买卖建议');
  });
});
