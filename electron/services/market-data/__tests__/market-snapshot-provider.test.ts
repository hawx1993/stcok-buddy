import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ITencentQuote } from '../../stock/a-stock-data-runner.js';

const mocks = vi.hoisted(() => ({
  runAStockDataFn: vi.fn(),
  stockSdkBatchByCodes: vi.fn(),
  stockSdkBatchCn: vi.fn(),
}));

vi.mock('../../stock/a-stock-data-runner', () => ({
  runAStockDataFn: mocks.runAStockDataFn,
}));

vi.mock('../../stock/shared', () => ({
  sdk: { batch: { byCodes: mocks.stockSdkBatchByCodes, cn: mocks.stockSdkBatchCn } },
}));

import {
  fetchAStockDataMarketSnapshotQuotes,
  fetchStockSdkAllMarketSnapshotQuotes,
  fetchStockSdkMarketSnapshotQuotes,
} from '../market-snapshot-provider.js';

const quote: ITencentQuote = {
  name: '单位校验股',
  price: 10,
  last_close: 9.8,
  open: 9.9,
  change_amt: 0.2,
  change_pct: 2.04,
  high: 10.1,
  low: 9.8,
  amount_wan: 30_000,
  turnover_pct: 12,
  pe_ttm: 20,
  amplitude_pct: 3,
  float_mcap_yi: 45,
  mcap_yi: 50,
  pb: 2,
  limit_up: 10.78,
  limit_down: 8.82,
  vol_ratio: 1.2,
  pe_static: 19,
  is_stale: false,
};

describe('市场快照 Provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('使用 stock-sdk 内置并发批量补齐全市场行情', async () => {
    mocks.stockSdkBatchByCodes.mockResolvedValue([
      {
        code: 'sh600001',
        name: '批量行情股',
        price: 10,
        change: 0.2,
        changePercent: 2,
        open: 9.9,
        high: 10.1,
        low: 9.8,
        prevClose: 9.8,
        volume: 1_000,
        amount: 30_000,
        turnoverRate: 12,
        pe: 20,
        pb: 2,
        totalMarketCap: 50,
        circulatingMarketCap: 45,
        amplitude: 3,
      },
    ]);

    const result = await fetchStockSdkMarketSnapshotQuotes(['600001', '000001']);

    expect(mocks.stockSdkBatchByCodes).toHaveBeenCalledTimes(1);
    expect(mocks.stockSdkBatchByCodes).toHaveBeenCalledWith(['600001', '000001'], {
      batchSize: 500,
      concurrency: 6,
    });
    expect(result).toEqual(
      expect.objectContaining({
        warnings: [],
        quotes: [expect.objectContaining({ code: '600001', totalMarketCap: 50, amount: 30_000 })],
      }),
    );
  });

  it('在本地快照为空时拉取真实全市场 stock-sdk 行情', async () => {
    mocks.stockSdkBatchCn.mockResolvedValue([
      {
        code: 'sz000001',
        name: '全市场行情股',
        price: 10,
        change: 0.2,
        changePercent: 2,
        open: 9.9,
        high: 10.1,
        low: 9.8,
        prevClose: 9.8,
        volume: 1_000,
        amount: 30_000,
        turnoverRate: 12,
        pe: 20,
        pb: 2,
        totalMarketCap: 50,
        circulatingMarketCap: 45,
        amplitude: 3,
      },
    ]);

    const result = await fetchStockSdkAllMarketSnapshotQuotes();

    expect(mocks.stockSdkBatchCn).toHaveBeenCalledWith({ batchSize: 500, concurrency: 6 });
    expect(result.quotes).toEqual([expect.objectContaining({ code: '000001', name: '全市场行情股' })]);
  });

  it('将 a-stock-data 行情适配为 DuckDB 快照的万/亿单位', async () => {
    mocks.runAStockDataFn.mockResolvedValue({ sz000001: quote });

    const result = await fetchAStockDataMarketSnapshotQuotes(['000001']);

    expect(mocks.runAStockDataFn).toHaveBeenCalledWith('tencent_quote', { codes: '000001' });
    expect(result.warnings).toEqual([]);
    expect(result.quotes).toEqual([
      expect.objectContaining({
        code: '000001',
        amount: 30_000,
        totalMarketCap: 50,
        circulatingMarketCap: 45,
      }),
    ]);
  });

  it('a-stock-data 执行失败时保留完整 warning 且不伪造行情', async () => {
    mocks.runAStockDataFn.mockRejectedValue(
      new Error('a-stock-data 脚本不存在: /Applications/StockBuddy.app/Contents/Resources/python/a-stock-data.py'),
    );

    const result = await fetchAStockDataMarketSnapshotQuotes(['000004', '002808']);

    expect(result.quotes).toEqual([]);
    expect(result.warnings).toEqual([
      'a-stock-data 批次 000004-002808 行情补齐失败：a-stock-data 脚本不存在: /Applications/StockBuddy.app/Contents/Resources/python/a-stock-data.py',
    ]);
  });
});
