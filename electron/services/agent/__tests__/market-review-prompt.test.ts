import { describe, expect, it } from 'vitest';

import { createMarketReviewMessages } from '../market-review-prompt.js';
import type { TMarketReviewReport } from '../../../../src/shared/types.js';

const report: TMarketReviewReport = {
  tradeDate: '2026-07-31',
  generatedAt: '2026-07-31T08:00:00.000Z',
  dataSources: ['test'],
  dataGaps: ['北向资金'],
  indexSummary: [],
  sentimentScore: null,
  sentiment: [],
  wealthEffect: [],
  profitDirections: [],
  lossDirections: [],
  hotThemes: [],
  leaders: [],
  nextDayFocus: [],
};

describe('创建市场复盘消息', () => {
  it('保留系统消息中的禁止编造和缺失数据约束', () => {
    const [systemMessage] = createMarketReviewMessages(report);

    expect(systemMessage.role).toBe('system');
    expect(systemMessage.content).toContain('严禁');
    expect(systemMessage.content).toContain('编造');
    expect(systemMessage.content).toContain('暂无数据');
    expect(systemMessage.content).toContain('数据源暂不可用');
    expect(systemMessage.content).toContain('不提供买卖建议');
  });

  it('保留必需输出章节并嵌入结构化报告数据', () => {
    const [, userMessage] = createMarketReviewMessages(report);

    expect(userMessage.role).toBe('user');
    expect(userMessage.content).toContain('## 📰 AI 一句话总结');
    expect(userMessage.content).toContain('## 📈 市场情绪');
    expect(userMessage.content).toContain('## 💰 赚钱效应');
    expect(userMessage.content).toContain('## 🌐 热点轮动');
    expect(userMessage.content).toContain('## 🚨 风险提示');
    expect(userMessage.content).toContain('## 🎯 综合结论');
    expect(userMessage.content).toContain('"tradeDate":"2026-07-31"');
  });
});
