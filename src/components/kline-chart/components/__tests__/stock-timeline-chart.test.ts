import { describe, expect, it } from 'vitest';

import {
  getTimelineChangePercent,
  getTimelinePriceScale,
  getTimelineYChangePercent,
  resolveTimelineHoverCrosshair,
} from '../stock-timeline-chart';

describe('分时图 hover 十字线', () => {
  it('鼠标 hover 时垂直线吸附分时点，水平线跟随鼠标高度', () => {
    expect(resolveTimelineHoverCrosshair({ x: 128.5, y: 90.25 }, 48.75)).toEqual({
      verticalPath: 'M 128.5,34 L 128.5,326',
      horizontalPath: 'M 58,48.75 L 902,48.75',
      percentLabelX: 952,
      percentLabelY: 48.75,
    });
  });

  it('基于昨收价计算 hover 点涨跌幅百分比', () => {
    expect(getTimelineChangePercent({ price: 10.5 }, 10)).toBeCloseTo(5);
    expect(getTimelineChangePercent({ price: 9.8 }, 10)).toBeCloseTo(-2);
  });

  it('基于鼠标高度反推水平线对应涨跌幅百分比', () => {
    const scale = getTimelinePriceScale([{ price: 9 }, { price: 11 }], 10);

    expect(getTimelineYChangePercent(34, 10, scale)).toBeCloseTo(10);
    expect(getTimelineYChangePercent(180, 10, scale)).toBeCloseTo(0);
    expect(getTimelineYChangePercent(326, 10, scale)).toBeCloseTo(-10);
  });

  it('昨收价或价格无效时不展示涨跌幅标签', () => {
    expect(getTimelineChangePercent({ price: 10 }, undefined)).toBeUndefined();
    expect(getTimelineChangePercent({ price: 10 }, 0)).toBeUndefined();
    expect(getTimelineChangePercent({ price: Number.NaN }, 10)).toBeUndefined();
    expect(getTimelineYChangePercent(180, undefined, getTimelinePriceScale([{ price: 10 }], undefined))).toBeUndefined();
  });
});
