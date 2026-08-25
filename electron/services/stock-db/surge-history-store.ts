import { app } from '../../electron-runtime.js';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import path from 'node:path';
import { shouldKeepSurgeItem } from '../stock/anomaly/surge-large-order.js';
import type { HotFocusItem, StockSurgeEvent } from '../../../src/shared/types.js';

interface SurgeRow {
  trade_date: string;
  id: string;
  code?: string | null;
  name?: string | null;
  title: string;
  time?: string | null;
  price?: string | null;
  change_percent?: string | null;
  turnover?: string | null;
  amount?: string | null;
  description?: string | null;
  tag?: string | null;
  type?: string | null;
}

export interface ISurgeHistoryFreshness {
  recordCount: number;
  latestCapturedAt?: string;
}

const dbPath =
  process.env.STOCKSENSE_SURGE_DB_PATH ??
  path.join(app.getPath('userData'), app.isPackaged ? 'stocksense-surge.duckdb' : 'stocksense-surge-dev.duckdb');
// ponytail: dbReady is undefined after a storage clear so the database file is
// NOT recreated until the next actual read/write — otherwise resetSurgeHistoryStore
// would immediately DuckDBInstance.create() an empty ~12KB file and the storage
// manager would show "12KB" right after clearing, looking like it never worked.
let dbReady: Promise<DuckDBInstance> | undefined = DuckDBInstance.fromCache(dbPath);
let ready: Promise<void> | undefined;
interface IDbOperation<T> {
  work: () => Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
  priority: boolean;
}

const operationQueue: Array<IDbOperation<unknown>> = [];
let isOperationRunning = false;
let idlePromise: Promise<void> | undefined;
let resolveIdle: (() => void) | undefined;
let isClosing = false;
let activeConnections = 0;

const DUCKDB_SINGLE_THREAD_SQL = 'SET threads TO 1';
let closeResolve: (() => void) | undefined;

// Deletes exact-duplicate rows: same trade_date + same displayed content
// (title/code/time/tag/price/change_percent/amount/description), keeping the
// first captured row. Mirrors the content key used by surgeItemContentKey.
const SURGE_DEDUPE_SQL = `
  DELETE FROM stock_surge_events
  WHERE (trade_date, captured_at, id) IN (
    SELECT trade_date, captured_at, id
    FROM (
      SELECT trade_date, captured_at, id,
             ROW_NUMBER() OVER (
               PARTITION BY trade_date, COALESCE(title,''), COALESCE(code,''), COALESCE(time,''),
                             COALESCE(tag,''), COALESCE(price,''), COALESCE(change_percent,''),
                             COALESCE(amount,''), COALESCE(description,'')
               ORDER BY captured_at ASC, id ASC
             ) AS rn
      FROM stock_surge_events
    )
    WHERE rn > 1
  )`;

// ponytail: marker set when the user explicitly clears surge history. While
// active, all reads return empty and all writes are dropped, so switching to
// historical dates does not recreate the ~12KB empty DuckDB file or backfill
// from remote. The marker expires after a grace period (or on app restart).
const SURGE_CLEAR_MARKER_TTL_MS = 30 * 60 * 1000;
let surgeHistoryClearMarkerAt: number | undefined;

type TQueuedSurgeSnapshot = {
  item: HotFocusItem;
  capturedAt: Date;
  tradeDate: string;
};

const surgeSnapshotQueue = new Map<string, TQueuedSurgeSnapshot>();

export function isSurgeHistoryClearMarkerActive() {
  if (!surgeHistoryClearMarkerAt) return false;
  if (Date.now() - surgeHistoryClearMarkerAt > SURGE_CLEAR_MARKER_TTL_MS) {
    surgeHistoryClearMarkerAt = undefined;
    return false;
  }
  return true;
}

export function setSurgeHistoryClearMarker() {
  surgeHistoryClearMarkerAt = Date.now();
}

export function clearSurgeHistoryClearMarker() {
  surgeHistoryClearMarkerAt = undefined;
}

function getDbReady(): Promise<DuckDBInstance> {
  // Lazily (re)create the DuckDB instance. After a clear, dbReady is undefined
  // and the file is gone; the first post-clear access recreates both. We use
  // DuckDBInstance.create (not fromCache) so a closed/cleared instance is never
  // returned from the singleton cache.
  dbReady ??= DuckDBInstance.create(dbPath);
  return dbReady;
}

function ensureReady() {
  ready ??= exec(`
    CREATE TABLE IF NOT EXISTS stock_surge_events (
      trade_date TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      id TEXT NOT NULL,
      code TEXT,
      name TEXT,
      title TEXT NOT NULL,
      time TEXT,
      price TEXT,
      change_percent TEXT,
      turnover TEXT,
      amount TEXT,
      description TEXT,
      tag TEXT,
      type TEXT
    );
    DROP INDEX IF EXISTS idx_stock_surge_events_date_id;
  `).then(async () => {
    // One-time cleanup: identical events were historically persisted under
    // unstable (per-capture index) ids, so the exact same content could be
    // inserted dozens of times. Keep the first row per content key and drop
    // the rest. Idempotent — after the first run no duplicates remain, so
    // later app starts scan only the unique rows.
    try {
      await exec(SURGE_DEDUPE_SQL);
    } catch (error) {
      // Non-fatal: the read path (listSurgeHistory) also dedupes by content,
      // so the panel never shows duplicates even if this cleanup fails.
      console.warn('[surge-history] startup duplicate cleanup failed', error);
    }
  });
  return ready;
}

function dedupeHotFocusItems(items: HotFocusItem[]) {
  const map = new Map<string, HotFocusItem>();
  for (const item of items) map.set(item.id, item);
  return Array.from(map.values());
}

function dedupeStockSurgeEvents(events: StockSurgeEvent[]) {
  const map = new Map<string, StockSurgeEvent>();
  for (const event of events) map.set(`${event.tradeDate}|${event.id}`, event);
  return Array.from(map.values());
}

export function saveSurgeSnapshot(items: HotFocusItem[], capturedAt = new Date(), tradeDate = toTradeDate(capturedAt)) {
  const uniqueItems = dedupeHotFocusItems(items.filter(shouldKeepSurgeItem));
  if (!uniqueItems.length) return Promise.resolve();
  // ponytail: drop writes while the clear marker is active so the DB file is
  // not recreated immediately after a clear.
  if (isSurgeHistoryClearMarkerActive()) return Promise.resolve();
  return withDb(async () => {
    const captured = capturedAt.toISOString();
    const statements = uniqueItems.flatMap((item) => [
      `DELETE FROM stock_surge_events WHERE trade_date = ${sqlValue(tradeDate)} AND id = ${sqlValue(item.id)}`,
      `INSERT INTO stock_surge_events
        (trade_date, captured_at, id, code, name, title, time, price, change_percent, turnover, amount, description, tag, type)
       VALUES (${[
         tradeDate,
         captured,
         item.id,
         item.code,
         item.name,
         item.title,
         item.time,
         stringify(item.price),
         item.changePercent,
         item.turnover,
         item.amount,
         item.description,
         item.tag,
         item.type,
       ]
         .map(sqlValue)
         .join(', ')})`,
    ]);
    await run(`BEGIN TRANSACTION; ${statements.join('; ')}; COMMIT`);
  });
}

export function enqueueSurgeSnapshot(
  items: HotFocusItem[],
  capturedAt = new Date(),
  tradeDate = toTradeDate(capturedAt),
) {
  const filteredItems = items.filter(shouldKeepSurgeItem);
  if (!filteredItems.length || isSurgeHistoryClearMarkerActive()) return;
  for (const item of filteredItems) {
    surgeSnapshotQueue.set(`${tradeDate}|${item.id}`, { item, capturedAt, tradeDate });
  }
}

export async function flushSurgeSnapshotQueue() {
  if (!surgeSnapshotQueue.size || isSurgeHistoryClearMarkerActive()) {
    surgeSnapshotQueue.clear();
    return;
  }
  const queued = Array.from(surgeSnapshotQueue.values());
  surgeSnapshotQueue.clear();
  const groups = new Map<string, { capturedAt: Date; items: HotFocusItem[] }>();
  for (const entry of queued) {
    const group = groups.get(entry.tradeDate);
    if (group) {
      group.items.push(entry.item);
      if (entry.capturedAt > group.capturedAt) group.capturedAt = entry.capturedAt;
    } else {
      groups.set(entry.tradeDate, { capturedAt: entry.capturedAt, items: [entry.item] });
    }
  }
  for (const [tradeDate, group] of groups) {
    await saveSurgeSnapshot(group.items, group.capturedAt, tradeDate);
  }
}

export function getQueuedSurgeSnapshotCount() {
  return surgeSnapshotQueue.size;
}

export function clearSurgeHistoryDate(tradeDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) return Promise.resolve();
  return withDb(async () => {
    await run(`DELETE FROM stock_surge_events WHERE trade_date = ${sqlValue(tradeDate)}`);
  });
}

export function clearAllSurgeHistory() {
  return withDb(async () => {
    await withConnection(async (connection) => {
      await connection.run('DELETE FROM stock_surge_events');
      await connection.run('CHECKPOINT');
    });
  });
}

export function listSurgeDates(limit = 7) {
  return readDb(async () => {
    const rows = await all<{ trade_date: string }>(
      `SELECT DISTINCT trade_date FROM stock_surge_events ORDER BY trade_date DESC LIMIT ${Math.max(1, limit)}`,
    );
    return rows.map((row) => row.trade_date);
  });
}

export function getSurgeHistoryFreshness() {
  return readDb(async (): Promise<ISurgeHistoryFreshness> => {
    const [row] = await all<{ record_count: number; latest_captured_at?: string }>(
      `SELECT COUNT(*) AS record_count, MAX(captured_at) AS latest_captured_at FROM stock_surge_events`,
    );
    const recordCount = Number(row?.record_count ?? 0);
    const latestCapturedAt =
      typeof row?.latest_captured_at === 'string' && row.latest_captured_at.length > 0
        ? row.latest_captured_at
        : undefined;
    return { recordCount, latestCapturedAt };
  });
}

function readSurgeHistoryRows(date: string) {
  return readDb(async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    const rows = await all<SurgeRow>(
      `SELECT trade_date, id, code, name, title, time, price, change_percent, turnover, amount, description, tag, type
       FROM stock_surge_events
       WHERE trade_date = ${sqlValue(date)}
       ORDER BY COALESCE(time, '') DESC, id DESC`,
    );
    // The same event was historically stored under unstable ids, so exact
    // duplicates can exist in the DB. Dedupe by displayed content before
    // slicing so pagination stays consistent and the panel shows each event
    // only once.
    return dedupeSurgeHistoryRows(rows);
  });
}

export function listSurgeHistory(date: string, offset = 0, limit = 20) {
  // ponytail: while the clear marker is active, pretend the DB is empty. This
  // avoids recreating the DuckDB file just to run an empty query.
  if (isSurgeHistoryClearMarkerActive()) return Promise.resolve([]);
  const safeOffset = Math.max(0, Math.floor(offset));
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  return readSurgeHistoryRows(date).then((rows) => rows.slice(safeOffset, safeOffset + safeLimit));
}

/**
 * 读取某交易日的全部异动行（不去重截断，仍按内容去重），供全市场手数/方向
 * 筛选等需要扫描整日样本的场景使用。listSurgeHistory 每页最多返回 100 条，
 * 若调用方只取第一页会漏掉早盘发生的大单异动。
 */
export function listSurgeHistoryAll(date: string) {
  // ponytail: while the clear marker is active, pretend the DB is empty. This
  // avoids recreating the DuckDB file just to run an empty query.
  if (isSurgeHistoryClearMarkerActive()) return Promise.resolve([]);
  return readSurgeHistoryRows(date);
}

export function listStockSurgeEvents(code: string, tradeDate = toTradeDate(new Date())) {
  return readDb(async () => {
    const normalizedCode = code.trim();
    if (!normalizedCode || !isTradeDate(tradeDate)) return [];
    const rows = await all<SurgeRow>(
      `SELECT trade_date, id, code, name, title, time, price, change_percent, turnover, amount, description, tag, type
       FROM stock_surge_events
       WHERE code = ${sqlValue(normalizedCode)} AND trade_date = ${sqlValue(tradeDate)}
       ORDER BY COALESCE(time, '') DESC, id DESC`,
    );
    return dedupeStockSurgeEventRows(rows);
  });
}

export function listStockSurgeEventsByTradeDates(code: string, tradeDates: string[]) {
  return readDb(async () => {
    const normalizedCode = code.trim();
    const normalizedDates = tradeDates.filter(isTradeDate);
    if (!normalizedCode || !normalizedDates.length) return [];
    const rows = await all<SurgeRow>(
      `SELECT trade_date, id, code, name, title, time, price, change_percent, turnover, amount, description, tag, type
       FROM stock_surge_events
       WHERE code = ${sqlValue(normalizedCode)} AND trade_date IN (${normalizedDates.map(sqlValue).join(', ')})
       ORDER BY trade_date DESC, COALESCE(time, '') DESC, id DESC`,
    );
    return dedupeStockSurgeEventRows(rows);
  });
}

export function listRecentStockSurgeEvents(code: string, keepDays = 7) {
  return readDb(async () => {
    const normalizedCode = code.trim();
    if (!normalizedCode) return [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Math.max(keepDays - 1, 0));
    const rows = await all<SurgeRow>(
      `SELECT trade_date, id, code, name, title, time, price, change_percent, turnover, amount, description, tag, type
       FROM stock_surge_events
       WHERE code = ${sqlValue(normalizedCode)} AND trade_date >= ${sqlValue(toTradeDate(cutoff))}
       ORDER BY trade_date DESC, COALESCE(time, '') DESC, id DESC`,
    );
    return dedupeStockSurgeEventRows(rows);
  }, true);
}

function mapSurgeRowToHotFocusItem(row: SurgeRow): HotFocusItem {
  return {
    id: row.id,
    title: row.title,
    code: optionalString(row.code),
    name: optionalString(row.name),
    time: optionalString(row.time),
    price: optionalString(row.price),
    changePercent: optionalString(row.change_percent),
    turnover: optionalString(row.turnover),
    amount: optionalString(row.amount),
    description: optionalString(row.description),
    tag: optionalString(row.tag),
    type: toHotFocusItemType(row.type),
  };
}

function optionalString(value: string | null | undefined) {
  return typeof value === 'string' ? value : undefined;
}

function toHotFocusItemType(value: string | null | undefined): HotFocusItem['type'] {
  if (value === 'surge' || value === 'plummet' || value === 'volume' || value === 'neutral') return value;
  return undefined;
}

function surgeItemContentKey(item: HotFocusItem): string {
  return [item.title, item.code, item.time, item.tag, item.price, item.changePercent, item.amount, item.description]
    .map((value) => value ?? '')
    .join('|');
}

function dedupeSurgeHistoryRows(rows: SurgeRow[]): HotFocusItem[] {
  const seen = new Set<string>();
  const items: HotFocusItem[] = [];
  for (const row of rows) {
    const item = mapSurgeRowToHotFocusItem(row);
    if (!shouldKeepSurgeItem(item)) continue;
    const key = surgeItemContentKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return items;
}

function dedupeStockSurgeEventRows(rows: SurgeRow[]) {
  const events = rows
    .map(
      (row) =>
        ({
          ...mapSurgeRowToHotFocusItem(row),
          tradeDate: row.trade_date,
        }) satisfies StockSurgeEvent,
    )
    .filter(shouldKeepSurgeItem);
  // De-duplicate anomalies that come from both the hot-list snapshot and
  // the per-stock individual history (they share the same time/tag/price).
  const seen = new Set<string>();
  return events.filter((item) => {
    const key = `${item.tradeDate}|${item.time ?? ''}|${item.tag ?? ''}|${item.price ?? ''}|${item.changePercent ?? ''}|${item.amount ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function saveIndividualSurgeHistory(events: StockSurgeEvent[]) {
  const uniqueEvents = dedupeStockSurgeEvents(events.filter(shouldKeepSurgeItem));
  if (!uniqueEvents.length) return Promise.resolve();
  // ponytail: drop writes while the clear marker is active.
  if (isSurgeHistoryClearMarkerActive()) return Promise.resolve();
  return withDb(async () => {
    const captured = new Date().toISOString();
    // Batch per trade_date to keep transactions manageable
    const groups = new Map<string, StockSurgeEvent[]>();
    for (const event of uniqueEvents) {
      const list = groups.get(event.tradeDate) ?? [];
      list.push(event);
      groups.set(event.tradeDate, list);
    }
    for (const [tradeDate, group] of groups) {
      const statements = group.flatMap((item) => [
        `DELETE FROM stock_surge_events WHERE trade_date = ${sqlValue(tradeDate)} AND id = ${sqlValue(item.id)}`,
        `INSERT INTO stock_surge_events
          (trade_date, captured_at, id, code, name, title, time, price, change_percent, turnover, amount, description, tag, type)
         VALUES (${[
           tradeDate,
           captured,
           item.id,
           item.code,
           item.name,
           item.title,
           item.time,
           stringify(item.price),
           item.changePercent,
           item.turnover,
           item.amount,
           item.description,
           item.tag,
           item.type,
         ]
           .map(sqlValue)
           .join(', ')})`,
      ]);
      await run(`BEGIN TRANSACTION; ${statements.join('; ')}; COMMIT`);
    }
  });
}

export function pruneSurgeHistory(keepDays = 7) {
  return withDb(async () => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Math.max(keepDays - 1, 0));
    await run(`DELETE FROM stock_surge_events WHERE trade_date < ${sqlValue(toTradeDate(cutoff))}`);
  });
}

export async function closeSurgeHistoryStore(timeoutMs?: number) {
  isClosing = true;
  try {
    await waitForDbOperations();
    if (activeConnections > 0)
      await new Promise<void>((resolve) => {
        closeResolve = resolve;
        if (timeoutMs && timeoutMs > 0) setTimeout(resolve, timeoutMs);
      });
  } catch (error) {
    console.warn('[surge-history] close failed', error);
  }
}

export async function closeSurgeHistoryInstance() {
  // ponytail: close the actual DuckDB instance to release native scheduler
  // threads before Electron tears down Node/N-API during app quit.
  try {
    if (activeConnections > 0) {
      console.warn(
        `[surge-history] skipping DuckDB closeSync during app quit: ${activeConnections} connection(s) still active`,
      );
      return;
    }
    if (dbReady) {
      const instance = await dbReady;
      instance.closeSync();
    }
  } catch (error) {
    console.warn('[surge-history] failed to close DuckDB instance', error);
  }
}

export async function resetSurgeHistoryStore() {
  if (activeConnections === 0 && dbReady) {
    try {
      const oldInstance = await dbReady;
      oldInstance.closeSync();
    } catch (error) {
      console.warn('[surge-history] failed to close old DuckDB instance during reset', error);
    }
  }
  // ponytail: do NOT eagerly create a new instance/file here. Setting
  // dbReady = undefined defers file creation to the next actual read/write
  // (via getDbReady), so after "清空异动/热点历史" the storage manager shows
  // 0 instead of a phantom ~12KB empty DuckDB file.
  dbReady = undefined;
  ready = undefined;
  operationQueue.length = 0;
  isOperationRunning = false;
  const pendingOperations = operationQueue.splice(0);
  for (const operation of pendingOperations) operation.reject(new Error('surge history store reset'));
  idlePromise = undefined;
  resolveIdle = undefined;
  surgeSnapshotQueue.clear();
  isClosing = false;
  activeConnections = 0;
  closeResolve = undefined;
}

function readDb<T>(work: () => Promise<T>, priority = false) {
  if (isClosing) return Promise.reject(new Error('surge history store is closing'));
  return enqueueDbOperation(work, priority);
}

function withDb<T>(work: () => Promise<T>) {
  if (isClosing) return Promise.reject(new Error('surge history store is closing'));
  return enqueueDbOperation(work, false);
}

function enqueueDbOperation<T>(work: () => Promise<T>, priority: boolean) {
  const operation = new Promise<T>((resolve, reject) => {
    const entry: IDbOperation<T> = { work, resolve, reject, priority };
    if (priority) {
      const firstWrite = operationQueue.findIndex((queued) => !queued.priority);
      if (firstWrite >= 0) operationQueue.splice(firstWrite, 0, entry as IDbOperation<unknown>);
      else operationQueue.unshift(entry as IDbOperation<unknown>);
    } else {
      operationQueue.push(entry as IDbOperation<unknown>);
    }
    void processNextDbOperation();
  });
  return operation;
}

async function processNextDbOperation(): Promise<void> {
  if (isOperationRunning) return;
  const operation = operationQueue.shift();
  if (!operation) {
    const resolve = resolveIdle;
    resolveIdle = undefined;
    idlePromise = undefined;
    resolve?.();
    return;
  }
  isOperationRunning = true;
  try {
    if (isClosing) throw new Error('surge history store is closing');
    try {
      await ensureReady();
      operation.resolve(await operation.work());
    } catch (error) {
      if (!isDuckDbFatalInvalidation(error)) throw error;
      await recoverSurgeHistoryStoreAfterFatal(error);
      await ensureReady();
      operation.resolve(await operation.work());
    }
  } catch (error) {
    operation.reject(error);
  } finally {
    isOperationRunning = false;
    void processNextDbOperation();
  }
}

function waitForDbOperations() {
  if (!isOperationRunning && operationQueue.length === 0) return Promise.resolve();
  idlePromise ??= new Promise<void>((resolve) => {
    resolveIdle = resolve;
  });
  return idlePromise;
}

function isDuckDbFatalInvalidation(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('database has been invalidated') ||
    message.includes('Failed to delete all rows from index') ||
    message.includes('The database must be restarted prior to being used again')
  );
}

async function recoverSurgeHistoryStoreAfterFatal(error: unknown) {
  console.warn('[surge-history] resetting DuckDB instance after fatal invalidation', error);
  try {
    if (dbReady) {
      const instance = await dbReady;
      instance.closeSync();
    }
  } catch (closeError) {
    console.warn('[surge-history] failed to close invalid DuckDB instance', closeError);
  }
  ready = undefined;
  dbReady = DuckDBInstance.create(dbPath);
}

function exec(sql: string) {
  return withConnection(async (connection) => {
    await connection.run(sql);
  });
}

function run(sql: string) {
  return withConnection(async (connection) => {
    await connection.run(sql);
  });
}

function all<T>(sql: string) {
  return withConnection(async (connection) => {
    const reader = await connection.runAndReadAll(sql);
    return reader.getRowObjectsJS() as T[];
  });
}

async function withConnection<T>(work: (connection: DuckDBConnection) => Promise<T>) {
  if (isClosing) throw new Error('surge history store is closing');
  const connection = await (await getDbReady()).connect();
  activeConnections += 1;
  try {
    await connection.run(DUCKDB_SINGLE_THREAD_SQL);
    return await work(connection);
  } finally {
    connection.closeSync();
    activeConnections -= 1;
    if (isClosing && activeConnections === 0) closeResolve?.();
  }
}

function toTradeDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isTradeDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function stringify(value: HotFocusItem['price']) {
  return value === undefined ? null : String(value);
}

function sqlValue(value: unknown) {
  if (value === undefined || value === null) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}
