import type { MarketFundFlow, NorthboundFlowSummary } from 'stock-sdk';

function toYi(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value / 100_000_000;
}

export function selectLatestMainFundFlowYi(rows: MarketFundFlow[]): number | null {
  const latest = rows
    .filter((row) => row.mainNetInflow !== null && row.mainNetInflow !== undefined)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0];
  return toYi(latest?.mainNetInflow);
}

function isNorthboundRow(row: NorthboundFlowSummary): boolean {
  return row.direction?.includes('北向') || row.direction?.includes('North');
}

function pickNorthboundValue(row: NorthboundFlowSummary): number | null {
  return row.netBuyAmount ?? row.netInflow ?? null;
}

export function sumNorthFundFlowYi(rows: NorthboundFlowSummary[]): number | null {
  let hasValue = false;
  let total = 0;
  for (const row of rows) {
    if (!isNorthboundRow(row)) continue;
    const value = pickNorthboundValue(row);
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    hasValue = true;
    total += value;
  }
  return hasValue ? toYi(total) : null;
}
