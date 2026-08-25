import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  institution: vi.fn(),
  branchRank: vi.fn(),
  quotesCn: vi.fn(),
  fetch: vi.fn(),
  resolveTradingDate: vi.fn(),
  loadFuyaoDragonTigerRange: vi.fn(),
}));

vi.mock('../../quotes/shared', () => ({
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

vi.mock('../../../market-data/trade-date-resolver', () => ({
  resolveTradingDate: mocks.resolveTradingDate,
}));

vi.mock('../../anomaly/fuyao-dragon-tiger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../anomaly/fuyao-dragon-tiger.js')>();
  return { ...actual, loadFuyaoDragonTigerRange: mocks.loadFuyaoDragonTigerRange };
});

import {
  dragonTigerTestExports,
  getDragonTigerSnapshot,
  listDailyDragonTiger,
  listDragonTigerByDate,
  listRecentDragonTigerDays,
} from '../../anomaly/dragon-tiger.js';
import {
  resolveFuyaoMcpConnection,
  toFuyaoDragonTigerRows,
  toFuyaoInstitutionRows,
} from '../../anomaly/fuyao-dragon-tiger.js';
import type { IDragonTigerDetailRow } from '../../../../../src/shared/types.js';

type TDetailFixture = Omit<IDragonTigerDetailRow, 'id'>;

describe('龙虎榜快照服务', () => {
  beforeEach(() => {
    mocks.detail.mockReset();
    mocks.institution.mockReset();
    mocks.branchRank.mockReset();
    mocks.quotesCn.mockReset();
    mocks.resolveTradingDate.mockReset();
    mocks.fetch.mockReset();
    mocks.loadFuyaoDragonTigerRange.mockReset();
    mocks.quotesCn.mockResolvedValue([]);
    mocks.resolveTradingDate.mockResolvedValue('2026-07-31');
    mocks.loadFuyaoDragonTigerRange.mockResolvedValue({
      tradeDate: '2026-07-31',
      rows: [],
      institutions: [],
      warnings: [],
    });
    vi.stubGlobal('fetch', mocks.fetch);
    mockDatacenterRows([]);
  });

  it('使用扶摇数据按净买额生成行情页榜单和汇总', async () => {
    mocks.loadFuyaoDragonTigerRange.mockResolvedValueOnce({
      tradeDate: '2026-07-31',
      rows: [
        createMappedDetail({
          id: 'buy',
          code: '600001',
          name: '强势股',
          netBuyAmount: 120_000_000,
          buyAmount: 200_000_000,
          sellAmount: 80_000_000,
          reason: '日涨幅偏离值达7%',
        }),
        createMappedDetail({
          id: 'sell',
          code: '000001',
          name: '分歧股',
          netBuyAmount: -30_000_000,
          buyAmount: 20_000_000,
          sellAmount: 50_000_000,
          reason: '日换手率达20%',
        }),
      ],
      institutions: [
        {
          code: '600001',
          name: '强势股',
          date: '2026-07-31',
          price: null,
          changePercent: 10,
          buyOrgCount: 2,
          sellOrgCount: 0,
          orgBuyAmount: null,
          orgSellAmount: null,
          orgNetAmount: 50_000_000,
        },
      ],
      warnings: [],
    });
    mocks.quotesCn.mockResolvedValueOnce([{ code: '600001', name: '强势股', price: 12.34, changePercent: 9.87 }]);

    const snapshot = await getDragonTigerSnapshot('5d');

    expect(snapshot.summary.totalCount).toBe(2);
    expect(snapshot.summary.netBuyAmount).toBe(90_000_000);
    expect(snapshot.summary.dataSource).toBe('fuyao-a-share-mcp');
    expect(snapshot.topNetBuy[0]?.code).toBe('600001');
    expect(snapshot.topNetSell[0]?.code).toBe('000001');
    expect(snapshot.activeReasons[0]?.count).toBe(1);
    expect(snapshot.institutionTop[0]?.orgNetAmount).toBe(50_000_000);
    expect(snapshot.institutionTop[0]?.price).toBe(12.34);
    expect(snapshot.institutionTop[0]?.changePercent).toBe(9.87);
    expect(snapshot.branchTop).toEqual([]);
  });

  it('Electron 环境变量缺失时读取项目 MCP 配置中的扶摇连接信息', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'stockbuddy-fuyao-mcp-'));
    try {
      await writeFile(
        join(cwd, '.mcp.json'),
        JSON.stringify({
          mcpServers: {
            'fuyao-a-share': {
              type: 'http',
              url: 'https://fuyao.example.test/mcp/a-share',
              headers: { 'X-api-key': 'mcp-config-test-key' },
            },
          },
        }),
        'utf8',
      );

      await expect(resolveFuyaoMcpConnection({ cwd, env: {} })).resolves.toEqual({
        url: 'https://fuyao.example.test/mcp/a-share',
        apiKey: 'mcp-config-test-key',
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('扶摇最新请求显式携带已解析交易日，避免回退到前一交易日', async () => {
    const actual = await vi.importActual<typeof import('../../anomaly/fuyao-dragon-tiger.js')>(
      '../../anomaly/fuyao-dragon-tiger.js',
    );
    const originalApiKey = process.env.FUYAO_A_SHARE_API_KEY;
    process.env.FUYAO_A_SHARE_API_KEY = 'test-key';
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: {
            structuredContent: {
              code: 0,
              data: { trade_date: '2026-08-25', stock_items: [] },
            },
          },
        }),
        { status: 200 },
      ),
    );

    try {
      const result = await actual.loadFuyaoDragonTigerRange({
        startDate: '2026-08-25',
        endDate: '2026-08-25',
        latestOnly: true,
      });
      const requestBody = JSON.parse(String(mocks.fetch.mock.calls[0]?.[1]?.body)) as {
        params?: { arguments?: { board_type?: string; date?: string } };
      };

      expect(requestBody.params?.arguments).toEqual({
        board_type: 'all',
        date: '2026-08-25',
      });
      expect(result.tradeDate).toBe('2026-08-25');
    } finally {
      if (originalApiKey === undefined) delete process.env.FUYAO_A_SHARE_API_KEY;
      else process.env.FUYAO_A_SHARE_API_KEY = originalApiKey;
    }
  });

  it('映射扶摇龙虎榜金额、百分比、原因和机构席位字段', () => {
    const envelope = {
      code: 0,
      data: {
        trade_date: '2026-08-24',
        stock_items: [
          {
            ticker: '002716',
            thscode: '002716.SZ',
            name: '湖南白银',
            range_days: 1,
            change: 0.099808,
            net_value: -197_517_128.01,
            buy_value: 710_303_026.01,
            sell_value: 907_820_154.02,
            net_rate: -0.02988676,
            limit_reason: '半年报增长+白银+湖南国资',
          },
          {
            ticker: '002716',
            thscode: '002716.SZ',
            name: '湖南白银',
            range_days: 3,
            change: 0.099808,
            net_value: 96_248_853.53,
            buy_value: 1_363_785_609.11,
            sell_value: 1_267_536_755.58,
            net_rate: 0.00881252,
            concept_list: [{ name: '黄金概念' }, { name: '金属锌' }],
          },
        ],
      },
    };

    const mapped = toFuyaoDragonTigerRows(envelope);
    const institutions = toFuyaoInstitutionRows({
      code: 0,
      data: {
        trade_date: '2026-08-24',
        stock_items: [
          {
            ticker: '002716',
            name: '湖南白银',
            change: 0.099808,
            org_buy_num: 2,
            org_sell_num: 4,
            org_net_value: -258_444_521.45,
          },
        ],
      },
    });

    expect(mapped.tradeDate).toBe('2026-08-24');
    expect(mapped.rows).toHaveLength(2);
    expect(new Set(mapped.rows.map((row) => row.id)).size).toBe(2);
    expect(mapped.rows[0]).toMatchObject({
      code: '002716',
      name: '湖南白银',
      date: '2026-08-24',
      reason: '半年报增长+白银+湖南国资',
      netBuyAmount: -197_517_128.01,
      close: null,
      turnoverRate: null,
    });
    expect(mapped.rows[0]?.changePercent).toBeCloseTo(9.9808);
    expect(mapped.rows[0]?.netBuyRatio).toBeCloseTo(-2.988676);
    expect(mapped.rows[1]?.reason).toBe('黄金概念、金属锌');
    expect(institutions[0]).toMatchObject({
      code: '002716',
      name: '湖南白银',
      date: '2026-08-24',
      price: null,
      buyOrgCount: 2,
      sellOrgCount: 4,
      orgBuyAmount: null,
      orgSellAmount: null,
      orgNetAmount: -258_444_521.45,
    });
    expect(institutions[0]?.changePercent).toBeCloseTo(9.9808);
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

  it('最新龙虎榜通过扶摇 latest 请求并使用接口返回的真实交易日', async () => {
    mocks.resolveTradingDate.mockResolvedValueOnce('2026-08-03');
    mocks.loadFuyaoDragonTigerRange.mockResolvedValueOnce({
      tradeDate: '2026-07-31',
      rows: [createMappedDetail({ code: '600001', name: '最新披露股', date: '2026-07-31', netBuyAmount: 10_000_000 })],
      institutions: [],
      warnings: [],
    });

    const snapshot = await getDragonTigerSnapshot('today');

    expect(mocks.resolveTradingDate).toHaveBeenCalledWith(9 * 60 + 30);
    expect(mocks.loadFuyaoDragonTigerRange).toHaveBeenCalledWith({
      startDate: '2026-08-03',
      endDate: '2026-08-03',
      latestOnly: true,
    });
    expect(snapshot.summary.tradeDate).toBe('2026-07-31');
    expect(snapshot.rows.map((row) => row.code)).toEqual(['600001']);
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it('区间龙虎榜仅使用扶摇真实数据，不回退 stock-sdk 或东财', async () => {
    mocks.loadFuyaoDragonTigerRange.mockResolvedValueOnce({
      tradeDate: '2026-08-03',
      rows: [
        createMappedDetail({
          code: '600001',
          name: '扶摇股',
          date: '2026-08-03',
          reason: '日涨幅偏离值达到7%的前5只证券',
          close: null,
          changePercent: 10.01,
          netBuyAmount: 80_000_000,
          buyAmount: 120_000_000,
          sellAmount: 40_000_000,
          turnoverRate: null,
        }),
      ],
      institutions: [],
      warnings: [],
    });

    const snapshot = await getDragonTigerSnapshot('5d');

    expect(mocks.loadFuyaoDragonTigerRange).toHaveBeenCalledWith({
      startDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      endDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      latestOnly: false,
    });
    expect(snapshot.summary.tradeDate).toBe('2026-08-03');
    expect(snapshot.rows[0]).toMatchObject({ code: '600001', name: '扶摇股', netBuyAmount: 80_000_000 });
    expect(mocks.detail).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('扶摇最新龙虎榜为空时返回真实空态且不伪造数据', async () => {
    mocks.resolveTradingDate.mockResolvedValueOnce('2026-08-03');
    mocks.loadFuyaoDragonTigerRange.mockResolvedValueOnce({
      tradeDate: '2026-08-03',
      rows: [],
      institutions: [],
      warnings: [],
    });

    const snapshot = await getDragonTigerSnapshot('today');

    expect(snapshot.summary.tradeDate).toBe('2026-08-03');
    expect(snapshot.rows).toEqual([]);
    expect(snapshot.warnings).toContain('扶摇 A 股龙虎榜暂未返回真实上榜记录');
    expect(mocks.detail).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
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
      createDetail({
        code: '600001',
        name: '机构净买股',
        date: '2026-08-04',
        netBuyAmount: 80_000_000,
        reason: '日涨幅偏离值达到7%的前5只证券',
      }),
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
