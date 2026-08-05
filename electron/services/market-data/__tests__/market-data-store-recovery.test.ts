import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyBarRecord } from '../types.js';

type TBoundValue = string | number | boolean | null;
type TBoundValues = Record<string, TBoundValue>;

interface IMockDuckDbState {
  createCalls: number;
  fromCacheCalls: number;
  instanceCloseCalls: number;
  connectionCloseCalls: number;
  statementRunCalls: number;
  failNextStatementRun: boolean;
  activeReaders: number;
  maxActiveReaders: number;
  blockReads: boolean;
  readResolvers: Array<() => void>;
  runSql: string[];
  preparedSql: string[];
  boundRows: TBoundValues[];
}

const duckDbMock = vi.hoisted(() => {
  type THoistedBoundValue = string | number | boolean | null;
  type THoistedBoundValues = Record<string, THoistedBoundValue>;

  interface IHoistedMockDuckDbState {
    createCalls: number;
    fromCacheCalls: number;
    instanceCloseCalls: number;
    connectionCloseCalls: number;
    statementRunCalls: number;
    failNextStatementRun: boolean;
    activeReaders: number;
    maxActiveReaders: number;
    blockReads: boolean;
    readResolvers: Array<() => void>;
    runSql: string[];
    preparedSql: string[];
    boundRows: THoistedBoundValues[];
  }

  const state: IHoistedMockDuckDbState = {
    createCalls: 0,
    fromCacheCalls: 0,
    instanceCloseCalls: 0,
    connectionCloseCalls: 0,
    statementRunCalls: 0,
    failNextStatementRun: false,
    activeReaders: 0,
    maxActiveReaders: 0,
    blockReads: false,
    readResolvers: [],
    runSql: [],
    preparedSql: [],
    boundRows: [],
  };

  class MockStatement {
    private values: THoistedBoundValues = {};

    bind(values: THoistedBoundValues) {
      this.values = values;
    }

    async run() {
      if (state.failNextStatementRun) {
        state.failNextStatementRun = false;
        throw new Error('FATAL Error: Failed: database has been invalidated because of a previous fatal error. The database must be restarted prior to being used again. Original error: "Invalid bitpacking mode"');
      }
      state.statementRunCalls += 1;
      state.boundRows.push(this.values);
    }
  }

  class MockConnection {
    async run(sql: string) {
      state.runSql.push(sql);
    }

    async prepare(sql: string) {
      state.preparedSql.push(sql);
      return new MockStatement();
    }

    async runAndReadAll() {
      state.activeReaders += 1;
      state.maxActiveReaders = Math.max(state.maxActiveReaders, state.activeReaders);
      if (state.blockReads) await new Promise<void>((resolve) => state.readResolvers.push(resolve));
      state.activeReaders -= 1;
      return { getRowObjectsJS: () => [] };
    }

    closeSync() {
      state.connectionCloseCalls += 1;
    }
  }

  class MockInstance {
    async connect() {
      return new MockConnection();
    }

    closeSync() {
      state.instanceCloseCalls += 1;
    }
  }

  function reset() {
    state.createCalls = 0;
    state.fromCacheCalls = 0;
    state.instanceCloseCalls = 0;
    state.connectionCloseCalls = 0;
    state.statementRunCalls = 0;
    state.failNextStatementRun = false;
    state.activeReaders = 0;
    state.maxActiveReaders = 0;
    state.blockReads = false;
    state.readResolvers = [];
    state.runSql = [];
    state.preparedSql = [];
    state.boundRows = [];
  }

  return {
    state,
    reset,
    DuckDBInstance: {
      fromCache: () => {
        state.fromCacheCalls += 1;
        return Promise.resolve(new MockInstance());
      },
      create: () => {
        state.createCalls += 1;
        return Promise.resolve(new MockInstance());
      },
    },
  };
});

vi.mock('@duckdb/node-api', () => ({
  DuckDBInstance: duckDbMock.DuckDBInstance,
}));

vi.mock('electron', () => {
  const electron = {
    app: {
      getPath: () => os.tmpdir(),
      isPackaged: false,
    },
  };
  return { ...electron, default: electron };
});

function createBar(overrides: Partial<DailyBarRecord> = {}): DailyBarRecord {
  return {
    symbol: '600519',
    tradeDate: '2026-07-09',
    open: 1500,
    high: 1520,
    low: 1490,
    close: 1510,
    volume: 1000,
    amount: 10_000_000,
    change: 12,
    changePercent: 0.8,
    turnoverRate: 1.2,
    adjustType: 'qfq',
    source: 'vitest',
    fetchedAt: '2026-07-09T10:00:00.000Z',
    ...overrides,
  };
}

describe('市场数据 DuckDB fatal invalidation recovery', () => {
  beforeEach(() => {
    duckDbMock.reset();
    process.env.STOCKSENSE_MARKET_DB_PATH = path.join(os.tmpdir(), `stocksense-market-recovery-vitest-${process.pid}.duckdb`);
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.STOCKSENSE_MARKET_DB_PATH;
    vi.resetModules();
  });

  it('reopens the DuckDB instance and retries daily bar persistence once after fatal invalidation', async () => {
    duckDbMock.state.failNextStatementRun = true;
    const store = await import('../market-data-store.js');

    await store.upsertDailyBars([createBar()]);

    expect(duckDbMock.state.fromCacheCalls).toBe(1);
    expect(duckDbMock.state.createCalls).toBe(1);
    // ponytail: recovery now closes the old corrupted instance before recreating
    expect(duckDbMock.state.instanceCloseCalls).toBe(1);
    expect(duckDbMock.state.statementRunCalls).toBe(1);
    expect(duckDbMock.state.runSql.filter((sql: string) => sql === 'BEGIN TRANSACTION')).toHaveLength(2);
    expect(duckDbMock.state.runSql).toContain('ROLLBACK');
    expect(duckDbMock.state.runSql).toContain('COMMIT');
    expect(duckDbMock.state.preparedSql[0]).toContain('INSERT OR REPLACE INTO daily_bars');
    expect(duckDbMock.state.boundRows[0]).toMatchObject<TBoundValues>({
      symbol: '600519',
      tradeDate: '2026-07-09',
      adjustType: 'qfq',
      source: 'vitest',
    });
  });

  it('serializes concurrent reads so DuckDB never scans from parallel connections', async () => {
    duckDbMock.state.blockReads = true;
    const store = await import('../market-data-store.js');

    const first = store.listSecurities();
    const second = store.listSecurities();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(duckDbMock.state.readResolvers).toHaveLength(1);
    duckDbMock.state.readResolvers.splice(0).forEach((resolve) => resolve());
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(duckDbMock.state.readResolvers).toHaveLength(1);
    duckDbMock.state.readResolvers.splice(0).forEach((resolve) => resolve());
    await second;

    expect(duckDbMock.state.maxActiveReaders).toBe(1);
  });
});
