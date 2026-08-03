import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/shared/market-time.js', () => ({
  isChinaMarketOpen: vi.fn(),
  toShanghaiMarketTime: vi.fn(),
}));

vi.mock('../../config-store.js', () => ({
  listFavoriteStocks: vi.fn(),
}));

vi.mock('../monitor-history-store.js', () => ({
  cleanupMonitorHistoryNoise: vi.fn(),
  countMonitorHistory: vi.fn(),
  countMonitorHistoryByCategory: vi.fn(),
  enqueueMonitorEvents: vi.fn(),
  flushMonitorEventQueue: vi.fn(),
  listMonitorDates: vi.fn(),
  listMonitorHistory: vi.fn(),
  pruneMonitorHistory: vi.fn(),
}));

vi.mock('../surge-history-store.js', () => ({
  listRecentStockSurgeEvents: vi.fn(),
  listStockSurgeEvents: vi.fn(),
}));

vi.mock('../../market-data/market-data-store.js', () => ({
  getStockChip: vi.fn(),
}));

vi.mock('../market-page.js', () => ({
  getAllMarketQuoteRows: vi.fn(),
}));

vi.mock('../stock-client.js', () => ({
  getBatchQuotes: vi.fn(),
  getChipDistribution: vi.fn(),
  listHotFocus: vi.fn(),
}));

vi.mock('../news-client.js', () => ({
  listStockNewsAnnouncements: vi.fn(),
}));

import { toShanghaiMarketTime } from '../../../../src/shared/market-time.js';
import {
  captureMonitorEvents,
  isLargeOrderItem,
  isRecentLargeBuyEvent,
  isRecentLimitUpEvent,
  parseMarketCapYi,
  ratioPercent,
} from '../monitor-service.js';
import { listFavoriteStocks } from '../../config-store.js';
import { getStockChip } from '../../market-data/market-data-store.js';
import { getAllMarketQuoteRows } from '../market-page.js';
import { getBatchQuotes, getChipDistribution, listHotFocus } from '../stock-client.js';
import { listRecentStockSurgeEvents } from '../surge-history-store.js';
import type { HotFocusItem, IChipDistributionResult, StockSurgeEvent } from '../../../../src/shared/types.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AI 监控筹码信号', () => {
  it('低集中度叠加大额买入时展示个股异动和买入信息', async () => {
    vi.mocked(toShanghaiMarketTime).mockReturnValue({ date: '2026-08-03', minutes: 600, weekday: 1 });
    vi.mocked(listFavoriteStocks).mockResolvedValue([{ code: '600519', name: '贵州茅台', createdAt: '2026-08-03T00:00:00.000Z' }]);
    vi.mocked(getBatchQuotes).mockResolvedValue([
      { code: '600519', name: '贵州茅台', price: '1500', changePercent: '1.20', marketCap: '800亿' },
    ]);
    vi.mocked(listHotFocus).mockResolvedValue([]);
    vi.mocked(getAllMarketQuoteRows).mockResolvedValue([]);
    vi.mocked(getStockChip).mockResolvedValue(undefined);
    vi.mocked(getChipDistribution).mockResolvedValue({
      latest: {
        date: '2026-08-03',
        avgCost: 1490,
        profitRatio: 0.42,
        concentration90: 0.145,
        points: [],
      },
      distributions: [],
      trend: [],
      source: 'stock-sdk',
    } satisfies IChipDistributionResult);
    vi.mocked(listRecentStockSurgeEvents).mockResolvedValue([
      {
        id: 'large-buy-1',
        tradeDate: '2026-08-01',
        title: '贵州茅台',
        code: '600519',
        name: '贵州茅台',
        time: '10:30:00',
        price: undefined,
        changePercent: undefined,
        turnover: undefined,
        amount: '买入1.2万手',
        description: '特大单买入',
        tag: '特大单买入',
        type: 'surge',
      },
    ]);

    const events = await captureMonitorEvents(new Date('2026-08-03T02:00:00.000Z'), ['chip']);
    const largeBuyChipEvent = events.find((event) => event.id === 'mo-chip-low-concentration-largebuy-600519-2026-08-03');

    expect(largeBuyChipEvent).toBeDefined();
    expect(largeBuyChipEvent?.details).toContain('90%筹码集中度 14.50%');
    expect(largeBuyChipEvent?.details).toContain('近周个股异动：2026-08-01 10:30:00，买入1.2万手');
  });
});
describe('监控大单工具', () => {
  it('识别一万手以上的大笔买入和卖出', () => {
    expect(isLargeOrderItem({ id: '1', title: '特大单买入', amount: '1.2万手' })).toBe(true);
    expect(isLargeOrderItem({ id: '2', title: '大笔卖出', description: '10000手' })).toBe(true);
    expect(isLargeOrderItem({ id: '3', title: '大笔买入', amount: '9999手' })).toBe(false);
    expect(isLargeOrderItem({ id: '4', title: '普通异动', amount: '2万手' })).toBe(false);
  });

  it('仅将买入侧大单识别为近期大额买入事件', () => {
    const buyEvent: StockSurgeEvent = { id: '1', tradeDate: '2026-07-31', title: '大笔买入', amount: '1万手' };
    const sellEvent: StockSurgeEvent = { id: '2', tradeDate: '2026-07-31', title: '大笔卖出', amount: '2万手' };

    expect(isRecentLargeBuyEvent(buyEvent)).toBe(true);
    expect(isRecentLargeBuyEvent(sellEvent)).toBe(false);
  });
});

describe('监控数值工具', () => {
  it('将比例归一化为百分比', () => {
    expect(ratioPercent(0.23)).toBe(23);
    expect(ratioPercent(23)).toBe(23);
    expect(ratioPercent(Number.NaN)).toBeUndefined();
    expect(ratioPercent(undefined)).toBeUndefined();
  });

  it('将市值解析为亿元', () => {
    expect(parseMarketCapYi(200_000_000)).toBe(2);
    expect(parseMarketCapYi(80)).toBe(80);
    expect(parseMarketCapYi('1.5万亿')).toBe(15_000);
    expect(parseMarketCapYi('3,500万')).toBe(0.35);
    expect(parseMarketCapYi('--')).toBeUndefined();
  });
});

describe('监控异动事件分类', () => {
  it('识别涨停事件并排除跌停和炸板文本', () => {
    const limitUp: StockSurgeEvent = { id: '1', tradeDate: '2026-07-31', title: '封涨停板' };
    const broken: StockSurgeEvent = { id: '2', tradeDate: '2026-07-31', title: '涨停开板' };
    const limitDown: StockSurgeEvent = { id: '3', tradeDate: '2026-07-31', title: '封跌停板' };

    expect(isRecentLimitUpEvent(limitUp)).toBe(true);
    expect(isRecentLimitUpEvent(broken)).toBe(false);
    expect(isRecentLimitUpEvent(limitDown)).toBe(false);
  });

  it('支持 HotFocusItem 兼容文本来源的大单识别', () => {
    const item: HotFocusItem = { id: '1', title: '盘口异动', description: '特大单买入 1.1万手' };

    expect(isLargeOrderItem(item)).toBe(true);
  });
});
