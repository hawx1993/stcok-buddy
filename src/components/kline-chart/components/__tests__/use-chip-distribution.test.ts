import { describe, expect, it } from 'vitest';

import { findChipDistributionByDate } from '../use-chip-distribution.js';
import type { ChipDistribution } from '../../../../shared/types.js';

function distribution(date: string): ChipDistribution {
  return { date, points: [] };
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

  it('无效日期或未命中时返回 undefined', () => {
    const rows = [distribution('2026-07-31')];

    expect(findChipDistributionByDate(rows, undefined)).toBeUndefined();
    expect(findChipDistributionByDate(rows, '2026-7')).toBeUndefined();
    expect(findChipDistributionByDate(rows, '2026-08-01')).toBeUndefined();
  });
});
