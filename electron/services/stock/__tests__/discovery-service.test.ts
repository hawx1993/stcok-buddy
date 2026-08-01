import { describe, expect, it, vi } from 'vitest';

const stockSdkInstances = vi.hoisted(() => [] as Array<{
  fundFlow: { rank: ReturnType<typeof vi.fn> };
  board: { concept: { constituents: ReturnType<typeof vi.fn> }; industry: { constituents: ReturnType<typeof vi.fn> } };
}>);

vi.mock('stock-sdk', () => ({
  default: class StockSDKMock {
    fundFlow = { rank: vi.fn() };
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
}));

vi.mock('../market-indices.js', () => ({
  fetchMarketIndex: vi.fn(),
}));

vi.mock('../../market-data/providers.js', () => ({
  isRemoteTradingDay: vi.fn(),
  previousRemoteTradingDay: vi.fn(),
}));

import { isRemoteTradingDay, previousRemoteTradingDay } from '../../market-data/providers.js';
import { writeDiscoverySnapshot } from '../../market-data/market-data-store.js';
import {
  buildDiscoverySnapshotFromHistoricalPoolsForTest,
  buildLocalBoardCatalog,
  buildDiscoveryDragonTigerForTest,
  buildDiscoveryDragonTigerHistoryForTest,
  buildDiscoveryHistoryLoadingSnapshotForTest,
  enrichMissingSectorMainNetInflowsForTest,
  findLocalBoard,
  formatDiscoveryDataErrorForTest,
  hasDragonTigerRowsForTest,
  reconcileSectorsWithLocalBoardsForTest,
  selectDragonTigerRowsForTest,
  shouldDeferDiscoveryRefresh,
  shouldHoldDiscoverySnapshotUntil930,
  sumConstituentMainNetInflowYiForTest,
  toLimitDownStockItemForTest,
  withOptionalTimeoutForTest,
  withSelectedDiscoveryTradeDateForTest,
  writeDiscoverySnapshotCachesForTest,
} from '../discovery-service.js';
import type { TLocalBoardSummary } from '../discovery-service.js';

const mockedIsRemoteTradingDay = vi.mocked(isRemoteTradingDay);
const mockedPreviousRemoteTradingDay = vi.mocked(previousRemoteTradingDay);
const mockedWriteDiscoverySnapshot = vi.mocked(writeDiscoverySnapshot);

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

  it('龙虎榜真实数据不匹配分类关键词时保留真实空分类', () => {
    const rows = Array.from({ length: 2 }, (_, index) => ({
      id: `common-${index}`,
      date: '2026-07-31',
      code: `60000${index}`,
      name: `普通上榜${index}`,
      reason: '日涨幅偏离值达7%',
      changePercent: 9 - index,
      netBuy: 80_000_000 - index,
      buy: 100_000_000,
      sell: 20_000_000,
    }));

    expect(buildDiscoveryDragonTigerForTest(rows)).toEqual({
      inst: [],
      hot: [],
      first: [],
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
        hot: [],
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
      hot: [],
      first: [],
    });
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

  it('将近一个月龙虎榜历史按交易日写入发现页 DuckDB 快照', async () => {
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

    expect(mockedWriteDiscoverySnapshot).toHaveBeenCalledWith(expect.any(Object), 'default');
    expect(mockedWriteDiscoverySnapshot).toHaveBeenCalledWith(expect.any(Object), 'trade-date:2026-07-31');
    expect(mockedWriteDiscoverySnapshot).toHaveBeenCalledWith(expect.any(Object), 'trade-date:2026-07-24');
    const cacheKeys = mockedWriteDiscoverySnapshot.mock.calls.map((call) => call[1]);
    const uniqueTradeDateKeys = new Set(cacheKeys.filter((key) => String(key).startsWith('trade-date:')));
    expect(uniqueTradeDateKeys).toHaveLength(20);
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

    expect(snapshot.marketSummary?.sectors).toEqual([
      expect.objectContaining({
        name: '机器人',
        changePercent: 8,
        amount: 1_200_000_000,
        topStockName: '机器人A',
        topStockCode: '600001',
      }),
    ]);
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
    expect(emptySnapshot.nextDayFocus).toBeUndefined();
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
    const sdk = stockSdkInstances[0];
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
