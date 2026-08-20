import { beforeEach, describe, expect, it, vi } from 'vitest';

interface IStockSdkOptions {
  timeout?: number;
  retry?: { maxRetries?: number; baseDelay?: number };
  providerPolicies?: {
    eastmoney?: {
      rotateUserAgent?: boolean;
    };
  };
}

interface IStockSdkInstance {
  options: IStockSdkOptions;
  kline: { cn: ReturnType<typeof vi.fn> };
}

const stockSdkInstances = vi.hoisted(() => [] as IStockSdkInstance[]);

vi.mock('stock-sdk', () => ({
  default: class StockSDKMock {
    kline = { cn: vi.fn() };

    constructor(options: IStockSdkOptions) {
      stockSdkInstances.push({ options, kline: this.kline });
    }
  },
}));

import { stockSdkHistoricalProvider } from '../providers.js';

describe('stockSdkHistoricalProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses stock-sdk eastmoney user-agent policy for historical K-lines', async () => {
    const historicalSdk = stockSdkInstances[1];
    if (!historicalSdk) throw new Error('Historical stock-sdk instance was not created');

    historicalSdk.kline.cn.mockResolvedValue([
      {
        date: '2026-08-19',
        open: 8.9,
        high: 9.1,
        low: 8.8,
        close: 9,
        volume: 100,
        amount: 900,
        change: 0.1,
        changePercent: 1.12,
        turnoverRate: 0.5,
      },
    ]);

    await expect(
      stockSdkHistoricalProvider.getDailyBars('600000', {
        adjustType: 'qfq',
        startDate: '2026-08-18',
        endDate: '2026-08-19',
      }),
    ).resolves.toMatchObject([
      {
        symbol: '600000',
        tradeDate: '2026-08-19',
        adjustType: 'qfq',
        source: 'stock-sdk:eastmoney',
      },
    ]);

    expect(historicalSdk.options).toEqual({
      timeout: 12_000,
      retry: { maxRetries: 0 },
      providerPolicies: {
        eastmoney: { rotateUserAgent: true },
      },
    });
    expect(historicalSdk.kline.cn).toHaveBeenCalledWith('600000', {
      period: 'daily',
      adjust: 'qfq',
      startDate: '20260818',
      endDate: '20260819',
    });
  });
});
