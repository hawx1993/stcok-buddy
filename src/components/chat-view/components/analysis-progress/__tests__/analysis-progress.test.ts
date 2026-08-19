import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { AgentRunEvent } from '../../../../../shared/types';
import { AnalysisProgress } from '../index';

describe('AnalysisProgress 完成态', () => {
  it('分析目标只显示一次且不再显示正在分析', () => {
    const stockName = '今日领涨板块筛选';
    const events: AgentRunEvent[] = [
      {
        type: 'intent_detected',
        intent: { name: 'stock-screen', label: stockName },
      },
      {
        type: 'plan_created',
        progress: { current: 0, total: 1 },
        plan: { agents: [{ id: 'report', agent: 'ReportAgent', description: '生成投研报告' }] },
      },
      {
        type: 'subagent_completed',
        step: { id: 'analysis-report', agent: 'ReportAgent', description: '生成投研报告', status: 'completed' },
        subAgent: { name: 'ReportAgent', status: 'completed' },
      },
      {
        type: 'final_answer',
        message: '分析完成',
      },
    ];

    const html = renderToStaticMarkup(createElement(AnalysisProgress, { events }));

    expect(html).not.toContain('正在分析');
    expect(html.split(stockName)).toHaveLength(2);
  });
});
