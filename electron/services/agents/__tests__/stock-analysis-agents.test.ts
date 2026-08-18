import { describe, expect, it, vi } from 'vitest';

vi.mock('../../llm/index', () => ({
  generateReport: vi.fn(),
}));

vi.mock('../evidence', () => ({
  fallbackEvidence: (id: string, title: string) => ({ id, source: 'fallback', title }),
}));

import {
  buildStockAnalysisInputForAgent,
  createChipUnavailableReport,
  parseStructuredAgentOutput,
  runStockAnalysisSubAgent,
  stockAnalysisAgentNames,
} from '../stock-analysis-agents.js';
import type { EvidenceItem, IAgentDataGap, IAgentPlan, KlinePoint } from '../../../../src/shared/types.js';
import type { StockAnalysisInput } from '../stock-analysis-agents.js';

const evidence: EvidenceItem[] = [
  { id: 'quote-1', source: 'quote', title: '行情' },
  { id: 'kline-1', source: 'kline', title: 'K线' },
  { id: 'fund-1', source: 'fund-flow', title: '资金' },
  { id: 'news-1', source: 'news', title: '新闻' },
  { id: 'chip-1', source: 'chip', title: '筹码' },
];

function klineRows(count: number): KlinePoint[] {
  return Array.from({ length: count }, (_, index) => ({
    time: `2026-07-${String(index + 1).padStart(2, '0')}`,
    open: 10,
    close: 11,
    high: 12,
    low: 9,
    volume: 100,
  }));
}

function input(): StockAnalysisInput {
  return {
    query: '分析测试股',
    symbol: '600001',
    stockLabel: '测试股',
    quote: { code: '600001', name: '测试股' },
    technical: { title: '技术', rows: [] },
    kline: klineRows(35),
    news: [{ id: 'n1', title: '新闻', source: 'test', time: '2026-07-31', tags: [] }],
    largeOrders: [{ id: 'o1', title: '大单买入' }],
    chip: { latest: {} },
    evidence,
  };
}

const agent = { name: 'technical' as const, label: '技术面', dimension: 'technical' as const };

const plan: IAgentPlan = {
  id: 'plan-analysis-600001',
  intent: 'analysis',
  target: '600001',
  summary: '测试计划',
  assumptions: [],
  items: [],
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

describe('股票分析子 Agent 输入裁剪', () => {
  it('技术面输入保留最近 30 根 K 线和相关证据', () => {
    const result = buildStockAnalysisInputForAgent('technical', input());

    expect(result.kline).toHaveLength(30);
    expect(result.evidence?.map((item) => item.source)).toEqual(['quote', 'kline']);
    expect(result.news).toBeUndefined();
  });

  it('资金面输入保留最近 5 根 K 线和资金相关字段', () => {
    const result = buildStockAnalysisInputForAgent('capital', input());

    expect(result.kline).toHaveLength(5);
    expect(result.largeOrders).toHaveLength(1);
    expect(result.evidence?.map((item) => item.source)).toEqual(['quote', 'fund-flow']);
  });

  it('返回可用子 Agent 名称和中文标签', () => {
    expect(stockAnalysisAgentNames().map((item) => item.name)).toEqual([
      'technical',
      'fundamental',
      'capital',
      'sentiment',
      'chip',
    ]);
    expect(stockAnalysisAgentNames()[0].label).toContain('技术面分析');
  });

  it('保留计划并按维度过滤数据缺口', () => {
    const result = buildStockAnalysisInputForAgent('technical', {
      ...input(),
      plan,
      dataGaps: [klineGap, { ...klineGap, id: 'gap-news', dataName: '新闻', userMessage: '新闻为空。' }],
      planRevisions: [
        { id: 'r1', reason: '数据采集后计划反思', changes: ['降低置信度'], createdAt: '2026-08-05T00:00:00.000Z' },
      ],
    });

    expect(result.plan?.summary).toBe('测试计划');
    expect(result.dataGaps?.map((gap) => gap.dataName)).toEqual(['K线']);
    expect(result.planRevisions?.[0].changes).toContain('降低置信度');
  });
});

describe('筹码分析报告', () => {
  it('按真实筹码直方图输出用户要求的量化字段和分析框架', async () => {
    const result = await runStockAnalysisSubAgent('chip', {
      ...input(),
      quote: { code: '600001', name: '测试股', price: 11.2 },
      chip: {
        latest: {
          date: '2026-08-10',
          profitRatio: 0.66,
          avgCost: 10.8,
          cost70: '10.00-11.40',
          cost90: '9.20-12.20',
          concentration70: 0.12,
          concentration90: 0.18,
          points: [
            { price: 9.2, weight: 0.08 },
            { price: 10.0, weight: 0.28 },
            { price: 10.8, weight: 0.14 },
            { price: 11.2, weight: 0.16 },
            { price: 11.8, weight: 0.22 },
            { price: 12.2, weight: 0.22 },
          ],
        },
        distributions: [],
        trend: [
          { days: 5, concentration70: 0.12, concentration90: 0.18 },
          { days: 10, concentration70: 0.13, concentration90: 0.19 },
          { days: 20, concentration70: 0.16, concentration90: 0.23 },
        ],
        source: 'stock-sdk',
        sourceTrace: ['stock-sdk 返回成功，使用最新真实数据。'],
      },
      evidence,
    });

    expect(result.content).toContain('🧩 筹码雷达');
    expect(result.content).toContain('- 标的：测试股（600001）');
    expect(result.content).toContain('- 筹码集中度(90%)：18.0%');
    expect(result.content).toContain('1. 筹码画像');
    expect(result.content).toContain('2. 筹码结构');
    expect(result.content).toContain('3. 多空博弈');
    expect(result.content).toContain('4. 主力行为推测');
    expect(result.content).toContain('5. 关键价位');
    expect(result.content).toContain('📐 Fibonacci关键价位');
    expect(result.content).toContain('波段：\n9.00 → 12.00');
    expect(result.content).toContain('当前价格：\n11.20');
    expect(result.content).toContain('- 斐波那契回调23.6%   11.29');
    expect(result.content).toContain('- 斐波那契回调38.2%   10.85');
    expect(result.content).toContain('- 斐波那契回调50%     10.50');
    expect(result.content).toContain('- 斐波那契回调61.8%   10.15');
    expect(result.content).toContain('🔴 上涨目标位');
    expect(result.content).toContain('- 前高突破   12.00');
    expect(result.content).toContain('- 1.272目标  12.82');
    expect(result.content).toContain('- 1.414目标  13.24');
    expect(result.content).toContain('- 1.618目标  13.85');
    expect(result.content).toContain('📊 压力共振');
    expect(result.content).toContain('来源：\n✓ 前高压力\n✓ 筹码密集区');
    expect(result.content).toContain('突破条件：\n成交量放大确认');
    expect(result.content).toContain('> 📐 Fibonacci关键价位');
    expect(result.content).toContain('7. AI评分');
    expect(result.content).toContain('数据源提示：stock-sdk 返回成功');
    expect(result.output.findings[0].dimension).toBe('chip');
    expect(result.output.findings[0].confidence).toBe(0.55);
  });
});

describe('筹码不可用报告', () => {
  it('使用筹码雷达结构并保持缺失数据占位', () => {
    const report = createChipUnavailableReport({ stockLabel: '测试股', symbol: '600001' });

    expect(report).toContain('🧩 筹码雷达');
    expect(report).toContain('- 标的：测试股（600001）');
    expect(report).toContain('2. 筹码结构');
    expect(report).toContain('4. 主力行为推测');
    expect(report).toContain('7. AI评分');
    expect(report).toContain('强支撑：--');
    expect(report).toContain('> 📐 Fibonacci关键价位');
    expect(report).toContain('- 斐波那契回调23.6%   --');
    expect(report).toContain('- 前高突破   --');
    expect(report).toContain('- 1.272目标  --');
    expect(report).toContain('- 1.618目标  --');
    expect(report).toContain('📊 压力共振\n\n不可确认');
    expect(report).not.toContain('来源：\n× 前高压力与筹码密集区未形成可确认重叠');
    expect(report).toContain('风险：--');
    expect(report).not.toContain('23.8');
    expect(report).not.toContain('25.6');
    expect(report).not.toContain('筹码健康：62');
  });
});

describe('结构化 Agent 输出解析', () => {
  it('解析 JSON 代码块并过滤不存在的证据 ID', () => {
    const raw =
      '```json\n{"findings":[{"id":"f1","dimension":"technical","stance":"bullish","score":120,"confidence":2,"summary":"趋势偏强","evidenceIds":["quote-1","missing"],"risks":["回撤"]}],"markdown":"### 技术面\\n趋势偏强"}\n```';

    const result = parseStructuredAgentOutput(raw, agent, input(), evidence);

    expect(result.agentName).toBe('technical');
    expect(result.findings[0]).toEqual(
      expect.objectContaining({
        id: 'f1',
        stance: 'bullish',
        score: 100,
        confidence: 1,
        evidenceIds: ['quote-1'],
        risks: ['回撤'],
      }),
    );
    expect(result.markdown).toBe('### 技术面\n趋势偏强');
  });

  it('无效 JSON 时返回兜底结构化输出', () => {
    const result = parseStructuredAgentOutput('不是 JSON', agent, input(), []);

    expect(result.agentName).toBe('technical');
    expect(result.findings[0].id).toBe('technical-fallback');
    expect(result.evidence[0]).toEqual(expect.objectContaining({ source: 'fallback' }));
    expect(result.markdown).toContain('数据不足');
  });

  it('有数据缺口时兜底 finding 降低置信度并写入风险', () => {
    const result = parseStructuredAgentOutput('不是 JSON', agent, { ...input(), dataGaps: [klineGap] }, []);

    expect(result.findings[0].confidence).toBe(0.25);
    expect(result.findings[0].score).toBeUndefined();
    expect(result.findings[0].risks[0]).toContain('K线数据为空');
  });

  it('数据缺口覆盖维度时会压低模型返回的确定性结论', () => {
    const raw =
      '{"findings":[{"id":"f1","dimension":"technical","stance":"bullish","score":90,"confidence":0.9,"summary":"突破","evidenceIds":["kline-1"],"risks":[]}],"markdown":"### 技术面"}';

    const result = parseStructuredAgentOutput(raw, agent, { ...input(), dataGaps: [klineGap] }, evidence);

    expect(result.findings[0].stance).toBe('unknown');
    expect(result.findings[0].score).toBeUndefined();
    expect(result.findings[0].confidence).toBeLessThanOrEqual(0.4);
    expect(result.findings[0].risks.join('')).toContain('K线数据为空');
  });
});
