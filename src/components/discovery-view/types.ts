export type TStockItem = {
  code: string;
  name: string;
  price?: string;
  changePercent?: string;
  amount?: string;
  industry?: string;
};

export type TDragonTigerRow = {
  code: string;
  name: string;
  changePercent?: number;
  netBuy: number;
  reason: string;
};

export type TDragonTigerDay = {
  date: string;
  weekday: string;
  inst: TDragonTigerRow[];
  hot: TDragonTigerRow[];
  first: TDragonTigerRow[];
};

export interface ISectorSummary {
  code: string;
  name: string;
  changePercent: number;
  mainNetInflow: number;
  amount?: number;
}

export interface IOpportunityRadarItem {
  code: string;
  name: string;
  ratio: number;
  changePercent: number;
  mainNetInflow: number;
}

export interface IOpportunityRadarData {
  boards: IOpportunityRadarItem[];
  stocks: Array<{
    code: string;
    name: string;
    reason: string;
    price?: number | null;
    changePercent?: number | null;
    amount?: number | null;
    score: number;
  }>;
}

export interface IMonthlyThemeItem {
  week: string;
  theme: string;
  leader: { code: string; name: string } | null;
}

export interface INextWeekSector {
  code?: string;
  name: string;
  score: number;
  reasoning: {
    fundFlow: string;
    news: string;
    policy: string;
    technical: string;
    rotation: string;
  };
}

export interface IMarketSummary {
  indices: Array<{ code: string; name: string; price: number; changePercent: number }>;
  mainFundFlow: number | null;
  northFundFlow: number | null;
  limitUp: number;
  limitDown: number;
  sentimentBar: number;
  sectors: ISectorSummary[];
  opportunityRadar: IOpportunityRadarItem[];
  monthlyThemes: IMonthlyThemeItem[];
  nextWeekSectors: INextWeekSector[];
}

export interface IDiscoverySnapshot {
  tradeDate: string;
  generatedAt: string;
  score?: number;
  scoreLabel?: string;
  scoreVerdict?: string;
  scoreTrend?: number[];
  indices?: Array<{ code: string; name: string; price?: number | string; changePercent?: number | string }>;
  bullets?: string[];
  wealthMetrics?: Array<{ label: string; value: number | null; unit: string }>;
  opportunityRadar?: IOpportunityRadarData;
  marketSummary?: IMarketSummary;
  sentimentScore?: number | null;
  sentimentFactors?: Array<{ label: string; value: string | number }>;
  sentimentStocks?: { zt: TStockItem[]; dt: TStockItem[]; zb: TStockItem[] };
  consecutiveStocks?: TStockItem[];
  yesterdayZt?: TStockItem[];
  yesterdayLb?: TStockItem[];
  leaders?: Array<{
    code: string;
    name: string;
    height?: number | null;
    amount?: number | null;
    concepts?: string[];
    changePercent?: number | null;
  }>;
  hotThemes?: Array<{
    name: string;
    score?: number | null;
    changePercent?: number | null;
    limitUpCount?: number | null;
    reason?: string | null;
    leaderName?: string | null;
    leaderCode?: string | null;
    leaders?: Array<{ code: string; name: string; height?: number | null }>;
  }>;
  limitUps?: Array<{ code: string; name: string; height: string; reason: string }>;
  dragonTiger?: {
    inst: TDragonTigerRow[];
    hot: TDragonTigerRow[];
    first: TDragonTigerRow[];
  };
  dragonTigerHistory?: TDragonTigerDay[];
  tradeDates?: Array<{ date: string; weekday: string }>;
  nextDayFocus?: Array<{ category: string; condition: string; baseline?: number | null }>;
  watchlistQuotes?: Array<{ code: string; name: string; price?: number | string; changePercent?: number | string }>;
  unavailableReason?: string;
}
