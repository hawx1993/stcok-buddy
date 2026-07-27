import { EventEmitter } from 'node:events';
import type {
  MarketBoardRow,
  MarketIndexPeriod,
  MarketIndexSnapshot,
  MarketPageSnapshot,
  MarketQuoteRow,
  MarketTab,
} from '../../../src/shared/types.js';
import { listDailyBars, listLatestMarketRows, listSecurities } from '../market-data/market-data-store.js';
import { pickString } from './format.js';
import {
  fetchEastmoneyClist,
  fetchEastmoneyQuoteRowsByCodes,
  hasValue,
  mergeByCode,
  normalizeIndustryName,
  parseMarketTime,
  shouldUseRemoteMarketData,
  toMarketQuoteRow,
  warnEastmoneyFallback,
  withTimeoutReject,
  sdk,
} from './shared.js';
import { getStoredQuoteRows, upsertQuoteRows } from './quote-store.js';
import { loadSinaIndustryMap } from './industry-provider.js';
import { marketIndexCache } from './market-state.js';
import { getMarketIndices, getCachedMarketIndices, fallbackIndex, fallbackIndices } from './market-indices.js';

type AnyRecord = Record<string, unknown>;

let quoteCache: { rows: MarketQuoteRow[]; updatedAt: number; promise?: Promise<MarketQuoteRow[]> } = {
  rows: [],
  updatedAt: 0,
};
const marketPageEvents = new EventEmitter();
const marketPageCache = new Map<string, { snapshot?: MarketPageSnapshot; refreshing?: Promise<MarketPageSnapshot> }>();
const marketPageIndustryRefreshes = new Map<string, Promise<void>>();

let securitiesIndustryMapPromise: Promise<Map<string, string>> | undefined;
let localSecuritiesIndustryCache: { rows: Map<string, string>; updatedAt: number } | undefined;

const INDUSTRY_CONSTITUENT_CONCURRENCY = 4;
const INDUSTRY_MAP_CACHE_TTL_MS = 30 * 60_000;
const LOCAL_SECURITIES_INDUSTRY_CACHE_TTL_MS = 10 * 60_000;
const EASTMONEY_INDUSTRY_CACHE_TTL_MS = 10 * 60_000;
const FAST_INDUSTRY_ENRICH_TIMEOUT_MS = 1_200;
const eastmoneyIndustryCache = new Map<MarketTab, { rows: Map<string, string>; updatedAt: number }>();
let boardIndustryMapPromise: Promise<Map<string, string>> | undefined;
let boardIndustryMapCache: { rows: Map<string, string>; updatedAt: number } | undefined;

export function onMarketPageSnapshotUpdated(listener: (snapshot: MarketPageSnapshot) => void) {
  marketPageEvents.on('updated', listener);
  return () => marketPageEvents.off('updated', listener);
}

async function loadIndustryMapFromBoardApi(): Promise<Map<string, string>> {
  const cached = boardIndustryMapCache;
  if (cached && Date.now() - cached.updatedAt < INDUSTRY_MAP_CACHE_TTL_MS) return cached.rows;
  if (boardIndustryMapPromise) return boardIndustryMapPromise;

  boardIndustryMapPromise = loadSinaIndustryMap()
    .catch(async (sinaError) => {
      console.warn('[market] sina industry map unavailable, trying stock-sdk', sinaError);
      return loadStockSdkIndustryMap();
    })
    .then((rows) => {
      boardIndustryMapCache = { rows, updatedAt: Date.now() };
      return rows;
    })
    .finally(() => {
      boardIndustryMapPromise = undefined;
    });
  return boardIndustryMapPromise;
}

async function loadStockSdkIndustryMap(): Promise<Map<string, string>> {
  const industries = await sdk.board.industry.list();
  const map = new Map<string, string>();
  let failedBoards = 0;
  for (let start = 0; start < industries.length; start += INDUSTRY_CONSTITUENT_CONCURRENCY) {
    const batch = industries.slice(start, start + INDUSTRY_CONSTITUENT_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (board) => ({
        name: board.name,
        constituents: await sdk.board.industry.constituents(board.code),
      })),
    );
    for (const result of results) {
      if (result.status !== 'fulfilled') {
        failedBoards += 1;
        continue;
      }
      for (const item of result.value.constituents) {
        const code = item.code?.trim();
        if (code && !map.has(code)) map.set(code, result.value.name);
      }
    }
  }
  if (failedBoards) console.warn(`[market] ${failedBoards} industry constituent requests failed`);
  if (!map.size) throw new Error('stock-sdk 行业成分股映射为空');
  return map;
}

async function loadSecuritiesIndustryMap(): Promise<Map<string, string>> {
  const cached = localSecuritiesIndustryCache;
  if (cached && Date.now() - cached.updatedAt < LOCAL_SECURITIES_INDUSTRY_CACHE_TTL_MS) return cached.rows;
  if (!securitiesIndustryMapPromise) {
    securitiesIndustryMapPromise = listSecurities()
      .then((securities) => {
        const rows = new Map(
          securities
            .map((item): [string, string] | undefined => {
              const industry = normalizeIndustryName(item.industry);
              return industry ? [item.symbol, industry] : undefined;
            })
            .filter((item): item is [string, string] => Boolean(item)),
        );
        localSecuritiesIndustryCache = { rows, updatedAt: Date.now() };
        return rows;
      })
      .finally(() => {
        securitiesIndustryMapPromise = undefined;
      });
  }
  return securitiesIndustryMapPromise;
}

async function loadBoardConstituentIndustryMap(): Promise<Map<string, string>> {
  return loadIndustryMapFromBoardApi();
}

async function loadEastmoneyIndustryMap(tab: MarketTab): Promise<Map<string, string>> {
  const cached = eastmoneyIndustryCache.get(tab);
  if (cached && Date.now() - cached.updatedAt < EASTMONEY_INDUSTRY_CACHE_TTL_MS) return cached.rows;
  const fs = marketTabFs(tab);
  if (!fs) return new Map();
  const rows = await fetchEastmoneyClist(fs, 5000, undefined, true);
  const mapped = new Map(
    rows
      .map((row): [string, string] | undefined => {
        const code = pickString(row, ['f12', 'code', 'symbol'])
          ?.replace(/^(sh|sz|bj)/i, '')
          .replace(/^\D+/, '');
        const industry = normalizeIndustryName(pickString(row, ['f100', 'industry']));
        return code && industry ? [code, industry] : undefined;
      })
      .filter((item): item is [string, string] => Boolean(item)),
  );
  eastmoneyIndustryCache.set(tab, { rows: mapped, updatedAt: Date.now() });
  return mapped;
}

async function loadEastmoneyIndustryMapForRows(rows: MarketQuoteRow[]): Promise<Map<string, string>> {
  const codes = rows.filter((row) => !normalizeIndustryName(row.industry)).map((row) => row.code);
  if (!codes.length) return new Map();
  const payloadRows = await fetchEastmoneyQuoteRowsByCodes(codes);
  return new Map(
    payloadRows
      .map((row): [string, string] | undefined => {
        const code = pickString(row, ['f12', 'code', 'symbol'])
          ?.replace(/^(sh|sz|bj)/i, '')
          .replace(/^\D+/, '');
        const industry = normalizeIndustryName(pickString(row, ['f100', 'industry']));
        return code && industry ? [code, industry] : undefined;
      })
      .filter((item): item is [string, string] => Boolean(item)),
  );
}

async function enrichMarketPageRows(rows: MarketQuoteRow[], tab: MarketTab): Promise<MarketQuoteRow[]> {
  if (!rows.length || rows.every((row) => normalizeIndustryName(row.industry))) return rows;
  const [localIndustryMap, eastmoneyIndustryMap, rowIndustryMap, boardIndustryMap] = await Promise.all([
    loadSecuritiesIndustryMap().catch(() => new Map<string, string>()),
    loadEastmoneyIndustryMap(tab).catch(() => new Map<string, string>()),
    loadEastmoneyIndustryMapForRows(rows).catch(() => new Map<string, string>()),
    loadBoardConstituentIndustryMap().catch(() => new Map<string, string>()),
  ]);
  return mergeMarketPageIndustries(rows, [rowIndustryMap, eastmoneyIndustryMap, localIndustryMap, boardIndustryMap]);
}

function mergeMarketPageIndustries(rows: MarketQuoteRow[], industryMaps: Array<Map<string, string>>): MarketQuoteRow[] {
  if (!industryMaps.some((map) => map.size)) return rows;
  let changed = false;
  const enriched = rows.map((row) => {
    const currentIndustry = normalizeIndustryName(row.industry);
    if (currentIndustry) {
      if (currentIndustry !== row.industry) changed = true;
      return currentIndustry === row.industry ? row : { ...row, industry: currentIndustry };
    }
    const industry = industryMaps.map((map) => map.get(row.code)).find((value): value is string => Boolean(value));
    if (!industry) return row;
    changed = true;
    return { ...row, industry };
  });
  return changed ? enriched : rows;
}

function hasMissingMarketPageIndustries(rows: MarketQuoteRow[]) {
  return rows.some((row) => !normalizeIndustryName(row.industry));
}

async function enrichMarketPageRowsFast(rows: MarketQuoteRow[], tab: MarketTab): Promise<MarketQuoteRow[]> {
  if (!rows.length || rows.every((row) => normalizeIndustryName(row.industry))) return rows;
  const [localIndustryMap, rowIndustryMap, eastmoneyIndustryMap] = await Promise.all([
    loadSecuritiesIndustryMap().catch(() => new Map<string, string>()),
    withTimeoutReject(
      loadEastmoneyIndustryMapForRows(rows),
      FAST_INDUSTRY_ENRICH_TIMEOUT_MS,
      '快速个股行业映射加载超时',
    ).catch(() => new Map<string, string>()),
    withTimeoutReject(loadEastmoneyIndustryMap(tab), FAST_INDUSTRY_ENRICH_TIMEOUT_MS, '快速行业映射加载超时').catch(
      () => new Map<string, string>(),
    ),
  ]);
  return mergeMarketPageIndustries(rows, [rowIndustryMap, eastmoneyIndustryMap, localIndustryMap]);
}

function scheduleMarketPageIndustryRefresh(snapshot: MarketPageSnapshot) {
  if (!hasMissingMarketPageIndustries(snapshot.rows)) return;
  const key = marketPageKey(snapshot.tab, snapshot.period ?? '1d');
  if (marketPageIndustryRefreshes.has(key)) return;
  const refreshing = enrichMarketPageRows(snapshot.rows, snapshot.tab)
    .then((rows) => {
      if (rows === snapshot.rows) return;
      const latest = marketPageCache.get(key)?.snapshot;
      const nextSnapshot: MarketPageSnapshot = {
        ...(latest ?? snapshot),
        rows: mergeByCode(latest?.rows ?? snapshot.rows, rows),
        rowOrderSource: 'local',
      };
      marketPageCache.set(key, { snapshot: nextSnapshot });
      marketPageEvents.emit('updated', nextSnapshot);
    })
    .catch((error) => console.warn('[market] industry refresh failed', error))
    .finally(() => {
      marketPageIndustryRefreshes.delete(key);
    });
  marketPageIndustryRefreshes.set(key, refreshing);
}

async function getMarketPageSnapshotCore(
  tab: MarketTab,
  period: MarketIndexPeriod = '1d',
): Promise<MarketPageSnapshot> {
  if (!shouldUseRemoteMarketData()) {
    const snapshot = getCachedMarketPageSnapshot(tab, period);
    if (!snapshot.rows.length || hasSparseQuoteRows(snapshot.rows))
      return getRemoteMarketPageSnapshot(tab, period)
        .then((remote) => {
          const remoteSnapshot = { ...remote, rowOrderSource: 'remote' as const };
          marketPageCache.set(marketPageKey(tab, period), { snapshot: remoteSnapshot });
          return remoteSnapshot.rows.length ? remoteSnapshot : snapshot;
        })
        .catch(() => {
          setTimeout(() => void hydrateLocalMarketPageSnapshot(tab, period), 0);
          return snapshot;
        });
    setTimeout(() => void hydrateLocalMarketPageSnapshot(tab, period), 0);
    return snapshot;
  }
  const snapshot = await getLocalMarketPageSnapshot(tab, period);
  if (!snapshot.rows.length || hasSparseQuoteRows(snapshot.rows))
    return getRemoteMarketPageSnapshot(tab, period)
      .then((remote) => {
        const remoteSnapshot = { ...remote, rowOrderSource: 'remote' as const };
        if (remoteSnapshot.rows.length) marketPageCache.set(marketPageKey(tab, period), { snapshot: remoteSnapshot });
        return remoteSnapshot.rows.length ? remoteSnapshot : snapshot;
      })
      .catch(() => snapshot);
  void refreshMarketPageSnapshot(tab, period).catch((error) =>
    console.warn('[market] background refresh failed', error),
  );
  return snapshot;
}

export async function getMarketPageSnapshot(
  tab: MarketTab,
  period: MarketIndexPeriod = '1d',
): Promise<MarketPageSnapshot> {
  const snapshot = await getMarketPageSnapshotCore(tab, period);
  const rows = await enrichMarketPageRowsFast(snapshot.rows, tab);
  const enrichedSnapshot = rows === snapshot.rows ? snapshot : { ...snapshot, rows };
  if (rows !== snapshot.rows) marketPageCache.set(marketPageKey(tab, period), { snapshot: enrichedSnapshot });
  scheduleMarketPageIndustryRefresh(enrichedSnapshot);
  return enrichedSnapshot;
}

function getCachedMarketPageSnapshot(tab: MarketTab, period: MarketIndexPeriod): MarketPageSnapshot {
  const cached = marketPageCache.get(marketPageKey(tab, period))?.snapshot;
  return {
    tab,
    period,
    updatedAt: cached?.updatedAt ?? new Date().toISOString(),
    indices: marketIndexCache.get(period)?.rows ?? cached?.indices ?? fallbackIndices(period),
    rows: cached?.rows?.length ? cached.rows : cachedQuoteRows(tab),
    boards: [],
    rowOrderSource: cached?.rowOrderSource ?? 'local',
  };
}

async function hydrateLocalMarketPageSnapshot(tab: MarketTab, period: MarketIndexPeriod) {
  const snapshot = await getLocalMarketPageSnapshot(tab, period).catch(() => getCachedMarketPageSnapshot(tab, period));
  const rows = await enrichMarketPageRowsFast(snapshot.rows, tab);
  const enrichedSnapshot = rows === snapshot.rows ? snapshot : { ...snapshot, rows };
  marketPageCache.set(marketPageKey(tab, period), { snapshot: enrichedSnapshot });
  scheduleMarketPageIndustryRefresh(enrichedSnapshot);
  marketPageEvents.emit('updated', enrichedSnapshot);
}

async function getLocalMarketIndices(period: MarketIndexPeriod): Promise<MarketIndexSnapshot[]> {
  const symbols = [
    { db: '000001', code: '000001', name: '上证指数' },
    { db: '399001', code: '399001', name: '深证成指' },
  ];
  const rows = await Promise.all(
    symbols.map(async (item) => {
      const bars = await listDailyBars(item.db, { limit: period === '1d' ? 120 : 60, adjustType: 'qfq' }).catch(
        () => [],
      );
      const minutes = bars.map((bar) => ({
        time: bar.tradeDate,
        timestamp: parseMarketTime(bar.tradeDate),
        open: bar.open,
        close: bar.close,
        high: bar.high,
        low: bar.low,
        volume: bar.volume,
        amount: bar.amount,
        change: bar.change,
        changePercent: bar.changePercent,
        turnoverRate: bar.turnoverRate,
      }));
      const latest = bars.at(-1);
      return latest
        ? {
            code: item.code,
            name: item.name,
            price: latest.close,
            change: latest.change,
            changePercent: latest.changePercent,
            open: latest.open,
            prevClose: latest.change === undefined ? undefined : Number((latest.close - latest.change).toFixed(2)),
            high: latest.high,
            low: latest.low,
            volume: latest.volume,
            amount: latest.amount,
            minutes,
          }
        : fallbackIndex(item.code, period);
    }),
  );
  if (rows.some((row) => row.minutes.length)) marketIndexCache.set(period, { rows });
  else void getCachedMarketIndices(period).then((indices) => emitIndexSnapshots(period, indices));
  return rows;
}

function emitIndexSnapshots(period: MarketIndexPeriod, indices: MarketIndexSnapshot[]) {
  for (const tab of tabsWithCachedSnapshots(period)) {
    const key = marketPageKey(tab, period);
    const cached = marketPageCache.get(key)?.snapshot ?? getCachedMarketPageSnapshot(tab, period);
    const snapshot = { ...cached, indices };
    marketPageCache.set(key, { snapshot });
    marketPageEvents.emit('updated', snapshot);
  }
}

function tabsWithCachedSnapshots(period: MarketIndexPeriod): MarketTab[] {
  const prefix = `:${period}`;
  return [...marketPageCache.keys()]
    .filter((key) => key.endsWith(prefix))
    .map((key) => key.slice(0, -prefix.length) as MarketTab);
}

async function getRemoteMarketPageSnapshot(tab: MarketTab, period: MarketIndexPeriod): Promise<MarketPageSnapshot> {
  const indices = await getMarketIndices(period)
    .then((fresh) => {
      if (fresh.length) marketIndexCache.set(period, { rows: fresh });
      return fresh;
    })
    .catch(() => []);
  const rows = await getRemoteMarketQuotes(tab);
  if (rows.length) upsertQuoteRows(rows, `market:${tab}`);
  return {
    tab,
    period,
    updatedAt: new Date().toISOString(),
    indices: indices.length ? indices : (marketIndexCache.get(period)?.rows ?? fallbackIndices(period)),
    rows,
    boards: [],
    rowOrderSource: 'remote',
  };
}

async function getLocalMarketPageSnapshot(tab: MarketTab, period: MarketIndexPeriod): Promise<MarketPageSnapshot> {
  const cached = marketPageCache.get(marketPageKey(tab, period))?.snapshot;
  const localRows = (
    await listLatestMarketRows()
      .then((rows) => rows.map(toMarketQuoteRow))
      .catch(() => [])
  )
    .filter((row) => quoteMatchesTab(row.code, tab))
    .sort(
      (a, b) =>
        Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0) || String(a.code).localeCompare(String(b.code)),
    );
  const persistedRows = cachedQuoteRows(tab);
  const rows = localRows.length
    ? mergeQuoteRows(localRows, quoteCache.rows.length ? quoteCache.rows : getStoredQuoteRows())
    : cached?.rows?.length
      ? cached.rows
      : persistedRows;
  if (hasSparseQuoteRows(rows)) return getRemoteMarketPageSnapshot(tab, period);
  const indices = marketIndexCache.get(period)?.rows ?? cached?.indices ?? (await getLocalMarketIndices(period));
  const snapshot: MarketPageSnapshot = {
    tab,
    period,
    updatedAt: cached?.updatedAt ?? new Date().toISOString(),
    indices,
    rows,
    boards: [],
    rowOrderSource: 'local',
  };
  const key = marketPageKey(tab, period);
  const entry = marketPageCache.get(key);
  marketPageCache.set(key, { ...entry, snapshot });
  return snapshot;
}

async function refreshMarketPageSnapshot(tab: MarketTab, period: MarketIndexPeriod) {
  const key = marketPageKey(tab, period);
  const entry = marketPageCache.get(key) ?? {};
  if (entry.refreshing) return entry.refreshing;
  const refreshing = getRemoteMarketPageSnapshot(tab, period)
    .then(async (snapshot) => {
      const rows = await enrichMarketPageRowsFast(snapshot.rows, tab);
      const enrichedSnapshot = rows === snapshot.rows ? snapshot : { ...snapshot, rows };
      marketPageCache.set(key, { snapshot: enrichedSnapshot });
      scheduleMarketPageIndustryRefresh(enrichedSnapshot);
      marketPageEvents.emit('updated', enrichedSnapshot);
      return enrichedSnapshot;
    })
    .finally(() => {
      const latest = marketPageCache.get(key);
      if (latest?.refreshing === refreshing) marketPageCache.set(key, { snapshot: latest.snapshot });
    });
  marketPageCache.set(key, entry.snapshot ? { ...entry, refreshing } : { refreshing });
  return refreshing;
}

function marketPageKey(tab: MarketTab, period: MarketIndexPeriod) {
  return `${tab}:${period}`;
}

function cachedQuoteRows(tab: MarketTab) {
  const rows = quoteCache.rows.length ? quoteCache.rows : getStoredQuoteRows();
  return rows
    .filter((row) => quoteMatchesTab(row.code, tab))
    .sort(
      (a, b) =>
        Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0) || String(a.code).localeCompare(String(b.code)),
    );
}

let eastmoneyClistWarned = false;
const eastmoneyClistDisabledUntil = new Map<string, number>();

async function getRemoteMarketQuotes(tab: MarketTab): Promise<MarketQuoteRow[]> {
  const cachedRows = quoteCache.rows.filter((row) => quoteMatchesTab(row.code, tab));
  if (needsSpotQuotePatch(tab) && (!cachedRows.length || hasSparseQuoteRows(cachedRows))) {
    const rows = await fetchSpecialMarketQuoteRows([tab]).catch(() => []);
    if (rows.length) {
      quoteCache = { rows: mergeByCode(quoteCache.rows, rows), updatedAt: Date.now() };
      upsertQuoteRows(rows, `market:${tab}`);
    }
    return quoteCache.rows
      .filter((row) => quoteMatchesTab(row.code, tab))
      .sort(
        (a, b) =>
          Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0) || String(a.code).localeCompare(String(b.code)),
      );
  }
  const quotes = await refreshQuoteCache();
  return quotes
    .filter((row) => quoteMatchesTab(row.code, tab))
    .sort(
      (a, b) =>
        Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0) || String(a.code).localeCompare(String(b.code)),
    );
}

export async function getMarketQuotes(tab: MarketTab): Promise<MarketQuoteRow[]> {
  const quotes = await getAllMarketQuoteRows();
  return quotes
    .filter((row) => quoteMatchesTab(row.code, tab))
    .sort(
      (a, b) =>
        Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0) || String(a.code).localeCompare(String(b.code)),
    );
}

export async function getAllMarketQuoteRows(): Promise<MarketQuoteRow[]> {
  const local = await listLatestMarketRows()
    .then((rows) => rows.map(toMarketQuoteRow))
    .catch(() => []);
  if (local.length) {
    void refreshQuoteCache();
    return mergeQuoteRows(local, quoteCache.rows.length ? quoteCache.rows : getStoredQuoteRows());
  }
  if (quoteCache.rows.length) {
    void refreshQuoteCache();
    return quoteCache.rows;
  }
  const stored = getStoredQuoteRows();
  if (stored.length) {
    void refreshQuoteCache();
    return stored;
  }
  return refreshQuoteCache();
}

export async function refreshQuoteCache() {
  if (quoteCache.promise) return quoteCache.promise;
  if (quoteCache.rows.length && Date.now() - quoteCache.updatedAt < 4_500) return quoteCache.rows;
  quoteCache.promise = fetchRemoteQuoteRows()
    .then((rows) => {
      quoteCache = { rows: mergeByCode(quoteCache.rows, rows), updatedAt: Date.now() };
      upsertQuoteRows(quoteCache.rows, 'stock-sdk');
      return quoteCache.rows;
    })
    .catch(() => quoteCache.rows)
    .finally(() => {
      quoteCache.promise = undefined;
    }) as Promise<MarketQuoteRow[]>;
  return quoteCache.promise;
}

async function fetchRemoteQuoteRows() {
  const sdkRows = await withTimeoutReject(
    (
      sdk as unknown as { quoteService: { getAllAShareQuotes(): Promise<unknown[]> } }
    ).quoteService.getAllAShareQuotes(),
    10_000,
    'Tencent quotes timeout',
  )
    .then((rows) =>
      mergeByCode(
        quoteCache.rows,
        (rows as AnyRecord[]).map(toMarketQuoteRow).filter((row) => row.code),
      ),
    )
    .catch(() => quoteCache.rows);
  const sparseTabs = (['sh-main', 'sz-main', 'bj', 'gem', 'star'] as const).filter((tab) =>
    hasSparseQuoteRows(sdkRows.filter((row) => quoteMatchesTab(row.code, tab))),
  );
  if (!sparseTabs.length) return sdkRows;

  const eastmoneyRows = await fetchSpecialMarketQuoteRows(sparseTabs).catch(() => []);
  return mergeByCode(sdkRows, eastmoneyRows);
}

async function fetchSpecialMarketQuoteRows(tabs: MarketTab[]) {
  const sdkRows = await Promise.all(tabs.map(fetchSdkMarketQuoteRows))
    .then((rows) => rows.flat())
    .catch(() => []);
  if (sdkRows.length && !hasSparseQuoteMetrics(sdkRows)) return sdkRows;
  return fetchEastmoneyQuoteRows(tabs);
}

async function fetchSdkMarketQuoteRows(tab: MarketTab) {
  const market = marketTabSdkMarket(tab);
  if (!market) return [];
  if (tab === 'sz-main') {
    const service = (
      sdk as unknown as {
        quoteService: {
          getAShareCodeList(options?: { market?: string }): Promise<string[]>;
          getAllQuotesByCodes(
            codes: string[],
            options?: { batchSize?: number; concurrency?: number },
          ): Promise<unknown[]>;
        };
      }
    ).quoteService;
    const codes = (
      await withTimeoutReject(service.getAShareCodeList({ market }), 5_000, `${market} code list timeout`)
    ).filter((code) => quoteMatchesTab(code.replace(/^(sh|sz|bj)/i, ''), tab));
    return withTimeoutReject(
      service.getAllQuotesByCodes(codes, { batchSize: 500, concurrency: 6 }),
      5_000,
      `${market} quotes timeout`,
    ).then((rows) => (rows as AnyRecord[]).map(toMarketQuoteRow).filter((row) => row.code));
  }
  return withTimeoutReject(
    (
      sdk as unknown as {
        quoteService: {
          getAllAShareQuotes(options?: {
            market?: string;
            batchSize?: number;
            concurrency?: number;
          }): Promise<unknown[]>;
        };
      }
    ).quoteService.getAllAShareQuotes({ market, batchSize: 500, concurrency: 6 }),
    5_000,
    `${market} quotes timeout`,
  ).then((rows) => (rows as AnyRecord[]).map(toMarketQuoteRow).filter((row) => row.code));
}

async function fetchEastmoneyQuoteRows(tabs: MarketTab[]) {
  const rows = await Promise.all(
    tabs.map(async (tab) => {
      const fs = marketTabFs(tab);
      if (!fs) return [];
      return fetchEastmoneyClist(fs, 5000).then((items) => items.map(toMarketQuoteRow).filter((row) => row.code));
    }),
  );
  if (rows.some((items) => items.length))
    warnEastmoneyFallback('quotes', new Error('stock-sdk sparse market quote metrics'));
  return rows.flat();
}

function marketTabFs(tab: MarketTab) {
  if (tab === 'sh-main') return 'm:1 t:2,m:1 t:1';
  if (tab === 'sz-main') return 'm:0 t:6,m:0 t:13';
  if (tab === 'bj') return 'm:0 t:81 s:2048';
  if (tab === 'gem') return 'm:0 t:80';
  if (tab === 'star') return 'm:1 t:23';
  return '';
}

function marketTabSdkMarket(tab: MarketTab) {
  if (tab === 'sh-main') return 'sh';
  if (tab === 'sz-main') return 'sz';
  if (tab === 'bj') return 'bj';
  if (tab === 'gem') return 'cy';
  if (tab === 'star') return 'kc';
  return undefined;
}

function needsSpotQuotePatch(_tab: MarketTab) {
  return true;
}

function mergeQuoteRows(local: MarketQuoteRow[], live: MarketQuoteRow[]) {
  if (!live.length) return local;
  return mergeByCode(local, live);
}

export function quoteMatchesTab(code: string, tab: MarketTab) {
  if (tab === 'star') return code.startsWith('688');
  if (tab === 'gem') return code.startsWith('300') || code.startsWith('301');
  if (tab === 'bj') return code.startsWith('4') || code.startsWith('8') || code.startsWith('92');
  if (tab === 'sh-main') return code.startsWith('6') && !code.startsWith('688');
  if (tab === 'sz-main') return /^(000|001|002|003)/.test(code);
  return true;
}

function hasQuoteMetrics(row: MarketQuoteRow | MarketBoardRow) {
  return (
    hasValue(row.price) &&
    hasValue(row.changePercent) &&
    hasValue(row.turnoverRate) &&
    hasValue(row.volume) &&
    hasValue(row.amount)
  );
}

function hasSparseQuoteMetrics(rows: MarketQuoteRow[]) {
  return rows.length > 0 && rows.filter(hasQuoteMetrics).length / rows.length < 0.8;
}

function hasSparseQuoteRows(rows: MarketQuoteRow[]) {
  return hasSparseQuoteMetrics(rows) || rows.some((row) => !row.name || row.name === row.code);
}
