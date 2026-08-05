import { describe, expect, it } from 'vitest';

import { getChatAutoScrollBehavior, getChatLastMessageIndex, isNearChatBottom, shouldAutoScrollChat } from '../auto-scroll';

describe('isNearChatBottom', () => {
  it('接近底部时返回 true', () => {
    expect(isNearChatBottom({ scrollTop: 952, clientHeight: 500, scrollHeight: 1500 })).toBe(true);
  });

  it('明显离开底部时返回 false', () => {
    expect(isNearChatBottom({ scrollTop: 700, clientHeight: 500, scrollHeight: 1500 })).toBe(false);
  });
});

describe('getChatLastMessageIndex', () => {
  it('空会话没有可滚动的目标消息', () => {
    expect(getChatLastMessageIndex(0)).toBeUndefined();
  });

  it('返回虚拟列表最后一条消息的索引', () => {
    expect(getChatLastMessageIndex(1)).toBe(0);
    expect(getChatLastMessageIndex(8)).toBe(7);
  });
});

describe('getChatAutoScrollBehavior', () => {
  it('切换会话加载历史消息时不自动滚动到底部', () => {
    expect(
      getChatAutoScrollBehavior({
        isResponding: false,
        reason: 'conversation-loaded',
        userScrolledAway: true,
      }),
    ).toBeUndefined();
  });

  it('新增消息仍使用平滑滚动', () => {
    expect(
      getChatAutoScrollBehavior({
        isResponding: false,
        reason: 'message-added',
        userScrolledAway: false,
      }),
    ).toBe('smooth');
  });
});

describe('shouldAutoScrollChat', () => {
  it('切换会话加载历史消息时不自动滚动', () => {
    expect(
      shouldAutoScrollChat({
        isResponding: false,
        reason: 'conversation-loaded',
        userScrolledAway: false,
      }),
    ).toBe(false);
  });

  it('AI 响应中且用户已上滑时不自动滚动', () => {
    expect(
      shouldAutoScrollChat({
        isResponding: true,
        reason: 'message-added',
        userScrolledAway: true,
      }),
    ).toBe(false);
  });

  it('AI 回答结束时自动滚动到底部', () => {
    expect(
      shouldAutoScrollChat({
        isResponding: false,
        reason: 'response-finished',
        userScrolledAway: true,
      }),
    ).toBe(true);
  });

  it('用户未上滑时保留自动滚动', () => {
    expect(
      shouldAutoScrollChat({
        isResponding: true,
        reason: 'message-added',
        userScrolledAway: false,
      }),
    ).toBe(true);
  });

  it('非响应状态下保留自动滚动', () => {
    expect(
      shouldAutoScrollChat({
        isResponding: false,
        reason: 'message-added',
        userScrolledAway: true,
      }),
    ).toBe(true);
  });
});
