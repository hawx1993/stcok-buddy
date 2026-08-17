import type { SecurityRecord } from './types.js';

export type TConditionScreenerDataSource = 'duckdb' | 'stock-sdk' | 'a-stock-data';
export type TConditionScreenerSortBy = 'code' | 'turnoverRate';
export type TConditionScreenerSortOrder = 'asc' | 'desc';

export interface IConditionScreenerInput {
  minTotalMarketCapYuan?: number;
  maxTotalMarketCapYuan?: number;
  maxTotalMarketCapYuanExclusive?: number;
  turnoverRateMinExclusive?: number;
  amountMinYuanExclusive?: number;
  changePercentMin?: number;
  changePercentMax?: number;
  concentration90MaxExclusive?: number;
  profitRatioMinExclusive?: number;
  excludeST?: boolean;
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
  totalMarketCapYuan?: number;
  concentration90Percent?: number;
  profitRatioPercent?: number;
  chipDate?: string;
  leadingBoards?: string[];
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
  totalMarketCapYuan?: number;
  fetchedAt?: string;
  dataSource: TConditionScreenerDataSource;
}
