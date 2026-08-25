import { beforeEach, describe, expect, it, vi } from 'vitest';

const stockSdkInstances = vi.hoisted(
  () =>
    [] as Array<{
      board: {
        industry: {
          constituents: ReturnType<typeof vi.fn>;
          list: ReturnType<typeof vi.fn>;
          kline: ReturnType<typeof vi.fn>;
        };
        concept: {
          constituents: ReturnType<typeof vi.fn>;
          list: ReturnType<typeof vi.fn>;
          kline: ReturnType<typeof vi.fn>;
        };
      };
      fundFlow: {
        rank: ReturnType<typeof vi.fn>;
      };
    }>,
);
const hithinkBoardHeat = vi.hoisted(() => ({
  getHithinkBoardConstituents: vi.fn(),
}));

vi.mock('stock-sdk', () => ({
  default: class StockSDKMock {
    board = {
      industry: { constituents: vi.fn(), list: vi.fn(), kline: vi.fn() },
      concept: { constituents: vi.fn(), list: vi.fn(), kline: vi.fn() },
    };
    fundFlow = { rank: vi.fn() };

    constructor() {
      stockSdkInstances.push(this);
    }
  },
}));

vi.mock('../../../stock-db/market-data-store', () => ({
  listBoardConstituents: vi.fn(),
  listDailyBars: vi.fn(),
  listLatestMarketRows: vi.fn(),
  listMarketBoards: vi.fn(),
  listSecurities: vi.fn(),
  readBoardDetail: vi.fn(),
  replaceBoardConstituents: vi.fn(),
  upsertMarketBoards: vi.fn(),
  writeBoardDetail: vi.fn(),
}));

vi.mock('../../anomaly/hithink-board-heat.js', () => hithinkBoardHeat);

vi.mock('../../quotes/shared', async () => {
  const actual = await vi.importActual<typeof import('../../quotes/shared.js')>('../../quotes/shared');
  return { ...actual, getCachedMarketBoardRows: vi.fn() };
});

import {
  listDailyBars,
  listLatestMarketRows,
  listMarketBoards,
  listSecurities,
  readBoardDetail,
} from '../../../stock-db/market-data-store.js';
import { getCachedMarketBoardRows } from '../../quotes/shared.js';
import { getBoardDetail } from '../../anomaly/board-detail.js';

const mockedListDailyBars = vi.mocked(listDailyBars);
const mockedListLatestMarketRows = vi.mocked(listLatestMarketRows);
const mockedListMarketBoards = vi.mocked(listMarketBoards);
const mockedListSecurities = vi.mocked(listSecurities);
const mockedReadBoardDetail = vi.mocked(readBoardDetail);
const mockedGetCachedMarketBoardRows = vi.mocked(getCachedMarketBoardRows);

beforeEach(() => {
  mockedListDailyBars.mockReset();
  mockedListLatestMarketRows.mockReset();
  mockedListMarketBoards.mockReset();
  mockedListSecurities.mockReset();
  mockedReadBoardDetail.mockReset();
  mockedGetCachedMarketBoardRows.mockReset();

  mockedReadBoardDetail.mockResolvedValue(undefined);
  mockedListMarketBoards.mockResolvedValue([]);
  hithinkBoardHeat.getHithinkBoardConstituents.mockReset();
  hithinkBoardHeat.getHithinkBoardConstituents.mockResolvedValue([]);
  mockedGetCachedMarketBoardRows.mockResolvedValue([
    { code: 'BK0725', name: '装饰装修', changePercent: 1.83, minutes: [] },
  ]);
  mockedListLatestMarketRows.mockResolvedValue([
    {
      code: '000001',
      name: '样本股',
      exchange: 'SZ',
      industry: '装饰装修',
      open: 9,
      high: 10,
      low: 9,
      price: 10,
      volume: 100,
      change: 1,
      changePercent: 0.82,
      amount: 1000000,
      turnoverRate: 2,
      marketCap: 5000000000,
    },
  ]);
  mockedListSecurities.mockResolvedValue([
    {
      symbol: '000001',
      name: '样本股',
      exchange: 'SZ',
      securityType: 'stock',
      status: 'listed',
      industry: '装饰装修',
      isSt: false,
      source: 'test',
      updatedAt: '2026-08-11T08:00:00.000Z',
    },
  ]);
  mockedListDailyBars.mockResolvedValue([
    {
      symbol: '000001',
      tradeDate: '2026-08-11',
      open: 9,
      close: 10,
      high: 10,
      low: 9,
      volume: 100,
      amount: 1000000,
      change: 1,
      changePercent: 11.11,
      turnoverRate: 2,
      adjustType: 'qfq',
      source: 'test',
      fetchedAt: '2026-08-11T08:00:00.000Z',
    },
  ]);

  for (const sdk of stockSdkInstances) {
    sdk.board.industry.list.mockReset();
    sdk.board.industry.constituents.mockReset();
    sdk.board.industry.kline.mockReset();
    sdk.fundFlow.rank.mockReset();
    sdk.board.concept.list.mockReset();
    sdk.board.concept.constituents.mockReset();
    sdk.board.concept.kline.mockReset();
    sdk.board.industry.list.mockResolvedValue([{ code: 'BK0725', name: '装饰装修' }]);
    sdk.fundFlow.rank.mockResolvedValue([{ code: '000001', mainNetInflow: 12345678 }]);
    sdk.board.industry.constituents.mockResolvedValue([
      { code: '000001', name: '样本股', price: 10, changePercent: 0.82 },
    ]);
    sdk.board.industry.kline.mockResolvedValue([
      { date: '2026-08-11', open: 9, close: 10, high: 10, low: 9, volume: 100 },
    ]);
    sdk.board.concept.list.mockResolvedValue([]);
    sdk.board.concept.constituents.mockResolvedValue([]);
    sdk.board.concept.kline.mockResolvedValue([]);
  }
});

describe('getBoardDetail', () => {
  it('uses the cached real board quote instead of defaulting local detail to zero', async () => {
    const detail = await getBoardDetail('BK0725', false, '装饰装修');

    expect(detail.changePercent).toBe('+1.83%');
    expect(detail.changePercent).not.toBe('+0.00%');
  });

  it('refreshes a cached detail percentage from the current board quote', async () => {
    mockedReadBoardDetail.mockResolvedValue({
      detail: {
        code: 'BK0725',
        name: '装饰装修',
        changePercent: '+0.00%',
        kline: [{ time: '2026-08-10', open: 9, close: 9, high: 9, low: 9, volume: 1 }],
        constituents: [],
      },
      updatedAt: '2026-08-10T08:00:00.000Z',
    });

    const detail = await getBoardDetail('BK0725', false, '装饰装修');

    expect(detail.changePercent).toBe('+1.83%');
  });

  it('enriches board detail constituents with real quote and fund-flow fields', async () => {
    const detail = await getBoardDetail('BK0725', true, '装饰装修');

    expect(detail.constituents?.[0]).toMatchObject({
      code: '000001',
      name: '样本股',
      price: 10,
      changePercent: '+0.82%',
      marketCap: '50.0亿',
      mainNetInflow: '+1234.57万',
      turnoverRate: '2.00%',
      volume: '100手',
      amount: '+100.00万',
      turnover: '2.00%',
    });
  });

  it('uses Fuyao THS index constituents for .TI board detail when stock-sdk has no rows', async () => {
    mockedGetCachedMarketBoardRows.mockResolvedValue([
      { code: '881169.TI', name: '贵金属', boardKind: 'industry', changePercent: -4.82, minutes: [] },
    ]);
    hithinkBoardHeat.getHithinkBoardConstituents.mockResolvedValue([
      { code: '000426', name: '兴业银锡' },
      { code: '600489', name: '中金黄金' },
    ]);
    for (const sdk of stockSdkInstances) {
      sdk.board.industry.constituents.mockResolvedValue([]);
      sdk.board.concept.constituents.mockResolvedValue([]);
      sdk.board.industry.kline.mockResolvedValue([]);
      sdk.board.concept.kline.mockResolvedValue([]);
    }

    const detail = await getBoardDetail('881169.TI', false, '贵金属');

    expect(hithinkBoardHeat.getHithinkBoardConstituents).toHaveBeenCalledWith('881169.TI');
    expect(detail).toMatchObject({
      code: '881169.TI',
      name: '贵金属',
      changePercent: '-4.82%',
      constituents: [
        { code: '000426', name: '兴业银锡' },
        { code: '600489', name: '中金黄金' },
      ],
    });
  });
});
