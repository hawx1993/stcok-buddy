import type {
  BoardDetail,
  IBoardDashboardSnapshot,
  KlinePoint,
  MarketBoardRow,
  StockDetail,
} from '../../../src/shared/types.js';

export type AdjustType = 'qfq' | 'none' | 'qfq_weekly' | 'qfq_monthly';
export type DataFreshness = 'live' | 'current' | 'historical' | 'stale' | 'fallback';
export type SyncJobType = 'initial_backfill' | 'daily_incremental' | 'repair';
export type SyncJobStatus = 'pending' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';

export interface DataMeta {
  source: string;
  storage: 'local' | 'remote' | 'mixed';
  freshness: DataFreshness;
  fetchedAt?: string;
  latestTradeDate?: string;
  requestedStartDate?: string;
  requestedEndDate?: string;
  isComplete: boolean;
  warnings: string[];
  adjustType?: AdjustType;
}

export interface DataResult<T> {
  data: T;
  meta: DataMeta;
}

export interface SecurityRecord {
  symbol: string;
  name: string;
  exchange: 'SH' | 'SZ' | 'BJ';
  securityType: 'stock';
  status: 'listed' | 'suspended' | 'delisted';
  listDate?: string;
  delistDate?: string;
  industry?: string;
  isSt: boolean;
  source: string;
  updatedAt: string;
}

export interface TradeCalendarRecord {
  market: string;
  tradeDate: string;
  isOpen: boolean;
  previousTradeDate?: string;
  nextTradeDate?: string;
  source: string;
  updatedAt: string;
}

export interface DailyBarRecord {
  symbol: string;
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount?: number;
  change?: number;
  changePercent?: number;
  turnoverRate?: number;
  adjustType: AdjustType;
  source: string;
  fetchedAt: string;
}

export interface HistoricalBarsOptions {
  limit?: number;
  startDate?: string;
  endDate?: string;
  period?: '1d';
  adjustType?: AdjustType;
}

export interface HistoricalBarProvider {
  name: string;
  getDailyBars(symbol: string, options: Required<Pick<HistoricalBarsOptions, 'adjustType'>> & Pick<HistoricalBarsOptions, 'startDate' | 'endDate'>): Promise<DailyBarRecord[]>;
}

export interface MarketDataSyncStatus {
  state: 'idle' | 'checking' | 'initializing' | 'syncing' | 'completed' | 'partial' | 'failed';
  jobType?: SyncJobType;
  targetTradeDate?: string;
  processedSymbols: number;
  totalSymbols: number;
  succeededSymbols: number;
  failedSymbols: number;
  startedAt?: string;
  finishedAt?: string;
  latestLocalTradeDate?: string;
  message?: string;
}

export interface MarketDataStats {
  securityCount: number;
  dailyBarCount: number;
  latestTradeDate?: string;
  databaseBytes: number;
  failedSymbols: number;
}

export interface SyncJobRecord extends MarketDataSyncStatus {
  id: string;
  status: SyncJobStatus;
  checkpointSymbol?: string;
  errorMessage?: string;
}

export interface DiscoverySnapshotCacheRecord {
  snapshot: unknown;
  updatedAt: string;
}

export interface BoardSnapshotRecord {
  rows: MarketBoardRow[];
  updatedAt: string;
}

export interface BoardDetailCacheRecord {
  detail: BoardDetail;
  updatedAt: string;
}

export interface BoardDashboardSnapshotRecord {
  snapshot: IBoardDashboardSnapshot;
  updatedAt: string;
}

export interface MarketBoardRecord {
  code: string;
  name: string;
  kind?: string;
  changePercent?: number;
  amount?: number;
  source: string;
  updatedAt: string;
}

export interface BoardConstituentRecord {
  boardCode: string;
  stockCode: string;
  stockName: string;
  position: number;
  updatedAt: string;
}

export type HistoricalBarsResult = DataResult<KlinePoint[]>;
export type LatestQuoteResult = DataResult<StockDetail>;
