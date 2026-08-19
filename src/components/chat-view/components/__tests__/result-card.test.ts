import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AgentResultCard } from '../../../../shared/types';

vi.mock('../../../kline-chart', () => ({
  KlineModal: () => null,
  StockKlineChart: () => null,
}));

import { ResultCard } from '../result-card';

function renderResultCard(result: AgentResultCard) {
  return renderToStaticMarkup(
    createElement(ResultCard, {
      result,
      onStockClick: () => undefined,
      onBoardClick: () => undefined,
    }),
  );
}

describe('ResultCard', () => {
  it('does not repeat the full-market dragon tiger narrative below its table', () => {
    const html = renderResultCard({
      title: '全市场龙虎榜',
      subtitle: '2026-08-18 · 净买入前 1 条',
      rows: [{ 排名: 1, 代码: '300684', 名称: '中石科技' }],
      narrative: '## 📰 核心事件\n- 重复叙述',
    });

    expect(html).toContain('中石科技');
    expect(html).not.toContain('重复叙述');
  });

  it('does not repeat the theme attribution narrative below its structured card data', () => {
    const html = renderResultCard({
      title: '题材归因',
      subtitle: '强势股 1 只 · 热点题材 1 个',
      metrics: [{ label: '强势股', value: '1只' }],
      rows: [{ 类型: '强势股', 名称: '示例股票' }],
      narrative: '## 📰 核心事件\n- 重复叙述',
    });

    expect(html).toContain('强势股 1 只 · 热点题材 1 个');
    expect(html).toContain('示例股票');
    expect(html).not.toContain('重复叙述');
  });

  it('continues to render narratives for other result cards', () => {
    const html = renderResultCard({
      title: '今日热门题材',
      subtitle: '热度排行',
      narrative: '## 📰 核心事件\n- 保留叙述',
    });

    expect(html).toContain('保留叙述');
  });
});
