import os from 'node:os';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.STOCKSENSE_MARKET_DB_PATH = `${process.env.TMPDIR ?? '/tmp'}/stocksense-market-cap-screener-${process.pid}.duckdb`;
});

vi.mock('electron', () => {
  const electron = {
    app: {
      getPath: () => os.tmpdir(),
      isPackaged: false,
    },
  };
  return { ...electron, default: electron };
});

vi.mock('../../../electron-runtime.js', () => ({
  app: {
    getPath: () => os.tmpdir(),
    isPackaged: false,
  },
}));

import {
  resetMarketCapScreenerDependenciesForTest,
  screenASharesByMarketCap,
  setMarketCapScreenerDependenciesForTest,
} from '../market-cap-screener.js';
import type { IAShareMarketCapSnapshotRow } from '../market-data-store.js';
import type { SecurityRecord } from '../types.js';

const emptyRemoteSecurities: SecurityRecord[] = [];

function row(partial: Partial<IAShareMarketCapSnapshotRow> & Pick<IAShareMarketCapSnapshotRow, 'symbol' | 'name'>): IAShareMarketCapSnapshotRow {
  return {
    exchange: partial.symbol.startsWith('6') ? 'SH' : 'SZ',
    isSt: false,
    ...partial,
  };
}

afterEach(() => {
  resetMarketCapScreenerDependenciesForTest();
  vi.restoreAllMocks();
});

afterAll(() => {
  delete process.env.STOCKSENSE_MARKET_DB_PATH;
});

describe('A股市值筛选服务', () => {
  it('优先返回 DuckDB 命中的市值区间结果', async () => {
    setMarketCapScreenerDependenciesForTest({
      listLocalRows: vi.fn().mockResolvedValue([
        row({ symbol: '600001', name: '区间内股', totalMarketCap: 5_000_000_000 }),
        row({ symbol: '600002', name: '区间外股', totalMarketCap: 15_000_000_000 }),
      ]),
      listRemoteSecurities: vi.fn().mockResolvedValue(emptyRemoteSecurities),
      upsertSnapshots: vi.fn(),
    });

    const result = await screenASharesByMarketCap({ minMarketCap: 30, maxMarketCap: 100, unit: 'yi' });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual(expect.objectContaining({ code: '600001', dataSource: 'duckdb', marketCapYi: 50 }));
    expect(result.sourceStats.duckdbMatched).toBe(1);
  });

  it('DuckDB 缺失市值时使用 stock-sdk 批量补齐并回写快照', async () => {
    const upsertSnapshots = vi.fn().mockResolvedValue(undefined);
    setMarketCapScreenerDependenciesForTest({
      listLocalRows: vi.fn().mockResolvedValue([
        row({ symbol: '600010', name: '缺失市值股' }),
      ]),
      listRemoteSecurities: vi.fn().mockResolvedValue(emptyRemoteSecurities),
      upsertSnapshots,
      fetchStockSdkQuotes: vi.fn().mockResolvedValue({
        quotes: [{ code: '600010', name: '缺失市值股', totalMarketCap: 8_000_000_000, price: 10.5 }],
        warnings: [],
      }),
    });

    const result = await screenASharesByMarketCap({ minMarketCap: 30, maxMarketCap: 100, unit: 'yi' });

    expect(result.rows[0]).toEqual(expect.objectContaining({ code: '600010', dataSource: 'stock-sdk', marketCapYi: 80 }));
    expect(upsertSnapshots).toHaveBeenCalledWith([expect.objectContaining({ code: '600010', totalMarketCap: 8_000_000_000 })]);
    expect(result.sourceStats.stockSdkMatched).toBe(1);
  });

  it('stock-sdk 缺失后使用 a-stock-data 腾讯市值字段兜底', async () => {
    setMarketCapScreenerDependenciesForTest({
      listLocalRows: vi.fn().mockResolvedValue([
        row({ symbol: '000001', name: '兜底股' }),
      ]),
      listRemoteSecurities: vi.fn().mockResolvedValue(emptyRemoteSecurities),
      upsertSnapshots: vi.fn().mockResolvedValue(undefined),
      fetchStockSdkQuotes: vi.fn().mockResolvedValue({ quotes: [], warnings: [] }),
      fetchAStockDataQuotes: vi.fn().mockResolvedValue({
        quotes: [{ code: '000001', name: '兜底股', totalMarketCap: 9_000_000_000 }],
        warnings: [],
      }),
    });

    const result = await screenASharesByMarketCap({ minMarketCap: 30, maxMarketCap: 100, unit: 'yi' });

    expect(result.rows[0]).toEqual(expect.objectContaining({ code: '000001', dataSource: 'a-stock-data', marketCapYi: 90 }));
    expect(result.sourceStats.aStockDataMatched).toBe(1);
  });

  it('支持 30 亿到 100 亿单位转换', async () => {
    setMarketCapScreenerDependenciesForTest({
      listLocalRows: vi.fn().mockResolvedValue([
        row({ symbol: '600030', name: '下界股', totalMarketCap: 3_000_000_000 }),
        row({ symbol: '600100', name: '上界股', totalMarketCap: 10_000_000_000 }),
        row({ symbol: '600200', name: '过大股', totalMarketCap: 10_100_000_000 }),
      ]),
      listRemoteSecurities: vi.fn().mockResolvedValue(emptyRemoteSecurities),
      upsertSnapshots: vi.fn(),
    });

    const result = await screenASharesByMarketCap({ minMarketCap: 30, maxMarketCap: 100, unit: 'yi' });

    expect(result.rows.map((item) => item.code)).toEqual(['600030', '600100']);
    expect(result.minMarketCap).toBe(3_000_000_000);
    expect(result.maxMarketCap).toBe(10_000_000_000);
  });

  it('总市值与流通市值使用不同字段筛选', async () => {
    setMarketCapScreenerDependenciesForTest({
      listLocalRows: vi.fn().mockResolvedValue([
        row({ symbol: '000002', name: '流通命中股', totalMarketCap: 200_000_000_000, circulatingMarketCap: 6_000_000_000 }),
      ]),
      listRemoteSecurities: vi.fn().mockResolvedValue(emptyRemoteSecurities),
      upsertSnapshots: vi.fn(),
    });

    const totalResult = await screenASharesByMarketCap({ minMarketCap: 30, maxMarketCap: 100, unit: 'yi' });
    const circulatingResult = await screenASharesByMarketCap({ minMarketCap: 30, maxMarketCap: 100, unit: 'yi', marketCapField: 'circulating' });

    expect(totalResult.rows).toHaveLength(0);
    expect(circulatingResult.rows[0]?.code).toBe('000002');
    expect(circulatingResult.rows[0]?.marketCapYi).toBe(60);
  });

  it('缺失真实市值时返回 warning 而不是伪造数据', async () => {
    setMarketCapScreenerDependenciesForTest({
      listLocalRows: vi.fn().mockResolvedValue([
        row({ symbol: '300001', name: '无市值股' }),
      ]),
      listRemoteSecurities: vi.fn().mockResolvedValue(emptyRemoteSecurities),
      upsertSnapshots: vi.fn(),
      fetchStockSdkQuotes: vi.fn().mockResolvedValue({ quotes: [], warnings: ['stock-sdk 未返回市值'] }),
      fetchAStockDataQuotes: vi.fn().mockResolvedValue({ quotes: [], warnings: ['a-stock-data 未返回市值'] }),
    });

    const result = await screenASharesByMarketCap({ minMarketCap: 30, maxMarketCap: 100, unit: 'yi' });

    expect(result.rows).toEqual([]);
    expect(result.isEmpty).toBe(true);
    expect(result.sourceStats.missingMarketCap).toBe(1);
    expect(result.warnings.join('；')).toContain('缺少可用总市值');
    expect(result.warnings.join('；')).toContain('stock-sdk 未返回市值');
    expect(result.warnings.join('；')).toContain('a-stock-data 未返回市值');
  });
});
