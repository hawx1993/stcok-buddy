import { describe, expect, it } from 'vitest';
import { getVisibleActiveConversationId, shouldSkipConversationSelection } from '../index';

describe('侧栏会话选中态', () => {
  it('非聊天主视图不应显示会话选中高亮', () => {
    expect(getVisibleActiveConversationId('chat', 'conversation-1')).toBe('conversation-1');
    expect(getVisibleActiveConversationId('market', 'conversation-1')).toBeUndefined();
    expect(getVisibleActiveConversationId('discovery', 'conversation-1')).toBeUndefined();
    expect(getVisibleActiveConversationId('news-reader', 'conversation-1')).toBeUndefined();
  });

  it('只有已在聊天视图且点击当前会话时才跳过切换', () => {
    expect(shouldSkipConversationSelection('chat', 'conversation-1', 'conversation-1')).toBe(true);
    expect(shouldSkipConversationSelection('chat', 'conversation-1', 'conversation-2')).toBe(false);
    expect(shouldSkipConversationSelection('market', 'conversation-1', 'conversation-1')).toBe(false);
  });
});
