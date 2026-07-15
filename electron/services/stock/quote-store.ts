import { app } from 'electron';
import Database from 'better-sqlite3';
import path from 'node:path';
import type { MarketQuoteRow, MarketTab } from '../../../src/shared/types.js';

let db: Database.Database | undefined;
const quoteMemory = new Map<string, MarketQuoteRow>();
const dirtyCodes = new Set<string>();
const quoteSources = new Map<string, string>();
const quoteUpdatedAt = new Map<string, string>();
let flushTimer: NodeJS.Timeout | undefined;

const FLUSH_INTERVAL_MS = 10_000;

const schemaSql = `
  CREATE TABLE IF NOT EXISTS stock_quote (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    market TEXT NOT NULL,
    price REAL,
    change REAL,
    change_percent REAL,
    turnover_rate REAL,
    volume REAL,
    amount REAL,
    amplitude REAL,
    high REAL,
    low REAL,
    open REAL,
    prev_close REAL,
    market_cap REAL,
    updated_at TEXT NOT NULL,
    source TEXT NOT NULL,
    raw_json TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_stock_quote_market ON stock_quote(market);
  CREATE INDEX IF NOT EXISTS idx_stock_quote_change_percent ON stock_quote(change_percent);
  CREATE INDEX IF NOT EXISTS idx_stock_quote_turnover_rate ON stock_quote(turnover_rate);
  CREATE INDEX IF NOT EXISTS idx_stock_quote_amount ON stock_quote(amount);
  CREATE INDEX IF NOT EXISTS idx_stock_quote_updated_at ON stock_quote(updated_at);
`;

interface QuoteRow {
  code: string;
  name: string;
  market: string;
  price?: number | null;
  change?: number | null;
  change_percent?: number | null;
  turnover_rate?: number | null;
  volume?: number | null;
  amount?: number | null;
  amplitude?: number | null;
  high?: number | null;
  low?: number | null;
  open?: number | null;
  prev_close?: number | null;
  market_cap?: number | null;
  updated_at: string;
  source: string;
  raw_json: string;
}

export function initializeQuoteStore() {
  const store = getDb();
  const rows = store.prepare('SELECT * FROM stock_quote').all() as QuoteRow[];
  quoteMemory.clear();
  for (const row of rows) {
    const quote = rowToQuote(row);
    if (!quote.code) continue;
    quoteMemory.set(quote.code, quote);
    quoteSources.set(quote.code, row.source);
    quoteUpdatedAt.set(quote.code, row.updated_at);
  }
}

export function closeQuoteStore() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = undefined;
  flushQuoteRows();
  if (db?.open) db.close();
}

export function getStoredQuoteRows() {
  getDb();
  return [...quoteMemory.values()];
}

export function getStoredQuoteRowsByTab(tab: MarketTab) {
  return getStoredQuoteRows().filter((row) => quoteMatchesTab(row.code, tab));
}

export function upsertQuoteRows(rows: MarketQuoteRow[], source = 'stock-sdk') {
  if (!rows.length) return;
  getDb();
  const updatedAt = new Date().toISOString();
  for (const row of rows) {
    if (!row.code || !row.name) continue;
    const current = quoteMemory.get(row.code);
    quoteMemory.set(row.code, { ...(current ?? row), ...compactRow(row), code: row.code, name: row.name });
    quoteSources.set(row.code, source);
    quoteUpdatedAt.set(row.code, updatedAt);
    dirtyCodes.add(row.code);
  }
  scheduleFlush();
}

export function flushQuoteRows() {
  if (!dirtyCodes.size) return;
  const store = getDb();
  const codes = [...dirtyCodes];
  dirtyCodes.clear();
  const statement = store.prepare(`
    INSERT INTO stock_quote
    (code, name, market, price, change, change_percent, turnover_rate, volume, amount, amplitude, high, low, open, prev_close, market_cap, updated_at, source, raw_json)
    VALUES (@code, @name, @market, @price, @change, @changePercent, @turnoverRate, @volume, @amount, @amplitude, @high, @low, @open, @prevClose, @marketCap, @updatedAt, @source, @rawJson)
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name,
      market = excluded.market,
      price = excluded.price,
      change = excluded.change,
      change_percent = excluded.change_percent,
      turnover_rate = excluded.turnover_rate,
      volume = excluded.volume,
      amount = excluded.amount,
      amplitude = excluded.amplitude,
      high = excluded.high,
      low = excluded.low,
      open = excluded.open,
      prev_close = excluded.prev_close,
      market_cap = excluded.market_cap,
      updated_at = excluded.updated_at,
      source = excluded.source,
      raw_json = excluded.raw_json
  `);
  const writeMany = store.transaction((items: MarketQuoteRow[]) => {
    for (const item of items) statement.run(toDbParams(item));
  });
  writeMany(codes.map((code) => quoteMemory.get(code)).filter((row): row is MarketQuoteRow => Boolean(row)));
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    try {
      flushQuoteRows();
    } catch (error) {
      console.warn('[quote-store] flush failed', error);
    }
  }, FLUSH_INTERVAL_MS);
}

function getDb() {
  if (db?.open) return db;
  db = new Database(path.join(app.getPath('userData'), app.isPackaged ? 'stocksense-quotes.sqlite' : 'stocksense-quotes-dev.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(schemaSql);
  return db;
}

function toDbParams(row: MarketQuoteRow) {
  return {
    code: row.code,
    name: row.name,
    market: inferMarket(row.code),
    price: toNumber(row.price),
    change: undefined,
    changePercent: toNumber(row.changePercent),
    turnoverRate: toNumber(row.turnoverRate),
    volume: toNumber(row.volume),
    amount: toNumber(row.amount),
    amplitude: undefined,
    high: toNumber(row.high),
    low: toNumber(row.low),
    open: toNumber(row.open),
    prevClose: toNumber(row.prevClose),
    marketCap: toNumber(row.marketCap),
    updatedAt: quoteUpdatedAt.get(row.code) ?? new Date().toISOString(),
    source: quoteSources.get(row.code) ?? 'stock-sdk',
    rawJson: JSON.stringify(row),
  };
}

function rowToQuote(row: QuoteRow): MarketQuoteRow {
  return {
    ...JSON.parse(row.raw_json || '{}'),
    code: row.code,
    name: row.name,
    price: optionalNumber(row.price),
    changePercent: optionalNumber(row.change_percent),
    turnoverRate: optionalNumber(row.turnover_rate),
    volume: optionalNumber(row.volume),
    amount: optionalNumber(row.amount),
    open: optionalNumber(row.open),
    high: optionalNumber(row.high),
    low: optionalNumber(row.low),
    prevClose: optionalNumber(row.prev_close),
    marketCap: optionalNumber(row.market_cap),
  };
}

function optionalNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function toNumber(value: unknown) {
  if (value === undefined || value === null || value === '' || value === '--') return undefined;
  const num = Number(String(value).replace(/[,%]/g, ''));
  return Number.isFinite(num) ? num : undefined;
}

function inferMarket(code: string) {
  if (code.startsWith('4') || code.startsWith('8') || code.startsWith('92')) return 'BJ';
  if (code.startsWith('6')) return 'SH';
  return 'SZ';
}

function quoteMatchesTab(code: string, tab: MarketTab) {
  if (tab === 'star') return code.startsWith('688');
  if (tab === 'gem') return code.startsWith('300') || code.startsWith('301');
  if (tab === 'bj') return code.startsWith('4') || code.startsWith('8') || code.startsWith('92');
  if (tab === 'sh-main') return code.startsWith('6') && !code.startsWith('688');
  if (tab === 'sz-main') return /^(000|001|002|003)/.test(code);
  return true;
}

function compactRow<T extends object>(row: T) {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined && value !== null && value !== '')) as Partial<T>;
}
