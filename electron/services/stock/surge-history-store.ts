import { app } from 'electron';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import path from 'node:path';
import type { HotFocusItem, StockSurgeEvent } from '../../../src/shared/types.js';

interface SurgeRow {
  trade_date: string;
  id: string;
  code?: string;
  name?: string;
  title: string;
  time?: string;
  price?: string;
  change_percent?: string;
  turnover?: string;
  amount?: string;
  description?: string;
  tag?: string;
  type?: HotFocusItem['type'];
}

const dbPath = path.join(app.getPath('userData'), app.isPackaged ? 'stocksense-surge.duckdb' : 'stocksense-surge-dev.duckdb');
const dbReady = DuckDBInstance.fromCache(dbPath);
let ready: Promise<void> | undefined;
let queue = Promise.resolve();
let isClosing = false;
let activeConnections = 0;
let closeResolve: (() => void) | undefined;

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
    DROP INDEX IF EXISTS idx_stock_surge_events_date;
  `);
  return ready;
}

export function saveSurgeSnapshot(items: HotFocusItem[], capturedAt = new Date(), tradeDate = toTradeDate(capturedAt)) {
  if (!items.length) return Promise.resolve();
  return withDb(async () => {
    const captured = capturedAt.toISOString();
    for (const item of items) {
      await run(`DELETE FROM stock_surge_events WHERE trade_date = ${sqlValue(tradeDate)} AND id = ${sqlValue(item.id)}`);
      await run(
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
         ].map(sqlValue).join(', ')})`,
      );
    }
  });
}

export function clearSurgeHistoryDate(tradeDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) return Promise.resolve();
  return withDb(async () => {
    await run(`DELETE FROM stock_surge_events WHERE trade_date = ${sqlValue(tradeDate)}`);
  });
}

export function listSurgeDates(limit = 7) {
  return readDb(async () => {
    const rows = await all<{ trade_date: string }>(`SELECT DISTINCT trade_date FROM stock_surge_events ORDER BY trade_date DESC LIMIT ${Math.max(1, limit)}`);
    return rows.map((row) => row.trade_date);
  });
}

export function listSurgeHistory(date: string, offset = 0, limit = 20) {
  return readDb(async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    const safeOffset = Math.max(0, Math.floor(offset));
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const rows = await all<SurgeRow>(
      `SELECT trade_date, id, code, name, title, time, price, change_percent, turnover, amount, description, tag, type
       FROM stock_surge_events
       WHERE trade_date = ${sqlValue(date)}
       ORDER BY COALESCE(time, '') DESC, id DESC
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    );
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      code: row.code,
      name: row.name,
      time: row.time,
      price: row.price,
      changePercent: row.change_percent,
      turnover: row.turnover,
      amount: row.amount,
      description: row.description,
      tag: row.tag,
      type: row.type,
    } satisfies HotFocusItem));
  });
}

export function listStockSurgeEvents(code: string, keepDays = 7) {
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
    return rows.map((row) => ({
      id: row.id,
      tradeDate: row.trade_date,
      title: row.title,
      code: row.code,
      name: row.name,
      time: row.time,
      price: row.price,
      changePercent: row.change_percent,
      turnover: row.turnover,
      amount: row.amount,
      description: row.description,
      tag: row.tag,
      type: row.type,
    } satisfies StockSurgeEvent));
  });
}

export function pruneSurgeHistory(keepDays = 7) {
  return withDb(async () => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Math.max(keepDays - 1, 0));
    await run(`DELETE FROM stock_surge_events WHERE trade_date < ${sqlValue(toTradeDate(cutoff))}`);
  });
}

export async function closeSurgeHistoryStore() {
  isClosing = true;
  try {
    await queue;
    if (activeConnections > 0) await new Promise<void>((resolve) => { closeResolve = resolve; });
  } catch (error) {
    console.warn('[surge-history] close failed', error);
  }
}

function readDb<T>(work: () => Promise<T>) {
  if (isClosing) return Promise.reject(new Error('surge history store is closing'));
  return ensureReady().then(work);
}

function withDb<T>(work: () => Promise<T>) {
  if (isClosing) return Promise.reject(new Error('surge history store is closing'));
  const next = queue.then(async () => {
    if (isClosing) throw new Error('surge history store is closing');
    await ensureReady();
    return work();
  });
  queue = next.then(() => undefined, () => undefined);
  return next;
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

function toTradeDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function stringify(value: HotFocusItem['price']) {
  return value === undefined ? null : String(value);
}

function sqlValue(value: unknown) {
  if (value === undefined || value === null) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}
