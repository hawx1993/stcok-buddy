import type { BoardDetail, MarketBoardRow } from '../../../src/shared/types.js';
import type { IConditionScreenerLeadingBoard } from './condition-screener-types.js';
import type { BoardConstituentRecord, MarketBoardRecord } from './types.js';

export interface IConditionScreenerBoardDependencies {
  listMarketBoards(): Promise<MarketBoardRecord[]>;
  listBoardConstituents(boardCode: string): Promise<BoardConstituentRecord[]>;
  getRemoteBoards(): Promise<MarketBoardRow[]>;
  getBoardDetail(boardCode: string): Promise<BoardDetail>;
}

export interface IConditionScreenerBoardScope {
  boards: IConditionScreenerLeadingBoard[];
  membershipByCode: Map<string, string[]>;
}

const LEADING_BOARD_LIMIT = 5;

export async function loadConditionScreenerLeadingBoardScope(
  dependencies: IConditionScreenerBoardDependencies,
  warnings: string[],
): Promise<IConditionScreenerBoardScope> {
  let boards = await loadLocalBoards(dependencies, warnings);
  if (!boards.length) boards = await loadRemoteBoards(dependencies, warnings);
  const leadingBoards = boards
    .map(toLeadingBoard)
    .filter((board): board is IConditionScreenerLeadingBoard => board !== undefined)
    .sort((left, right) => right.changePercent - left.changePercent || left.code.localeCompare(right.code))
    .slice(0, LEADING_BOARD_LIMIT);
  if (!leadingBoards.length) {
    warnings.push('暂无本地板块快照，无法执行今日领涨板块条件');
    return emptyConditionScreenerBoardScope();
  }

  const membershipByCode = new Map<string, string[]>();
  for (const board of leadingBoards) {
    const constituents = await loadBoardConstituents(dependencies, board, warnings);
    for (const constituent of constituents) {
      membershipByCode.set(constituent.code, [...(membershipByCode.get(constituent.code) ?? []), board.name]);
    }
  }
  if (!membershipByCode.size) warnings.push('今日领涨板块缺少可用成分股数据，无法执行板块范围条件');
  return { boards: leadingBoards, membershipByCode };
}

export function emptyConditionScreenerBoardScope(): IConditionScreenerBoardScope {
  return { boards: [], membershipByCode: new Map() };
}

async function loadLocalBoards(dependencies: IConditionScreenerBoardDependencies, warnings: string[]) {
  try {
    return await dependencies.listMarketBoards();
  } catch (error) {
    warnings.push(`暂无本地板块快照，DuckDB 读取失败：${formatError(error)}`);
    return [];
  }
}

async function loadRemoteBoards(dependencies: IConditionScreenerBoardDependencies, warnings: string[]) {
  try {
    const boards = await dependencies.getRemoteBoards();
    if (!boards.length) warnings.push('stock-sdk 暂不可用，未返回今日板块行情');
    return boards.map((board) => ({
      code: board.code,
      name: board.name,
      changePercent: finiteNumber(board.changePercent),
      amount: finiteNumber(board.amount),
      source: 'stock-sdk',
      updatedAt: new Date().toISOString(),
    }));
  } catch (error) {
    warnings.push(`stock-sdk 暂不可用，读取今日板块行情失败：${formatError(error)}`);
    return [];
  }
}

function toLeadingBoard(board: MarketBoardRecord): IConditionScreenerLeadingBoard | undefined {
  if (board.changePercent === undefined || !Number.isFinite(board.changePercent)) return undefined;
  return { code: board.code, name: board.name, kind: board.kind, changePercent: board.changePercent };
}

async function loadBoardConstituents(
  dependencies: IConditionScreenerBoardDependencies,
  board: IConditionScreenerLeadingBoard,
  warnings: string[],
) {
  try {
    const localRows = await dependencies.listBoardConstituents(board.code);
    if (localRows.length) return localRows.map((row) => ({ code: row.stockCode, name: row.stockName }));
  } catch (error) {
    warnings.push(`板块 ${board.name} 本地成分股读取失败：${formatError(error)}`);
  }
  try {
    const detail = await dependencies.getBoardDetail(board.code);
    return (detail.constituents ?? []).map((row) => ({ code: row.code, name: row.name }));
  } catch (error) {
    warnings.push(`板块 ${board.name} 成分股数据暂不可用：${formatError(error)}`);
    return [];
  }
}

function finiteNumber(value: number | string | undefined) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
