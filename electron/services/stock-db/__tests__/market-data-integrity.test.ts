import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());
const existsSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({ spawn: spawnMock }));
vi.mock('node:fs', () => ({ existsSync: existsSyncMock }));

import { extractCorruptTables, probeMarketDatabaseCorruption } from '../market-data-integrity.js';

interface IFakeChildProcess {
  stdout: EventEmitter;
  exitHandler?: (code: number | null, signal: NodeJS.Signals | null) => void;
  errorHandler?: (error: Error) => void;
  killed?: string;
}

function createFakeChild(): IFakeChildProcess {
  const fake: IFakeChildProcess = { stdout: new EventEmitter() };
  spawnMock.mockImplementation(
    () =>
      ({
        stdout: fake.stdout,
        on: (event: string, handler: (...args: never[]) => void) => {
          if (event === 'exit') fake.exitHandler = handler as IFakeChildProcess['exitHandler'];
          if (event === 'error') fake.errorHandler = handler as IFakeChildProcess['errorHandler'];
          return fake;
        },
        kill: (signal: string) => {
          fake.killed = signal;
        },
      }) as never,
  );
  return fake;
}

describe('extractCorruptTables', () => {
  it('returns the last SCAN line the probe printed before dying', () => {
    expect(extractCorruptTables('SCAN securities\nSCAN daily_bars\n')).toEqual(['daily_bars']);
  });

  it('returns a single table when the probe died on the first scan', () => {
    expect(extractCorruptTables('SCAN board_constituents\n')).toEqual(['board_constituents']);
  });

  it('returns an empty array when there is no SCAN progress', () => {
    expect(extractCorruptTables('some random output\n')).toEqual([]);
    expect(extractCorruptTables('')).toEqual([]);
  });
});

describe('probeMarketDatabaseCorruption', () => {
  beforeEach(() => {
    spawnMock.mockClear();
    existsSyncMock.mockReset();
    existsSyncMock.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves to an empty array when the probe exits cleanly (healthy database)', async () => {
    const fake = createFakeChild();
    const promise = probeMarketDatabaseCorruption('/tmp/test.duckdb');
    fake.stdout.emit('data', 'SCAN securities\nSCAN daily_bars\n');
    fake.exitHandler?.(0, null);
    await expect(promise).resolves.toEqual([]);
  });

  it('reports the table the probe died on when it segfaults on corrupt data', async () => {
    const fake = createFakeChild();
    const promise = probeMarketDatabaseCorruption('/tmp/test.duckdb');
    fake.stdout.emit('data', 'SCAN securities\nSCAN daily_bars\n');
    fake.exitHandler?.(null, 'SIGSEGV');
    await expect(promise).resolves.toEqual(['daily_bars']);
  });

  it('does not treat a probe script error (non-SIGSEGV exit) as corruption', async () => {
    const fake = createFakeChild();
    const promise = probeMarketDatabaseCorruption('/tmp/test.duckdb');
    fake.stdout.emit('data', 'SCAN daily_bars\n');
    fake.exitHandler?.(3, null);
    await expect(promise).resolves.toEqual([]);
  });

  it('skips the probe when the database file does not exist', async () => {
    existsSyncMock.mockReturnValue(false);
    await expect(probeMarketDatabaseCorruption('/tmp/missing.duckdb')).resolves.toEqual([]);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('resolves to the last scanned table when the probe times out', async () => {
    vi.useFakeTimers();
    const fake = createFakeChild();
    const promise = probeMarketDatabaseCorruption('/tmp/test.duckdb');
    fake.stdout.emit('data', 'SCAN daily_bars\n');
    await vi.advanceTimersByTimeAsync(60_001);
    expect(fake.killed).toBe('SIGKILL');
    await expect(promise).resolves.toEqual(['daily_bars']);
  });
});
