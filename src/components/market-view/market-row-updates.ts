import type { MarketQuoteRow } from '../../shared/types.js';
import { parsePercent } from './market-format.js';

export const MARKET_UPDATE_BATCH_SIZE = 4;

export interface IMarketRowBatch {
  rows: MarketQuoteRow[];
  changedCodes: string[];
  movedCodes: string[];
  pending: boolean;
}

export function applyMarketRowUpdateBatch(
  currentRows: MarketQuoteRow[],
  targetRows: MarketQuoteRow[],
  limit = MARKET_UPDATE_BATCH_SIZE,
  allowReorder = true,
): IMarketRowBatch {
  if (!currentRows.length) {
    return { rows: targetRows, changedCodes: targetRows.map((row) => row.code), movedCodes: [], pending: false };
  }

  const currentByCode = new Map(currentRows.map((row) => [row.code, row]));
  const targetRowsWithPreservedIndustry = targetRows.map((row) => withCurrentIndustry(row, currentByCode.get(row.code)));
  const targetByCode = new Map(targetRowsWithPreservedIndustry.map((row) => [row.code, row]));
  const immediateIndustryCodes: string[] = [];
  const baseRows = currentRows.map((row) => {
    const industry = targetByCode.get(row.code)?.industry;
    if (!industry || row.industry === industry) return row;
    immediateIndustryCodes.push(row.code);
    return { ...row, industry };
  });
  const baseByCode = new Map(baseRows.map((row) => [row.code, row]));
  const orderedTargetRows = allowReorder
    ? targetRowsWithPreservedIndustry
    : baseRows.map((row) => targetByCode.get(row.code)).filter((row): row is MarketQuoteRow => Boolean(row));
  const selectedCodes: string[] = [];
  const rowsToCompare = orderedTargetRows;

  for (let index = 0; index < rowsToCompare.length && selectedCodes.length < limit; index += 1) {
    const targetRow = rowsToCompare[index];
    const currentRow = baseByCode.get(targetRow.code);
    const posChanged = allowReorder && baseRows[index]?.code !== targetRow.code;
    // 仅当涨跌幅不同时，位置交换才有意义；同涨跌幅（如集体涨停 9.98%）顺序保持稳定
    const meaningfulPosChange =
      posChanged &&
      parsePercent(baseRows[index]?.changePercent) !== parsePercent(targetRow.changePercent);

    if (!currentRow || !sameMarketRowData(currentRow, targetRow) || meaningfulPosChange) {
      selectedCodes.push(targetRow.code);
    }
  }
  if (!allowReorder) {
    for (const row of baseRows) {
      if (selectedCodes.length >= limit) break;
      const targetRow = targetByCode.get(row.code);
      if (targetRow && !sameMarketRowData(row, targetRow) && !selectedCodes.includes(row.code)) selectedCodes.push(row.code);
    }
  }
  for (const row of baseRows) {
    if (selectedCodes.length >= limit) break;
    if (!targetByCode.has(row.code) && !selectedCodes.includes(row.code)) selectedCodes.push(row.code);
  }

  if (!selectedCodes.length)
    return { rows: immediateIndustryCodes.length ? baseRows : currentRows, changedCodes: immediateIndustryCodes, movedCodes: [], pending: false };

  const selected = new Set(selectedCodes);
  const nextRows = baseRows.filter((row) => targetByCode.has(row.code) && !selected.has(row.code));
  const movedCodes: string[] = [];

  for (const code of selectedCodes) {
    const targetRow = targetByCode.get(code);
    if (!targetRow) continue;
    const targetIndex = orderedTargetRows.findIndex((row) => row.code === code);
    if (targetIndex < 0) continue;
    const currentIndex = baseRows.findIndex((row) => row.code === code);
    if (currentIndex !== targetIndex) movedCodes.push(code);
    nextRows.splice(Math.min(targetIndex, nextRows.length), 0, targetRow);
  }

  const pending = !sameMarketRows(nextRows, orderedTargetRows);
  const currentIndexByCode = new Map(baseRows.map((row, index) => [row.code, index]));
  const nextIndexByCode = new Map(nextRows.map((row, index) => [row.code, index]));
  for (const row of currentRows) {
    const nextIndex = nextIndexByCode.get(row.code);
    const currentIndex = currentIndexByCode.get(row.code);
    if (nextIndex !== undefined && currentIndex !== undefined && nextIndex !== currentIndex && !movedCodes.includes(row.code)) {
      movedCodes.push(row.code);
    }
  }
  const changedCodes = [...new Set([...immediateIndustryCodes, ...selectedCodes])];
  return { rows: nextRows, changedCodes, movedCodes, pending };
}

function withCurrentIndustry(targetRow: MarketQuoteRow, currentRow: MarketQuoteRow | undefined) {
  return targetRow.industry || !currentRow?.industry ? targetRow : { ...targetRow, industry: currentRow.industry };
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

/**
 * 更新已有行的数值，并处理新增/删除行（保持当前显示顺序）。
 */
export function applyMarketRowValueUpdateBatch(
  currentRows: MarketQuoteRow[],
  targetRows: MarketQuoteRow[],
  limit = MARKET_UPDATE_BATCH_SIZE,
): IMarketRowBatch {
  if (!currentRows.length) {
    return { rows: targetRows, changedCodes: targetRows.map((row) => row.code), movedCodes: [], pending: false };
  }
  const targetByCode = new Map(targetRows.map((row) => [row.code, row]));
  const changedIndices: number[] = [];
  for (let index = 0; index < currentRows.length; index += 1) {
    const row = currentRows[index];
    const targetRow = targetByCode.get(row.code);
    if (targetRow && !sameMarketRowData(row, targetRow)) changedIndices.push(index);
  }
  const indicesToUpdate = changedIndices.slice(0, limit);
  const updateSet = new Set(indicesToUpdate);
  let nextRows = currentRows.map((row, index) => (updateSet.has(index) ? targetByCode.get(row.code)! : row));

  // 删除 currentRows 中 target 不存在的行
  const rowsToRemove = nextRows.filter((row) => !targetByCode.has(row.code));
  if (rowsToRemove.length) {
    nextRows = nextRows.filter((row) => targetByCode.has(row.code));
  }

  // 新增 target 中 currentRows 没有的行，限制每次新增数量
  const currentCodeSet = new Set(currentRows.map((row) => row.code));
  const newRows = targetRows.filter((row) => !currentCodeSet.has(row.code));
  const addedRows = newRows.slice(0, Math.max(0, limit - indicesToUpdate.length));
  if (addedRows.length) {
    nextRows = [...nextRows, ...addedRows];
  }

  const changedCodes = [
    ...new Set([...indicesToUpdate.map((index) => currentRows[index].code), ...addedRows.map((row) => row.code)]),
  ];
  const pending = changedIndices.length > limit || newRows.length > addedRows.length || rowsToRemove.length > 0;

  return {
    rows: nextRows,
    changedCodes,
    movedCodes: [],
    pending,
  };
}

/**
 * 逐步将 currentRows 调整为 targetRows 的顺序，每次最多移动 limit 只。
 */
export function applyMarketRowOrderUpdateBatch(
  currentRows: MarketQuoteRow[],
  targetRows: MarketQuoteRow[],
  limit = 3,
): IMarketRowBatch {
  if (!currentRows.length) return { rows: targetRows, changedCodes: [], movedCodes: [], pending: false };
  if (sameMarketRows(currentRows, targetRows)) return { rows: currentRows, changedCodes: [], movedCodes: [], pending: false };
  const currentByCode = new Map(currentRows.map((row, index) => [row.code, { row, index }]));
  const targetByCode = new Map(targetRows.map((row, index) => [row.code, { row, index }]));
  const selectedCodes: string[] = [];
  for (let index = 0; index < targetRows.length && selectedCodes.length < limit; index += 1) {
    if (currentRows[index]?.code !== targetRows[index].code) selectedCodes.push(targetRows[index].code);
  }
  for (let index = 0; index < currentRows.length && selectedCodes.length < limit; index += 1) {
    const code = currentRows[index].code;
    if (!targetByCode.has(code) && !selectedCodes.includes(code)) selectedCodes.push(code);
  }
  if (!selectedCodes.length) return { rows: currentRows, changedCodes: [], movedCodes: [], pending: false };
  const selected = new Set(selectedCodes);
  const nextRows = currentRows.filter((row) => !selected.has(row.code));
  const movedCodes: string[] = [];
  for (const code of selectedCodes) {
    const targetInfo = targetByCode.get(code);
    if (targetInfo) {
      const currentIndex = currentByCode.get(code)?.index;
      if (currentIndex === undefined || currentIndex !== targetInfo.index) movedCodes.push(code);
      nextRows.splice(Math.min(targetInfo.index, nextRows.length), 0, targetInfo.row);
    } else {
      movedCodes.push(code);
    }
  }
  return { rows: nextRows, changedCodes: [], movedCodes, pending: !sameMarketRows(nextRows, targetRows) };
}
