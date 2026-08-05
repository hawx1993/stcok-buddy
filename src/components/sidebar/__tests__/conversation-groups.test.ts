import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from '../../../shared/types';
import { groupConversations } from '../index';

function createConversation(id: string, updatedAt: string): ConversationSummary {
  return {
    id,
    title: `会话 ${id}`,
    preview: '',
    date: updatedAt,
    updatedAt,
    tab: 'stock',
    count: 1,
  };
}

describe('侧栏会话分组', () => {
  it('按更新时间降序分组，异常时间不会导致分组崩溃', () => {
    const groups = groupConversations(
      [createConversation('old', 'not-a-date'), createConversation('today', '2026-08-05T09:30:00.000Z')],
      new Date('2026-08-05T12:00:00.000Z'),
    );

    expect(groups[0]).toMatchObject({ label: '最新' });
    expect(groups[0].conversations.map((item) => item.id)).toEqual(['today']);
    expect(groups[1].conversations.map((item) => item.id)).toEqual(['old']);
  });
});
