import type { MarketFundFlow, NorthboundFlowSummary } from 'stock-sdk';

function toYi(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value / 100_000_000;
}

export function selectLatestMainFundFlowYi(rows: MarketFundFlow[], tradeDate?: string): number | null {
  const candidates = rows.filter(
    (row) => row.mainNetInflow !== null && row.mainNetInflow !== undefined && Number.isFinite(row.mainNetInflow),
  );
  if (!candidates.length) return null;

  const target = tradeDate ?? [...candidates].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0]?.date;
  const matched = candidates.filter((row) => row.date === target);
  if (!matched.length) return null;

  const total = matched.reduce((sum, row) => sum + (row.mainNetInflow ?? 0), 0);
  return toYi(total);
}

function isNorthboundRow(row: NorthboundFlowSummary): boolean {
  return row.direction?.includes('北向') || row.direction?.includes('North');
}

function isTradeDateRow(row: NorthboundFlowSummary, tradeDate?: string): boolean {
  return tradeDate === undefined || row.date === tradeDate;
}

function pickNorthboundValue(row: NorthboundFlowSummary): number | null {
  if (row.netBuyAmount !== null && row.netBuyAmount !== undefined) {
    return row.netBuyAmount === 0 ? null : row.netBuyAmount;
  }
  return row.netInflow ?? null;
}

export function sumNorthFundFlowYi(rows: NorthboundFlowSummary[], tradeDate?: string): number | null {
  let hasValue = false;
  let total = 0;
  for (const row of rows) {
    if (!isNorthboundRow(row) || !isTradeDateRow(row, tradeDate)) continue;
    const value = pickNorthboundValue(row);
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    hasValue = true;
    total += value;
  }
  return hasValue ? toYi(total) : null;
}
