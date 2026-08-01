import { describe, expect, it } from 'vitest';
import { getLatestVisibleMonitorEvents } from '../monitoring-center';
import type { IMonitorFeed, IMonitorEvent } from '../../../../shared/types';

function makeEvent(id: string, timestamp: string, category: IMonitorEvent['category']): IMonitorEvent {
  return {
    id,
    timestamp,
    category,
    code: `60000${id}`,
    name: `测试${id}`,
    title: `事件${id}`,
    details: [],
    aiAnalysis: `分析${id}`,
  };
}

describe('探索页 AI 监控事件筛选', () => {
  it('非交易时段回落到历史数据时，仍然使用右侧栏同一数据流的监控事件', () => {
    const feed: IMonitorFeed = {
      updatedAt: '2026-07-31T08:00:00.000Z',
      mode: 'history',
      isTradingTime: false,
      availableDates: ['2026-07-31'],
      selectedDate: '2026-07-31',
      events: [
        makeEvent('1', '2026-07-31T01:00:00.000Z', 'large-order'),
        makeEvent('2', '2026-07-31T01:08:00.000Z', 'dragon-tiger'),
        makeEvent('3', '2026-07-31T01:05:00.000Z', 'technical'),
      ],
      total: 3,
      categoryTotals: {},
    };

    expect(getLatestVisibleMonitorEvents(feed).map((event) => event.id)).toEqual(['3', '1']);
  });

  it('只展示右侧栏同一数据流中最新的前 8 条可见监控事件', () => {
    const feed: IMonitorFeed = {
      updatedAt: '2026-07-31T08:00:00.000Z',
      mode: 'realtime',
      isTradingTime: true,
      availableDates: ['2026-07-31'],
      selectedDate: '2026-07-31',
      events: Array.from({ length: 10 }, (_, index) =>
        makeEvent(String(index + 1), `2026-07-31T01:${String(index).padStart(2, '0')}:00.000Z`, 'news'),
      ),
      total: 10,
      categoryTotals: {},
    };

    expect(getLatestVisibleMonitorEvents(feed).map((event) => event.id)).toEqual(['10', '9', '8', '7', '6', '5', '4', '3']);
  });
});
