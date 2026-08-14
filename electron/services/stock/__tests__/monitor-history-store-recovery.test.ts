import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const duckDbMock = vi.hoisted(() => {
  const state = {
    createCalls: 0,
    fromCacheCalls: 0,
    instanceCloseCalls: 0,
    connectionCloseCalls: 0,
    failNextRead: false,
    failNextRunError: undefined as string | undefined,
  };

  class MockConnection {
    async run(_sql: string) {
      if (state.failNextRunError) {
        const error = state.failNextRunError;
        state.failNextRunError = undefined;
        throw new Error(error);
      }
    }

    async runAndReadAll() {
      if (state.failNextRead) {
        state.failNextRead = false;
        throw new Error('FATAL Error: database has been invalidated because of a previous fatal error. The database must be restarted prior to being used again.');
      }
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
    state.failNextRead = false;
    state.failNextRunError = undefined;
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

vi.mock('@duckdb/node-api', () => ({ DuckDBInstance: duckDbMock.DuckDBInstance }));
vi.mock('../../../electron-runtime.js', () => ({
  app: {
    getPath: () => os.tmpdir(),
    isPackaged: false,
  },
}));

type TMonitorHistoryStore = typeof import('../monitor-history-store.js');

async function loadStore(): Promise<TMonitorHistoryStore> {
  vi.resetModules();
  return import('../monitor-history-store.js');
}

beforeEach(() => {
  duckDbMock.reset();
});

afterEach(() => {
  vi.resetModules();
});

describe('AI 监控历史 DuckDB fatal 恢复', () => {
  it('fatal invalidation 后重建实例并重试当前读取', async () => {
    const store = await loadStore();
    duckDbMock.state.failNextRead = true;

    await expect(store.listMonitorDates()).resolves.toEqual([]);

    expect(duckDbMock.state.fromCacheCalls).toBe(1);
    expect(duckDbMock.state.createCalls).toBe(1);
    expect(duckDbMock.state.instanceCloseCalls).toBe(1);
  });

  it('删除索引 fatal 错误后重建实例并重试当前写入', async () => {
    const store = await loadStore();
    duckDbMock.state.failNextRunError = 'Invalid Input Error: Failed to delete all rows from index. Only deleted 5 out of 8 rows.';

    await expect(store.cleanupMonitorHistoryNoise('2026-08-12')).resolves.toBeUndefined();

    expect(duckDbMock.state.createCalls).toBe(1);
    expect(duckDbMock.state.instanceCloseCalls).toBe(1);
  });

  it('非 fatal 错误继续暴露给调用方', async () => {
    const store = await loadStore();
    duckDbMock.state.failNextRunError = 'regular database error';

    await expect(store.cleanupMonitorHistoryNoise('2026-08-12')).rejects.toThrow('regular database error');
    expect(duckDbMock.state.createCalls).toBe(0);
    expect(duckDbMock.state.instanceCloseCalls).toBe(0);
  });
});
