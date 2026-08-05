import { describe, expect, it } from 'vitest';

import { isNearChatBottom, shouldAutoScrollChat } from '../auto-scroll';

describe('isNearChatBottom', () => {
  it('接近底部时返回 true', () => {
    expect(isNearChatBottom({ scrollTop: 952, clientHeight: 500, scrollHeight: 1500 })).toBe(true);
  });

  it('明显离开底部时返回 false', () => {
    expect(isNearChatBottom({ scrollTop: 700, clientHeight: 500, scrollHeight: 1500 })).toBe(false);
  });
});

describe('shouldAutoScrollChat', () => {
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
