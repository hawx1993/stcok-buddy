import {
  runAStockDataFn,
  type ISinaBoardConstituentResult,
  type ISinaBoardRankResult,
} from '../stock/a-stock-data-runner.js';
import { normalizeASymbol } from '../stock/symbols.js';
import type { BoardConstituentRecord, MarketBoardRecord } from './types.js';

export interface IConditionScreenerSinaBoardsResult {
  boards: MarketBoardRecord[];
  warnings: string[];
}

export interface IConditionScreenerSinaConstituentsResult {
  rows: BoardConstituentRecord[];
  warnings: string[];
}

export async function fetchConditionScreenerSinaBoards(): Promise<IConditionScreenerSinaBoardsResult> {
  const result = await runAStockDataFn<ISinaBoardRankResult>('sina_board_rank', {});
  const updatedAt = new Date().toISOString();
  return {
    boards: result.rows.flatMap((row) => toMarketBoardRecord(row, updatedAt)),
    warnings: result.failed_kinds.map(
      (kind) => `新浪${kind === 'industry' ? '行业' : '概念'}板块排行暂不可用，结果未覆盖该类板块`,
    ),
  };
}

export async function fetchConditionScreenerSinaConstituents(
  boardCodes: string[],
): Promise<IConditionScreenerSinaConstituentsResult> {
  const codes = [...new Set(boardCodes.map((code) => code.trim()).filter(Boolean))];
  if (!codes.length) return { rows: [], warnings: [] };

  const result = await runAStockDataFn<ISinaBoardConstituentResult>('sina_board_constituents', {
    board_codes: codes.join(','),
  });
  const requestedCodes = new Set(codes);
  const positionByBoard = new Map<string, number>();
  const updatedAt = new Date().toISOString();
  const rows: BoardConstituentRecord[] = [];
  for (const row of result.rows) {
    const boardCode = row.board_code.trim();
    const stockCode = normalizeASymbol(row.stock_code);
    const stockName = row.stock_name.trim();
    if (!requestedCodes.has(boardCode) || !/^\d{6}$/.test(stockCode) || !stockName) continue;
    const position = positionByBoard.get(boardCode) ?? 0;
    positionByBoard.set(boardCode, position + 1);
    rows.push({ boardCode, stockCode, stockName, position, updatedAt });
  }

  const failedCodes = result.failed_board_codes.filter((code) => requestedCodes.has(code));
  return {
    rows,
    warnings: failedCodes.length ? [`新浪板块成分股暂不可用：${failedCodes.join('、')}`] : [],
  };
}

function toMarketBoardRecord(row: ISinaBoardRankResult['rows'][number], updatedAt: string): MarketBoardRecord[] {
  const code = row.code.trim();
  const name = row.name.trim();
  if (!code || !name || !Number.isFinite(row.change_percent)) return [];
  return [
    {
      code,
      name,
      kind: row.kind,
      changePercent: row.change_percent,
      amount: finiteNonNegative(row.amount),
      source: 'a-stock-data:sina',
      updatedAt,
    },
  ];
}

function finiteNonNegative(value: number | null): number | undefined {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : undefined;
}
