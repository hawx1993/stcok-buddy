import type {
  IBoardDashboardMetric,
  IBoardDashboardSnapshot,
  IBoardLeaderCandidate,
  MarketBoardRow,
  TBoardDashboardRange,
} from '../../../src/shared/types.js';
import { toShanghaiMarketTime } from '../../../src/shared/market-time.js';
import {
  getBoardRangeMetrics,
  getLatestTradeDate,
  listBoardConstituents,
  listLatestMarketRows,
  listMarketBoards,
  readBoardDashboardSnapshot,
  writeBoardDashboardSnapshot,
} from '../market-data/market-data-store.js';
import type { BoardConstituentRecord, MarketBoardRecord } from '../market-data/types.js';
import { getBoardDetail } from './board-detail.js';
import { getBatchQuotes } from './stock-client.js';
import { normalizeASymbol } from './symbols.js';
import { boardKindCache, getCachedMarketBoardRows, sdk } from './shared.js';
import {
  type IBoardDashboardInput,
  type ILeaderInput,
  normalizeBoardChangePercent,
  normalizeDashboardBoardName,
  normalizeDashboardRange,
  pickBoardLeaders,
  rangeToDayLimit,
  rankBoardMetrics,
  toFiniteNumber,
} from './board-dashboard-utils.js';

const DASHBOARD_BOARD_LIMIT = 200;
const DETAIL_BACKFILL_LIMIT = 24;
const DETAIL_BACKFILL_CONCURRENCY = 4;

const inflight = new Map<string, Promise<IBoardDashboardSnapshot>>();

type TBoardKind = 'industry' | 'concept' | 'unknown';
type TFundFlowIndicator = 'today' | '3day' | '5day' | '10day';
type TSectorFundFlowType = 'industry' | 'concept' | 'region';
type TRecord = Record<string, unknown>;
type TSectorFundFlowRankRow = Awaited<ReturnType<typeof sdk.fundFlow.sectorRank>>[number];
type TSectorFundFlowHistoryRow = Awaited<ReturnType<typeof sdk.fundFlow.sectorHistory>>[number];

interface ISectorFundFlowMaps {
  byCode: Map<string, number>;
  byName: Map<string, number>;
  warnings: string[];
}

interface IQuoteLike {
  code: string;
  name: string;
  price: number | null;
  changePercent: number | null;
  amount: number | null;
  turnoverRate: number | null;
  amplitude: number | null;
}

interface IBoardMetricSource {
  board: MarketBoardRecord;
  constituents: BoardConstituentRecord[];
  rangeMetrics: Awaited<ReturnType<typeof getBoardRangeMetrics>>;
  leaders: IBoardLeaderCandidate[];
  upCount: number | null;
  downCount: number | null;
  upRatio: number | null;
  warnings?: string[];
}

export async function getBoardDashboard(
  inputRange: TBoardDashboardRange = 'today',
  forceRefresh = false,
): Promise<IBoardDashboardSnapshot> {
  const range = normalizeDashboardRange(inputRange);
  const tradeDate = (await getLatestTradeDate().catch(() => undefined)) ?? toShanghaiMarketTime(new Date()).date;
  const key = `${range}:${tradeDate}:${forceRefresh ? 'refresh' : 'cache'}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = loadBoardDashboard(range, tradeDate, forceRefresh).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

async function loadBoardDashboard(
  range: TBoardDashboardRange,
  tradeDate: string,
  forceRefresh: boolean,
): Promise<IBoardDashboardSnapshot> {
  const cached = await readBoardDashboardSnapshot(range, tradeDate).catch(() => undefined);
  if (cached && !forceRefresh && !shouldRefreshCachedSnapshot(cached.snapshot)) return withLeaderQuotes(cached.snapshot);

  try {
    const snapshot = await buildDashboardSnapshot(range, tradeDate);
    await writeBoardDashboardSnapshot(snapshot).catch((error: unknown) =>
      console.warn('[board-dashboard] write snapshot failed', error),
    );
    return snapshot;
  } catch (error: unknown) {
    if (cached?.snapshot) {
      return withLeaderQuotes({
        ...cached.snapshot,
        warnings: [
          ...(cached.snapshot.warnings ?? []),
          `最新板块 Dashboard 刷新失败，当前展示本地缓存：${errorMessage(error)}`,
        ],
      });
    }
    throw new Error(`板块 Dashboard 暂不可用：${errorMessage(error)}`);
  }
}

function shouldRefreshCachedSnapshot(snapshot: IBoardDashboardSnapshot): boolean {
  const hasAbnormalChangePercent = snapshot.rankings.some(
    (metric) => normalizeBoardChangePercent(metric.changePercent) === null && metric.changePercent !== null,
  );
  const hasQuadrantPoint = snapshot.rankings.some(
    (metric) => metric.fundScore !== null && metric.momentumScore !== null,
  );
  const hasSparseLeaderCandidates = snapshot.rankings.some(
    (metric) => metric.constituentCount >= 3 && metric.leaders.length < 3,
  );
  return hasAbnormalChangePercent || (snapshot.rankings.length > 0 && !hasQuadrantPoint) || hasSparseLeaderCandidates;
}

async function buildDashboardSnapshot(
  range: TBoardDashboardRange,
  tradeDate: string,
): Promise<IBoardDashboardSnapshot> {
  const updatedAt = new Date().toISOString();
  const warnings: string[] = [];
  const boards = await loadBoardCatalog();
  if (!boards.length) {
    return emptySnapshot(range, tradeDate, updatedAt, ['暂无真实板块数据，请稍后刷新或先同步市场数据。']);
  }

  const selectedBoards = boards.slice(0, DASHBOARD_BOARD_LIMIT);
  const tips = boards.length > selectedBoards.length
    ? [`本次基于前 ${selectedBoards.length} 个真实板块样本计算。`]
    : undefined;

  const [quoteByCode, stockFlowByCode, sectorFlowMaps] = await Promise.all([
    loadQuoteMap(),
    loadStockFundFlowMap(range),
    loadSectorFundFlowMaps(range),
  ]);
  const sources = await runLimited(selectedBoards, DETAIL_BACKFILL_CONCURRENCY, (board, index) =>
    buildMetricSource(board, range, quoteByCode, stockFlowByCode, sectorFlowMaps, index < DETAIL_BACKFILL_LIMIT),
  );
  const inputs = sources.map((source) => toDashboardInput(source, range, tradeDate, updatedAt));
  const snapshot = await withLeaderQuotes(rankBoardMetrics(inputs));
  return {
    ...snapshot,
    tips,
    warnings: mergeWarnings(warnings, sectorFlowMaps.warnings, snapshot.warnings),
  };
}

async function loadBoardCatalog(): Promise<MarketBoardRecord[]> {
  const local = await listMarketBoards().catch(() => []);
  const normalizedLocal = deduplicateByCode(local.map(normalizeBoardRecord).filter(BooleanBoardRecord));
  if (normalizedLocal.length) return normalizedLocal;
  const remote = await getCachedMarketBoardRows(true).catch(() => []);
  return deduplicateByCode(remote.map(marketBoardRowToRecord).filter(BooleanBoardRecord));
}

async function buildMetricSource(
  board: MarketBoardRecord,
  range: TBoardDashboardRange,
  quoteByCode: Map<string, IQuoteLike>,
  stockFlowByCode: Map<string, number>,
  sectorFlowMaps: ISectorFundFlowMaps,
  allowRemoteBackfill: boolean,
): Promise<IBoardMetricSource> {
  const localConstituents = await listBoardConstituents(board.code).catch(() => []);
  const constituents = localConstituents.length || !allowRemoteBackfill ? localConstituents : await backfillBoardConstituents(board);
  const rangeMetrics = await getBoardRangeMetrics(board.code, rangeToDayLimit(range)).catch(() => ({
    tradeDates: [],
    maxDailyChangePercent: null,
    avgTurnoverRate: null,
    avgAmplitude: null,
    sampledCodes: 0,
    netInflow: null,
    fundFlowSampleSize: 0,
  }));
  const leaderInputs = constituents.map((item): ILeaderInput => {
    const code = normalizeASymbol(item.stockCode);
    const quote = quoteByCode.get(code);
    return {
      code,
      name: item.stockName,
      price: quote?.price,
      changePercent: quote?.changePercent,
      mainNetInflow: stockFlowByCode.get(code) ?? null,
      amount: quote?.amount,
      turnoverRate: quote?.turnoverRate,
      amplitude: quote?.amplitude,
    };
  });
  const leaders = pickBoardLeaders(leaderInputs);
  const sectorFlow = await resolveSectorFlow(board, range, rangeMetrics.netInflow, sectorFlowMaps, allowRemoteBackfill);
  const breadth = calculateBreadth(constituents, quoteByCode);
  const warnings = sectorFlow.source === 'history'
    ? [`${board.name} 使用 stock-sdk 板块历史资金流修复本区间净流入。`]
    : undefined;
  return {
    board: { ...board, amount: board.amount, changePercent: board.changePercent },
    constituents,
    rangeMetrics: { ...rangeMetrics, netInflow: sectorFlow.value ?? rangeMetrics.netInflow },
    leaders,
    ...breadth,
    warnings,
  };
}

async function backfillBoardConstituents(board: MarketBoardRecord): Promise<BoardConstituentRecord[]> {
  if (!board.code || board.code.length < 4) return [];
  const index = Number.parseInt(board.code.replace(/\D/g, ''), 10);
  if (Number.isFinite(index) && index > DETAIL_BACKFILL_LIMIT * 1000) return [];
  return runLimited([board], DETAIL_BACKFILL_CONCURRENCY, async (item) => {
    const detail = await getBoardDetail(item.code, false, item.name).catch(() => undefined);
    return (detail?.constituents ?? []).map((stock, position) => ({
      boardCode: item.code,
      stockCode: normalizeASymbol(stock.code),
      stockName: stock.name,
      position,
      updatedAt: new Date().toISOString(),
    }));
  }).then((groups) => groups.flat());
}

async function withLeaderQuotes(snapshot: IBoardDashboardSnapshot): Promise<IBoardDashboardSnapshot> {
  const displayedMetrics = [...snapshot.hot, ...snapshot.potential, ...snapshot.avoid, ...snapshot.leaders];
  const leaderCodes = [...new Set(displayedMetrics.flatMap((metric) => metric.leaders.map((leader) => leader.code)))];
  const missingCodes = leaderCodes.filter((code) => {
    const leader = displayedMetrics.flatMap((metric) => metric.leaders).find((item) => item.code === code);
    return leader && (leader.price === null || leader.changePercent === null);
  });
  if (!missingCodes.length) return snapshot;

  const quotes = await getBatchQuotes(missingCodes).catch(() => []);
  const quoteByCode = new Map(quotes.map((quote) => [normalizeASymbol(quote.code), quote]));
  if (!quoteByCode.size) return snapshot;

  const enrichMetric = (metric: IBoardDashboardMetric): IBoardDashboardMetric => ({
    ...metric,
    leaders: metric.leaders.map((leader) => {
      const quote = quoteByCode.get(normalizeASymbol(leader.code));
      if (!quote) return leader;
      const price = toFiniteNumber(quote.price);
      const changePercent = toFiniteNumber(quote.changePercent);
      return {
        ...leader,
        price: price ?? leader.price,
        changePercent: changePercent ?? leader.changePercent,
      };
    }),
  });

  return {
    ...snapshot,
    summary: {
      hottest: snapshot.summary.hottest ? enrichMetric(snapshot.summary.hottest) : undefined,
      potential: snapshot.summary.potential ? enrichMetric(snapshot.summary.potential) : undefined,
      avoid: snapshot.summary.avoid ? enrichMetric(snapshot.summary.avoid) : undefined,
      strongestLeader: snapshot.summary.strongestLeader ? enrichMetric(snapshot.summary.strongestLeader) : undefined,
    },
    rankings: snapshot.rankings.map(enrichMetric),
    potential: snapshot.potential.map(enrichMetric),
    hot: snapshot.hot.map(enrichMetric),
    avoid: snapshot.avoid.map(enrichMetric),
    leaders: snapshot.leaders.map(enrichMetric),
  };
}

function toDashboardInput(
  source: IBoardMetricSource,
  range: TBoardDashboardRange,
  tradeDate: string,
  updatedAt: string,
): IBoardDashboardInput {
  const mainNetInflow = source.rangeMetrics.netInflow ?? null;
  return {
    boardCode: source.board.code,
    boardName: source.board.name,
    boardKind: normalizeBoardKind(source.board.kind),
    range,
    tradeDate,
    changePercent: normalizeBoardChangePercent(source.board.changePercent, range),
    maxDailyChangePercent: source.rangeMetrics.maxDailyChangePercent,
    mainNetInflow,
    amount: source.board.amount ?? null,
    limitUpCount: null,
    upCount: source.upCount,
    downCount: source.downCount,
    constituentCount: source.constituents.length,
    upRatio: source.upRatio,
    averageTurnoverRate: source.rangeMetrics.avgTurnoverRate,
    averageAmplitude: source.rangeMetrics.avgAmplitude,
    leaders: source.leaders,
    updatedAt,
    warnings: source.warnings,
  };
}

async function loadQuoteMap(): Promise<Map<string, IQuoteLike>> {
  const rows = await listLatestMarketRows().catch(() => []);
  return new Map(
    rows.map((row) => [
      normalizeASymbol(row.code),
      {
        code: normalizeASymbol(row.code),
        name: row.name,
        price: row.price ?? null,
        changePercent: row.changePercent ?? null,
        amount: row.amount ?? null,
        turnoverRate: row.turnoverRate ?? null,
        amplitude: calculateAmplitude(row.high ?? null, row.low ?? null),
      },
    ]),
  );
}

async function loadStockFundFlowMap(range: TBoardDashboardRange): Promise<Map<string, number>> {
  if (range !== 'today') return new Map();
  const rows = await sdk.fundFlow.rank({ indicator: 'today' }).catch(() => []);
  const entries = rows.flatMap((row): Array<[string, number]> => {
    const code = normalizeASymbol(readCode(row));
    const flow = readMainNetInflow(row);
    if (!code || flow === null || !Number.isFinite(flow)) return [];
    return [[code, flow]];
  });
  return new Map(entries);
}

async function loadSectorFundFlowMaps(range: TBoardDashboardRange): Promise<ISectorFundFlowMaps> {
  const indicator = rangeToFundFlowIndicator(range);
  if (!indicator) return { byCode: new Map(), byName: new Map(), warnings: [] };
  const warnings: string[] = [];
  const results = await Promise.allSettled([
    loadSectorFundFlowRankRows(indicator, 'industry'),
    loadSectorFundFlowRankRows(indicator, 'concept'),
  ]);
  if (results[0].status === 'rejected') warnings.push(`stock-sdk 行业板块资金流排名获取失败：${errorMessage(results[0].reason)}`);
  if (results[1].status === 'rejected') warnings.push(`stock-sdk 概念板块资金流排名获取失败：${errorMessage(results[1].reason)}`);
  const rows = deduplicateSectorFlowRows(results.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])));
  return {
    byCode: new Map(toSectorFlowCodeEntries(rows)),
    byName: new Map(toSectorFlowNameEntries(rows)),
    warnings,
  };
}

async function loadSectorFundFlowRankRows(
  indicator: TFundFlowIndicator,
  sectorType: TSectorFundFlowType,
): Promise<TSectorFundFlowRankRow[]> {
  return sdk.fundFlow.sectorRank({ indicator, sectorType });
}

function deduplicateSectorFlowRows(rows: TSectorFundFlowRankRow[]): TSectorFundFlowRankRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = readBoardCode(row) || normalizeDashboardBoardName(readBoardName(row));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toSectorFlowCodeEntries(rows: TSectorFundFlowRankRow[]): Array<[string, number]> {
  return rows.flatMap((row): Array<[string, number]> => {
    const code = readBoardCode(row);
    const flow = readMainNetInflow(row);
    if (!code || flow === null || !Number.isFinite(flow)) return [];
    return [[code, flow]];
  });
}

function toSectorFlowNameEntries(rows: TSectorFundFlowRankRow[]): Array<[string, number]> {
  return rows.flatMap((row): Array<[string, number]> => {
    const name = readBoardName(row);
    const flow = readMainNetInflow(row);
    if (!name || flow === null || !Number.isFinite(flow)) return [];
    return [[normalizeDashboardBoardName(name), flow]];
  });
}

async function resolveSectorFlow(
  board: MarketBoardRecord,
  range: TBoardDashboardRange,
  dbNetInflow: number | null,
  sectorFlowMaps: ISectorFundFlowMaps,
  allowRemoteBackfill: boolean,
): Promise<{ value: number | null; source: 'rank' | 'history' | 'database' | 'empty' }> {
  const rankFlow = sectorFlowMaps.byCode.get(board.code) ?? sectorFlowMaps.byName.get(normalizeDashboardBoardName(board.name));
  if (rankFlow !== undefined) return { value: rankFlow, source: 'rank' };
  const historyFlow = allowRemoteBackfill ? await loadSectorHistoryNetInflow(board.code, range) : null;
  if (historyFlow !== null) return { value: historyFlow, source: 'history' };
  if (dbNetInflow !== null) return { value: dbNetInflow, source: 'database' };
  return { value: null, source: 'empty' };
}

async function loadSectorHistoryNetInflow(boardCode: string, range: TBoardDashboardRange): Promise<number | null> {
  if (!/^BK\d+$/i.test(boardCode)) return null;
  const rows = await sdk.fundFlow.sectorHistory(boardCode, { period: 'daily' }).catch(() => []);
  return sumRecentSectorHistoryRows(rows, rangeToDayLimit(range));
}

function sumRecentSectorHistoryRows(rows: TSectorFundFlowHistoryRow[], limit: number): number | null {
  const values = rows
    .filter((row) => row.date)
    .sort((left, right) => String(right.date).localeCompare(String(left.date)))
    .slice(0, Math.max(1, limit))
    .map((row) => row.mainNetInflow)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

function calculateBreadth(constituents: BoardConstituentRecord[], quoteByCode: Map<string, IQuoteLike>) {
  const values = constituents
    .map((item) => quoteByCode.get(normalizeASymbol(item.stockCode))?.changePercent ?? null)
    .filter((value): value is number => value !== null);
  if (!values.length) return { upCount: null, downCount: null, upRatio: null };
  const upCount = values.filter((value) => value > 0).length;
  const downCount = values.filter((value) => value < 0).length;
  return { upCount, downCount, upRatio: Number(((upCount / values.length) * 100).toFixed(2)) };
}

function marketBoardRowToRecord(row: MarketBoardRow): MarketBoardRecord | undefined {
  if (!row.code || !row.name) return undefined;
  return {
    code: row.code,
    name: row.name,
    kind: normalizeBoardKind(boardKindCache.get(row.code)),
    changePercent: normalizeBoardChangePercent(row.changePercent, 'twenty-days') ?? undefined,
    amount: toFiniteNumber(row.amount) ?? undefined,
    source: 'stock-sdk',
    updatedAt: new Date().toISOString(),
  };
}

function normalizeBoardRecord(row: MarketBoardRecord): MarketBoardRecord | undefined {
  if (!row.code || !row.name) return undefined;
  return {
    ...row,
    code: row.code.toUpperCase(),
    kind: normalizeBoardKind(row.kind),
    changePercent: normalizeBoardChangePercent(row.changePercent, 'twenty-days') ?? row.changePercent,
  };
}

function normalizeBoardKind(kind?: string): TBoardKind {
  return kind === 'industry' || kind === 'concept' ? kind : 'unknown';
}

function BooleanBoardRecord(row: MarketBoardRecord | undefined): row is MarketBoardRecord {
  return Boolean(row?.code && row.name);
}

function deduplicateByCode(rows: MarketBoardRecord[]): MarketBoardRecord[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.code)) return false;
    seen.add(row.code);
    return true;
  });
}

function rangeToFundFlowIndicator(range: TBoardDashboardRange): TFundFlowIndicator | undefined {
  if (range === 'twenty-days') return '10day';
  if (range === 'five-days') return '5day';
  return 'today';
}

function readCode(row: unknown): string {
  const record = toRecord(row);
  return String(record.code ?? record.symbol ?? '').replace(/^\D+/, '');
}

function readBoardCode(row: unknown): string {
  const record = toRecord(row);
  return String(record.code ?? record.boardCode ?? record.sectorCode ?? '').toUpperCase();
}

function readBoardName(row: unknown): string {
  const record = toRecord(row);
  return String(record.name ?? record.boardName ?? record.sectorName ?? '');
}

function readMainNetInflow(row: unknown): number | null {
  const record = toRecord(row);
  return toFiniteNumber(record.mainNetInflow ?? record.netInflow ?? record.today ?? record.mainNetAmount);
}

function toRecord(row: unknown): TRecord {
  return row && typeof row === 'object' ? row as TRecord : {};
}

function calculateAmplitude(high: number | null, low: number | null): number | null {
  if (high === null || low === null || low === 0) return null;
  return Number((((high - low) / low) * 100).toFixed(2));
}

async function runLimited<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const itemIndex = index;
      const item = items[itemIndex];
      index += 1;
      if (item !== undefined) results.push(await task(item, itemIndex));
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, limit) }, () => worker()));
  return results;
}

function emptySnapshot(
  range: TBoardDashboardRange,
  tradeDate: string,
  updatedAt: string,
  warnings: string[],
): IBoardDashboardSnapshot {
  return { range, tradeDate, updatedAt, summary: {}, rankings: [], potential: [], hot: [], avoid: [], leaders: [], warnings };
}

function mergeWarnings(...groups: Array<string[] | undefined>): string[] | undefined {
  const warnings = groups.flatMap((group) => group ?? []);
  return warnings.length ? Array.from(new Set(warnings)) : undefined;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
