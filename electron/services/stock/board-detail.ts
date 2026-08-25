import type {
  BoardDetail,
  KlinePoint,
  MarketBoardRow,
  MarketQuoteRow,
  MarketIndexPeriod,
} from '../../../src/shared/types.js';
import {
  listBoardConstituents,
  listLatestMarketRows,
  listMarketBoards,
  listSecurities,
  readBoardDetail,
  replaceBoardConstituents,
  upsertMarketBoards,
  writeBoardDetail,
} from '../stock-db/market-data-store.js';
import {
  aggregateBaiduBoardKline,
  aggregateLocalBoardKline,
  aggregateRemoteBoardKline,
  getAStockBoardKline,
} from './board-detail-kline.js';
export { getBaiduStockKline } from './board-detail-kline.js';
import { formatMoney, formatNumber, formatPercent } from './format.js';
import { getHithinkBoardConstituents } from './hithink-board-heat.js';
import { normalizeASymbol } from './symbols.js';
import {
  BOARD_CONSTITUENT_SCAN_LIMIT,
  BOARD_SCAN_BUDGET_MS,
  BOARD_SCAN_CONCURRENCY,
  BOARD_SDK_OUTER_TIMEOUT,
  BOARD_SDK_REQUEST_TIMEOUT,
  type BoardKind,
  type BoardApi,
  type IndexKlinePeriod,
  aggregateKline,
  boardKindCache,
  boardNamesMatch,
  fetchEastmoneyClist,
  getCachedMarketBoardRows,
  marketBoardsCache,
  normalizeBoardName,
  normalizeAmount,
  orderBoardApis,
  searchBoardNameCache,
  shouldUseRemoteMarketData,
  toKlinePoint,
  toMarketQuoteRow,
  withTimeoutReject,
  sdk,
} from './shared.js';
let boardApisLoadingPromise: Promise<void> | undefined;

type AnyRecord = Record<string, unknown>;
type TStockBoardMembershipPayload = { data?: { diff?: unknown[] | Record<string, unknown> } };

function parseStockBoardMembershipPayload(payload: TStockBoardMembershipPayload) {
  const diff = payload.data?.diff ?? [];
  const items = Array.isArray(diff) ? diff : Object.values(diff);
  return items
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      code: String(item.f12 ?? '').toUpperCase(),
      name: String(item.f14 ?? ''),
      changePercent: toNullableNumber(item.f3),
      leadStock: String(item.f128 ?? ''),
    }))
    .filter((item) => /^BK\d+$/i.test(item.code) && item.name);
}

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function refreshBoardDetailForHeat(symbol: string, boardName?: string): Promise<BoardDetail> {
  const cacheKey = resolveBoardDetailLookupKey(symbol, boardName);
  const detail = await getRemoteBoardDetail(cacheKey || symbol || boardName || '', true, boardName);
  if (detail.constituents?.length) {
    const updatedAt = new Date().toISOString();
    await writeBoardDetail({ detail, updatedAt });
    await persistBoardDetail(detail, updatedAt);
    return detail;
  }
  // 远程接口未返回成分股时，回退本地 DuckDB 已持久化的真实成分股，避免热度链路整体报错
  // 注意远程失败时 detail.code 可能退化为板块名称，本地查询必须使用 BK 编码
  const persistedCode = [detail.code, cacheKey].find((code) => /^BK\d+$/i.test(code)) ?? '';
  const persisted = await getPersistedBoardDetailForHeat(persistedCode, detail.name || boardName);
  if (persisted?.constituents?.length) {
    // 命中缓存时同步成分股到 board_constituents 表，保证本地热度聚合可读取
    await persistBoardDetail(persisted, new Date().toISOString());
    return persisted;
  }
  throw new Error('板块接口未返回完整成分股数据，本地也暂无缓存成分股');
}

async function getPersistedBoardDetailForHeat(boardCode: string, boardName?: string): Promise<BoardDetail | undefined> {
  if (!boardCode) return undefined;
  const cached = await readBoardDetail(boardCode).catch(() => undefined);
  if (cached?.detail.constituents?.length) return cached.detail;
  const rows = await listBoardConstituents(boardCode).catch(() => []);
  if (!rows.length) return cached?.detail;
  return {
    code: boardCode,
    name: cached?.detail.name || boardName || boardCode,
    changePercent: cached?.detail.changePercent,
    kline: cached?.detail.kline ?? [],
    constituents: rows.map((row) => ({
      code: row.stockCode,
      name: row.stockName,
      price: '--',
      changePercent: '--',
      marketCap: '--',
      mainNetInflow: '--',
      turnoverRate: '--',
      volume: '--',
      amount: '--',
      turnover: '--',
    })),
  };
}

type TBoardQuoteRow = Pick<MarketBoardRow, 'code' | 'name' | 'changePercent'>;

async function findBoardQuote(symbol: string, boardName?: string): Promise<TBoardQuoteRow | undefined> {
  const boardRows = marketBoardsCache.rows.length ? marketBoardsCache.rows : await getCachedMarketBoardRows(true);
  const find = (rows: TBoardQuoteRow[]) => rows.find((item) => item.code === symbol || item.name === boardName);
  const remoteBoard = find(boardRows);
  if (remoteBoard) return remoteBoard;
  return find(await listMarketBoards());
}

export async function getBoardDetail(symbol: string, forceRefresh = false, boardName?: string): Promise<BoardDetail> {
  const cacheKey = resolveBoardDetailLookupKey(symbol, boardName);
  const requestSymbol = cacheKey || boardName || symbol;
  const refreshRemote = async (localFallback?: BoardDetail) => {
    const detail = await getRemoteBoardDetail(requestSymbol, !localFallback, boardName, localFallback);
    if (detail.kline?.length || detail.constituents?.length) {
      const updatedAt = new Date().toISOString();
      void writeBoardDetail({ detail, updatedAt });
      void persistBoardDetail(detail, updatedAt);
    }
    return detail;
  };

  if (forceRefresh) {
    const detail = await refreshRemote();
    if (!detail.kline?.length && !detail.constituents?.length) throw new Error('板块接口暂无数据');
    return detail;
  }

  const cached = cacheKey
    ? ((await readBoardDetail(cacheKey).catch(() => undefined)) ??
      (symbol && symbol !== cacheKey ? await readBoardDetail(symbol).catch(() => undefined) : undefined))
    : undefined;
  const cachedName = cached?.detail.name;
  if (cached?.detail.kline?.length || cached?.detail.constituents?.length) {
    const boardQuote = await findBoardQuote(cacheKey, cachedName ?? boardName);
    const cachedDetail =
      boardQuote?.changePercent === undefined
        ? cached.detail
        : { ...cached.detail, changePercent: formatPercent(boardQuote.changePercent) };
    void refreshRemote(cachedDetail).catch((error) =>
      console.warn(
        '[market] board detail background refresh failed',
        symbol,
        error instanceof Error ? error.message : error,
      ),
    );
    return cachedDetail;
  }

  // ponytail: timeout local scan — scanBoardMembership can run 8s+
  const localDetail = await withTimeoutReject(
    getLocalBoardDetail(cacheKey, cachedName ?? boardName),
    6_000,
    '本地板块详情加载超时',
  ).catch(() => undefined);

  if (localDetail?.constituents?.length) {
    void refreshRemote(localDetail).catch((error) =>
      console.warn(
        '[market] board detail background refresh failed',
        symbol,
        error instanceof Error ? error.message : error,
      ),
    );
    return localDetail;
  }

  try {
    return await refreshRemote(localDetail);
  } catch (error) {
    console.warn('[market] board detail unavailable', symbol, error instanceof Error ? error.message : error);
    return cached?.detail ?? localDetail ?? { code: cacheKey, name: boardName ?? symbol, kline: [], constituents: [] };
  }
}

async function completeBoardDetail(detail: BoardDetail): Promise<BoardDetail> {
  const constituents = shouldUseRemoteMarketData()
    ? await enrichBoardConstituents(detail.constituents ?? [])
    : (detail.constituents ?? []);
  const kline = detail.kline?.length
    ? detail.kline
    : constituents.length
      ? await aggregateRemoteBoardKline(constituents.map((row) => row.code)).catch(() => [])
      : [];
  return { ...detail, kline, constituents };
}

async function enrichBoardConstituents(
  rows: NonNullable<BoardDetail['constituents']>,
): Promise<NonNullable<BoardDetail['constituents']>> {
  if (!rows.length) return rows;
  const [latestRows, fundFlowByCode] = await Promise.all([
    listLatestMarketRows().catch(() => []),
    loadStockFundFlowMap().catch(() => new Map<string, number>()),
  ]);
  const byCode = new Map(latestRows.map((row) => [normalizeASymbol(row.code), row]));
  return rows.map((row) => {
    const code = normalizeASymbol(row.code);
    const latest = byCode.get(code);
    const mainNetInflow = fundFlowByCode.get(code);
    if (!latest && mainNetInflow === undefined) return row;
    const turnoverRate = latest?.turnoverRate === undefined ? row.turnoverRate : `${formatNumber(latest.turnoverRate)}%`;
    const turnover = turnoverRate === undefined ? row.turnover : String(turnoverRate);
    return {
      ...row,
      price: latest?.price ?? row.price ?? '--',
      changePercent:
        latest?.changePercent === undefined ? (row.changePercent ?? '--') : formatPercent(latest.changePercent),
      marketCap: latest?.marketCap === undefined ? row.marketCap : formatMarketCap(latest.marketCap),
      mainNetInflow: mainNetInflow === undefined ? row.mainNetInflow : formatMoney(mainNetInflow),
      turnoverRate,
      volume: latest?.volume === undefined ? row.volume : formatVolume(latest.volume),
      amount: latest?.amount === undefined ? row.amount : formatMoney(latest.amount),
      turnover,
    };
  });
}

async function loadStockFundFlowMap(): Promise<Map<string, number>> {
  const rows = await sdk.fundFlow.rank({ indicator: 'today' });
  const entries = rows.flatMap((row): Array<[string, number]> => {
    const code = normalizeASymbol(readFundFlowCode(row));
    const flow = readMainNetInflow(row);
    if (!code || flow === undefined) return [];
    return [[code, flow]];
  });
  return new Map(entries);
}

function readFundFlowCode(row: unknown): string {
  const record = toRecord(row);
  return String(record.code ?? record.symbol ?? '').replace(/^\D+/, '');
}

function readMainNetInflow(row: unknown): number | undefined {
  const record = toRecord(row);
  return toFiniteNumber(record.mainNetInflow ?? record.netInflow ?? record.today ?? record.mainNetAmount);
}

function formatMarketCap(value: unknown): string {
  const number = toFiniteNumber(value);
  if (number === undefined) return '--';
  const normalized = number < 100_000 ? number * 100_000_000 : number;
  return `${(normalized / 100_000_000).toFixed(1)}亿`;
}

function formatVolume(value: unknown): string {
  const number = toFiniteNumber(value);
  if (number === undefined) return '--';
  if (number >= 100_000_000) return `${(number / 100_000_000).toFixed(2)}亿手`;
  if (number >= 10_000) return `${(number / 10_000).toFixed(2)}万手`;
  return `${number.toFixed(0)}手`;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || text === '--') return undefined;
  const unit = text.includes('亿') ? 100_000_000 : text.includes('万') ? 10_000 : 1;
  const parsed = Number.parseFloat(text.replace(/[,%+，]/g, '').replace(/[亿元万]/g, ''));
  return Number.isFinite(parsed) ? parsed * unit : undefined;
}

function toRecord(row: unknown): AnyRecord {
  return row && typeof row === 'object' ? (row as AnyRecord) : {};
}

async function getRemoteBoardDetail(
  symbol: string,
  skipLocalFallback = false,
  boardName?: string,
  precomputedLocal?: BoardDetail,
): Promise<BoardDetail> {
  const canonicalSymbol = normalizeBoardCode(symbol);

  // ponytail: use cached boards; fall back to remote only if cache is empty
  const boards = marketBoardsCache.rows.length
    ? marketBoardsCache.rows
    : await withTimeoutReject(getCachedMarketBoardRows(), BOARD_SDK_REQUEST_TIMEOUT, '板块列表加载超时').catch(
        () => [],
      );
  const searchName = searchBoardNameCache.get(symbol) ?? searchBoardNameCache.get(canonicalSymbol);
  const board = boards.find(
    (item) =>
      item.code === canonicalSymbol ||
      item.code === symbol ||
      item.name === symbol ||
      item.name === searchName ||
      item.name === boardName,
  ) ?? { code: canonicalSymbol, name: searchName ?? boardName ?? symbol, changePercent: undefined };
  const targets = getBoardDetailTargets(canonicalSymbol, board.name, boards, symbol, boardName);
  // ponytail: longer outer timeout so SDK loop has time to try each target
  const [kline, sdkRows] = await Promise.all([
    withTimeoutReject(
      fetchSdkBoardSeries(board.code, '1d', board.name, targets),
      BOARD_SDK_OUTER_TIMEOUT,
      '板块K线加载超时',
    ).catch(() => []),
    withTimeoutReject(
      getSdkBoardConstituents(board.code, board.name, targets),
      BOARD_SDK_OUTER_TIMEOUT,
      '板块成分股加载超时',
    ).catch(() => []),
  ]);
  const hithinkRows = sdkRows.length ? [] : await firstHithinkBoardConstituentsFromTargets(targets).catch(() => []);
  const fallbackRows = sdkRows.length || hithinkRows.length ? [] : await firstBoardConstituentsFromTargets(targets).catch(() => []);
  const fallbackKline = kline.length ? [] : await firstBoardKlineFromTargets(targets).catch(() => []);
  const baseConstituents = sdkRows.length ? sdkRows : hithinkRows.length ? hithinkRows : fallbackRows;
  // ponytail: reuse precomputed local detail instead of re-running expensive scan
  const localDetail = skipLocalFallback
    ? undefined
    : (precomputedLocal ??
      (await withTimeoutReject(getLocalBoardDetail(board.code), 5_000, '本地板块详情加载超时').catch(() => undefined)));
  const constituents = baseConstituents.length ? await enrichBoardConstituents(baseConstituents) : [];
  const mergedConstituents = constituents.length ? constituents : (localDetail?.constituents ?? []);
  const mergedKline = kline.length ? kline : fallbackKline.length ? fallbackKline : (localDetail?.kline ?? []);
  return {
    code: board.code,
    name: board.name,
    changePercent:
      board.changePercent === undefined ? (localDetail?.changePercent ?? '--') : formatPercent(board.changePercent),
    kline: mergedKline,
    constituents: mergedConstituents,
  };
}

function getBoardDetailTargets(
  symbol: string,
  boardName?: string,
  boards = marketBoardsCache.rows,
  ...aliases: Array<string | undefined>
): string[] {
  const canonicalSymbol = normalizeBoardCode(symbol);
  const selected = boards.find(
    (item) =>
      item.code === canonicalSymbol ||
      item.code === symbol ||
      item.name === symbol ||
      item.name === boardName ||
      aliases.includes(item.code) ||
      aliases.includes(item.name),
  );
  const normalized = normalizeBoardName(boardName ?? selected?.name ?? symbol);
  const siblings = normalized ? boards.filter((item) => normalizeBoardName(item.name) === normalized) : [];
  return [
    ...new Set(
      [
        selected?.code,
        selected?.name,
        canonicalSymbol,
        symbol,
        boardName,
        ...aliases,
        ...siblings.flatMap((item) => [item.code, item.name]),
      ].filter(Boolean),
    ),
  ] as string[];
}

export function resolveBoardDetailLookupKey(symbol: string, boardName?: string): string {
  const normalizedSymbol = normalizeBoardCode(symbol);
  if (normalizedSymbol) return normalizedSymbol;
  if (!boardName) return normalizedSymbol;
  const directMatch = marketBoardsCache.rows.find((item) => item.name === boardName);
  if (directMatch) return directMatch.code;
  const normalizedName = normalizeBoardName(boardName);
  return (
    marketBoardsCache.rows.find((item) => normalizeBoardName(item.name) === normalizedName)?.code ?? normalizedSymbol
  );
}

function normalizeBoardCode(value: string) {
  const code = value.trim().toUpperCase();
  return /^\d{4}$/.test(code) ? `BK${code}` : code;
}

async function persistBoardDetail(detail: BoardDetail, updatedAt: string) {
  const changePercent =
    detail.changePercent === undefined || detail.changePercent === '--'
      ? undefined
      : Number.parseFloat(detail.changePercent);
  await upsertMarketBoards([
    {
      code: detail.code,
      name: detail.name,
      kind: boardKindCache.get(detail.code),
      changePercent: Number.isFinite(changePercent as number) ? (changePercent as number) : undefined,
      source: 'stock-sdk',
      updatedAt,
    },
  ]);
  if (detail.constituents?.length) {
    await replaceBoardConstituents(
      detail.code,
      detail.constituents.map((row, index) => ({
        boardCode: detail.code,
        stockCode: row.code,
        stockName: row.name,
        position: index,
        updatedAt,
      })),
    );
  }
}

async function firstBoardConstituentsFromTargets(targets: string[]): Promise<NonNullable<BoardDetail['constituents']>> {
  for (const target of targets) {
    const rows = await getEastmoneyBoardConstituents(target).catch(() => []);
    if (rows.length) return rows;
  }
  return [];
}

async function firstHithinkBoardConstituentsFromTargets(
  targets: string[],
): Promise<NonNullable<BoardDetail['constituents']>> {
  for (const target of targets) {
    const rows = await getHithinkBoardConstituents(target).catch(() => []);
    if (rows.length) return rows;
  }
  return [];
}

async function firstBoardKlineFromTargets(targets: string[]): Promise<KlinePoint[]> {
  for (const target of targets) {
    const rows = await getAStockBoardKline(target, '1d').catch(() => []);
    if (rows.length) return rows;
  }
  return [];
}

async function getSdkBoardConstituents(
  symbol: string,
  boardName: string,
  targets = getBoardDetailTargets(symbol, boardName),
): Promise<NonNullable<BoardDetail['constituents']>> {
  const apis = await getBoardApis(symbol, boardName);
  const kind = boardKindCache.get(symbol);

  // ponytail: kind unknown — try both APIs in parallel on first target to discover fast
  if (!kind && targets.length) {
    const firstTarget = targets[0];
    const [industryRows, conceptRows] = await Promise.all([
      withTimeoutReject(
        sdk.board.industry.constituents(firstTarget),
        BOARD_SDK_REQUEST_TIMEOUT,
        '行业成分股加载超时',
      ).catch(() => []),
      withTimeoutReject(
        sdk.board.concept.constituents(firstTarget),
        BOARD_SDK_REQUEST_TIMEOUT,
        '概念成分股加载超时',
      ).catch(() => []),
    ]);
    const rows = industryRows.length ? industryRows : conceptRows;
    const discoveredKind: BoardKind = industryRows.length ? 'industry' : 'concept';
    if (rows.length) {
      boardKindCache.set(symbol, discoveredKind);
      return rows.map(toBoardConstituent);
    }
    // ponytail: first target failed with both APIs — try remaining targets with the preferred order
    const orderedApis = orderBoardApis(undefined);
    for (const target of targets.slice(1)) {
      for (const board of orderedApis) {
        try {
          const result = await withTimeoutReject(
            board.constituents(target),
            BOARD_SDK_REQUEST_TIMEOUT,
            '板块成分股加载超时',
          );
          if (result.length) {
            const resultKind = board === sdk.board.industry ? 'industry' : 'concept';
            boardKindCache.set(symbol, resultKind);
            return result.map(toBoardConstituent);
          }
        } catch {
          /* try next */
        }
      }
    }
    return [];
  }

  // ponytail: kind known — try preferred API first for each target
  for (const board of apis) {
    for (const target of targets) {
      try {
        const rows = await withTimeoutReject(
          board.constituents(target),
          BOARD_SDK_REQUEST_TIMEOUT,
          '板块成分股加载超时',
        );
        if (rows.length) return rows.map(toBoardConstituent);
      } catch {
        // Try name/code and the other board namespace, then the real-data HTTP fallback.
      }
    }
  }
  return [];
}

async function getBoardApis(symbol: string, boardName?: string): Promise<BoardApi[]> {
  // ponytail: check cache first — downloading all boards just to find one board's type is wasteful
  const cachedKind = boardKindCache.get(symbol);
  if (cachedKind) return orderBoardApis(cachedKind);

  // Try to infer kind from already-cached board rows
  const knownBoard = marketBoardsCache.rows.find((row) => row.code === symbol || row.name === boardName);
  const inferredKind = (knownBoard as unknown as AnyRecord)?.kind as BoardKind | undefined;
  if (inferredKind) {
    boardKindCache.set(symbol, inferredKind);
    return orderBoardApis(inferredKind);
  }

  // ponytail: dedup concurrent calls — only one full list download at a time
  if (boardApisLoadingPromise) await boardApisLoadingPromise;
  const cachedAfterWait = boardKindCache.get(symbol);
  if (cachedAfterWait) return orderBoardApis(cachedAfterWait);

  boardApisLoadingPromise = (async () => {
    const [industries, concepts] = await Promise.allSettled([
      withTimeoutReject(sdk.board.industry.list(), BOARD_SDK_REQUEST_TIMEOUT, '行业板块列表加载超时'),
      withTimeoutReject(sdk.board.concept.list(), BOARD_SDK_REQUEST_TIMEOUT, '概念板块列表加载超时'),
    ]);
    const industryRows = industries.status === 'fulfilled' ? industries.value : [];
    const conceptRows = concepts.status === 'fulfilled' ? concepts.value : [];
    for (const item of industryRows) boardKindCache.set(item.code, 'industry');
    for (const item of conceptRows) boardKindCache.set(item.code, 'concept');
  })();

  try {
    await boardApisLoadingPromise;
  } finally {
    boardApisLoadingPromise = undefined;
  }

  const kind =
    boardKindCache.get(symbol) ??
    ((marketBoardsCache.rows.find((row) => row.code === symbol || row.name === boardName) as unknown as AnyRecord)
      ?.kind as BoardKind | undefined);
  if (kind) boardKindCache.set(symbol, kind);
  return orderBoardApis(kind);
}

async function getEastmoneyBoardConstituents(symbol: string): Promise<NonNullable<BoardDetail['constituents']>> {
  if (!/^BK\d+/i.test(symbol)) return [];
  // ponytail: force=true bypasses rate-limit cooldown for user-initiated fetches; try primary then CDN
  for (const endpoint of [
    'https://push2.eastmoney.com/api/qt/clist/get',
    'https://29.push2.eastmoney.com/api/qt/clist/get',
  ]) {
    try {
      const rows = await fetchEastmoneyClist(`b:${symbol}`, 500, endpoint, true);
      return rows.map((row) => toBoardConstituent(toMarketQuoteRow(row))).filter((row) => row.code && row.name);
    } catch {
      /* try next endpoint */
    }
  }
  return [];
}

function toBoardConstituent(item: {
  code?: string;
  symbol?: string;
  name?: string;
  price?: unknown;
  changePercent?: unknown;
  amount?: unknown;
  turnover?: unknown;
  turnoverRate?: unknown;
  marketCap?: unknown;
  volume?: unknown;
}): NonNullable<BoardDetail['constituents']>[number] {
  const code = String(item.code ?? item.symbol ?? '')
    .replace(/^(sh|sz|bj)/i, '')
    .replace(/^\D+/, '');
  return {
    code,
    name: String(item.name ?? code),
    price: item.price === null || item.price === undefined ? '--' : formatNumber(item.price),
    changePercent:
      item.changePercent === null || item.changePercent === undefined ? '--' : formatPercent(item.changePercent),
    marketCap: item.marketCap === null || item.marketCap === undefined ? '--' : formatMarketCap(item.marketCap),
    turnoverRate:
      item.turnoverRate === null || item.turnoverRate === undefined ? '--' : `${formatNumber(item.turnoverRate)}%`,
    volume: item.volume === null || item.volume === undefined ? '--' : formatVolume(item.volume),
    amount: item.amount === null || item.amount === undefined ? '--' : formatMoney(item.amount),
    turnover:
      item.turnoverRate === null || item.turnoverRate === undefined
        ? item.turnover === undefined
          ? '--'
          : String(item.turnover)
        : `${formatNumber(item.turnoverRate)}%`,
  };
}

async function getLocalBoardDetail(symbol: string, fallbackName?: string): Promise<BoardDetail> {
  const boardQuote = await findBoardQuote(symbol, fallbackName);
  const searchName = searchBoardNameCache.get(symbol);
  const board = boardQuote ?? {
    code: symbol,
    name: fallbackName ?? searchName ?? symbol,
    changePercent: undefined,
    minutes: [],
  };
  const rows = await getLocalBoardConstituents(board.name);
  const kline = await aggregateLocalBoardKline(rows.map((row) => row.code))
    .then((items) => (items.length ? items : aggregateBaiduBoardKline(rows.map((row) => row.code))))
    .catch(() => []);
  return {
    code: board.code,
    name: board.name,
    changePercent: formatPercent(board.changePercent),
    kline,
    constituents: rows.slice(0, 80).map((item) => ({
      code: item.code,
      name: item.name,
      price: item.price ?? '--',
      changePercent: item.changePercent === undefined ? '--' : formatPercent(item.changePercent),
      turnoverRate: item.turnoverRate === undefined ? '--' : `${formatNumber(item.turnoverRate)}%`,
      volume: item.volume === undefined ? '--' : formatVolume(item.volume),
      amount: item.amount === undefined ? '--' : formatMoney(item.amount),
      turnover: item.turnoverRate === undefined ? '--' : `${formatNumber(item.turnoverRate)}%`,
    })),
  };
}

async function getLocalBoardConstituents(boardName: string): Promise<MarketQuoteRow[]> {
  const rows = await listLatestMarketRows().catch(() => []);
  const securities = await listSecurities().catch(() => []);
  const localName = normalizeBoardName(boardName);
  const industryByCode = new Map(
    securities.map((item) => [item.symbol, item.industry]).filter((item): item is [string, string] => Boolean(item[1])),
  );
  const byIndustry = rows.filter((row) => {
    const industry = industryByCode.get(row.code);
    return industry && boardNamesMatch(industry, localName);
  });
  if (byIndustry.length)
    return byIndustry.sort(
      (a, b) =>
        Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0) || String(a.code).localeCompare(String(b.code)),
    );

  const byMembership = await scanBoardMembership(boardName).catch(() => []);
  if (byMembership.length) return byMembership;
  return rows
    .filter((row) => boardNamesMatch(row.name, localName))
    .sort(
      (a, b) =>
        Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0) || String(a.code).localeCompare(String(b.code)),
    );
}

async function scanBoardMembership(boardName: string): Promise<MarketQuoteRow[]> {
  const localName = normalizeBoardName(boardName);
  if (!localName) return [];
  const symbols = prioritizeBoardScanSymbols(await sdk.codes.cn({ simple: true }));
  const matched: string[] = [];
  const deadline = Date.now() + BOARD_SCAN_BUDGET_MS;
  for (
    let index = 0;
    index < Math.min(symbols.length, BOARD_CONSTITUENT_SCAN_LIMIT) && Date.now() < deadline;
    index += BOARD_SCAN_CONCURRENCY
  ) {
    const batch = symbols.slice(index, index + BOARD_SCAN_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (code) => ({ code, boards: await getStockBoardMembership(code).catch(() => []) })),
    );
    for (const result of results) {
      if (
        result.boards.some(
          (item) => item.code === normalizeBoardCode(boardName) || boardNamesMatch(item.name, localName),
        )
      )
        matched.push(result.code);
    }
    if (matched.length >= 200) break;
  }
  const quotes = matched.length ? await sdk.quotes.cn(matched).catch(() => []) : [];
  return quotes
    .map((quote) =>
      toMarketQuoteRow({
        code: quote.code,
        name: quote.name,
        price: quote.price,
        changePercent: quote.changePercent,
        volume: quote.volume,
        amount: normalizeAmount(quote.amount),
        open: quote.open,
        high: quote.high,
        low: quote.low,
        prevClose: quote.prevClose,
        turnoverRate: quote.turnoverRate,
        marketCap: quote.totalMarketCap,
      }),
    )
    .filter((row) => row.code && row.name)
    .sort(
      (a, b) =>
        Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0) || String(a.code).localeCompare(String(b.code)),
    );
}

function prioritizeBoardScanSymbols(symbols: string[]) {
  const main = symbols.filter((code) => /^(60|00|30|68)/.test(code));
  const rest = symbols.filter((code) => !/^(60|00|30|68)/.test(code));
  return [...main, ...rest];
}

export async function getStockBoardMembership(
  code: string,
): Promise<Array<{ code: string; name: string; changePercent: number | null; leadStock: string }>> {
  const secid = `${code.startsWith('6') ? 1 : 0}.${code}`;
  const params = new URLSearchParams({
    fltt: '2',
    invt: '2',
    secid,
    spt: '3',
    pi: '0',
    pz: '200',
    po: '1',
    fields: 'f12,f14,f3,f128',
  });
  const endpoints = [
    `https://push2.eastmoney.com/api/qt/slist/get?${params}`,
    `https://push2delay.eastmoney.com/api/qt/slist/get?${params}`,
  ];
  let lastError: unknown;
  for (const url of endpoints) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(6_000),
        headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: 'https://quote.eastmoney.com/' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = parseStockBoardMembershipPayload(await response.json());
      if (rows.length) return rows;
      lastError = new Error('东财 slist 未返回所属板块');
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('东财 slist 所属板块请求失败');
}

async function fetchSdkBoardSeries(
  code: string,
  period: MarketIndexPeriod,
  name?: string,
  targets = getBoardDetailTargets(code, name),
): Promise<KlinePoint[]> {
  const limit = period === '4h' ? 80 : period === '1d' ? 120 : 60;
  const load = async (board: BoardApi, target: string) => {
    const rows =
      period === '1d'
        ? await withTimeoutReject(
            board.kline(target, { period: 'daily', adjust: 'qfq' }),
            BOARD_SDK_REQUEST_TIMEOUT,
            '板块K线加载超时',
          )
        : await withTimeoutReject(
            board.minuteKline(target, { period: period === '15m' ? '15' : '60' }),
            BOARD_SDK_REQUEST_TIMEOUT,
            '板块分钟K线加载超时',
          );
    const points = rows
      .map(toKlinePoint)
      .filter((point): point is KlinePoint => Boolean(point))
      .slice(-limit);
    return period === '4h' ? aggregateKline(points, 4) : points;
  };

  const apis = await getBoardApis(code, name);
  const kind = boardKindCache.get(code);

  // ponytail: kind unknown — try both APIs in parallel on first target
  if (!kind && targets.length) {
    const firstTarget = targets[0];
    const [industryRows, conceptRows] = await Promise.all([
      load(sdk.board.industry, firstTarget).catch(() => []),
      load(sdk.board.concept, firstTarget).catch(() => []),
    ]);
    const rows = industryRows.length ? industryRows : conceptRows;
    const discoveredKind: BoardKind = industryRows.length ? 'industry' : 'concept';
    if (rows.length) {
      boardKindCache.set(code, discoveredKind);
      return rows;
    }
    for (const target of targets.slice(1)) {
      for (const board of orderBoardApis(undefined)) {
        try {
          const result = await load(board, target);
          if (result.length) {
            boardKindCache.set(code, board === sdk.board.industry ? 'industry' : 'concept');
            return result;
          }
        } catch {
          /* try next */
        }
      }
    }
    return [];
  }

  for (const board of apis) {
    for (const target of targets) {
      try {
        const rows = await load(board, target);
        if (rows.length) return rows;
      } catch {
        // Try name/code and the other board namespace, then the real-data HTTP fallback.
      }
    }
  }
  return [];
}
