import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../../../shared/types';
import { findSearchTargetMessageId, highlightSearchTermInHtml } from '../search-highlight';

function message(id: string, content: string): ChatMessage {
  return { id, role: 'assistant', content, createdAt: '2026-08-05T00:00:00.000Z' };
}

describe('chat search highlight helpers', () => {
  it('优先使用搜索结果中的消息 id 定位', () => {
    const messages = [message('m-1', '贵州茅台'), message('m-2', '低空经济')];

    expect(findSearchTargetMessageId(messages, { messageId: 'm-2', query: '贵州' })).toBe('m-2');
  });

  it('没有消息 id 时按正文关键词定位', () => {
    const messages = [message('m-1', '贵州茅台'), message('m-2', '低空经济资金流')];

    expect(findSearchTargetMessageId(messages, { query: '经济资金' })).toBe('m-2');
  });

  it('只高亮 HTML 文本内容，不改动标签属性', () => {
    const html = '<a data-stock-name="低空经济">低空经济</a><span title="低空经济">资金流</span>';

    expect(highlightSearchTermInHtml(html, '低空经济')).toBe(
      '<a data-stock-name="低空经济"><mark class="chat-search-hit">低空经济</mark></a><span title="低空经济">资金流</span>',
    );
  });

  it('空关键词返回原始 HTML', () => {
    const html = '<p>低空经济</p>';

    expect(highlightSearchTermInHtml(html, '   ')).toBe(html);
  });
});
