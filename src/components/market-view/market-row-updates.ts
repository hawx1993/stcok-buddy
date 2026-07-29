import type { MarketQuoteRow } from '../../shared/types.js';

export interface IMarketRowValueUpdate {
  rows: MarketQuoteRow[];
  changedCodes: string[];
}

/**
 * 一次性全量应用数值更新（保持当前显示顺序不变）。
 * - 已存在行：用最新数据替换，数据有变化的记入 changedCodes（用于闪烁高亮）
 * - 新增行：追加到列表末尾（顺序由每分钟的排序检查统一纠正）
 * - 删除行：直接从列表移除
 * 所有变化在同一个渲染帧内生效，单元格同时闪烁，不按顺序逐批闪烁。
 */
export function applyMarketRowValueUpdate(
  currentRows: MarketQuoteRow[],
  targetRows: MarketQuoteRow[],
): IMarketRowValueUpdate {
  if (!currentRows.length) {
    return { rows: targetRows, changedCodes: targetRows.map((row) => row.code) };
  }
  const targetByCode = new Map(targetRows.map((row) => [row.code, row]));
  const changedCodes: string[] = [];
  const nextRows: MarketQuoteRow[] = [];
  for (const row of currentRows) {
    const targetRow = targetByCode.get(row.code);
    if (!targetRow) {
      changedCodes.push(row.code);
      continue;
    }
    // 目标行缺少行业数据时保留当前值，避免已加载的行业信息丢失
    const nextRow = targetRow.industry || !row.industry ? targetRow : { ...targetRow, industry: row.industry };
    if (!sameMarketRowData(row, nextRow)) changedCodes.push(row.code);
    nextRows.push(nextRow);
  }
  const currentCodeSet = new Set(currentRows.map((row) => row.code));
  for (const row of targetRows) {
    if (currentCodeSet.has(row.code)) continue;
    changedCodes.push(row.code);
    nextRows.push(row);
  }
  return { rows: nextRows, changedCodes };
}

export function sameMarketRows(firstRows: MarketQuoteRow[], secondRows: MarketQuoteRow[]) {
  return (
    firstRows.length === secondRows.length &&
    firstRows.every((row, index) => {
      const secondRow = secondRows[index];
      return secondRow !== undefined && sameMarketRowData(row, secondRow);
    })
  );
}

export function sameMarketRowData(firstRow: MarketQuoteRow, secondRow: MarketQuoteRow) {
  return (
    firstRow.code === secondRow.code &&
    firstRow.name === secondRow.name &&
    firstRow.price === secondRow.price &&
    firstRow.changePercent === secondRow.changePercent &&
    firstRow.volume === secondRow.volume &&
    firstRow.amount === secondRow.amount &&
    firstRow.open === secondRow.open &&
    firstRow.high === secondRow.high &&
    firstRow.low === secondRow.low &&
    firstRow.prevClose === secondRow.prevClose &&
    firstRow.turnoverRate === secondRow.turnoverRate &&
    firstRow.marketCap === secondRow.marketCap &&
    firstRow.industry === secondRow.industry
  );
}
