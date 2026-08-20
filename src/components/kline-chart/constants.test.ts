import { describe, expect, it } from 'vitest';

import {
  getChipStateCacheKey,
  resolveChipOverlayDistribution,
  resolveChipStateCacheEntry,
  shouldKeepPreviousChipOverlay,
  shouldReserveModalChipColumn,
  shouldUseCachedChipState,
} from './constants';

describe('K线弹窗筹码列宽度预留', () => {
  it('支持筹码分布的周期在数据加载前也固定预留右侧筹码列', () => {
    expect(shouldReserveModalChipColumn('15m', true, true, true)).toBe(true);
    expect(shouldReserveModalChipColumn('1h', true, true, true)).toBe(true);
    expect(shouldReserveModalChipColumn('1d', true, true, true)).toBe(true);
    expect(shouldReserveModalChipColumn('1w', true, true, true)).toBe(true);
    expect(shouldReserveModalChipColumn('1mo', true, true, true)).toBe(true);
  });

  it('分时或筹码栏关闭时不预留弹窗筹码列', () => {
    expect(shouldReserveModalChipColumn('timeline', true, true, true)).toBe(false);
    expect(shouldReserveModalChipColumn('1d', false, true, true)).toBe(false);
    expect(shouldReserveModalChipColumn('1d', true, false, true)).toBe(false);
    expect(shouldReserveModalChipColumn('1d', true, true, false)).toBe(false);
  });
});

describe('K线弹窗筹码内容保留', () => {
  it('新周期筹码加载期间保留上一份真实筹码内容', () => {
    const previous = { date: '2026-08-19', points: [{ price: 56, weight: 0.2 }] };

    expect(resolveChipOverlayDistribution(undefined, previous, true)).toBe(previous);
  });

  it('切换周期后 hook 状态尚未进入新周期前也保留上一份真实筹码内容', () => {
    expect(shouldKeepPreviousChipOverlay(false, true, '1h', '1d')).toBe(true);
    expect(shouldKeepPreviousChipOverlay(false, true, '1h', '1h')).toBe(false);
  });

  it('周期切换或刷新期间优先使用同周期缓存，让 hover summary 可以继续变化', () => {
    expect(shouldUseCachedChipState(false, '1d', '15m', false)).toBe(true);
    expect(shouldUseCachedChipState(true, '1d', '1d', false)).toBe(true);
    expect(shouldUseCachedChipState(true, '1d', '1d', true)).toBe(false);
    expect(shouldUseCachedChipState(false, '1d', '1d', true)).toBe(false);
  });

  it('没有目标周期缓存时用已有真实筹码列表适配目标周期，覆盖 15分钟、小时、周、月', () => {
    const older = { date: '2026-08-18', period: '1d' as const, profitRatio: 0.38, points: [{ price: 55, weight: 0.2 }] };
    const latest = { date: '2026-08-19', period: '1d' as const, profitRatio: 0.48, points: [{ price: 56, weight: 0.3 }] };
    const cache = new Map([
      [getChipStateCacheKey('002812', '1d'), { distribution: latest, distributions: [older, latest], source: 'stock-sdk' as const }],
    ]);

    for (const period of ['15m', '1h', '1w', '1mo'] as const) {
      const resolved = resolveChipStateCacheEntry(cache, '002812', period);

      expect(resolved?.distribution?.period).toBe(period);
      expect(resolved?.distributions.map((item) => item.period)).toEqual([period, period]);
      expect(resolved?.distributions.map((item) => item.profitRatio)).toEqual([0.38, 0.48]);
    }
  });

  it('新筹码数据返回后优先展示新内容，非加载状态不继续保留旧内容', () => {
    const previous = { date: '2026-08-19', points: [{ price: 56, weight: 0.2 }] };
    const current = { date: '2026-08-20', points: [{ price: 57, weight: 0.3 }] };

    expect(resolveChipOverlayDistribution(current, previous, true)).toBe(current);
    expect(resolveChipOverlayDistribution(undefined, previous, false)).toBeUndefined();
  });
});
