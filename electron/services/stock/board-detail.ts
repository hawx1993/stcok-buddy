import type {
  BoardDetail,
  KlinePoint,
  MarketBoardRow,
  MarketQuoteRow,
  MarketIndexPeriod,
  MarketTab,
} from '../../../src/shared/types.js';
import {
  listDailyBars,
  listLatestMarketRows,
  listSecurities,
  readBoardDetail,
  writeBoardDetail,
} from '../market-data/market-data-store.js';
import { formatMoney, formatNumber, formatPercent } from './format.js';
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
  hasValue,
  marketBoardsCache,
  normalizeBoardName,
  normalizeAmount,
  orderBoardApis,
  parseEastmoneyKline,
  parseMarketTime,
  searchBoardNameCache,
  shouldUseRemoteMarketData,
  toKlinePoint,
  toMarketQuoteRow,
  withTimeoutReject,
  sdk,
} from './shared.js';
let boardApisLoadingPromise: Promise<void> | undefined;

type AnyRecord = Record<string, unknown>;

export async function getBoardDetail(symbol: string, forceRefresh = false, boardName?: string): Promise<BoardDetail> {
  const cacheKey = normalizeBoardCode(symbol);
  const refreshRemote = async (localFallback?: BoardDetail) => {
    const detail = await getRemoteBoardDetail(symbol, !localFallback, boardName, localFallback);
    if (detail.kline?.length || detail.constituents?.length)
      void writeBoardDetail({ detail, updatedAt: new Date().toISOString() });
    return detail;
  };

  if (forceRefresh) {
    const detail = await refreshRemote();
    if (!detail.kline?.length && !detail.constituents?.length) throw new Error('板块接口暂无数据');
    return detail;
  }

  const cached =
    (await readBoardDetail(cacheKey).catch(() => undefined)) ?? (await readBoardDetail(symbol).catch(() => undefined));
  const cachedName = cached?.detail.name;
  // ponytail: timeout local scan — scanBoardMembership can run 8s+
  const localDetail = await withTimeoutReject(
    getLocalBoardDetail(cacheKey, cachedName ?? boardName),
    6_000,
    '本地板块详情加载超时',
  ).catch(() => undefined);
  if (cached?.detail.constituents?.length) {
    void refreshRemote().catch((error) =>
      console.warn(
        '[market] board detail background refresh failed',
        symbol,
        error instanceof Error ? error.message : error,
      ),
    );
    return cached.detail;
  }

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
  const latestRows = await listLatestMarketRows().catch(() => []);
  const byCode = new Map(latestRows.map((row) => [row.code, row]));
  return rows.map((row) => {
    const latest = byCode.get(row.code);
    if (!latest) return row;
    return {
      ...row,
      price: latest.price ?? row.price ?? '--',
      changePercent:
        latest.changePercent === undefined ? (row.changePercent ?? '--') : formatPercent(latest.changePercent),
      amount: latest.amount === undefined ? row.amount : formatMoney(latest.amount),
      turnover: latest.turnoverRate === undefined ? row.turnover : `${formatNumber(latest.turnoverRate)}%`,
    };
  });
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
  const fallbackRows = sdkRows.length ? [] : await firstBoardConstituentsFromTargets(targets).catch(() => []);
  const fallbackKline = kline.length ? [] : await firstBoardKlineFromTargets(targets).catch(() => []);
  const baseConstituents = (sdkRows.length ? sdkRows : fallbackRows).slice(0, 200);
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

function normalizeBoardCode(value: string) {
  const code = value.trim().toUpperCase();
  return /^\d{4}$/.test(code) ? `BK${code}` : code;
}

async function firstBoardConstituentsFromTargets(targets: string[]): Promise<NonNullable<BoardDetail['constituents']>> {
  for (const target of targets) {
    const rows = await getEastmoneyBoardConstituents(target).catch(() => []);
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

async function getAStockBoardKline(symbol: string, period: MarketIndexPeriod): Promise<KlinePoint[]> {
  if (!/^BK\d+/i.test(symbol)) return [];
  const klt = ({ '15m': '15', '1h': '60', '4h': '60', '1d': '101', '1w': '102', '1mo': '103' } as const)[period];
  const limit = period === '4h' ? 80 : period === '1d' ? 120 : period === '1w' ? 240 : period === '1mo' ? 120 : 60;
  const params = new URLSearchParams({
    secid: `90.${symbol.toUpperCase()}`,
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    klt,
    fqt: '1',
    beg: '0',
    end: '20500101',
    lmt: String(limit),
  });
  const payload = await fetchFirstJson<{ data?: { klines?: string[] } }>(
    [
      `https://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`,
      `https://7.push2his.eastmoney.com/api/qt/stock/kline/get?${params}`,
    ],
    'https://quote.eastmoney.com/',
    3_000,
  );
  const rows = (payload.data?.klines ?? [])
    .map(parseEastmoneyKline)
    .filter((point): point is KlinePoint => Boolean(point));
  return period === '4h' ? aggregateKline(rows, 4) : rows;
}

async function fetchFirstJson<T>(urls: string[], referer: string, timeout = 12_000): Promise<T> {
  let lastError: unknown;
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeout),
        headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: referer },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('a-stock-data board request failed');
}

async function aggregateRemoteBoardKline(codes: string[]): Promise<KlinePoint[]> {
  const topCodes = codes.slice(0, 20);
  const series = await Promise.all(
    topCodes.map((code) => listDailyBars(code, { limit: 120, adjustType: 'qfq' }).catch(() => [])),
  );
  return averageKlineSeries(
    series.map((rows) =>
      rows.map((row) => ({
        time: row.tradeDate,
        timestamp: parseMarketTime(row.tradeDate),
        open: row.open,
        close: row.close,
        high: row.high,
        low: row.low,
        volume: row.volume,
        amount: row.amount,
        change: row.change,
        changePercent: row.changePercent,
        turnoverRate: row.turnoverRate,
      })),
    ),
  );
}

function averageKlineSeries(series: KlinePoint[][]): KlinePoint[] {
  const byDate = new Map<
    string,
    { open: number; close: number; high: number; low: number; volume: number; amount: number; count: number }
  >();
  for (const rows of series) {
    for (const row of rows) {
      const group = byDate.get(row.time) ?? { open: 0, close: 0, high: 0, low: 0, volume: 0, amount: 0, count: 0 };
      group.open += row.open;
      group.close += row.close;
      group.high += row.high;
      group.low += row.low;
      group.volume += row.volume;
      group.amount += row.amount ?? 0;
      group.count += 1;
      byDate.set(row.time, group);
    }
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, group]) => ({
      time,
      timestamp: parseMarketTime(time),
      open: group.open / group.count,
      close: group.close / group.count,
      high: group.high / group.count,
      low: group.low / group.count,
      volume: group.volume,
      amount: group.amount,
    }));
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
  const remoteBoard = marketBoardsCache.rows.find((item) => item.code === symbol);
  const searchName = searchBoardNameCache.get(symbol);
  const board = remoteBoard ?? {
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
    changePercent: formatPercent(board.changePercent ?? 0),
    kline,
    constituents: rows.slice(0, 80).map((item) => ({
      code: item.code,
      name: item.name,
      price: item.price ?? '--',
      changePercent: item.changePercent === undefined ? '--' : formatPercent(item.changePercent),
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

async function getStockBoardMembership(code: string): Promise<Array<{ code: string; name: string }>> {
  const secid = `${code.startsWith('6') ? 1 : 0}.${code}`;
  const url = new URL('https://push2delay.eastmoney.com/api/qt/slist/get');
  url.search = new URLSearchParams({
    fltt: '2',
    invt: '2',
    secid,
    spt: '3',
    pi: '0',
    pz: '200',
    po: '1',
    fields: 'f12,f14,f3,f128',
  }).toString();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(4_000),
    headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.2', Referer: 'https://quote.eastmoney.com/' },
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as { data?: { diff?: AnyRecord[] | Record<string, AnyRecord> } };
  const diff = payload.data?.diff ?? [];
  const items = Array.isArray(diff) ? diff : Object.values(diff);
  return items
    .map((item) => ({ code: String(item.f12 ?? ''), name: String(item.f14 ?? '') }))
    .filter((item) => item.code && item.name);
}

async function aggregateBaiduBoardKline(codes: string[]): Promise<KlinePoint[]> {
  const series = await Promise.all(codes.slice(0, 12).map((code) => getBaiduStockKline(code).catch(() => [])));
  return averageKlineSeries(series);
}

export async function getBaiduStockKline(code: string, limit = 240): Promise<KlinePoint[]> {
  const url = new URL('https://finance.pae.baidu.com/selfselect/getstockquotation');
  url.search = new URLSearchParams({
    all: '1',
    isIndex: 'false',
    isBk: 'false',
    isBlock: 'false',
    isFutures: 'false',
    isStock: 'true',
    newFormat: '1',
    group: 'quotation_kline_ab',
    finClientType: 'pc',
    code,
    ktype: '1',
  }).toString();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(8_000),
    headers: {
      'User-Agent': 'Mozilla/5.0 StockBuddy/0.2',
      Accept: 'application/vnd.finance-web.v1+json',
      Origin: 'https://gushitong.baidu.com',
      Referer: 'https://gushitong.baidu.com/',
    },
  });
  if (!response.ok) throw new Error(`百度股市通日 K 请求失败：HTTP ${response.status}`);
  const payload = (await response.json()) as {
    ResultCode?: number | string;
    Result?: { newMarketData?: { keys?: string[]; marketData?: string } };
  };
  if (String(payload.ResultCode ?? '0') !== '0') throw new Error(`百度股市通返回错误码 ${payload.ResultCode}`);
  const keys = payload.Result?.newMarketData?.keys ?? [];
  const rows = payload.Result?.newMarketData?.marketData?.split(';').filter(Boolean) ?? [];
  const data = rows
    .map((line) => parseBaiduKline(line, keys))
    .filter((item): item is KlinePoint => Boolean(item))
    .slice(-limit);
  if (!data.length) throw new Error(`${code} 暂无百度股市通日 K 数据`);
  return data;
}

function parseBaiduKline(line: string, keys: string[]): KlinePoint | undefined {
  const values = line.split(',');
  const at = (name: string) => values[keys.indexOf(name)];
  const point = {
    time: at('time') ?? '',
    timestamp: Number(at('timestamp')) || parseMarketTime(at('time') ?? ''),
    open: Number(at('open')),
    close: Number(at('close')),
    high: Number(at('high')),
    low: Number(at('low')),
    volume: Number(at('volume')) || 0,
    amount: Number(at('amount')) || undefined,
    change: Number(at('ratioamount')) || undefined,
    changePercent: Number(at('ratioprice')) || undefined,
    turnoverRate: Number(at('turnoverratio') ?? at('turnover')) || undefined,
  };
  return [point.open, point.close, point.high, point.low].every(Number.isFinite) ? point : undefined;
}

async function aggregateLocalBoardKline(codes: string[]): Promise<KlinePoint[]> {
  const topCodes = codes.slice(0, 20);
  const series = await Promise.all(
    topCodes.map((code) => listDailyBars(code, { limit: 120, adjustType: 'qfq' }).catch(() => [])),
  );
  const byDate = new Map<
    string,
    { open: number; close: number; high: number; low: number; volume: number; amount: number; count: number }
  >();
  for (const rows of series) {
    for (const row of rows) {
      const group = byDate.get(row.tradeDate) ?? { open: 0, close: 0, high: 0, low: 0, volume: 0, amount: 0, count: 0 };
      group.open += row.open;
      group.close += row.close;
      group.high += row.high;
      group.low += row.low;
      group.volume += row.volume;
      group.amount += row.amount ?? 0;
      group.count += 1;
      byDate.set(row.tradeDate, group);
    }
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, group]) => ({
      time,
      timestamp: parseMarketTime(time),
      open: group.open / group.count,
      close: group.close / group.count,
      high: group.high / group.count,
      low: group.low / group.count,
      volume: group.volume,
      amount: group.amount,
    }));
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
