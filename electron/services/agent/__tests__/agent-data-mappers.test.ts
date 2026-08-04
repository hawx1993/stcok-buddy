import { describe, expect, it } from 'vitest';

import {
  emFundFlowToSnapshot,
  localBarToStockDetail,
  parseBaiduKline,
  tencentQuoteToStockDetail,
} from '../agent-data-mappers.js';

const tencentQuote = {
  name: '贵州茅台',
  price: 1358.98,
  last_close: 1350.6,
  open: 1350.6,
  change_amt: 8.38,
  change_pct: 0.62,
  high: 1363.35,
  low: 1346.0,
  amount_wan: 489867,
  turnover_pct: 0.29,
  pe_ttm: 20.54,
  amplitude_pct: 1.28,
  float_mcap_yi: 16988.36,
  mcap_yi: 16988.36,
  pb: 7.3,
  limit_up: 1485.66,
  limit_down: 1215.54,
  vol_ratio: 0.66,
  pe_static: 15.59,
  is_stale: false,
};

describe('腾讯行情 → StockDetail 映射', () => {
  it('映射真实腾讯行情字段', () => {
    const detail = tencentQuoteToStockDetail(tencentQuote, '600519');
    expect(detail.name).toBe('贵州茅台');
    expect(detail.price).toBe(1358.98);
    expect(detail.changePercent).toBe('+0.62%');
    expect(detail.pe).toBe(20.54);
    expect(detail.pb).toBe(7.3);
    expect(detail.marketCap).toContain('亿');
  });

  it('僵尸报价在 summary 中标注风险', () => {
    const stale = tencentQuoteToStockDetail({ ...tencentQuote, is_stale: true, stale_reason: '停牌' }, '600519');
    expect(stale.summary).toContain('停牌');
  });
});

describe('百度 K线 → KlinePoint 映射', () => {
  it('按 keys 解析逗号分隔行', () => {
    const bars = parseBaiduKline({
      keys: ['timestamp', 'time', 'open', 'close', 'volume', 'high', 'low', 'amount'],
      rows: ['1525708800,2018-05-08,413.23,424.03,6249783,427.33,413.23,4414037853.00'],
    });
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({
      time: '2018-05-08',
      open: 413.23,
      high: 427.33,
      low: 413.23,
      close: 424.03,
      volume: 6249783,
    });
  });

  it('缺 keys 或空行返回空数组', () => {
    expect(parseBaiduKline(null)).toEqual([]);
    expect(parseBaiduKline({ keys: [], rows: [] })).toEqual([]);
  });
});

describe('东财分钟级资金流 → 快照映射', () => {
  it('汇总各档净流入并标记 a-stock-data 源', () => {
    const snapshot = emFundFlowToSnapshot(
      [
        { time: '2026-08-03 13:21', main_net: -1000, small_net: -100, mid_net: 200, large_net: 300, super_net: -1400 },
        { time: '2026-08-03 13:22', main_net: 500, small_net: 0, mid_net: 100, large_net: 200, super_net: 200 },
      ],
      '600519',
    );
    expect(snapshot.mainNetInflow).toBe(-500);
    expect(snapshot.superLargeNetInflow).toBe(-1200);
    expect(snapshot.source).toBe('a-stock-data');
    expect(snapshot.date).toBe('2026-08-03');
  });
});

describe('DuckDB 日线 → StockDetail 映射', () => {
  it('由收盘/涨跌幅构建本地行情', () => {
    const detail = localBarToStockDetail(
      { tradeDate: '2026-08-01', close: 100, open: 98, high: 102, low: 97, change: 2, changePercent: 2.04 },
      '600519',
    );
    expect(detail.price).toBe(100);
    expect(detail.changePercent).toBe('+2.04%');
    expect(detail.summary).toContain('2026-08-01');
  });
});
