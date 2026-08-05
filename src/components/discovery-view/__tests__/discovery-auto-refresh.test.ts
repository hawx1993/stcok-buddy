import { describe, expect, it } from 'vitest';
import { shouldAutoRefreshDiscoverySnapshot, shouldRefreshActiveDiscoverySections } from '../auto-refresh';

describe('探索页自动刷新条件', () => {
  it('数据尚未加载完成时允许刷新默认快照', () => {
    expect(shouldAutoRefreshDiscoverySnapshot('', [])).toBe(true);
  });

  it('当前展示最新交易日时允许自动刷新', () => {
    expect(
      shouldAutoRefreshDiscoverySnapshot('2026-08-04', [
        { date: '2026-08-01' },
        { date: '2026-08-04' },
      ]),
    ).toBe(true);
  });

  it('用户查看历史交易日时停止自动刷新，避免覆盖当前选择', () => {
    expect(
      shouldAutoRefreshDiscoverySnapshot('2026-08-01', [
        { date: '2026-08-01' },
        { date: '2026-08-04' },
      ]),
    ).toBe(false);
  });

  it('没有交易日列表但仍在默认视图时允许后续刷新', () => {
    expect(shouldAutoRefreshDiscoverySnapshot('2026-08-04', [])).toBe(true);
  });

  it('仅在页面可见且已有激活区块时执行定时刷新', () => {
    expect(shouldRefreshActiveDiscoverySections(true, true, 2)).toBe(true);
    expect(shouldRefreshActiveDiscoverySections(true, false, 2)).toBe(false);
    expect(shouldRefreshActiveDiscoverySections(true, true, 0)).toBe(false);
    expect(shouldRefreshActiveDiscoverySections(false, true, 2)).toBe(false);
  });
});
