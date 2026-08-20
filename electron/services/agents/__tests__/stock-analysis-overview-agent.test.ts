import { describe, expect, it, vi } from 'vitest';

vi.mock('../../llm/index', () => ({
  generateReport: vi.fn(() => {
    throw new Error('模型不可用');
  }),
}));

vi.mock('../../llm/openai-compatible-client', () => ({
  isLlmRequestError: () => false,
}));

import type { IAgentDataGap, IAgentPlan, IStockFundFlowSnapshot } from '../../../../src/shared/types.js';
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

const klineGap: IAgentDataGap = {
  id: 'gap-kline',
  dataName: 'K线',
  status: 'empty',
  reason: 'K线为空',
  affectedPlanItemIds: ['technical-structure'],
  impact: 'high',
  userMessage: 'K线数据为空，技术判断需降低置信度。',
};

const fundFlowGap: IAgentDataGap = {
  id: 'gap-fund-flow',
  dataName: '资金流',
  status: 'empty',
  reason: '资金流为空',
  affectedPlanItemIds: ['capital-flow'],
  impact: 'high',
  userMessage: '资金流数据为空，资金面不能视为已确认。',
};

const technicalResult: StockAnalysisResult = {
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

const capitalResult: StockAnalysisResult = {
  name: 'capital',
  label: '💰 资金面分析',
  content: '资金面数据不足',
  output: {
    agentName: 'capital',
    label: '💰 资金面分析',
    findings: [
      {
        id: 'capital-1',
        dimension: 'capital',
        stance: 'unknown',
        confidence: 0.2,
        summary: '资金流字段缺失，暂不判断主力方向',
        evidenceIds: ['fund-flow-1'],
        risks: ['资金流缺口'],
      },
    ],
    evidence: [{ id: 'fund-flow-1', source: 'fund-flow', title: '资金流不足', summary: '资金流字段缺失' }],
    markdown: '### 资金面\n资金流字段缺失',
  },
};

const emptyFundFlow: IStockFundFlowSnapshot = {
  date: '2026-08-19',
  mainNetInflow: null,
  mainNetInflowPercent: null,
  superLargeNetInflow: null,
  superLargeNetInflowPercent: null,
  largeNetInflow: null,
  largeNetInflowPercent: null,
  mediumNetInflow: null,
  mediumNetInflowPercent: null,
  smallNetInflow: null,
  smallNetInflowPercent: null,
  source: 'stock-sdk',
  warnings: ['所有资金流数据源均未返回有效的净流入数据'],
};

const zeroFundFlow: IStockFundFlowSnapshot = {
  date: '2026-08-19',
  mainNetInflow: 0,
  mainNetInflowPercent: 0,
  superLargeNetInflow: 0,
  superLargeNetInflowPercent: 0,
  largeNetInflow: 0,
  largeNetInflowPercent: 0,
  mediumNetInflow: 0,
  mediumNetInflowPercent: 0,
  smallNetInflow: 0,
  smallNetInflowPercent: 0,
  source: 'stock-sdk',
};

describe('股票综合报告最终正文', () => {
  it('fallback overview 删除过程型小节并保留四个结果维度', async () => {
    const report = await runStockAnalysisOverview(
      {
        query: '分析测试股',
        symbol: '600001',
        stockLabel: '测试股',
        plan,
        dataGaps: [klineGap],
        planRevisions: [
          { id: 'r1', reason: '数据采集后计划反思', changes: ['降低置信度'], createdAt: '2026-08-05T00:00:00.000Z' },
        ],
      },
      [technicalResult],
    );

    expect(report).not.toContain('### 🧭 分析计划回顾');
    expect(report).not.toContain('### ⚠️ 数据缺口与影响');
    expect(report).not.toContain('### 🚨 风险排除');
    expect(report).not.toContain('### 🧭 观察框架');
    expect(report).toContain('### 📈 技术面分析');
    expect(report).toContain('### 📊 基本面分析');
    expect(report).toContain('### 💰 资金面分析');
    expect(report).toContain('### 🧩 筹码分析');
    expect(report).toContain('### 📄 证据摘要');
    expect(report).toContain('### 🚨 风险提示');
    expect(report).toContain('K线数据为空');
    expect(report).toContain('暂不硬判断');
  });

  it('资金流缺失时不把缺失字段展示为零值', async () => {
    const report = await runStockAnalysisOverview(
      {
        query: '分析测试股资金面',
        symbol: '600001',
        stockLabel: '测试股',
        plan,
        dataGaps: [fundFlowGap],
        fundFlow: emptyFundFlow,
      },
      [capitalResult],
    );

    expect(report).toContain('### 💰 资金面分析');
    expect(report).toContain('暂无真实资金流数据');
    expect(report).not.toContain('+0.00');
    expect(report).not.toContain('+0.00%');
  });

  it('真实零值资金流保留为零但不添加正号', async () => {
    const report = await runStockAnalysisOverview(
      {
        query: '分析测试股资金面',
        symbol: '600001',
        stockLabel: '测试股',
        plan,
        dataGaps: [],
        fundFlow: zeroFundFlow,
      },
      [capitalResult],
    );

    expect(report).toContain('净流向持平约 0.00 亿');
    expect(report).toContain('| 主力合计 | **0.00** | **0.00%** |');
    expect(report).not.toContain('暂无真实资金流数据');
    expect(report).not.toContain('+0.00');
    expect(report).not.toContain('+0.00%');
  });
});
