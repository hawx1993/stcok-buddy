import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  institution: vi.fn(),
  branchRank: vi.fn(),
  quotesCn: vi.fn(),
  fetch: vi.fn(),
  resolveTradingDate: vi.fn(),
}));

vi.mock('../shared.js', () => ({
  sdk: {
    dragonTiger: {
      detail: mocks.detail,
      institution: mocks.institution,
      branchRank: mocks.branchRank,
    },
    quotes: {
      cn: mocks.quotesCn,
    },
  },
  withTimeoutReject: <T>(promise: Promise<T>) => promise,
}));

vi.mock('../../market-data/trade-date-resolver.js', () => ({
  resolveTradingDate: mocks.resolveTradingDate,
}));

import { dragonTigerTestExports, getDragonTigerSnapshot, listDailyDragonTiger, listDragonTigerByDate, listRecentDragonTigerDays } from '../dragon-tiger.js';
import type { IDragonTigerDetailRow } from '../../../../src/shared/types.js';

type TDetailFixture = Omit<IDragonTigerDetailRow, 'id'>;

describe('龙虎榜快照服务', () => {
  beforeEach(() => {
    mocks.detail.mockReset();
    mocks.institution.mockReset();
    mocks.branchRank.mockReset();
    mocks.quotesCn.mockReset();
    mocks.resolveTradingDate.mockReset();
    mocks.fetch.mockReset();
    mocks.quotesCn.mockResolvedValue([]);
    mocks.resolveTradingDate.mockResolvedValue('2026-07-31');
    vi.stubGlobal('fetch', mocks.fetch);
    mockDatacenterRows([]);
  });

  it('按净买额生成榜单和汇总', async () => {
    mocks.detail.mockResolvedValueOnce([
      createDetail({ code: '600001', name: '强势股', netBuyAmount: 120_000_000, buyAmount: 200_000_000, sellAmount: 80_000_000, reason: '日涨幅偏离值达7%' }),
      createDetail({ code: '000001', name: '分歧股', netBuyAmount: -30_000_000, buyAmount: 20_000_000, sellAmount: 50_000_000, reason: '日换手率达20%' }),
    ]);
    mocks.institution.mockResolvedValueOnce([
      {
        code: '600001',
        name: '强势股',
        date: '2026-07-31',
        close: 12,
        changePercent: 10,
        buyOrgCount: 2,
        sellOrgCount: 0,
        orgBuyAmount: 60_000_000,
        orgSellAmount: 10_000_000,
        orgNetAmount: 50_000_000,
      },
    ]);
    mocks.branchRank.mockResolvedValueOnce([
      { code: 'B1', name: '营业部A', totalBuyAmount: 90_000_000, totalSellAmount: 10_000_000, buyCount: 3, sellCount: 1, totalCount: 4 },
    ]);
    mocks.quotesCn.mockResolvedValueOnce([
      { code: '600001', name: '强势股', price: 12.34, changePercent: 9.87 },
    ]);

    const snapshot = await getDragonTigerSnapshot('5d');

    expect(snapshot.summary.totalCount).toBe(2);
    expect(snapshot.summary.netBuyAmount).toBe(90_000_000);
    expect(snapshot.topNetBuy[0]?.code).toBe('600001');
    expect(snapshot.topNetSell[0]?.code).toBe('000001');
    expect(snapshot.activeReasons[0]?.count).toBe(1);
    expect(snapshot.institutionTop[0]?.orgNetAmount).toBe(50_000_000);
    expect(snapshot.institutionTop[0]?.price).toBe(12.34);
    expect(snapshot.institutionTop[0]?.changePercent).toBe(9.87);
    expect(snapshot.branchTop[0]?.name).toBe('营业部A');
  });

  it('stock-sdk 机构榜为空时用 a-stock-data 席位明细补充', async () => {
    mocks.detail.mockResolvedValueOnce([
      createDetail({ code: '600001', name: '机构股', netBuyAmount: 80_000_000, buyAmount: 100_000_000, sellAmount: 20_000_000, reason: '日涨幅偏离值达7%' }),
    ]);
    mocks.institution.mockResolvedValueOnce([]);
    mocks.branchRank.mockResolvedValueOnce([]);
    mocks.quotesCn.mockResolvedValueOnce([
      { code: '600001', name: '机构股', price: 21.5, changePercent: 8.88 },
    ]);
    mockDatacenterRows([
      [
        {
          SECURITY_CODE: '600001',
          SECURITY_NAME_ABBR: '机构股',
          TRADE_DATE: '2026-07-31',
          OPERATEDEPT_CODE: '0',
          OPERATEDEPT_NAME: '机构专用',
          BUY: 70_000_000,
          SELL: 5_000_000,
          CHANGE_RATE: 10,
        },
      ],
      [
        {
          SECURITY_CODE: '600001',
          SECURITY_NAME_ABBR: '机构股',
          TRADE_DATE: '2026-07-31',
          OPERATEDEPT_CODE: '0',
          OPERATEDEPT_NAME: '机构专用',
          BUY: 3_000_000,
          SELL: 10_000_000,
          CHANGE_RATE: 10,
        },
      ],
    ]);

    const snapshot = await getDragonTigerSnapshot('today');

    expect(snapshot.institutionTop[0]).toMatchObject({
      code: '600001',
      name: '机构股',
      buyOrgCount: 1,
      sellOrgCount: 1,
      orgBuyAmount: 70_000_000,
      orgSellAmount: 10_000_000,
      orgNetAmount: 60_000_000,
      price: 21.5,
      changePercent: 8.88,
    });
    expect(snapshot.warnings).toContain('stock-sdk 未返回机构买卖数据，已使用 a-stock-data 东财席位明细补充机构净买入');
  });

  it('最近龙虎榜按交易日倒序分组并限制数量', async () => {
    mocks.detail.mockResolvedValueOnce([
      createDetail({ code: '600001', name: '最新A', date: '2026-07-31', netBuyAmount: 10_000_000 }),
      createDetail({ code: '600002', name: '最新B', date: '2026-07-31', netBuyAmount: 9_000_000 }),
      createDetail({ code: '600003', name: '前日A', date: '2026-07-30', netBuyAmount: 8_000_000 }),
      createDetail({ code: '600004', name: '更早A', date: '2026-07-29', netBuyAmount: 7_000_000 }),
    ]);

    const groups = await listRecentDragonTigerDays(2);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.date)).toEqual(['2026-07-31', '2026-07-30']);
    expect(groups[0]?.items.map((item) => item.code)).toEqual(['600001', '600002']);
  });

  it('最新龙虎榜按 stock-sdk 文档用日期区间获取并展示最新交易日', async () => {
    mocks.resolveTradingDate.mockResolvedValueOnce('2026-08-03');
    mocks.detail.mockResolvedValueOnce([
      createDetail({ code: '600001', name: '最新披露股', date: '2026-07-31', netBuyAmount: 10_000_000 }),
      createDetail({ code: '600002', name: '前日股', date: '2026-07-30', netBuyAmount: 9_000_000 }),
    ]);
    mocks.institution.mockResolvedValueOnce([]);
    mocks.branchRank.mockResolvedValueOnce([]);

    const snapshot = await getDragonTigerSnapshot('today');

    expect(mocks.resolveTradingDate).toHaveBeenCalledWith(9 * 60 + 30);
    expect(mocks.detail).toHaveBeenCalledTimes(1);
    expect(mocks.detail).toHaveBeenCalledWith({ startDate: expect.any(String), endDate: expect.any(String) });
    expect(snapshot.summary.tradeDate).toBe('2026-07-31');
    expect(snapshot.rows.map((row) => row.code)).toEqual(['600001']);
  });

  it('区间龙虎榜 stock-sdk 为空时用东财真实龙虎榜详情补充', async () => {
    mocks.detail.mockResolvedValueOnce([]);
    mocks.institution.mockResolvedValueOnce([]);
    mocks.branchRank.mockResolvedValueOnce([]);
    mockDatacenterRows([
      [
        {
          SECURITY_CODE: '600001',
          SECURITY_NAME_ABBR: '东财股',
          TRADE_DATE: '2026-08-03 00:00:00',
          EXPLANATION: '日涨幅偏离值达到7%的前5只证券',
          CLOSE_PRICE: 12.34,
          CHANGE_RATE: 10.01,
          BILLBOARD_NET_AMT: 80_000_000,
          BILLBOARD_BUY_AMT: 120_000_000,
          BILLBOARD_SELL_AMT: 40_000_000,
          TURNOVERRATE: 23.45,
        },
      ],
    ]);

    const snapshot = await getDragonTigerSnapshot('5d');

    expect(snapshot.summary.tradeDate).toBe('2026-08-03');
    expect(snapshot.rows[0]).toMatchObject({
      code: '600001',
      name: '东财股',
      date: '2026-08-03',
      reason: '日涨幅偏离值达到7%的前5只证券',
      close: 12.34,
      changePercent: 10.01,
      netBuyAmount: 80_000_000,
      buyAmount: 120_000_000,
      sellAmount: 40_000_000,
      turnoverRate: 23.45,
    });
    expect(snapshot.warnings).toContain('stock-sdk 龙虎榜详情暂未返回，已使用 a-stock-data 东财龙虎榜详情补充');
  });

  it('最新龙虎榜近 30 日 stock-sdk 为空时不伪造数据', async () => {
    mocks.resolveTradingDate.mockResolvedValueOnce('2026-08-03');
    mocks.detail.mockResolvedValueOnce([]);
    mocks.institution.mockResolvedValueOnce([]);
    mocks.branchRank.mockResolvedValueOnce([]);

    const snapshot = await getDragonTigerSnapshot('today');

    expect(mocks.detail).toHaveBeenCalledTimes(1);
    expect(snapshot.summary.tradeDate).toBe('2026-08-03');
    expect(snapshot.rows).toEqual([]);
    expect(snapshot.warnings).toContain('stock-sdk 近 30 日龙虎榜详情暂未返回真实上榜记录');
  });

  it('最新龙虎榜从近 30 日历史中按日期取最新一组', async () => {
    mocks.detail.mockResolvedValueOnce([
      createDetail({ code: '600002', name: '回看股', date: '2026-07-30', netBuyAmount: 10_000_000 }),
      createDetail({ code: '600003', name: '最新股', date: '2026-07-31', netBuyAmount: 20_000_000 }),
    ]);
    mocks.institution.mockResolvedValueOnce([]);
    mocks.branchRank.mockResolvedValueOnce([]);

    const rows = await listDailyDragonTiger();

    expect(mocks.detail).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: '600003', netBuy: 20_000_000 });
  });

  it('指定日期 stock-sdk 为空时用东财真实龙虎榜详情补充', async () => {
    mocks.detail.mockResolvedValueOnce([]);
    mockDatacenterRows([
      [
        {
          SECURITY_CODE: '600001',
          SECURITY_NAME_ABBR: '东财指定日股',
          TRADE_DATE: '2026-08-04 00:00:00',
          EXPLANATION: '日涨幅偏离值达到7%的前5只证券',
          CLOSE_PRICE: 12.34,
          CHANGE_RATE: 10.01,
          BILLBOARD_NET_AMT: 80_000_000,
          BILLBOARD_BUY_AMT: 120_000_000,
          BILLBOARD_SELL_AMT: 40_000_000,
          TURNOVERRATE: 23.45,
        },
      ],
    ]);

    const group = await listDragonTigerByDate('2026-08-04');

    expect(group.date).toBe('2026-08-04');
    expect(group.items).toEqual([
      expect.objectContaining({ code: '600001', name: '东财指定日股', netBuy: 80_000_000 }),
    ]);
  });

  it('指定日期龙虎榜同时返回真实机构买卖数据供探索页机构榜使用', async () => {
    mocks.detail.mockResolvedValueOnce([
      createDetail({ code: '600001', name: '机构净买股', date: '2026-08-04', netBuyAmount: 80_000_000, reason: '日涨幅偏离值达到7%的前5只证券' }),
    ]);
    mocks.institution.mockResolvedValueOnce([
      {
        code: '600001',
        name: '机构净买股',
        date: '2026-08-04',
        changePercent: 9.8,
        buyOrgCount: 2,
        sellOrgCount: 1,
        orgBuyAmount: 90_000_000,
        orgSellAmount: 20_000_000,
        orgNetAmount: 70_000_000,
      },
    ]);
    mocks.quotesCn.mockResolvedValueOnce([]);

    const group = await listDragonTigerByDate('2026-08-04');

    expect(group.institutions).toEqual([
      expect.objectContaining({ code: '600001', name: '机构净买股', orgNetAmount: 70_000_000 }),
    ]);
  });

  it('聚合相同上榜原因', () => {
    const snapshot = dragonTigerTestExports.buildDragonTigerSnapshot({
      range: 'today',
      startDate: '20260731',
      endDate: '20260731',
      rows: [
        createMappedDetail({ id: '1', code: '600001', reason: '日涨幅偏离值达7%', netBuyAmount: 10_000_000 }),
        createMappedDetail({ id: '2', code: '600002', reason: '日涨幅偏离值达7%', netBuyAmount: 20_000_000 }),
      ],
      institutionTop: [],
      branchTop: [],
      warnings: [],
    });

    expect(snapshot.activeReasons).toEqual([
      expect.objectContaining({ reason: '日涨幅偏离值达7%', count: 2, netBuyAmount: 30_000_000 }),
    ]);
  });

  it('保留更多龙虎榜和席位排行数据供 UI 展示', () => {
    const rows = Array.from({ length: 24 }, (_, index) =>
      createMappedDetail({
        id: `buy-${index}`,
        code: `${600000 + index}`,
        netBuyAmount: 100_000_000 - index,
      }),
    );
    const institutionTop = Array.from({ length: 14 }, (_, index) => ({
      code: `${300000 + index}`,
      name: `机构股${index}`,
      date: '2026-07-31',
      price: null,
      changePercent: null,
      buyOrgCount: 1,
      sellOrgCount: 0,
      orgBuyAmount: 10_000_000 + index,
      orgSellAmount: 0,
      orgNetAmount: 10_000_000 + index,
    }));

    const snapshot = dragonTigerTestExports.buildDragonTigerSnapshot({
      range: 'today',
      startDate: '20260731',
      endDate: '20260731',
      rows,
      institutionTop,
      branchTop: [],
      warnings: [],
    });

    expect(snapshot.topNetBuy).toHaveLength(20);
    expect(snapshot.institutionTop).toHaveLength(12);
  });
});

function createDetail(overrides: Partial<TDetailFixture> = {}): TDetailFixture {
  return {
    code: '600000',
    name: '样本股',
    date: '2026-07-31',
    close: 10,
    changePercent: 5,
    netBuyAmount: 0,
    buyAmount: 0,
    sellAmount: 0,
    dealAmount: 0,
    totalAmount: 0,
    netBuyRatio: 0,
    dealAmountRatio: 0,
    turnoverRate: 0,
    floatMarketValue: 1_000_000_000,
    reason: '日涨幅偏离值达7%',
    afterChange1d: null,
    afterChange2d: null,
    afterChange5d: null,
    afterChange10d: null,
    ...overrides,
  };
}

function createMappedDetail(overrides: Partial<IDragonTigerDetailRow> = {}): IDragonTigerDetailRow {
  return {
    id: 'row',
    code: '600000',
    name: '样本股',
    date: '2026-07-31',
    reason: '日涨幅偏离值达7%',
    close: 10,
    changePercent: 5,
    netBuyAmount: 0,
    buyAmount: 0,
    sellAmount: 0,
    dealAmount: 0,
    totalAmount: 0,
    netBuyRatio: 0,
    dealAmountRatio: 0,
    turnoverRate: 0,
    floatMarketValue: 1_000_000_000,
    afterChange1d: null,
    afterChange2d: null,
    afterChange5d: null,
    afterChange10d: null,
    ...overrides,
  };
}

function mockDatacenterRows(results: Record<string, unknown>[][]) {
  mocks.fetch.mockImplementation(async () => {
    const data = results.shift() ?? [];
    return new Response(JSON.stringify({ result: { data } }), { status: 200 });
  });
}
