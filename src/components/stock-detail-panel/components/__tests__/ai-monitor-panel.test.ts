import { describe, expect, it } from 'vitest';

import { isAiMonitorFeedCacheFresh } from '../ai-monitor-panel';

describe('AI 监控面板缓存', () => {
  it('超过短期有效期后不复用全部 tab 的旧监控列表', () => {
    const now = new Date('2026-08-05T14:24:00+08:00').getTime();

    expect(isAiMonitorFeedCacheFresh({ cachedAt: now - 10_000 }, now)).toBe(true);
    expect(isAiMonitorFeedCacheFresh({ cachedAt: now - 16_000 }, now)).toBe(false);
    expect(isAiMonitorFeedCacheFresh(undefined, now)).toBe(false);
  });
});
