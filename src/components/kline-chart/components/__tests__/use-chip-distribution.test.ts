import { describe, expect, it } from 'vitest';

import { findChipDistributionByDate, selectChipDistributionForKline } from '../use-chip-distribution.js';
import type { ChipDistribution, TChipDistributionPeriod } from '../../../../shared/types.js';

function distribution(date: string, period: TChipDistributionPeriod = '1d', timestamp?: number): ChipDistribution {
  return {
    date,
    ...(timestamp === undefined ? {} : { timestamp }),
    period,
    points: [],
  };
}

describe('按日期查找筹码分布', () => {
  it('支持带横线日期和连续数字日期互相匹配', () => {
    const rows = [distribution('2026-07-30'), distribution('20260731')];

    expect(findChipDistributionByDate(rows, '20260730')).toEqual(distribution('2026-07-30'));
    expect(findChipDistributionByDate(rows, '2026-07-31')).toEqual(distribution('20260731'));
  });

  it('忽略日期中的非数字字符并只取前八位', () => {
    const rows = [distribution('2026/07/31')];

    expect(findChipDistributionByDate(rows, '2026-07-31 09:30')).toEqual(distribution('2026/07/31'));
  });

  it('分钟和小时周期优先按毫秒时间戳精确匹配', () => {
    const matchedTimestamp = Date.parse('2026-07-31T10:45:00+08:00');
    const rows = [
      distribution('2026-07-31 10:30', '15m', Date.parse('2026-07-31T10:30:00+08:00')),
      distribution('2026-07-31 10:45', '15m', matchedTimestamp),
    ];

    expect(findChipDistributionByDate(rows, '2026-07-31 10:30', '15m', matchedTimestamp)).toEqual(
      distribution('2026-07-31 10:45', '15m', matchedTimestamp),
    );
  });

  it('15分钟周期兼容起止时间标签相差一个 bar 的真实数据', () => {
    const chipTimestamp = Date.parse('2026-07-31T10:45:00+08:00');
    const chartTimestamp = Date.parse('2026-07-31T10:30:00+08:00');
    const rows = [distribution('2026-07-31 10:45', '15m', chipTimestamp)];

    expect(findChipDistributionByDate(rows, '2026-07-31 10:30', '15m', chartTimestamp)).toEqual(rows[0]);
    expect(findChipDistributionByDate(rows, '2026-07-31 11:15', '15m', Date.parse('2026-07-31T11:15:00+08:00'))).toBeUndefined();
  });

  it('悬停 K 线未命中时保留最新的真实筹码分布', () => {
    const latest = distribution('2026-08-19', '15m');
    const matched = distribution('2026-08-17 11:15', '15m', Date.parse('2026-08-17T11:15:00+08:00'));

    expect(
      selectChipDistributionForKline(
        [matched],
        latest,
        '2026-08-17 11:15',
        '15m',
        Date.parse('2026-08-17T11:15:00+08:00'),
      ),
    ).toEqual({ distribution: matched, matchesHoveredKline: true });
    expect(
      selectChipDistributionForKline(
        [latest],
        latest,
        '2026-08-17 11:15',
        '15m',
        Date.parse('2026-08-17T11:15:00+08:00'),
      ),
    ).toEqual({ distribution: latest, matchesHoveredKline: false });
  });

  it('分钟和小时周期匹配同日的日K筹码快照', () => {
    const minuteRows = [distribution('2026-07-31', '15m')];
    const hourRows = [distribution('2026-07-31', '1h')];

    expect(
      findChipDistributionByDate(minuteRows, '2026-07-31 11:15', '15m', Date.parse('2026-07-31T11:15:00+08:00')),
    ).toEqual(minuteRows[0]);
    expect(
      findChipDistributionByDate(hourRows, '2026-07-31 11:30', '1h', Date.parse('2026-07-31T11:30:00+08:00')),
    ).toEqual(hourRows[0]);
  });

  it('周线周期使用同一自然周最近的日K筹码快照', () => {
    const rows = [distribution('2026-08-10', '1w'), distribution('2026-08-14', '1w')];

    expect(findChipDistributionByDate(rows, '2026-08-10', '1w')).toEqual(rows[0]);
    expect(findChipDistributionByDate(rows, '2026-08-16', '1w')).toEqual(rows[1]);
    expect(findChipDistributionByDate(rows, '2026-08-17', '1w')).toBeUndefined();
  });

  it('月线周期匹配同月最近的日K筹码快照', () => {
    const rows = [distribution('2026-08-03', '1mo'), distribution('2026-08-28', '1mo')];

    expect(findChipDistributionByDate(rows, '2026-08-31', '1mo')).toEqual(rows[1]);
    expect(findChipDistributionByDate(rows, '2026-09-01', '1mo')).toBeUndefined();
  });

  it('分钟和小时周期无时间戳时按完整分钟匹配，不退化为同日匹配', () => {
    const rows = [distribution('2026-07-31 10:30', '1h'), distribution('2026-07-31 11:30', '1h')];

    expect(findChipDistributionByDate(rows, '2026-07-31 11:30', '1h')).toEqual(distribution('2026-07-31 11:30', '1h'));
    expect(findChipDistributionByDate(rows, '2026-07-31', '1h')).toBeUndefined();
  });

  it('无效日期或未命中时返回 undefined', () => {
    const rows = [distribution('2026-07-31')];

    expect(findChipDistributionByDate(rows, undefined)).toBeUndefined();
    expect(findChipDistributionByDate(rows, '2026-7')).toBeUndefined();
    expect(findChipDistributionByDate(rows, '2026-08-01')).toBeUndefined();
  });
});
