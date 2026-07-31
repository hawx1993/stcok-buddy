import { describe, expect, it, vi } from 'vitest';

vi.mock('stock-sdk', () => ({
  default: class StockSDKMock {
    fundFlow = { rank: vi.fn() };
    board = {
      concept: { constituents: vi.fn() },
      industry: { constituents: vi.fn() },
    };
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
}));

import { isRemoteTradingDay } from '../../market-data/providers.js';
import {
  buildLocalBoardCatalog,
  findLocalBoard,
  reconcileSectorsWithLocalBoardsForTest,
  shouldDeferDiscoveryRefresh,
  shouldHoldDiscoverySnapshotUntil930,
  sumConstituentMainNetInflowYiForTest,
  toLimitDownStockItemForTest,
} from '../discovery-service.js';
import type { TLocalBoardSummary } from '../discovery-service.js';

const mockedIsRemoteTradingDay = vi.mocked(isRemoteTradingDay);

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
});

describe('发现页刷新门控', () => {
  it('交易日 08:00 到 09:30 之间保持发现页快照', async () => {
    mockedIsRemoteTradingDay.mockResolvedValue(true);

    await expect(shouldHoldDiscoverySnapshotUntil930(new Date('2026-07-31T01:29:00.000Z'))).resolves.toBe(true);
    await expect(shouldHoldDiscoverySnapshotUntil930(new Date('2026-07-31T01:30:00.000Z'))).resolves.toBe(false);
  });

  it('交易可刷新窗口外延后刷新', async () => {
    mockedIsRemoteTradingDay.mockResolvedValue(true);

    await expect(shouldDeferDiscoveryRefresh(new Date('2026-07-30T23:59:00.000Z'))).resolves.toBe(true);
    await expect(shouldDeferDiscoveryRefresh(new Date('2026-07-31T01:29:00.000Z'))).resolves.toBe(true);
    await expect(shouldDeferDiscoveryRefresh(new Date('2026-07-31T01:30:00.000Z'))).resolves.toBe(false);

    mockedIsRemoteTradingDay.mockResolvedValue(false);
    await expect(shouldDeferDiscoveryRefresh(new Date('2026-08-01T02:00:00.000Z'))).resolves.toBe(true);
  });
});
