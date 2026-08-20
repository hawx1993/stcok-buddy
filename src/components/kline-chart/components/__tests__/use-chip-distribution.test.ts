import { describe, expect, it } from 'vitest';

import { findChipDistributionByDate, selectChipDistributionForKline } from '../use-chip-distribution.js';
import type { ChipDistribution, TChipDistributionPeriod } from '../../../../shared/types.js';

function distribution(date: string, period: TChipDistributionPeriod = '1d', timestamp?: number): ChipDistribution {
  return {
    date,
    ...(timestamp === undefined ? {} : { timestamp }),
    period,
    points: [{ price: 10, weight: 1 }],
  };
}

const chipPeriodHoverCases = [
  { period: '15m', firstSnapshot: '2026-08-10', secondSnapshot: '2026-08-12', firstHover: '2026-08-11 10:00', secondHover: '2026-08-13 10:00', beforeFirst: '2026-08-09 10:00' },
  { period: '1h', firstSnapshot: '2026-08-10', secondSnapshot: '2026-08-12', firstHover: '2026-08-11 10:00', secondHover: '2026-08-13 10:00', beforeFirst: '2026-08-09 10:00' },
  { period: '1d', firstSnapshot: '2026-08-10', secondSnapshot: '2026-08-12', firstHover: '2026-08-11', secondHover: '2026-08-13', beforeFirst: '2026-08-09' },
  { period: '1w', firstSnapshot: '2026-08-10', secondSnapshot: '2026-08-17', firstHover: '2026-08-12', secondHover: '2026-08-19', beforeFirst: '2026-08-09' },
  { period: '1mo', firstSnapshot: '2026-08-03', secondSnapshot: '2026-08-28', firstHover: '2026-08-15', secondHover: '2026-08-31', beforeFirst: '2026-08-02' },
] as const;

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
    expect(findChipDistributionByDate(rows, '2026-07-31 11:15', '15m', Date.parse('2026-07-31T11:15:00+08:00'))).toEqual(
      rows[0],
    );
    expect(findChipDistributionByDate(rows, '2026-07-31 10:00', '15m', Date.parse('2026-07-31T10:00:00+08:00'))).toBeUndefined();
  });

  it('悬停 K 线优先使用此前最近快照，无已覆盖快照时保留真实 latest', () => {
    const latest = distribution('2026-08-19', '15m');
    const previous = distribution('2026-08-16', '15m');
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
        [previous, latest],
        latest,
        '2026-08-17 11:15',
        '15m',
        Date.parse('2026-08-17T11:15:00+08:00'),
      ),
    ).toEqual({ distribution: previous, matchesHoveredKline: true });
    expect(
      selectChipDistributionForKline(
        [latest],
        latest,
        '2026-08-17 11:15',
        '15m',
        Date.parse('2026-08-17T11:15:00+08:00'),
      ),
    ).toEqual({ distribution: latest, matchesHoveredKline: false });
    expect(selectChipDistributionForKline([latest], latest, undefined, '15m')).toEqual({
      distribution: latest,
      matchesHoveredKline: false,
    });
  });

  it.each(chipPeriodHoverCases)('$period 悬停在不同真实快照覆盖范围时切换 summary 数据', ({
    period,
    firstSnapshot,
    secondSnapshot,
    firstHover,
    secondHover,
  }) => {
    const first = distribution(firstSnapshot, period);
    const second = distribution(secondSnapshot, period);

    expect(selectChipDistributionForKline([first, second], second, firstHover, period)).toEqual({
      distribution: first,
      matchesHoveredKline: true,
    });
    expect(selectChipDistributionForKline([first, second], second, secondHover, period)).toEqual({
      distribution: second,
      matchesHoveredKline: true,
    });
  });

  it.each(chipPeriodHoverCases)('$period 悬停早于首个真实快照时保留真实 latest', ({
    period,
    firstSnapshot,
    secondSnapshot,
    beforeFirst,
  }) => {
    const first = distribution(firstSnapshot, period);
    const latest = distribution(secondSnapshot, period);

    expect(selectChipDistributionForKline([first, latest], latest, beforeFirst, period)).toEqual({
      distribution: latest,
      matchesHoveredKline: false,
    });
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

  it('K线 time 不可匹配时使用 timestamp 匹配日K筹码快照', () => {
    const rows = [distribution('2026-07-23')];

    expect(findChipDistributionByDate(rows, 'bad-time', '1d', Date.parse('2026-07-23T00:00:00+08:00'))).toEqual(rows[0]);
  });

  it('日K没有同日筹码时使用此前最近快照，不使用未来快照', () => {
    const previous = distribution('2026-07-22');
    const future = distribution('2026-07-24');

    expect(findChipDistributionByDate([previous, future], '2026-07-23', '1d')).toEqual(previous);
  });

  it('分钟和小时周期 K线 time 不可匹配时使用 timestamp 匹配日K筹码快照', () => {
    const minuteRows = [distribution('2026-07-23', '15m')];
    const hourRows = [distribution('2026-07-23', '1h')];

    expect(findChipDistributionByDate(minuteRows, 'bad-time', '15m', Date.parse('2026-07-23T11:15:00+08:00'))).toEqual(
      minuteRows[0],
    );
    expect(findChipDistributionByDate(hourRows, 'bad-time', '1h', Date.parse('2026-07-23T11:30:00+08:00'))).toEqual(
      hourRows[0],
    );
  });

  it('周线周期使用同一自然周最近的日K筹码快照', () => {
    const rows = [distribution('2026-08-10', '1w'), distribution('2026-08-14', '1w')];

    expect(findChipDistributionByDate(rows, '2026-08-10', '1w')).toEqual(rows[0]);
    expect(findChipDistributionByDate(rows, '2026-08-16', '1w')).toEqual(rows[1]);
    expect(findChipDistributionByDate(rows, 'bad-time', '1w', Date.parse('2026-08-16T00:00:00+08:00'))).toEqual(rows[1]);
    expect(findChipDistributionByDate(rows, '2026-08-17', '1w')).toEqual(rows[1]);
    expect(findChipDistributionByDate(rows, '2026-08-09', '1w')).toBeUndefined();
  });

  it('月线周期匹配同月最近的日K筹码快照', () => {
    const rows = [distribution('2026-08-03', '1mo'), distribution('2026-08-28', '1mo')];

    expect(findChipDistributionByDate(rows, '2026-08-31', '1mo')).toEqual(rows[1]);
    expect(findChipDistributionByDate(rows, 'bad-time', '1mo', Date.parse('2026-08-31T00:00:00+08:00'))).toEqual(rows[1]);
    expect(findChipDistributionByDate(rows, '2026-09-01', '1mo')).toEqual(rows[1]);
    expect(findChipDistributionByDate(rows, '2026-08-02', '1mo')).toBeUndefined();
  });

  it('分钟和小时周期无时间戳时按完整分钟匹配，不退化为同日匹配', () => {
    const rows = [distribution('2026-07-31 10:30', '1h'), distribution('2026-07-31 11:30', '1h')];

    expect(findChipDistributionByDate(rows, '2026-07-31 11:30', '1h')).toEqual(distribution('2026-07-31 11:30', '1h'));
    expect(findChipDistributionByDate(rows, '2026-07-31', '1h')).toBeUndefined();
  });

  it('无效日期或早于最早筹码快照时返回 undefined', () => {
    const rows = [distribution('2026-07-31')];

    expect(findChipDistributionByDate(rows, undefined)).toBeUndefined();
    expect(findChipDistributionByDate(rows, '2026-7')).toBeUndefined();
    expect(findChipDistributionByDate(rows, '2026-07-30')).toBeUndefined();
  });
});
