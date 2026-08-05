import { describe, expect, it } from 'vitest';

import { isAiMonitorFeedCacheFresh, shouldLoadAiMonitorFeedOnActiveTransition } from '../ai-monitor-panel-utils';

describe('AI 监控面板缓存', () => {
  it('超过短期有效期后不复用全部 tab 的旧监控列表', () => {
    const now = new Date('2026-08-05T14:24:00+08:00').getTime();

    expect(isAiMonitorFeedCacheFresh({ cachedAt: now - 10_000 }, now)).toBe(true);
    expect(isAiMonitorFeedCacheFresh({ cachedAt: now - 16_000 }, now)).toBe(false);
    expect(isAiMonitorFeedCacheFresh(undefined, now)).toBe(false);
  });

  it('重新打开已初始化的面板时刷新当前 tab', () => {
    expect(
      shouldLoadAiMonitorFeedOnActiveTransition({
        currentFeedKey: 'history:2026-08-05:1:all',
        didRestore: true,
        hasEvents: true,
        isActive: true,
        nextFeedKey: 'history:2026-08-05:1:all',
        wasActive: false,
      }),
    ).toBe(true);
  });

  it('面板保持打开时不重复触发刷新', () => {
    expect(
      shouldLoadAiMonitorFeedOnActiveTransition({
        currentFeedKey: 'history:2026-08-05:1:all',
        didRestore: true,
        hasEvents: true,
        isActive: true,
        nextFeedKey: 'history:2026-08-05:1:all',
        wasActive: true,
      }),
    ).toBe(false);
  });
});
