import { app } from 'electron';
import { DuckDBInstance, type DuckDBConnection, type DuckDBValue } from '@duckdb/node-api';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type {
  AdjustType,
  BoardConstituentRecord,
  BoardDetailCacheRecord,
  BoardSnapshotRecord,
  DailyBarRecord,
  DiscoverySnapshotCacheRecord,
  MarketBoardRecord,
  MarketDataStats,
  SecurityRecord,
  SyncJobRecord,
  SyncJobStatus,
  SyncJobType,
  TradeCalendarRecord,
} from './types.js';

const defaultPath = path.join(
  app.getPath('userData'),
  app.isPackaged ? 'stocksense-market.duckdb' : 'stocksense-market-dev.duckdb',
);
const dbPath = process.env.STOCKSENSE_MARKET_DB_PATH || defaultPath;
// ponytail: dbReady must be reassignable so we can close the old DuckDB
// instance and create a fresh one after the database file is deleted by
// the storage manager. A const here would leave the app permanently
// pointing at a closed instance after "清空本地行情数据库".
let dbReady = DuckDBInstance.fromCache(dbPath);
let ready: Promise<void> | undefined;
let writeQueue = Promise.resolve();
let isClosing = false;
let activeConnections = 0;
let closeResolve: (() => void) | undefined;

const schemaSql = `
  CREATE TABLE IF NOT EXISTS securities (
    symbol TEXT PRIMARY KEY, name TEXT NOT NULL, exchange TEXT NOT NULL,
    security_type TEXT NOT NULL DEFAULT 'stock', status TEXT NOT NULL DEFAULT 'listed',
    list_date DATE, delist_date DATE, industry TEXT, is_st BOOLEAN NOT NULL DEFAULT FALSE,
    source TEXT NOT NULL, updated_at TIMESTAMP NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_securities_name ON securities(name);
  CREATE INDEX IF NOT EXISTS idx_securities_status ON securities(status);

  CREATE TABLE IF NOT EXISTS trade_calendar (
    market TEXT NOT NULL, trade_date DATE NOT NULL, is_open BOOLEAN NOT NULL,
    previous_trade_date DATE, next_trade_date DATE, source TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL, PRIMARY KEY (market, trade_date)
  );

  CREATE TABLE IF NOT EXISTS daily_bars (
    symbol TEXT NOT NULL, trade_date DATE NOT NULL, open DOUBLE NOT NULL,
    high DOUBLE NOT NULL, low DOUBLE NOT NULL, close DOUBLE NOT NULL,
    volume DOUBLE NOT NULL, amount DOUBLE, change DOUBLE, change_percent DOUBLE,
    turnover_rate DOUBLE, adjust_type TEXT NOT NULL DEFAULT 'qfq', source TEXT NOT NULL,
    fetched_at TIMESTAMP NOT NULL, PRIMARY KEY (symbol, trade_date, adjust_type)
  );
  CREATE INDEX IF NOT EXISTS idx_daily_bars_symbol_date ON daily_bars(symbol, trade_date);
  CREATE INDEX IF NOT EXISTS idx_daily_bars_date ON daily_bars(trade_date);

  CREATE TABLE IF NOT EXISTS sync_jobs (
    id TEXT PRIMARY KEY, job_type TEXT NOT NULL, status TEXT NOT NULL,
    target_trade_date DATE, started_at TIMESTAMP NOT NULL, finished_at TIMESTAMP,
    total_symbols INTEGER NOT NULL DEFAULT 0, processed_symbols INTEGER NOT NULL DEFAULT 0,
    succeeded_symbols INTEGER NOT NULL DEFAULT 0, failed_symbols INTEGER NOT NULL DEFAULT 0,
    checkpoint_symbol TEXT, error_message TEXT, metadata_json TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sync_jobs_type_started ON sync_jobs(job_type, started_at);

  CREATE TABLE IF NOT EXISTS sync_failures (
    job_id TEXT NOT NULL, symbol TEXT NOT NULL, stage TEXT NOT NULL,
    error_message TEXT NOT NULL, retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL, updated_at TIMESTAMP NOT NULL,
    PRIMARY KEY (job_id, symbol, stage)
  );

  CREATE TABLE IF NOT EXISTS market_board_snapshots (
    snapshot_key TEXT PRIMARY KEY, rows_json TEXT NOT NULL, updated_at TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS discovery_snapshots (
    snapshot_key TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL, updated_at TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stock_chips (
    symbol TEXT PRIMARY KEY, data_json TEXT NOT NULL, fetched_at TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stock_snapshots (
    symbol TEXT PRIMARY KEY, name TEXT NOT NULL, price DOUBLE, change DOUBLE,
    change_percent DOUBLE, open DOUBLE, high DOUBLE, low DOUBLE, prev_close DOUBLE,
    volume DOUBLE, amount DOUBLE, turnover_rate DOUBLE, pe DOUBLE, pb DOUBLE,
    total_market_cap DOUBLE, circulating_market_cap DOUBLE, amplitude DOUBLE,
    fetched_at TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS market_board_details (
    board_code TEXT PRIMARY KEY, detail_json TEXT NOT NULL, updated_at TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS market_boards (
    board_code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT,
    change_percent DOUBLE,
    source TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_market_boards_name ON market_boards(name);

  CREATE TABLE IF NOT EXISTS board_constituents (
    board_code TEXT NOT NULL,
    stock_code TEXT NOT NULL,
    stock_name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL,
    PRIMARY KEY (board_code, stock_code)
  );
  CREATE INDEX IF NOT EXISTS idx_board_constituents_stock ON board_constituents(stock_code);
`;

export function initializeMarketDataStore() {
  return ensureReady();
}

export function getMarketDataDatabasePath() {
  return dbPath;
}

export function upsertSecurities(items: SecurityRecord[]) {
  if (!items.length) return Promise.resolve();
  return write(async (connection) => {
    await connection.run('BEGIN TRANSACTION');
    try {
      const statement = await connection.prepare(`
        INSERT OR REPLACE INTO securities
        (symbol, name, exchange, security_type, status, list_date, delist_date, industry, is_st, source, updated_at)
        VALUES ($symbol, $name, $exchange, $securityType, $status, CASE WHEN $listDate IS NULL THEN NULL ELSE CAST($listDate AS DATE) END, CASE WHEN $delistDate IS NULL THEN NULL ELSE CAST($delistDate AS DATE) END, $industry, $isSt, $source, $updatedAt)
      `);
      for (const item of items) {
        statement.bind({
          symbol: item.symbol,
          name: item.name,
          exchange: item.exchange,
          securityType: item.securityType,
          status: item.status,
          listDate: item.listDate ?? null,
          delistDate: item.delistDate ?? null,
          industry: item.industry ?? null,
          isSt: item.isSt,
          source: item.source,
          updatedAt: item.updatedAt,
        });
        await statement.run();
      }
      await connection.run('COMMIT');
    } catch (error) {
      await connection.run('ROLLBACK');
      throw error;
    }
  });
}

export function upsertStockSnapshots(items: Array<{
  symbol: string; name: string; price?: number; change?: number;
  changePercent?: number; open?: number; high?: number; low?: number;
  prevClose?: number; volume?: number; amount?: number; turnoverRate?: number;
  pe?: number; pb?: number; totalMarketCap?: number; circulatingMarketCap?: number;
  amplitude?: number;
}>) {
  if (!items.length) return Promise.resolve();
  const now = new Date().toISOString();
  return write(async (connection) => {
    await connection.run('BEGIN TRANSACTION');
    try {
      const statement = await connection.prepare(`
        INSERT OR REPLACE INTO stock_snapshots
        (symbol, name, price, change, change_percent, open, high, low, prev_close,
         volume, amount, turnover_rate, pe, pb, total_market_cap, circulating_market_cap,
         amplitude, fetched_at)
        VALUES ($symbol, $name, $price, $change, $changePercent, $open, $high, $low,
                $prevClose, $volume, $amount, $turnoverRate, $pe, $pb, $totalMarketCap,
                $circulatingMarketCap, $amplitude, $fetchedAt)
      `);
      for (const item of items) {
        statement.bind({
          symbol: item.symbol,
          name: item.name,
          price: item.price ?? null,
          change: item.change ?? null,
          changePercent: item.changePercent ?? null,
          open: item.open ?? null,
          high: item.high ?? null,
          low: item.low ?? null,
          prevClose: item.prevClose ?? null,
          volume: item.volume ?? null,
          amount: item.amount ?? null,
          turnoverRate: item.turnoverRate ?? null,
          pe: item.pe ?? null,
          pb: item.pb ?? null,
          totalMarketCap: item.totalMarketCap ?? null,
          circulatingMarketCap: item.circulatingMarketCap ?? null,
          amplitude: item.amplitude ?? null,
          fetchedAt: now,
        });
        await statement.run();
      }
      await connection.run('COMMIT');
    } catch (error) {
      await connection.run('ROLLBACK');
      throw error;
    }
  });
}

export function upsertStockChip(symbol: string, data: unknown) {
  const now = new Date().toISOString();
  return write(async (connection) => {
    await connection.run(
      `INSERT OR REPLACE INTO stock_chips (symbol, data_json, fetched_at) VALUES ($symbol, $data, $now)`,
      { symbol, data: JSON.stringify(data), now },
    );
  });
}

export async function getStockChip(symbol: string): Promise<unknown | undefined> {
  try {
    await ensureReady();
    return read(async (connection) => {
      const reader = await connection.runAndReadAll(
        `SELECT data_json FROM stock_chips WHERE symbol = $symbol`,
        { symbol },
      );
      const rows = reader.getRowObjectsJS() as Array<{ data_json: string }>;
      return rows.length ? JSON.parse(rows[0].data_json) : undefined;
    });
  } catch {
    return undefined;
  }
}

export function updateSecurityIndustries(items: Array<{ symbol: string; industry: string }>) {
  if (!items.length) return Promise.resolve();
  return write(async (connection) => {
    await connection.run('BEGIN TRANSACTION');
    try {
      const statement = await connection.prepare(
        'UPDATE securities SET industry = $industry, updated_at = $updatedAt WHERE symbol = $symbol',
      );
      const now = new Date().toISOString();
      for (const item of items) {
        statement.bind({ symbol: item.symbol, industry: item.industry, updatedAt: now });
        await statement.run();
      }
      await connection.run('COMMIT');
    } catch (error) {
      await connection.run('ROLLBACK');
      throw error;
    }
  });
}

export function upsertTradingCalendar(items: TradeCalendarRecord[]) {
  if (!items.length) return Promise.resolve();
  return write(async (connection) => {
    await connection.run('BEGIN TRANSACTION');
    try {
      const statement = await connection.prepare(`
        INSERT OR REPLACE INTO trade_calendar
        (market, trade_date, is_open, previous_trade_date, next_trade_date, source, updated_at)
        VALUES ($market, CASE WHEN $tradeDate IS NULL THEN NULL ELSE CAST($tradeDate AS DATE) END, $isOpen, CASE WHEN $previousTradeDate IS NULL THEN NULL ELSE CAST($previousTradeDate AS DATE) END, CASE WHEN $nextTradeDate IS NULL THEN NULL ELSE CAST($nextTradeDate AS DATE) END, $source, $updatedAt)
      `);
      for (const item of items) {
        statement.bind({
          market: item.market,
          tradeDate: item.tradeDate,
          isOpen: item.isOpen,
          previousTradeDate: item.previousTradeDate ?? null,
          nextTradeDate: item.nextTradeDate ?? null,
          source: item.source,
          updatedAt: item.updatedAt,
        });
        await statement.run();
      }
      await connection.run('COMMIT');
    } catch (error) {
      await connection.run('ROLLBACK');
      throw error;
    }
  });
}

export function upsertDailyBars(items: DailyBarRecord[]) {
  if (!items.length) return Promise.resolve();
  return write(async (connection) => {
    await connection.run('BEGIN TRANSACTION');
    try {
      const statement = await connection.prepare(`
        INSERT OR REPLACE INTO daily_bars
        (symbol, trade_date, open, high, low, close, volume, amount, change, change_percent, turnover_rate, adjust_type, source, fetched_at)
        VALUES ($symbol, CAST($tradeDate AS DATE), $open, $high, $low, $close, $volume, $amount, $change, $changePercent, $turnoverRate, $adjustType, $source, $fetchedAt)
      `);
      for (const item of items) {
        statement.bind(toDbValues(item));
        await statement.run();
      }
      await connection.run('COMMIT');
    } catch (error) {
      await connection.run('ROLLBACK');
      throw error;
    }
  });
}

export async function listSecurities() {
  return read(async (connection) => {
    const rows = await all<Record<string, unknown>>(
      connection,
      `SELECT * FROM securities WHERE status = 'listed' ORDER BY symbol`,
    );
    return rows.map(toSecurityRecord);
  });
}

export async function listLatestMarketRows() {
  return read(async (connection) => {
    const rows = await all<Record<string, unknown>>(
      connection,
      `
      WITH latest AS (
        SELECT symbol, max(trade_date) AS trade_date FROM daily_bars WHERE adjust_type = 'qfq' GROUP BY symbol
      )
      SELECT s.symbol, s.name, s.exchange, s.industry, b.open, b.high, b.low, b.close, b.volume, b.amount, b.change, b.change_percent, b.turnover_rate
      FROM securities s
      LEFT JOIN latest l ON l.symbol = s.symbol
      LEFT JOIN daily_bars b ON b.symbol = s.symbol AND b.trade_date = l.trade_date AND b.adjust_type = 'qfq'
      WHERE s.status = 'listed'
      ORDER BY s.symbol
    `,
    );
    return rows.map((row) => ({
      code: String(row.symbol),
      name: String(row.name),
      exchange: String(row.exchange),
      open: optionalNumber(row.open),
      high: optionalNumber(row.high),
      low: optionalNumber(row.low),
      price: optionalNumber(row.close),
      volume: optionalNumber(row.volume),
      amount: optionalNumber(row.amount),
      change: optionalNumber(row.change),
      changePercent: optionalNumber(row.change_percent),
      turnoverRate: optionalNumber(row.turnover_rate),
      industry: optionalString(row.industry),
    }));
  });
}

export async function listDailyBars(
  symbol: string,
  options: { startDate?: string; endDate?: string; limit?: number; adjustType: AdjustType },
) {
  return read(async (connection) => {
    const conditions = ['symbol = $symbol', 'adjust_type = $adjustType'];
    const values: Record<string, DuckDBValue> = { symbol, adjustType: options.adjustType };
    if (options.startDate) {
      conditions.push('trade_date >= $startDate');
      values.startDate = options.startDate;
    }
    if (options.endDate) {
      conditions.push('trade_date <= $endDate');
      values.endDate = options.endDate;
    }
    const limit = options.limit ? `LIMIT ${Math.max(1, Math.floor(options.limit))}` : '';
    const rows = await all<Record<string, unknown>>(
      connection,
      `
      SELECT * FROM (
        SELECT * FROM daily_bars WHERE ${conditions.join(' AND ')} ORDER BY trade_date DESC ${limit}
      ) ORDER BY trade_date ASC
    `,
      values,
    );
    return rows.map(toDailyBarRecord);
  });
}

export async function getLatestDailyBar(symbol: string, adjustType: AdjustType = 'qfq') {
  return (await listDailyBars(symbol, { limit: 1, adjustType }))[0];
}

export async function readDiscoverySnapshot(snapshotKey = 'default'): Promise<DiscoverySnapshotCacheRecord | undefined> {
  return read(async (connection) => {
    const row = (
      await all<{ snapshot_json?: string; updated_at?: string }>(
        connection,
        'SELECT snapshot_json, updated_at FROM discovery_snapshots WHERE snapshot_key = $snapshotKey',
        { snapshotKey },
      )
    )[0];
    if (!row?.snapshot_json) return undefined;
    return { snapshot: JSON.parse(row.snapshot_json), updatedAt: String(row.updated_at ?? '') };
  });
}

export function writeDiscoverySnapshot(record: DiscoverySnapshotCacheRecord, snapshotKey = 'default') {
  return write((connection) =>
    connection
      .run(
        `
    INSERT OR REPLACE INTO discovery_snapshots (snapshot_key, snapshot_json, updated_at)
    VALUES ($snapshotKey, $snapshotJson, $updatedAt)
  `,
        { snapshotKey, snapshotJson: JSON.stringify(record.snapshot), updatedAt: record.updatedAt },
      )
      .then(() => undefined),
  );
}

export async function readBoardSnapshot(snapshotKey = 'all'): Promise<BoardSnapshotRecord | undefined> {
  return read(async (connection) => {
    const row = (
      await all<{ rows_json?: string; updated_at?: string }>(
        connection,
        'SELECT rows_json, updated_at FROM market_board_snapshots WHERE snapshot_key = $snapshotKey',
        { snapshotKey },
      )
    )[0];
    if (!row?.rows_json) return undefined;
    return { rows: JSON.parse(row.rows_json), updatedAt: String(row.updated_at ?? '') };
  });
}

export function writeBoardSnapshot(record: BoardSnapshotRecord, snapshotKey = 'all') {
  return write((connection) =>
    connection
      .run(
        `
    INSERT OR REPLACE INTO market_board_snapshots (snapshot_key, rows_json, updated_at)
    VALUES ($snapshotKey, $rowsJson, $updatedAt)
  `,
        { snapshotKey, rowsJson: JSON.stringify(record.rows), updatedAt: record.updatedAt },
      )
      .then(() => undefined),
  );
}

export async function readBoardDetail(boardCode: string): Promise<BoardDetailCacheRecord | undefined> {
  return read(async (connection) => {
    const row = (
      await all<{ detail_json?: string; updated_at?: string }>(
        connection,
        'SELECT detail_json, updated_at FROM market_board_details WHERE board_code = $boardCode',
        { boardCode },
      )
    )[0];
    if (!row?.detail_json) return undefined;
    return { detail: JSON.parse(row.detail_json), updatedAt: String(row.updated_at ?? '') };
  });
}

export function writeBoardDetail(record: BoardDetailCacheRecord) {
  return write((connection) =>
    connection
      .run(
        `
    INSERT OR REPLACE INTO market_board_details (board_code, detail_json, updated_at)
    VALUES ($boardCode, $detailJson, $updatedAt)
  `,
        { boardCode: record.detail.code, detailJson: JSON.stringify(record.detail), updatedAt: record.updatedAt },
      )
      .then(() => undefined),
  );
}

export function upsertMarketBoards(items: MarketBoardRecord[]) {
  if (!items.length) return Promise.resolve();
  return write(async (connection) => {
    await connection.run('BEGIN TRANSACTION');
    try {
      const statement = await connection.prepare(`
        INSERT INTO market_boards
        (board_code, name, kind, change_percent, source, updated_at)
        VALUES ($code, $name, $kind, $changePercent, $source, $updatedAt)
        ON CONFLICT(board_code) DO UPDATE SET
          name = excluded.name,
          kind = excluded.kind,
          change_percent = excluded.change_percent,
          source = excluded.source,
          updated_at = excluded.updated_at
      `);
      for (const item of items) {
        statement.bind({
          code: item.code,
          name: item.name,
          kind: item.kind ?? null,
          changePercent: item.changePercent ?? null,
          source: item.source,
          updatedAt: item.updatedAt,
        });
        await statement.run();
      }
      await connection.run('COMMIT');
    } catch (error) {
      await connection.run('ROLLBACK');
      throw error;
    }
  });
}

export function replaceBoardConstituents(boardCode: string, items: BoardConstituentRecord[]) {
  if (!boardCode) return Promise.resolve();
  return write(async (connection) => {
    await connection.run('BEGIN TRANSACTION');
    try {
      await connection.run('DELETE FROM board_constituents WHERE board_code = $boardCode', { boardCode });
      if (items.length) {
        const statement = await connection.prepare(`
          INSERT INTO board_constituents
          (board_code, stock_code, stock_name, position, updated_at)
          VALUES ($boardCode, $stockCode, $stockName, $position, $updatedAt)
        `);
        for (const item of items) {
          statement.bind({
            boardCode: item.boardCode,
            stockCode: item.stockCode,
            stockName: item.stockName,
            position: item.position,
            updatedAt: item.updatedAt,
          });
          await statement.run();
        }
      }
      await connection.run('COMMIT');
    } catch (error) {
      await connection.run('ROLLBACK');
      throw error;
    }
  });
}

export async function listMarketBoards(): Promise<MarketBoardRecord[]> {
  return read(async (connection) => {
    const rows = await all<Record<string, unknown>>(
      connection,
      'SELECT board_code, name, kind, change_percent, source, updated_at FROM market_boards ORDER BY name',
    );
    return rows.map((row) => ({
      code: String(row.board_code),
      name: String(row.name),
      kind: optionalString(row.kind),
      changePercent: optionalNumber(row.change_percent),
      source: String(row.source),
      updatedAt: String(row.updated_at),
    }));
  });
}

export async function listBoardConstituents(boardCode: string): Promise<BoardConstituentRecord[]> {
  return read(async (connection) => {
    const rows = await all<Record<string, unknown>>(
      connection,
      'SELECT board_code, stock_code, stock_name, position, updated_at FROM board_constituents WHERE board_code = $boardCode ORDER BY position',
      { boardCode },
    );
    return rows.map((row) => ({
      boardCode: String(row.board_code),
      stockCode: String(row.stock_code),
      stockName: String(row.stock_name),
      position: Number(row.position),
      updatedAt: String(row.updated_at),
    }));
  });
}

export function getLatestTradeDate() {
  return read(async (connection) => {
    const row = (
      await all<{ trade_date?: string }>(connection, 'SELECT max(trade_date)::VARCHAR AS trade_date FROM daily_bars')
    )[0];
    return row?.trade_date || undefined;
  });
}

export function countDailyBarsForDate(tradeDate: string) {
  return read(async (connection) => {
    const row = (
      await all<{ count: bigint | number }>(
        connection,
        'SELECT count(DISTINCT symbol) AS count FROM daily_bars WHERE trade_date = $tradeDate',
        { tradeDate },
      )
    )[0];
    return Number(row?.count ?? 0);
  });
}

export function createSyncJob(job: {
  id: string;
  jobType: SyncJobType;
  targetTradeDate: string;
  totalSymbols: number;
  checkpointSymbol?: string;
}) {
  const values: Record<string, DuckDBValue> = {
    ...job,
    checkpointSymbol: job.checkpointSymbol ?? null,
    startedAt: new Date().toISOString(),
  };
  return write((connection) =>
    connection
      .run(
        `
    INSERT INTO sync_jobs
    (id, job_type, status, target_trade_date, started_at, total_symbols, checkpoint_symbol)
    VALUES ($id, $jobType, 'running', $targetTradeDate, $startedAt, $totalSymbols, $checkpointSymbol)
  `,
        values,
      )
      .then(() => undefined),
  );
}

export function updateSyncJob(
  id: string,
  patch: Partial<{
    status: SyncJobStatus;
    processedSymbols: number;
    succeededSymbols: number;
    failedSymbols: number;
    checkpointSymbol: string;
    errorMessage: string;
    finishedAt: string;
    metadataJson: string;
  }>,
) {
  const columns: string[] = [];
  const values: Record<string, DuckDBValue> = { id };
  const names: Record<string, string> = {
    status: 'status',
    processedSymbols: 'processed_symbols',
    succeededSymbols: 'succeeded_symbols',
    failedSymbols: 'failed_symbols',
    checkpointSymbol: 'checkpoint_symbol',
    errorMessage: 'error_message',
    finishedAt: 'finished_at',
    metadataJson: 'metadata_json',
  };
  for (const [key, column] of Object.entries(names)) {
    const value = patch[key as keyof typeof patch];
    if (value !== undefined) {
      columns.push(`${column} = $${key}`);
      values[key] = value;
    }
  }
  if (!columns.length) return Promise.resolve();
  return write((connection) =>
    connection.run(`UPDATE sync_jobs SET ${columns.join(', ')} WHERE id = $id`, values).then(() => undefined),
  );
}

export function recordSyncFailure(jobId: string, symbol: string, stage: string, errorMessage: string) {
  const now = new Date().toISOString();
  return write((connection) =>
    connection
      .run(
        `
    INSERT OR REPLACE INTO sync_failures
    (job_id, symbol, stage, error_message, retry_count, created_at, updated_at)
    VALUES ($jobId, $symbol, $stage, $errorMessage,
      COALESCE((SELECT retry_count + 1 FROM sync_failures WHERE job_id = $jobId AND symbol = $symbol AND stage = $stage), 0),
      COALESCE((SELECT created_at FROM sync_failures WHERE job_id = $jobId AND symbol = $symbol AND stage = $stage), $now), $now)
  `,
        { jobId, symbol, stage, errorMessage, now },
      )
      .then(() => undefined),
  );
}

export function clearSyncFailure(jobId: string, symbol: string, stage: string) {
  return write((connection) =>
    connection
      .run('DELETE FROM sync_failures WHERE job_id = $jobId AND symbol = $symbol AND stage = $stage', {
        jobId,
        symbol,
        stage,
      })
      .then(() => undefined),
  );
}

export function listLatestSyncFailures() {
  return read(async (connection) => {
    const rows = await all<{ job_id: string; symbol: string; stage: string }>(
      connection,
      `
      SELECT job_id, symbol, stage FROM sync_failures
      WHERE job_id = (SELECT id FROM sync_jobs ORDER BY started_at DESC LIMIT 1)
      ORDER BY symbol
    `,
    );
    return rows.map((row) => ({ jobId: row.job_id, symbol: row.symbol, stage: row.stage }));
  });
}

export function getLatestSyncJob(): Promise<SyncJobRecord | undefined> {
  return read(async (connection) => {
    const row = (
      await all<Record<string, unknown>>(connection, 'SELECT * FROM sync_jobs ORDER BY started_at DESC LIMIT 1')
    )[0];
    return row ? toSyncJob(row) : undefined;
  });
}

export function getMarketDataStats(): Promise<MarketDataStats> {
  return read(async (connection) => {
    const row =
      (
        await all<Record<string, unknown>>(
          connection,
          `
      SELECT
        (SELECT count(*) FROM securities) AS security_count,
        (SELECT count(*) FROM daily_bars) AS daily_bar_count,
        (SELECT max(trade_date)::VARCHAR FROM daily_bars) AS latest_trade_date,
        (SELECT count(*) FROM sync_failures WHERE job_id = (SELECT id FROM sync_jobs ORDER BY started_at DESC LIMIT 1)) AS failed_symbols
    `,
        )
      )[0] ?? {};
    return {
      securityCount: Number(row.security_count ?? 0),
      dailyBarCount: Number(row.daily_bar_count ?? 0),
      latestTradeDate: String(row.latest_trade_date || '') || undefined,
      databaseBytes: existsSync(dbPath) ? statSync(dbPath).size : 0,
      failedSymbols: Number(row.failed_symbols ?? 0),
    };
  });
}

export async function closeMarketDataStore(timeoutMs?: number) {
  isClosing = true;
  await writeQueue.catch((error) => console.warn('[market-data] close wait failed', error));
  if (activeConnections > 0)
    await new Promise<void>((resolve) => {
      closeResolve = resolve;
      // ponytail: bound the wait so a stuck sync worker (mid network call) can't
      // leave the database permanently closing and hang callers like the storage
      // manager's "清空本地行情数据库". After the grace period we resolve anyway
      // and let the caller delete + reset the database.
      if (timeoutMs && timeoutMs > 0) setTimeout(resolve, timeoutMs);
    });
}

/**
 * ponytail: After closeMarketDataStore() + file deletion, the module is in a
 * permanently broken state — isClosing is true, ready/writeQueue reference
 * the old instance, and dbReady points at a closed DuckDB instance. This
 * function resets all module-level state and creates a brand-new DuckDB
 * instance so the store can be used again without an app restart.
 *
 * Must only be called AFTER closeMarketDataStore() has completed and the
 * database file has been deleted.
 */
export async function resetMarketDataStore() {
  // Close the old DuckDB instance to release the file handle — but only if no
  // connections are still active. If closeMarketDataStore() timed out while a
  // sync worker was mid-flight, calling closeSync() on an instance with open
  // connections can itself hang, so we skip it and just create a fresh
  // instance (the database file has already been unlinked, so the new instance
  // opens a brand-new inode).
  if (activeConnections === 0) {
    try {
      const oldInstance = await dbReady;
      oldInstance.closeSync();
    } catch (error) {
      console.warn('[market-data] failed to close old DuckDB instance during reset', error);
    }
  } else {
    console.warn(`[market-data] skipping DuckDB closeSync during reset: ${activeConnections} connection(s) still active`);
  }
  // Create a fresh instance. DuckDBInstance.fromCache may return the closed
  // instance from its singleton cache, so we use DuckDBInstance.create which
  // always opens a new database file.
  dbReady = DuckDBInstance.create(dbPath);
  // Reset all module-level state so read()/write() work again
  ready = undefined;
  writeQueue = Promise.resolve();
  isClosing = false;
  activeConnections = 0;
  closeResolve = undefined;
}

function ensureReady() {
  ready ??= withConnection((connection) => connection.run(schemaSql).then(() => undefined));
  return ready;
}

async function read<T>(work: (connection: DuckDBConnection) => Promise<T>) {
  if (isClosing) throw new Error('market data store is closing');
  await ensureReady();
  return withConnection(work);
}

function write<T>(work: (connection: DuckDBConnection) => Promise<T>) {
  if (isClosing) return Promise.reject(new Error('market data store is closing'));
  const next = writeQueue.then(async () => {
    await ensureReady();
    return withConnection(work);
  });
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function withConnection<T>(work: (connection: DuckDBConnection) => Promise<T>) {
  if (isClosing) throw new Error('market data store is closing');
  const connection = await (await dbReady).connect();
  activeConnections += 1;
  try {
    return await work(connection);
  } finally {
    connection.closeSync();
    activeConnections -= 1;
    if (isClosing && activeConnections === 0) closeResolve?.();
  }
}

async function all<T>(connection: DuckDBConnection, sql: string, values?: Record<string, DuckDBValue>) {
  const reader = await connection.runAndReadAll(sql, values);
  return reader.getRowObjectsJS() as T[];
}

function toDbValues(item: DailyBarRecord): Record<string, DuckDBValue> {
  return {
    symbol: item.symbol,
    tradeDate: item.tradeDate,
    open: item.open,
    high: item.high,
    low: item.low,
    close: item.close,
    volume: item.volume,
    amount: item.amount ?? null,
    change: item.change ?? null,
    changePercent: item.changePercent ?? null,
    turnoverRate: item.turnoverRate ?? null,
    adjustType: item.adjustType,
    source: item.source,
    fetchedAt: item.fetchedAt,
  };
}

function toDailyBarRecord(row: Record<string, unknown>): DailyBarRecord {
  return {
    symbol: String(row.symbol),
    tradeDate: toDateString(row.trade_date),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
    amount: optionalNumber(row.amount),
    change: optionalNumber(row.change),
    changePercent: optionalNumber(row.change_percent),
    turnoverRate: optionalNumber(row.turnover_rate),
    adjustType: row.adjust_type as AdjustType,
    source: String(row.source),
    fetchedAt: String(row.fetched_at),
  };
}

function toSecurityRecord(row: Record<string, unknown>): SecurityRecord {
  return {
    symbol: String(row.symbol),
    name: String(row.name),
    exchange: row.exchange as SecurityRecord['exchange'],
    securityType: 'stock',
    status: row.status as SecurityRecord['status'],
    listDate: optionalString(row.list_date),
    delistDate: optionalString(row.delist_date),
    industry: optionalString(row.industry),
    isSt: Boolean(row.is_st),
    source: String(row.source),
    updatedAt: String(row.updated_at),
  };
}

function toSyncJob(row: Record<string, unknown>): SyncJobRecord {
  const status = String(row.status) as SyncJobStatus;
  return {
    id: String(row.id),
    status,
    state:
      status === 'running'
        ? row.job_type === 'initial_backfill'
          ? 'initializing'
          : 'syncing'
        : status === 'pending'
          ? 'checking'
          : status === 'cancelled'
            ? 'idle'
            : status,
    jobType: row.job_type as SyncJobType,
    targetTradeDate: optionalString(row.target_trade_date),
    processedSymbols: Number(row.processed_symbols),
    totalSymbols: Number(row.total_symbols),
    succeededSymbols: Number(row.succeeded_symbols),
    failedSymbols: Number(row.failed_symbols),
    startedAt: optionalString(row.started_at),
    finishedAt: optionalString(row.finished_at),
    checkpointSymbol: optionalString(row.checkpoint_symbol),
    errorMessage: optionalString(row.error_message),
    message: optionalString(row.error_message),
  };
}

function toDateString(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value ?? '');
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  // ponytail: normalize compact dates like "20240722" → "2024-07-22"
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return text;
}
function optionalNumber(value: unknown) {
  return value === null || value === undefined ? undefined : Number(value);
}
function optionalString(value: unknown) {
  return value === null || value === undefined || value === '' ? undefined : String(value);
}
