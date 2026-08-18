import type { SecurityRecord } from './types.js';

export type TConditionScreenerDataSource = 'duckdb' | 'stock-sdk' | 'a-stock-data';
export type TConditionScreenerMarketScope = 'sh' | 'sz' | 'bj' | 'kc' | 'cy' | 'main';
export type TConditionScreenerSortBy =
  | 'code'
  | 'totalMarketCap'
  | 'circulatingMarketCap'
  | 'amount'
  | 'volume'
  | 'turnoverRate'
  | 'changePercent'
  | 'concentration90'
  | 'concentration70';
export type TConditionScreenerSortOrder = 'asc' | 'desc';

export interface IConditionScreenerInput {
  minTotalMarketCapYuan?: number;
  maxTotalMarketCapYuan?: number;
  maxTotalMarketCapYuanExclusive?: number;
  minCirculatingMarketCapYuan?: number;
  maxCirculatingMarketCapYuan?: number;
  maxCirculatingMarketCapYuanExclusive?: number;
  turnoverRateMin?: number;
  turnoverRateMax?: number;
  turnoverRateMinExclusive?: number;
  minAmountYuan?: number;
  maxAmountYuan?: number;
  amountMinYuanExclusive?: number;
  minVolume?: number;
  maxVolume?: number;
  volumeMinExclusive?: number;
  changePercentMin?: number;
  changePercentMax?: number;
  concentration90Min?: number;
  concentration90Max?: number;
  concentration90MaxExclusive?: number;
  concentration70Min?: number;
  concentration70Max?: number;
  concentration70MaxExclusive?: number;
  profitRatioMin?: number;
  profitRatioMax?: number;
  profitRatioMinExclusive?: number;
  excludeST?: boolean;
  marketScopes?: TConditionScreenerMarketScope[];
  leadingBoards?: boolean;
  sortBy?: TConditionScreenerSortBy;
  sortOrder?: TConditionScreenerSortOrder;
  limit?: number;
}

export interface IConditionScreenerLeadingBoard {
  code: string;
  name: string;
  kind?: string;
  changePercent: number;
}

export interface IConditionScreenerRow {
  code: string;
  name: string;
  exchange: SecurityRecord['exchange'];
  industry?: string;
  price?: number;
  changePercent?: number;
  turnoverRate?: number;
  amountYuan?: number;
  volume?: number;
  totalMarketCapYuan?: number;
  circulatingMarketCapYuan?: number;
  concentration90Percent?: number;
  concentration70Percent?: number;
  profitRatioPercent?: number;
  chipDate?: string;
  leadingBoards?: string[];
  missingFields?: string[];
  dataSource: TConditionScreenerDataSource;
  fetchedAt?: string;
}

export interface IConditionScreenerResult {
  source: 'duckdb+stock-sdk+a-stock-data';
  storage: 'local' | 'mixed' | 'remote' | 'none';
  freshness: 'current' | 'stale';
  isComplete: boolean;
  latestTradeDate?: string;
  rows: IConditionScreenerRow[];
  matchedCount: number;
  returnedCount: number;
  totalCandidates: number;
  leadingBoards: IConditionScreenerLeadingBoard[];
  sourceStats: {
    duckdbMatched: number;
    stockSdkMatched: number;
    aStockDataMatched: number;
    missingQuoteFields: number;
    missingChipData: number;
  };
  warnings: string[];
  isEmpty: boolean;
}

export interface IConditionScreenerCandidate {
  code: string;
  name: string;
  exchange: SecurityRecord['exchange'];
  industry?: string;
  isSt: boolean;
  price?: number;
  changePercent?: number;
  turnoverRate?: number;
  amountYuan?: number;
  volume?: number;
  totalMarketCapYuan?: number;
  circulatingMarketCapYuan?: number;
  fetchedAt?: string;
  dataSource: TConditionScreenerDataSource;
}
