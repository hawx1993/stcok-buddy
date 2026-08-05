export interface IOpportunityRadarBoardItem {
  code: string;
  name: string;
  ratio: number;
  changePercent: number;
  mainNetInflow: number;
}

export interface IOpportunityRadarStockItem {
  code: string;
  name: string;
  reason: string;
  price?: number | null;
  changePercent?: number | null;
  amount?: number | null;
  score: number;
}

export interface IOpportunityRadarData {
  boards: IOpportunityRadarBoardItem[];
  stocks: IOpportunityRadarStockItem[];
}

function hasStockRadarItems(data?: IOpportunityRadarData) {
  return Boolean(data?.stocks.length);
}

export function hasOpportunityRadarItems(data?: IOpportunityRadarData) {
  return hasStockRadarItems(data);
}

function formatPrice(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return '--';
  return value.toFixed(2);
}

export function getOpportunityRadarMetaText(item: IOpportunityRadarStockItem) {
  return `${item.code} · 现价 ${formatPrice(item.price)}`;
}
