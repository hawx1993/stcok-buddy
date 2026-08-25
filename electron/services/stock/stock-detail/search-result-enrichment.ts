import type { MarketQuoteRow, StockDetail } from '../../../../src/shared/types.js';

export type TStockSearchRow = MarketQuoteRow & { kind?: 'stock' };

export function hasCompleteSearchStockMetrics(row: TStockSearchRow) {
  return [row.price, row.changePercent, row.marketCap, row.turnoverRate].every(hasValue);
}

export function mergeSearchStockQuoteMetrics(
  row: TStockSearchRow,
  quote: StockDetail,
  normalizedCode: string,
): TStockSearchRow {
  return {
    ...row,
    code: normalizedCode,
    name: row.name || quote.name,
    price: row.price ?? quote.price,
    changePercent: row.changePercent ?? quote.changePercent,
    marketCap: row.marketCap ?? quote.marketCap,
    turnoverRate: row.turnoverRate ?? quote.turnoverRate,
  };
}

function hasValue(value: string | number | undefined) {
  return value !== undefined && value !== null && value !== '' && value !== '--';
}
