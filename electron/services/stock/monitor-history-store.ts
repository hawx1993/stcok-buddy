import { app } from 'electron';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import path from 'node:path';
import type { IMonitorEvent, TMonitorCategory } from '../../../src/shared/types.js';

interface IMonitorHistoryRow {
  trade_date: string;
  captured_at: string;
  id: string;
  category: TMonitorCategory;
  timestamp: string;
  code: string;
  name: string;
  price?: string;
  change_percent?: string;
  title: string;
  badge?: string;
  details_json: string;
  ai_analysis: string;
  chart_json?: string;
  score?: number;
}

interface IMonitorHistoryQuery {
  date: string;
  categories?: TMonitorCategory[];
  offset?: number;
  limit?: number;
}

const MAX_MONITOR_HISTORY_LIMIT = 1000;
const HIGH_FREQUENCY_MONITOR_CATEGORIES: TMonitorCategory[] = ['technical', 'risk', 'ai-opportunity', 'ai-warning'];

const dbPath = process.env.STOCKSENSE_MONITOR_DB_PATH ?? path.join(
  app.getPath('userData'),
  app.isPackaged ? 'stocksense-monitor.duckdb' : 'stocksense-monitor-dev.duckdb',
);

let dbReady: Promise<DuckDBInstance> | undefined = DuckDBInstance.fromCache(dbPath);
let ready: Promise<void> | undefined;
let queue = Promise.resolve();
let isClosing = false;
let activeConnections = 0;
let closeResolve: (() => void) | undefined;

type TQueuedMonitorEvents = {
  events: Map<string, IMonitorEvent>;
  capturedAt: Date;
  tradeDate: string;
};

const monitorEventQueue = new Map<string, TQueuedMonitorEvents>();

function getDbReady(): Promise<DuckDBInstance> {
  dbReady ??= DuckDBInstance.create(dbPath);
  return dbReady;
}

function ensureReady() {
  ready ??= exec(`
    CREATE TABLE IF NOT EXISTS ai_monitor_events (
      trade_date TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      id TEXT NOT NULL,
      category TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      price TEXT,
      change_percent TEXT,
      title TEXT NOT NULL,
      badge TEXT,
      details_json TEXT NOT NULL,
      ai_analysis TEXT NOT NULL,
      chart_json TEXT,
      score DOUBLE
    );
    CREATE INDEX IF NOT EXISTS idx_ai_monitor_events_date_category_time
      ON ai_monitor_events (trade_date, category, timestamp);
    CREATE INDEX IF NOT EXISTS idx_ai_monitor_events_date_id
      ON ai_monitor_events (trade_date, id);
  `);
  return ready;
}

export async function saveMonitorEvents(events: IMonitorEvent[], capturedAt = new Date(), tradeDate = toTradeDate(capturedAt)) {
  const dedupedEvents = dedupeMonitorEvents(events);
  if (!dedupedEvents.length) return Promise.resolve();
  return withDb(async () => {
    const captured = capturedAt.toISOString();
    const eventIds = Array.from(new Set(dedupedEvents.map((event) => event.id)));
    const highFrequencyKeys = Array.from(new Set(dedupedEvents.filter(isHighFrequencyMonitorEvent).map(monitorSignalKey)));
    const existingTimestamps = new Map(
      (await all<{ id: string; timestamp: string }>(
        `SELECT id, MIN(timestamp) AS timestamp
         FROM ai_monitor_events
         WHERE trade_date = ${sqlValue(tradeDate)} AND id IN (${eventIds.map(sqlValue).join(', ')})
         GROUP BY id`,
      )).map((row) => [row.id, row.timestamp] as const),
    );
    const existingSignalTimestamps = highFrequencyKeys.length
      ? new Map(
          (await all<{ category: TMonitorCategory; code: string; title: string; timestamp: string }>(
            `SELECT category, code, title, MIN(timestamp) AS timestamp
             FROM ai_monitor_events
             WHERE trade_date = ${sqlValue(tradeDate)}
               AND (${highFrequencyKeys.map(monitorSignalWhereSql).join(' OR ')})
             GROUP BY category, code, title`,
          )).map((row) => [monitorSignalKey(row), row.timestamp] as const),
        )
      : new Map<string, string>();
    const signalTimestamps = new Map(existingSignalTimestamps);
    for (const event of dedupedEvents) {
      if (!isHighFrequencyMonitorEvent(event)) continue;
      const key = monitorSignalKey(event);
      if (!signalTimestamps.has(key)) signalTimestamps.set(key, event.timestamp);
    }
    const statements = dedupedEvents.flatMap((event) => [
      `DELETE FROM ai_monitor_events WHERE trade_date = ${sqlValue(tradeDate)} AND id = ${sqlValue(event.id)}`,
      monitorDuplicateDeleteSql(tradeDate, event),
      ...(isHighFrequencyMonitorEvent(event)
        ? [
            `DELETE FROM ai_monitor_events
             WHERE trade_date = ${sqlValue(tradeDate)}
               AND category = ${sqlValue(event.category)}
               AND code = ${sqlValue(event.code)}
               AND title = ${sqlValue(event.title)}`,
          ]
        : []),
      `INSERT INTO ai_monitor_events
        (trade_date, captured_at, id, category, timestamp, code, name, price, change_percent, title, badge, details_json, ai_analysis, chart_json, score)
       VALUES (${[
         tradeDate,
         captured,
         event.id,
         event.category,
         existingTimestamps.get(event.id) ?? signalTimestamps.get(monitorSignalKey(event)) ?? event.timestamp,
         event.code,
         event.name,
         stringify(event.price),
         stringify(event.changePercent),
         event.title,
         event.badge,
         JSON.stringify(event.details),
         event.aiAnalysis,
         event.chart ? JSON.stringify(event.chart) : undefined,
         event.score,
       ].map(sqlValue).join(', ')})`,
    ]);
    await run(`BEGIN TRANSACTION; ${statements.join('; ')}; COMMIT`);
  });
}

export function enqueueMonitorEvents(events: IMonitorEvent[], capturedAt = new Date(), tradeDate = toTradeDate(capturedAt)) {
  const dedupedEvents = dedupeMonitorEvents(events);
  if (!dedupedEvents.length) return;
  const group = monitorEventQueue.get(tradeDate) ?? { events: new Map<string, IMonitorEvent>(), capturedAt, tradeDate };
  for (const event of dedupedEvents) {
    const key = findQueuedMonitorEventKey(group.events, event);
    const queuedEvent = group.events.get(key);
    group.events.set(key, queuedEvent ? { ...event, timestamp: queuedEvent.timestamp } : event);
  }
  if (capturedAt > group.capturedAt) group.capturedAt = capturedAt;
  monitorEventQueue.set(tradeDate, group);
}

export async function flushMonitorEventQueue() {
  if (!monitorEventQueue.size) return;
  const groups = Array.from(monitorEventQueue.values());
  monitorEventQueue.clear();
  for (const group of groups) {
    await saveMonitorEvents(Array.from(group.events.values()), group.capturedAt, group.tradeDate);
  }
}

export function getQueuedMonitorEventCount() {
  let count = 0;
  for (const group of monitorEventQueue.values()) count += group.events.size;
  return count;
}

export function listMonitorDates(limit = 7) {
  return readDb(async () => {
    const safeLimit = Math.max(1, Math.min(30, Math.floor(limit)));
    const rows = await all<{ trade_date: string }>(
      `SELECT DISTINCT trade_date FROM ai_monitor_events ORDER BY trade_date DESC LIMIT ${safeLimit}`,
    );
    return rows.map((row) => row.trade_date);
  });
}

export function listMonitorHistory(options: IMonitorHistoryQuery) {
  return readDb(async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) return [];
    const safeOffset = Math.max(0, Math.floor(options.offset ?? 0));
    const safeLimit = Math.max(1, Math.min(MAX_MONITOR_HISTORY_LIMIT, Math.floor(options.limit ?? 50)));
    const categorySql = monitorCategorySql(options.categories);
    const rows = await all<IMonitorHistoryRow>(
      `SELECT trade_date, captured_at, id, category, timestamp, code, name, price, change_percent, title, badge, details_json, ai_analysis, chart_json, score
       FROM ai_monitor_events
       WHERE trade_date = ${sqlValue(options.date)}${categorySql}
       ORDER BY timestamp DESC, id DESC
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    );
    return rows.map(toMonitorEvent);
  });
}

export function countMonitorHistory(options: Pick<IMonitorHistoryQuery, 'date' | 'categories'>) {
  return readDb(async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) return 0;
    const categorySql = monitorCategorySql(options.categories);
    const rows = await all<{ total: number }>(
      `SELECT COUNT(*) AS total FROM ai_monitor_events WHERE trade_date = ${sqlValue(options.date)}${categorySql}`,
    );
    return Number(rows[0]?.total ?? 0);
  });
}

export function countMonitorHistoryByCategory(options: Pick<IMonitorHistoryQuery, 'date' | 'categories'>) {
  return readDb(async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) return {} as Partial<Record<TMonitorCategory, number>>;
    const categorySql = monitorCategorySql(options.categories);
    const rows = await all<{ category: TMonitorCategory; total: number }>(
      `SELECT category, COUNT(*) AS total FROM ai_monitor_events WHERE trade_date = ${sqlValue(options.date)}${categorySql} GROUP BY category`,
    );
    const counts: Partial<Record<TMonitorCategory, number>> = {};
    for (const row of rows) counts[row.category] = Number(row.total ?? 0);
    return counts;
  });
}

export function pruneMonitorHistory(keepTradingDays = 7) {
  return withDb(async () => {
    const dates = await listMonitorDates(Math.max(keepTradingDays, 1) + 1);
    const cutoff = dates[Math.max(keepTradingDays, 1)];
    if (!cutoff) return;
    await run(`DELETE FROM ai_monitor_events WHERE trade_date <= ${sqlValue(cutoff)}`);
  });
}

export function cleanupMonitorHistoryNoise(tradeDate: string) {
  return withDb(async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) return;
    const categorySql = HIGH_FREQUENCY_MONITOR_CATEGORIES.map(sqlValue).join(', ');
    await run(`
      DELETE FROM ai_monitor_events
      WHERE trade_date = ${sqlValue(tradeDate)}
        AND category IN (${categorySql})
        AND id NOT IN (
          SELECT id FROM (
            SELECT id,
              ROW_NUMBER() OVER (
                PARTITION BY trade_date, category, code, title
                ORDER BY timestamp DESC, captured_at DESC, id DESC
              ) AS rn
            FROM ai_monitor_events
            WHERE trade_date = ${sqlValue(tradeDate)}
              AND category IN (${categorySql})
          ) ranked
          WHERE rn = 1
        );
      DELETE FROM ai_monitor_events
      WHERE trade_date = ${sqlValue(tradeDate)}
        AND category = 'ai-opportunity'
        AND COALESCE(TRY_CAST(change_percent AS DOUBLE), 0) < 4;
      DELETE FROM ai_monitor_events
      WHERE trade_date = ${sqlValue(tradeDate)}
        AND category = 'ai-warning'
        AND COALESCE(TRY_CAST(change_percent AS DOUBLE), 0) > -4;
    `);
  });
}

export async function closeMonitorHistoryStore(timeoutMs?: number) {
  isClosing = true;
  try {
    await queue;
    if (activeConnections > 0)
      await new Promise<void>((resolve) => {
        closeResolve = resolve;
        if (timeoutMs && timeoutMs > 0) setTimeout(resolve, timeoutMs);
      });
  } catch (error) {
    console.warn('[monitor-history] close failed', error);
  }
}

export async function closeMonitorHistoryInstance() {
  try {
    if (dbReady) {
      const instance = await dbReady;
      instance.closeSync();
    }
  } catch (error) {
    console.warn('[monitor-history] failed to close DuckDB instance', error);
  }
}

export async function resetMonitorHistoryStore() {
  if (activeConnections === 0 && dbReady) {
    try {
      const oldInstance = await dbReady;
      oldInstance.closeSync();
    } catch (error) {
      console.warn('[monitor-history] failed to close old DuckDB instance during reset', error);
    }
  }
  dbReady = undefined;
  ready = undefined;
  queue = Promise.resolve();
  monitorEventQueue.clear();
  isClosing = false;
  activeConnections = 0;
  closeResolve = undefined;
}

function readDb<T>(work: () => Promise<T>) {
  if (isClosing) return Promise.reject(new Error('monitor history store is closing'));
  return ensureReady().then(work);
}

function withDb<T>(work: () => Promise<T>) {
  if (isClosing) return Promise.reject(new Error('monitor history store is closing'));
  const next = queue.then(async () => {
    if (isClosing) throw new Error('monitor history store is closing');
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
  if (isClosing) throw new Error('monitor history store is closing');
  const connection = await (await getDbReady()).connect();
  activeConnections += 1;
  try {
    return await work(connection);
  } finally {
    connection.closeSync();
    activeConnections -= 1;
    if (isClosing && activeConnections === 0) closeResolve?.();
  }
}

function isHighFrequencyMonitorEvent(event: Pick<IMonitorEvent, 'category'>) {
  return HIGH_FREQUENCY_MONITOR_CATEGORIES.includes(event.category);
}

function dedupeMonitorEvents(events: IMonitorEvent[]) {
  const byId = new Map<string, IMonitorEvent>();
  for (const event of events) byId.set(event.id, event);
  const byDuplicate = new Map<string, IMonitorEvent>();
  for (const event of byId.values()) byDuplicate.set(monitorDuplicateKey(event), event);
  return Array.from(byDuplicate.values());
}

function findQueuedMonitorEventKey(events: Map<string, IMonitorEvent>, event: IMonitorEvent) {
  const duplicateKey = monitorDuplicateKey(event);
  if (events.has(duplicateKey)) return duplicateKey;
  for (const [key, queuedEvent] of events) {
    if (queuedEvent.id === event.id) return key;
  }
  return duplicateKey;
}

function monitorDuplicateKey(event: IMonitorEvent) {
  return `${event.category}\n${event.timestamp}\n${event.code}\n${event.title}\n${event.details.join('\n')}`;
}

function monitorDuplicateDeleteSql(tradeDate: string, event: IMonitorEvent) {
  return `DELETE FROM ai_monitor_events
          WHERE trade_date = ${sqlValue(tradeDate)}
            AND category = ${sqlValue(event.category)}
            AND timestamp = ${sqlValue(event.timestamp)}
            AND code = ${sqlValue(event.code)}
            AND title = ${sqlValue(event.title)}
            AND details_json = ${sqlValue(JSON.stringify(event.details))}`;
}

function monitorSignalKey(event: Pick<IMonitorEvent, 'category' | 'code' | 'title'>) {
  return `${event.category}\n${event.code}\n${event.title}`;
}

function monitorSignalWhereSql(eventKey: string) {
  const [category, code, title] = eventKey.split('\n');
  return `(category = ${sqlValue(category)} AND code = ${sqlValue(code)} AND title = ${sqlValue(title)})`;
}

function monitorCategorySql(categories: TMonitorCategory[] | undefined) {
  return categories?.length ? ` AND category IN (${categories.map(sqlValue).join(', ')})` : '';
}

function toMonitorEvent(row: IMonitorHistoryRow): IMonitorEvent {
  return {
    id: row.id,
    category: row.category,
    timestamp: row.timestamp,
    code: row.code,
    name: row.name,
    price: parseStoredNumeric(row.price),
    changePercent: parseStoredNumeric(row.change_percent),
    title: row.title,
    badge: optionalString(row.badge),
    details: parseStringArray(row.details_json),
    aiAnalysis: row.ai_analysis,
    chart: parseChart(row.chart_json),
    score: optionalNumber(row.score),
  };
}

function parseStoredNumeric(value: string | undefined) {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

function parseStringArray(value: string) {
  const parsed: unknown = JSON.parse(value || '[]');
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}

function parseChart(value: string | undefined): IMonitorEvent['chart'] {
  if (!value) return undefined;
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object') return undefined;
  const chart = parsed as { type?: unknown; data?: unknown; labels?: unknown };
  if (chart.type !== 'line' && chart.type !== 'bar' && chart.type !== 'radar') return undefined;
  if (!Array.isArray(chart.data) || !chart.data.every((item) => typeof item === 'number')) return undefined;
  return {
    type: chart.type,
    data: chart.data,
    labels: Array.isArray(chart.labels) ? chart.labels.filter((item): item is string => typeof item === 'string') : undefined,
  };
}

function toTradeDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function stringify(value: IMonitorEvent['price']) {
  return value === undefined ? null : String(value);
}

function optionalNumber(value: unknown) {
  return value === null || value === undefined ? undefined : Number(value);
}

function optionalString(value: string | undefined) {
  return value === undefined || value === '' ? undefined : value;
}

function sqlValue(value: unknown) {
  if (value === undefined || value === null) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}
