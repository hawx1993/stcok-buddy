import { beforeEach, describe, expect, it, vi } from 'vitest';

const stockSdkInstances = vi.hoisted(() => [] as Array<{
  fundFlow: { market: ReturnType<typeof vi.fn>; rank: ReturnType<typeof vi.fn> };
  board: { concept: { constituents: ReturnType<typeof vi.fn> }; industry: { constituents: ReturnType<typeof vi.fn> } };
}>);

vi.mock('stock-sdk', () => ({
  default: class StockSDKMock {
    fundFlow = { market: vi.fn(), rank: vi.fn() };
    board = {
      concept: { constituents: vi.fn() },
      industry: { constituents: vi.fn() },
    };

    constructor() {
      stockSdkInstances.push(this);
    }
  },
}));

vi.mock('../market-review-service.js', () => ({
  getMarketReview: vi.fn(),
  scoreSentiment: vi.fn(),
}));

vi.mock('../stock-client.js', () => ({
  getBatchQuotes: vi.fn(),
  getAllMarketQuoteRows: vi.fn(),
  getMarketPageSnapshot: vi.fn(),
  listDailyDragonTiger: vi.fn(),
  listEastmoneySurgeByDate: vi.fn(),
  listRecentDragonTigerDays: vi.fn(),
}));

vi.mock('../../config-store.js', () => ({
  listFavoriteStocks: vi.fn(),
  getConfig: vi.fn(),
}));

vi.mock('../../llm/openai-compatible-client.js', () => ({
  chatWithOpenAICompatible: vi.fn(),
}));

vi.mock('../surge-history-store.js', () => ({
  listSurgeDates: vi.fn(),
  listSurgeHistory: vi.fn(),
}));

vi.mock('../../market-data/market-data-store.js', () => ({
  listBoardConstituents: vi.fn(),
  listMarketBoards: vi.fn(),
  readDiscoverySnapshot: vi.fn(),
  writeDiscoverySnapshot: vi.fn(),
  getStockChip: vi.fn(),
}));

vi.mock('../market-indices.js', () => ({
  fetchMarketIndex: vi.fn(),
}));

vi.mock('../../market-data/providers.js', () => ({
  isRemoteTradingDay: vi.fn(),
  previousRemoteTradingDay: vi.fn(),
}));

vi.mock('../monitor-service.js', () => ({
  getMonitorFeed: vi.fn(),
}));

import { isRemoteTradingDay, previousRemoteTradingDay } from '../../market-data/providers.js';
import { writeDiscoverySnapshot } from '../../market-data/market-data-store.js';
import {
  buildDiscoverySnapshotFromHistoricalPoolsForTest,
  buildDiscoveryWaitingSnapshotForTest,
  buildLocalBoardCatalog,
  buildDiscoveryDragonTigerForTest,
  buildDiscoveryDragonTigerHistoryForTest,
  buildDiscoveryHistoryLoadingSnapshotForTest,
  buildDiscoveryOpportunityRadarForTest,
  buildOpportunityStockRadarForTest,
  buildOpportunityStockRadarFromLargeOrdersForTest,
  mergeLargeOrderMonitorCandidatesForTest,
  enrichMissingSectorMainNetInflowsForTest,
  fetchMainFundFlowForTest,
  findLocalBoard,
  formatDiscoveryDataErrorForTest,
  hasDragonTigerRowsForTest,
  pickCurrentDragonTigerFromHistoryForTest,
  reconcileSectorsWithLocalBoardsForTest,
  resolveYesterdaySentimentPoolsForTest,
  resetDiscoveryFundFlowCachesForTest,
  selectDragonTigerRowsForTest,
  shouldDeferDiscoveryRefresh,
  shouldHoldDiscoverySnapshotUntil930,
  shouldRefreshCachedDiscoverySnapshotForTest,
  sumConstituentMainNetInflowYiForTest,
  sumFundFlowRankRowsYiForTest,
  toLimitDownStockItemForTest,
  withOptionalTimeoutForTest,
  withSelectedDiscoveryTradeDateForTest,
  writeDiscoverySnapshotCachesForTest,
} from '../discovery-service.js';
import type { TLocalBoardSummary } from '../discovery-service.js';

const mockedIsRemoteTradingDay = vi.mocked(isRemoteTradingDay);
const mockedPreviousRemoteTradingDay = vi.mocked(previousRemoteTradingDay);
const mockedWriteDiscoverySnapshot = vi.mocked(writeDiscoverySnapshot);

function getDiscoverySdk() {
  const sdk = stockSdkInstances[stockSdkInstances.length - 1];
  if (!sdk) throw new Error('StockSDK mock instance not initialized');
  return sdk;
}

beforeEach(() => {
  resetDiscoveryFundFlowCachesForTest();
  for (const sdk of stockSdkInstances) {
    sdk.fundFlow.market.mockReset();
    sdk.fundFlow.rank.mockReset();
    sdk.board.concept.constituents.mockReset();
    sdk.board.industry.constituents.mockReset();
  }
});

function createFundFlowRankRow(code: string, name: string, mainNetInflow: number | null) {
  return {
    code,
    name,
    price: null,
    changePercent: null,
    mainNetInflow,
    mainNetInflowPercent: null,
    superLargeNetInflow: null,
    superLargeNetInflowPercent: null,
    largeNetInflow: null,
    largeNetInflowPercent: null,
    mediumNetInflow: null,
    mediumNetInflowPercent: null,
    smallNetInflow: null,
    smallNetInflowPercent: null,
  };
}

const boards: TLocalBoardSummary[] = [
  { code: 'BK0001', name: '半导体行业Ⅱ', kind: 'industry', changePercent: 2.1, mainNetInflow: 0, amount: 10 },
  { code: 'BK0002', name: '机器人板块', kind: 'concept', changePercent: -0.5, mainNetInflow: 0 },
];

describe('本地板块匹配工具', () => {
  it('按代码、原始名称和归一化名称索引本地板块', () => {
    const catalog = buildLocalBoardCatalog(boards);

    expect(catalog.byCode.get('BK0001')?.name).toBe('半导体行业Ⅱ');
    expect(catalog.byName.get('半导体')?.code).toBe('BK0001');
  });

  it('通过代码、归一化名称和模糊重叠查找板块', () => {
    const catalog = buildLocalBoardCatalog(boards);

    expect(findLocalBoard(catalog, { code: 'BK0002' })?.name).toBe('机器人板块');
    expect(findLocalBoard(catalog, { name: '半导体板块' })?.code).toBe('BK0001');
    expect(findLocalBoard(catalog, { name: '半导体设备' })?.code).toBe('BK0001');
    expect(findLocalBoard(catalog, { name: '' })).toBeUndefined();
  });

  it('用本地板块字段校准板块并在无匹配时回退目录记录', () => {
    const catalog = buildLocalBoardCatalog(boards);

    expect(reconcileSectorsWithLocalBoardsForTest([{ code: 'old', name: '半导体', changePercent: 9, mainNetInflow: 1 }], catalog)).toEqual([
      { code: 'BK0001', name: '半导体行业Ⅱ', changePercent: 2.1, mainNetInflow: 1, amount: 10 },
    ]);
    expect(reconcileSectorsWithLocalBoardsForTest([{ code: 'missing', name: '不存在', changePercent: 1, mainNetInflow: 0 }], catalog)).toEqual(boards.slice(0, 30));
  });
});

describe('发现页股票和资金流工具', () => {
  it('仅将跌停行情行转换为股票项', () => {
    expect(toLimitDownStockItemForTest({ code: '600001', name: '跌停A', changePercent: '-10.01%', price: 5, amount: 120_000_000 })).toEqual({
      code: '600001',
      name: '跌停A',
      price: '5',
      changePercent: '-10.01',
      amount: '+1.20亿',
    });
    expect(toLimitDownStockItemForTest({ code: '300001', name: '创业板', changePercent: '-10%', price: 5 })).toBeUndefined();
  });

  it('归一化股票代码后按亿元汇总成分股主力净流入', () => {
    expect(sumConstituentMainNetInflowYiForTest(
      [{ code: 'sh600001' }, { code: 'sz000001' }, { code: 'bad' }],
      [
        { code: '600001', mainNetInflow: 100_000_000 },
        { code: '000001', mainNetInflow: -50_000_000 },
        { code: '300001', mainNetInflow: 999_000_000 },
      ],
    )).toBe(0.5);
    expect(sumConstituentMainNetInflowYiForTest([], [])).toBeUndefined();
  });

  it('机会雷达仅筛选超大单买入且涨幅低于4%的个股，并按资金额排序保留至少10条', () => {
    const rows = Array.from({ length: 14 }, (_, index) => ({
      code: `6000${String(index).padStart(2, '0')}`,
      name: `低涨幅资金股${index}`,
      price: 10 + index,
      changePercent: index === 13 ? 4 : 3.9 - index * 0.1,
      mainNetInflow: 80_000_000 + index * 10_000_000,
      mainNetInflowPercent: 1,
      superLargeNetInflow: 100_000_000 + index * 10_000_000,
      superLargeNetInflowPercent: 1,
      largeNetInflow: null,
      largeNetInflowPercent: null,
      mediumNetInflow: null,
      mediumNetInflowPercent: null,
      smallNetInflow: null,
      smallNetInflowPercent: null,
    }));

    const radar = buildOpportunityStockRadarForTest([
      ...rows,
      { ...rows[0], code: '600100', name: '涨停股', changePercent: 10, superLargeNetInflow: 999_000_000 },
      { ...rows[0], code: '600101', name: '资金流出', changePercent: 1, superLargeNetInflow: -100_000_000 },
    ]);

    expect(radar).toHaveLength(13);
    expect(radar.length).toBeGreaterThanOrEqual(10);
    expect(radar[0]).toMatchObject({ code: '600012', name: '低涨幅资金股12' });
    expect(radar[0]?.changePercent).toBeCloseTo(2.7);
    expect(radar.some((item) => item.name === '涨停股')).toBe(false);
    expect(radar.some((item) => item.name === '资金流出')).toBe(false);
    expect(radar.every((item) => item.changePercent !== undefined && item.changePercent !== null && item.changePercent < 4 && Number(item.amount) > 0)).toBe(true);
  });

  it('机会雷达在超大单字段缺失时使用主力净流入真实数据', () => {
    const radar = buildOpportunityStockRadarForTest([
      {
        code: '600001',
        name: '主力净流入股',
        price: 10,
        changePercent: 1.2,
        mainNetInflow: 120_000_000,
        mainNetInflowPercent: 1,
        superLargeNetInflow: null,
        superLargeNetInflowPercent: null,
        largeNetInflow: null,
        largeNetInflowPercent: null,
        mediumNetInflow: null,
        mediumNetInflowPercent: null,
        smallNetInflow: null,
        smallNetInflowPercent: null,
      },
    ]);

    expect(radar).toEqual([
      expect.objectContaining({
        code: '600001',
        name: '主力净流入股',
        amount: 120_000_000,
        reason: '主力净流入 +1.20亿',
      }),
    ]);
  });

  it('机会雷达低涨幅候选不足10条时展示正向资金流个股，避免误判为空态', () => {
    const rows = Array.from({ length: 3 }, (_, index) => ({
      code: `6002${String(index).padStart(2, '0')}`,
      name: `正向资金股${index}`,
      price: 10 + index,
      changePercent: 4.5 + index,
      mainNetInflow: 60_000_000 + index * 10_000_000,
      mainNetInflowPercent: 1,
      superLargeNetInflow: 90_000_000 + index * 10_000_000,
      superLargeNetInflowPercent: 1,
      largeNetInflow: null,
      largeNetInflowPercent: null,
      mediumNetInflow: null,
      mediumNetInflowPercent: null,
      smallNetInflow: null,
      smallNetInflowPercent: null,
    }));

    const radar = buildOpportunityStockRadarForTest(rows);

    expect(radar).toHaveLength(3);
    expect(radar[0]).toMatchObject({ code: '600202', name: '正向资金股2', amount: 110_000_000 });
  });

  it('发现页机会雷达返回个股机会时同时保留市场总结里的板块机会数据', () => {
    const radar = buildDiscoveryOpportunityRadarForTest({
      boards: [
        { code: 'BK0001', name: '机器人', ratio: 2.5, changePercent: 1.2, mainNetInflow: 3.2 },
      ],
      stocks: [
        { code: '600001', name: '个股机会', reason: '超大单净买入', changePercent: 1.2, amount: 120_000_000, score: 120_000_000 },
      ],
    });

    expect(radar.boards).toHaveLength(1);
    expect(radar.boards[0]?.name).toBe('机器人');
    expect(radar.stocks).toEqual([
      { code: '600001', name: '个股机会', reason: '超大单净买入', changePercent: 1.2, amount: 120_000_000, score: 120_000_000 },
    ]);
  });

  it('昨日情绪池跳过无涨停数据的前一交易日', () => {
    const resolved = resolveYesterdaySentimentPoolsForTest(
      ['2026-08-03', '2026-07-31', '2026-07-30'],
      [
        [{ id: 'today', title: '今日股', code: '600000', name: '今日股', tag: '封涨停板', description: '机器人·首板' }],
        [],
        [
          { id: 'previous-1', title: '前日首板', code: '600001', name: '前日首板', tag: '封涨停板', description: '半导体·首板', changePercent: '10.00%' },
          { id: 'previous-2', title: '前日连板', code: '600002', name: '前日连板', tag: '封涨停板', description: '机器人·2连板', changePercent: '10.01%' },
          { id: 'broken', title: '炸板股', code: '600003', name: '炸板股', tag: '涨停开板', description: '机器人·开板', changePercent: '5.00%' },
        ],
      ],
      '2026-08-03',
    );

    expect(resolved.date).toBe('2026-07-30');
    expect(resolved.zt.map((item) => item.code)).toEqual(['600001', '600002']);
    expect(resolved.lb.map((item) => item.code)).toEqual(['600002']);
    expect(resolved.zt[0]?.industry).toBe('半导体');
  });

  it('龙虎榜分类只返回匹配当前 tab 的真实上榜原因', () => {
    const rows = [
      {
        id: 'inst',
        date: '2026-07-31',
        code: '600001',
        name: '机构股',
        reason: '机构专用',
        changePercent: 10,
        netBuy: 100_000_000,
        buy: 120_000_000,
        sell: 20_000_000,
      },
      {
        id: 'common',
        date: '2026-07-31',
        code: '600002',
        name: '普通上榜',
        reason: '日涨幅偏离值达7%',
        changePercent: 9,
        netBuy: 80_000_000,
        buy: 100_000_000,
        sell: 20_000_000,
      },
    ];

    const selected = selectDragonTigerRowsForTest(rows, (item) => /机构|专用/.test(item.reason));

    expect(selected).toEqual([
      { code: '600001', name: '机构股', changePercent: 10, netBuy: 100_000_000, reason: '机构专用' },
    ]);
  });

  it('龙虎榜真实监管上榜原因保留到净买入和涨幅上榜分类', () => {
    const rows = [
      {
        id: 'turnover',
        date: '2026-07-30',
        code: '600001',
        name: '换手上榜',
        reason: '日换手率达到20%的前5只证券',
        changePercent: 9,
        netBuy: 80_000_000,
        buy: 100_000_000,
        sell: 20_000_000,
      },
      {
        id: 'rise',
        date: '2026-07-30',
        code: '600002',
        name: '涨幅上榜',
        reason: '日涨幅偏离值达到7%的前5只证券',
        changePercent: 10,
        netBuy: 120_000_000,
        buy: 150_000_000,
        sell: 30_000_000,
      },
      {
        id: 'three-days',
        date: '2026-07-30',
        code: '600003',
        name: '连涨上榜',
        reason: '连续三个交易日内，涨幅偏离值累计达到20%的证券',
        changePercent: 10,
        netBuy: -10_000_000,
        buy: 30_000_000,
        sell: 40_000_000,
      },
    ];

    expect(buildDiscoveryDragonTigerForTest(rows)).toEqual({
      inst: [],
      hot: [
        { code: '600002', name: '涨幅上榜', changePercent: 10, netBuy: 120_000_000, reason: '日涨幅偏离值达到7%的前5只证券' },
        { code: '600001', name: '换手上榜', changePercent: 9, netBuy: 80_000_000, reason: '日换手率达到20%的前5只证券' },
      ],
      first: [
        { code: '600002', name: '涨幅上榜', changePercent: 10, netBuy: 120_000_000, reason: '日涨幅偏离值达到7%的前5只证券' },
      ],
    });
  });

  it('龙虎榜历史按交易日输出日期和星期', () => {
    const history = buildDiscoveryDragonTigerHistoryForTest([
      {
        date: '2026-07-31',
        items: [
          {
            id: 'first',
            date: '2026-07-31',
            code: '600001',
            name: '首板股',
            reason: '首板上榜',
            changePercent: 10,
            netBuy: 90_000_000,
            buy: 100_000_000,
            sell: 10_000_000,
          },
        ],
      },
    ]);

    expect(history).toEqual([
      {
        date: '2026-07-31',
        weekday: '星期五',
        inst: [],
        hot: [
          { code: '600001', name: '首板股', changePercent: 10, netBuy: 90_000_000, reason: '首板上榜' },
        ],
        first: [
          { code: '600001', name: '首板股', changePercent: 10, netBuy: 90_000_000, reason: '首板上榜' },
        ],
      },
    ]);
  });

  it('龙虎榜任一分类有真实数据就算已有龙虎榜数据', () => {
    const createItems = (count: number) => Array.from({ length: count }, (_, index) => ({
      code: `6000${String(index).padStart(2, '0')}`,
      name: `样本${index}`,
      changePercent: index,
      netBuy: 100_000_000 - index,
      reason: '日涨幅偏离值达7%',
    }));

    expect(hasDragonTigerRowsForTest({
      tradeDate: '2026-07-31',
      generatedAt: '2026-07-31T10:00:00.000Z',
      dragonTiger: { inst: createItems(1), hot: [], first: [] },
    })).toBe(true);
    expect(hasDragonTigerRowsForTest({
      tradeDate: '2026-07-31',
      generatedAt: '2026-07-31T10:00:00.000Z',
      dragonTiger: { inst: [], hot: [], first: [] },
      dragonTigerHistory: [{ date: '2026-07-31', weekday: '星期五', inst: [], hot: [], first: createItems(1) }],
    })).toBe(true);
    expect(hasDragonTigerRowsForTest({
      tradeDate: '2026-07-31',
      generatedAt: '2026-07-31T10:00:00.000Z',
      dragonTiger: { inst: [], hot: [], first: [] },
    })).toBe(false);
  });

  it('按选中交易日只保留该日龙虎榜数据', () => {
    const history = buildDiscoveryDragonTigerHistoryForTest([
      {
        date: '2026-07-31',
        items: [
          {
            id: 'latest',
            date: '2026-07-31',
            code: '600001',
            name: '最新股',
            reason: '首板上榜',
            changePercent: 10,
            netBuy: 90_000_000,
            buy: 100_000_000,
            sell: 10_000_000,
          },
        ],
      },
      {
        date: '2026-07-30',
        items: [
          {
            id: 'previous',
            date: '2026-07-30',
            code: '600002',
            name: '前日股',
            reason: '机构专用',
            changePercent: 8,
            netBuy: 80_000_000,
            buy: 90_000_000,
            sell: 10_000_000,
          },
        ],
      },
    ]);

    const selected = withSelectedDiscoveryTradeDateForTest({
      tradeDate: '2026-07-31',
      generatedAt: '2026-07-31T10:00:00.000Z',
      dragonTiger: { inst: [], hot: [], first: [{ code: '600001', name: '最新股', changePercent: 10, netBuy: 90_000_000, reason: '首板上榜' }] },
      dragonTigerHistory: history,
    }, '2026-07-30');

    expect(selected.tradeDate).toBe('2026-07-30');
    expect(selected.dragonTiger).toEqual({
      inst: [{ code: '600002', name: '前日股', changePercent: 8, netBuy: 80_000_000, reason: '机构专用' }],
      hot: [{ code: '600002', name: '前日股', changePercent: 8, netBuy: 80_000_000, reason: '机构专用' }],
      first: [],
    });
  });

  it('默认发现页缓存交易日落后最新交易日时需要同步刷新', () => {
    expect(shouldRefreshCachedDiscoverySnapshotForTest({
      tradeDate: '2026-07-31',
      generatedAt: '2026-07-31T10:00:00.000Z',
      dragonTiger: { inst: [], hot: [{ code: '600001', name: '旧榜股', changePercent: 10, netBuy: 90_000_000, reason: '首板上榜' }], first: [] },
    }, '2026-08-03')).toBe(true);
  });

  it('当前交易日缓存缺少个股机会雷达时需要同步刷新', () => {
    expect(shouldRefreshCachedDiscoverySnapshotForTest({
      tradeDate: '2026-08-03',
      generatedAt: '2026-08-03T10:00:00.000Z',
      dragonTiger: { inst: [], hot: [{ code: '600001', name: '上榜股', changePercent: 10, netBuy: 90_000_000, reason: '首板上榜' }], first: [] },
      opportunityRadar: {
        boards: [{ code: 'BK0001', name: '电力', ratio: 16.3, changePercent: 1.26, mainNetInflow: 20.6 }],
        stocks: [],
      },
    }, '2026-08-03')).toBe(true);
  });

  it('当前交易日缓存已有龙虎榜和个股机会雷达时不强制同步刷新', () => {
    expect(shouldRefreshCachedDiscoverySnapshotForTest({
      tradeDate: '2026-08-03',
      generatedAt: '2026-08-03T10:00:00.000Z',
      dragonTiger: { inst: [], hot: [{ code: '600001', name: '上榜股', changePercent: 10, netBuy: 90_000_000, reason: '首板上榜' }], first: [] },
      opportunityRadar: {
        boards: [],
        stocks: [{ code: '600002', name: '个股机会', reason: '主力净流入 +1.00亿', changePercent: 1.2, amount: 100_000_000, score: 100_000_000 }],
      },
    }, '2026-08-03')).toBe(false);
  });

  it('当前交易日缓存个股机会雷达含卖出侧大单时需要同步刷新', () => {
    expect(shouldRefreshCachedDiscoverySnapshotForTest({
      tradeDate: '2026-08-03',
      generatedAt: '2026-08-03T10:00:00.000Z',
      dragonTiger: { inst: [], hot: [{ code: '600001', name: '上榜股', changePercent: 10, netBuy: 90_000_000, reason: '首板上榜' }], first: [] },
      opportunityRadar: {
        boards: [],
        stocks: [{ code: '600002', name: '卖出股', reason: '特大单卖出 · 总市值 80.0亿', changePercent: 1.2, amount: 100_000_000, score: 100_000_000 }],
      },
    }, '2026-08-03')).toBe(true);
  });

  it('当前交易日缓存少于10条且含90%筹码集中度文案时需要同步刷新', () => {
    expect(shouldRefreshCachedDiscoverySnapshotForTest({
      tradeDate: '2026-08-03',
      generatedAt: '2026-08-03T10:00:00.000Z',
      dragonTiger: { inst: [], hot: [{ code: '600001', name: '上榜股', changePercent: 10, netBuy: 90_000_000, reason: '首板上榜' }], first: [] },
      opportunityRadar: {
        boards: [],
        stocks: [{ code: '600002', name: '旧缓存股', reason: '特大单买入 · 总市值 80.0亿 · 90%筹码集中度 11.90%', changePercent: 1.2, amount: 100_000_000, score: 100_000_000 }],
      },
    }, '2026-08-03')).toBe(true);
  });

  it('当前交易日龙虎榜尚未更新时展示该交易日真实空态', () => {
    const latestRows = [{ code: '600001', name: '最新股', changePercent: 10, netBuy: 90_000_000, reason: '首板上榜' }];
    const picked = pickCurrentDragonTigerFromHistoryForTest([
      { date: '2026-08-03', weekday: '星期一', inst: [], hot: [], first: [] },
      { date: '2026-07-31', weekday: '星期五', inst: [], hot: latestRows, first: [] },
    ], '2026-08-03');

    expect(picked).toEqual({ inst: [], hot: [], first: [] });
  });

  it('选中无龙虎榜交易日时返回真实空态而不是回退最新日', () => {
    const selected = withSelectedDiscoveryTradeDateForTest({
      tradeDate: '2026-07-31',
      generatedAt: '2026-07-31T10:00:00.000Z',
      dragonTiger: { inst: [], hot: [], first: [{ code: '600001', name: '最新股', changePercent: 10, netBuy: 90_000_000, reason: '首板上榜' }] },
      dragonTigerHistory: [],
    }, '2026-07-29');

    expect(selected.tradeDate).toBe('2026-07-29');
    expect(selected.dragonTiger).toEqual({ inst: [], hot: [], first: [] });
  });

  it('指定历史日期缺少本地缓存时返回空态，不拼接最新日数据', () => {
    const snapshot = buildDiscoveryHistoryLoadingSnapshotForTest('2026-07-29', new Date('2026-07-31T10:00:00.000Z'));

    expect(snapshot).toEqual({
      tradeDate: '2026-07-29',
      generatedAt: '2026-07-31T10:00:00.000Z',
      tradeDates: [{ date: '2026-07-29', weekday: '星期三' }],
      unavailableReason: '该交易日暂无本地历史数据，正在后台同步',
    });
    expect(snapshot).not.toHaveProperty('marketSummary');
    expect(snapshot).not.toHaveProperty('dragonTiger');
  });

  it('发现页只写入当前点击交易日快照，不批量写入近一个月历史日历', async () => {
    mockedWriteDiscoverySnapshot.mockResolvedValue(undefined);
    const history = Array.from({ length: 24 }, (_, index) => {
      const date = new Date('2026-07-31T00:00:00.000Z');
      date.setUTCDate(date.getUTCDate() - index);
      const day = String(date.getUTCDate()).padStart(2, '0');
      return {
        date: `2026-07-${day}`,
        weekday: '星期五',
        inst: [],
        hot: [],
        first: [{ code: `6000${String(index).padStart(2, '0')}`, name: `样本${index}`, changePercent: 10, netBuy: 10_000_000, reason: '首板上榜' }],
      };
    });

    await writeDiscoverySnapshotCachesForTest({
      tradeDate: '2026-07-31',
      generatedAt: '2026-07-31T10:00:00.000Z',
      dragonTiger: { inst: [], hot: [], first: history[0].first },
      dragonTigerHistory: history,
    });

    expect(mockedWriteDiscoverySnapshot).toHaveBeenCalledTimes(2);
    expect(mockedWriteDiscoverySnapshot).toHaveBeenCalledWith(expect.any(Object), 'default');
    expect(mockedWriteDiscoverySnapshot).toHaveBeenCalledWith(expect.any(Object), 'trade-date:2026-07-31');
    const cacheKeys = mockedWriteDiscoverySnapshot.mock.calls.map((call) => call[1]);
    expect(cacheKeys).not.toContain('trade-date:2026-07-24');
    const uniqueTradeDateKeys = new Set(cacheKeys.filter((key) => String(key).startsWith('trade-date:')));
    expect(uniqueTradeDateKeys).toEqual(new Set(['trade-date:2026-07-31']));
  });

  it('历史涨停池生成明日预判观察项，空池保持无预判空态', () => {
    const snapshot = buildDiscoverySnapshotFromHistoricalPoolsForTest({
      tradeDate: '2026-07-30',
      generatedAt: '2026-07-30T15:30:00.000Z',
      poolItems: [
        { id: '600001', title: '机器人A', code: '600001', name: '机器人A', tag: '封涨停板', description: '机器人·2连板·成交额 12亿', changePercent: '10.00%' },
        { id: '600002', title: '机器人B', code: '600002', name: '机器人B', tag: '涨停开板', description: '机器人·开板', changePercent: '6.00%' },
      ],
      dragonTiger: { inst: [], hot: [], first: [] },
      tradeDates: [{ date: '2026-07-30', weekday: '星期四' }],
    });

    expect(snapshot.sentimentStocks?.zt[0]?.industry).toBe('机器人');
    expect(snapshot.marketSummary?.sectors).toEqual([
      expect.objectContaining({
        name: '机器人',
        changePercent: 8,
        amount: 1_200_000_000,
        topStockName: '机器人A',
        topStockCode: '600001',
      }),
    ]);
    expect(snapshot.opportunityRadar).toEqual({ boards: [], stocks: [] });
    expect(snapshot.nextDayFocus?.length).toBeGreaterThan(0);
    expect(snapshot.nextDayFocus?.some((item) => item.category === 'theme')).toBe(true);
    const emptySnapshot = buildDiscoverySnapshotFromHistoricalPoolsForTest({
      tradeDate: '2026-07-29',
      generatedAt: '2026-07-30T15:30:00.000Z',
      poolItems: [],
      dragonTiger: { inst: [], hot: [], first: [] },
      tradeDates: [{ date: '2026-07-29', weekday: '星期三' }],
    });
    expect(emptySnapshot.marketSummary?.sectors).toEqual([]);
    expect(emptySnapshot.opportunityRadar).toEqual({ boards: [], stocks: [] });
    expect(emptySnapshot.nextDayFocus).toBeUndefined();
  });
  it('机会雷达直接复用AI监控大单异动事件并按行情市值补充筛选', () => {
    const candidates = mergeLargeOrderMonitorCandidatesForTest(
      [
        {
          id: 'mo-large-1',
          category: 'large-order',
          timestamp: '2026-08-03T02:00:00.000Z',
          code: '600100',
          name: '监控股A',
          price: 10,
          changePercent: 3.2,
          title: '特大单买入',
          badge: '大单买入',
          details: ['监控股A', '买入1.2万手'],
          aiAnalysis: '来自AI监控大单异动',
        },
        {
          id: 'mo-large-sell',
          category: 'large-order',
          timestamp: '2026-08-03T02:00:00.000Z',
          code: '600102',
          name: '卖出股',
          price: 9,
          changePercent: 2.8,
          title: '特大单卖出',
          badge: '大单卖出',
          details: ['卖出股', '卖出1.8万手'],
          aiAnalysis: '来自AI监控大单异动',
        },
        {
          id: 'mo-tech-1',
          category: 'technical',
          timestamp: '2026-08-03T02:00:00.000Z',
          code: '600101',
          name: '技术股',
          changePercent: 2.1,
          title: '技术信号',
          details: [],
          aiAnalysis: '非大单异动',
        },
      ],
      [
        { code: '600100', name: '监控股A', changePercent: 3.2, amount: 180_000_000, marketCap: '88亿' },
        { code: '600102', name: '卖出股', changePercent: 2.8, amount: 260_000_000, marketCap: '66亿' },
      ],
    );

    const radar = buildOpportunityStockRadarFromLargeOrdersForTest(candidates);
    expect(radar).toEqual([
      expect.objectContaining({ code: '600100', name: '监控股A', changePercent: 3.2, amount: 180_000_000 }),
    ]);
    expect(radar.some((item) => item.code === '600102')).toBe(false);
  });

  it('机会雷达候选少于10条时不应用90%筹码集中度过滤', () => {
    const rows = Array.from({ length: 9 }, (_, index) => ({
      code: `6001${String(index).padStart(2, '0')}`,
      name: `大单股${index}`,
      title: '大单异动',
      changePercent: 3.5,
      amount: 100_000_000 + index,
      marketCap: '80亿',
      concentration90: 0.16,
    }));

    const radar = buildOpportunityStockRadarFromLargeOrdersForTest(rows);

    expect(radar).toHaveLength(9);
    expect(radar.every((item) => !/90%筹码集中度/.test(item.reason))).toBe(true);
  });

  it('机会雷达候选大于10条时前10条保留，后续才应用90%筹码集中度小于15%', () => {
    const rows = Array.from({ length: 13 }, (_, index) => ({
      code: `6000${String(index).padStart(2, '0')}`,
      name: `大单股${index}`,
      title: '大单异动',
      changePercent: index === 12 ? 4.2 : 3.5,
      amount: 100_000_000 + (12 - index),
      marketCap: index === 11 ? '250亿' : '80亿',
      concentration90: index < 10 ? 0.16 : 0.14,
    }));

    const radar = buildOpportunityStockRadarFromLargeOrdersForTest(rows);

    expect(radar).toHaveLength(11);
    expect(radar.slice(0, 10).every((item) => !/90%筹码集中度/.test(item.reason))).toBe(true);
    expect(radar[10].code).toBe('600010');
    expect(radar[10].reason).toContain('90%筹码集中度 14.00%');
    expect(radar.some((item) => item.code === '600011')).toBe(false);
    expect(radar.some((item) => item.code === '600012')).toBe(false);
  });


  it('大盘主力资金请求失败时使用短期缓存，避免重复触发网络错误', async () => {
    const sdk = getDiscoverySdk();
    sdk.fundFlow.market.mockResolvedValueOnce([
      { date: '2026-07-31', mainNetInflow: 100_000_000 },
      { date: '2026-07-31', mainNetInflow: -50_000_000 },
    ]);

    await expect(fetchMainFundFlowForTest('2026-07-31')).resolves.toBe(0.5);
    await expect(fetchMainFundFlowForTest('2026-07-31')).resolves.toBe(0.5);
    expect(sdk.fundFlow.market).toHaveBeenCalledTimes(1);
  });

  it('大盘主力资金请求失败时使用个股资金流排名汇总作为真实数据降级', async () => {
    const sdk = getDiscoverySdk();
    sdk.fundFlow.market.mockRejectedValueOnce(Object.assign(new Error('fetch failed'), { code: 'NETWORK_ERROR', provider: 'eastmoney' }));
    sdk.fundFlow.rank.mockResolvedValueOnce([
      createFundFlowRankRow('600001', '资金流入', 120_000_000),
      createFundFlowRankRow('600002', '资金流出', -20_000_000),
      createFundFlowRankRow('600003', '无效数据', null),
    ]);

    await expect(fetchMainFundFlowForTest('2026-07-31')).resolves.toBe(1);
    expect(sdk.fundFlow.market).toHaveBeenCalledTimes(1);
    expect(sdk.fundFlow.rank).toHaveBeenCalledWith({ indicator: 'today' });
  });

  it('个股资金流排名汇总应忽略空值并按亿元返回', () => {
    expect(sumFundFlowRankRowsYiForTest([
      createFundFlowRankRow('600001', '资金流入', 200_000_000),
      createFundFlowRankRow('600002', '资金流出', -50_000_000),
      createFundFlowRankRow('600003', '空值', null),
    ])).toBe(1.5);
    expect(sumFundFlowRankRowsYiForTest([createFundFlowRankRow('600004', '空值', null)])).toBeNull();
  });

  it('大盘主力资金和个股排名都失败时保持空态', async () => {
    const sdk = getDiscoverySdk();
    sdk.fundFlow.market.mockRejectedValueOnce(new Error('fetch failed'));
    sdk.fundFlow.rank.mockRejectedValueOnce(new Error('rank failed'));

    await expect(fetchMainFundFlowForTest('2026-07-31')).resolves.toBeNull();
    expect(sdk.fundFlow.market).toHaveBeenCalledTimes(1);
    expect(sdk.fundFlow.rank).toHaveBeenCalledTimes(1);
  });

  it('格式化 stock-sdk 网络错误时不输出完整堆栈对象', () => {
    const error = new Error('fetch failed');
    Object.assign(error, {
      code: 'NETWORK_ERROR',
      provider: 'eastmoney',
      cause: { code: 'UND_ERR_SOCKET' },
    });

    expect(formatDiscoveryDataErrorForTest(error)).toBe(
      'fetch failed code=NETWORK_ERROR provider=eastmoney cause=UND_ERR_SOCKET',
    );
  });

  it('可选任务超时时返回空态而不是阻塞探索页快照', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const pendingTask = new Promise<string>(() => undefined);
      const resultPromise = withOptionalTimeoutForTest('slow task', pendingTask, 10);

      await vi.advanceTimersByTimeAsync(10);

      await expect(resultPromise).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith('[discovery] optional task timed out: slow task');
    } finally {
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('板块主力资金接口失败时保留已有板块并跳过成分股请求', async () => {
    const sdk = getDiscoverySdk();
    sdk.fundFlow.rank.mockRejectedValue(new Error('fetch failed'));

    await expect(enrichMissingSectorMainNetInflowsForTest(
      [{ code: 'BK0001', name: '半导体行业Ⅱ', changePercent: 2.1, mainNetInflow: 0, amount: 10 }],
      buildLocalBoardCatalog(boards),
    )).resolves.toEqual([
      { code: 'BK0001', name: '半导体行业Ⅱ', changePercent: 2.1, mainNetInflow: 0, amount: 10 },
    ]);
    expect(sdk.board.industry.constituents).not.toHaveBeenCalled();
    expect(sdk.board.concept.constituents).not.toHaveBeenCalled();
  });

  it('等待 9:30 时仍返回今天起往前 20 个交易日导航', async () => {
    const tradingDates = [
      '2026-08-03',
      '2026-07-31',
      '2026-07-30',
      '2026-07-29',
      '2026-07-28',
      '2026-07-27',
      '2026-07-24',
      '2026-07-23',
      '2026-07-22',
      '2026-07-21',
      '2026-07-20',
      '2026-07-17',
      '2026-07-16',
      '2026-07-15',
      '2026-07-14',
      '2026-07-13',
      '2026-07-10',
      '2026-07-09',
      '2026-07-08',
      '2026-07-07',
    ];
    const previousByDate = new Map(tradingDates.map((date, index) => [date, tradingDates[index + 1]]));
    mockedPreviousRemoteTradingDay.mockImplementation(async (date) => previousByDate.get(date) ?? date);

    const snapshot = await buildDiscoveryWaitingSnapshotForTest(new Date('2026-08-03T00:10:00.000Z'));

    expect(snapshot.tradeDate).toBe('2026-08-03');
    expect(snapshot.tradeDates?.map((item) => item.date)).toEqual(tradingDates);
    expect(snapshot.tradeDates).toHaveLength(20);
    expect(snapshot.tradeDates?.[0]).toEqual({ date: '2026-08-03', weekday: '星期一' });
    expect(snapshot.tradeDates?.at(-1)).toEqual({ date: '2026-07-07', weekday: '星期二' });
  });

  it('交易日 08:00 到 09:30 之间保持发现页快照', async () => {
    mockedIsRemoteTradingDay.mockResolvedValue(true);

    await expect(shouldHoldDiscoverySnapshotUntil930(new Date('2026-07-31T01:29:00.000Z'))).resolves.toBe(true);
    await expect(shouldHoldDiscoverySnapshotUntil930(new Date('2026-07-31T01:30:00.000Z'))).resolves.toBe(false);
  });

  it('交易可刷新窗口外延后刷新，非交易日允许刷新历史龙虎榜', async () => {
    mockedIsRemoteTradingDay.mockResolvedValue(true);

    await expect(shouldDeferDiscoveryRefresh(new Date('2026-07-30T23:59:00.000Z'))).resolves.toBe(true);
    await expect(shouldDeferDiscoveryRefresh(new Date('2026-07-31T01:29:00.000Z'))).resolves.toBe(true);
    await expect(shouldDeferDiscoveryRefresh(new Date('2026-07-31T01:30:00.000Z'))).resolves.toBe(false);

    mockedIsRemoteTradingDay.mockResolvedValue(false);
    await expect(shouldDeferDiscoveryRefresh(new Date('2026-08-01T02:00:00.000Z'))).resolves.toBe(false);
  });
});
