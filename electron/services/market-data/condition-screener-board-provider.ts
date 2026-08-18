import type { BoardDetail, MarketBoardRow } from '../../../src/shared/types.js';
import type {
  IConditionScreenerSinaBoardsResult,
  IConditionScreenerSinaConstituentsResult,
} from './condition-screener-sina-board-provider.js';
import type { IConditionScreenerLeadingBoard } from './condition-screener-types.js';
import type { BoardConstituentRecord, MarketBoardRecord } from './types.js';

export interface IConditionScreenerBoardDependencies {
  listMarketBoards(): Promise<MarketBoardRecord[]>;
  listBoardConstituents(boardCode: string): Promise<BoardConstituentRecord[]>;
  getRemoteBoards(): Promise<MarketBoardRow[]>;
  getBoardDetail(boardCode: string): Promise<BoardDetail>;
  getAStockDataBoards(): Promise<IConditionScreenerSinaBoardsResult>;
  getAStockDataBoardConstituents(boardCodes: string[]): Promise<IConditionScreenerSinaConstituentsResult>;
}

export interface IConditionScreenerBoardScope {
  boards: IConditionScreenerLeadingBoard[];
  membershipByCode: Map<string, string[]>;
}

type TBoardScopeSource = 'local' | 'stock-sdk' | 'a-stock-data';

const LEADING_BOARD_LIMIT = 5;

export async function loadConditionScreenerLeadingBoardScope(
  dependencies: IConditionScreenerBoardDependencies,
  warnings: string[],
): Promise<IConditionScreenerBoardScope> {
  let boards = await loadLocalBoards(dependencies, warnings);
  let source: TBoardScopeSource = 'local';
  if (!boards.length) {
    boards = await loadRemoteBoards(dependencies, warnings);
    source = 'stock-sdk';
  }

  let leadingBoards = selectLeadingBoards(boards);
  if (!leadingBoards.length) {
    const previousSource = source;
    boards = await loadAStockDataBoards(dependencies, warnings);
    source = 'a-stock-data';
    leadingBoards = selectLeadingBoards(boards);
    if (leadingBoards.length) warnings.push(fallbackSourceMessage(previousSource));
  }
  if (!leadingBoards.length) {
    warnings.push('暂无本地板块快照，无法执行今日领涨板块条件');
    return emptyConditionScreenerBoardScope();
  }

  const membershipByCode =
    source === 'a-stock-data'
      ? await loadAStockDataBoardMembership(dependencies, leadingBoards, warnings)
      : await loadPrimaryBoardMembership(dependencies, leadingBoards, warnings);
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

async function loadAStockDataBoards(dependencies: IConditionScreenerBoardDependencies, warnings: string[]) {
  try {
    const result = await dependencies.getAStockDataBoards();
    warnings.push(...result.warnings);
    if (!result.boards.length) warnings.push('a-stock-data 暂不可用，未返回新浪板块行情');
    return result.boards;
  } catch (error) {
    warnings.push(`a-stock-data 暂不可用，读取新浪板块行情失败：${formatError(error)}`);
    return [];
  }
}

function fallbackSourceMessage(source: Exclude<TBoardScopeSource, 'a-stock-data'>) {
  return source === 'local'
    ? '本地板块排行字段不可用，已使用 a-stock-data 新浪板块数据继续筛选'
    : 'stock-sdk 板块行情暂不可用，已使用 a-stock-data 新浪板块数据继续筛选';
}

function selectLeadingBoards(boards: MarketBoardRecord[]) {
  return boards
    .map(toLeadingBoard)
    .filter((board): board is IConditionScreenerLeadingBoard => board !== undefined)
    .sort((left, right) => right.changePercent - left.changePercent || left.code.localeCompare(right.code))
    .slice(0, LEADING_BOARD_LIMIT);
}

function toLeadingBoard(board: MarketBoardRecord): IConditionScreenerLeadingBoard | undefined {
  if (board.changePercent === undefined || !Number.isFinite(board.changePercent)) return undefined;
  return { code: board.code, name: board.name, kind: board.kind, changePercent: board.changePercent };
}

async function loadPrimaryBoardMembership(
  dependencies: IConditionScreenerBoardDependencies,
  boards: IConditionScreenerLeadingBoard[],
  warnings: string[],
) {
  const membershipByCode = new Map<string, string[]>();
  for (const board of boards) {
    const constituents = await loadBoardConstituents(dependencies, board, warnings);
    addBoardMembership(membershipByCode, board.name, constituents);
  }
  return membershipByCode;
}

async function loadAStockDataBoardMembership(
  dependencies: IConditionScreenerBoardDependencies,
  boards: IConditionScreenerLeadingBoard[],
  warnings: string[],
) {
  const membershipByCode = new Map<string, string[]>();
  try {
    const result = await dependencies.getAStockDataBoardConstituents(boards.map((board) => board.code));
    warnings.push(...result.warnings);
    const nameByCode = new Map(boards.map((board) => [board.code, board.name]));
    for (const row of result.rows) {
      const boardName = nameByCode.get(row.boardCode);
      if (!boardName) continue;
      addBoardMembership(membershipByCode, boardName, [{ code: row.stockCode, name: row.stockName }]);
    }
  } catch (error) {
    warnings.push(`a-stock-data 暂不可用，读取新浪板块成分股失败：${formatError(error)}`);
  }
  return membershipByCode;
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

function addBoardMembership(
  membershipByCode: Map<string, string[]>,
  boardName: string,
  constituents: Array<{ code: string; name: string }>,
) {
  for (const constituent of constituents) {
    membershipByCode.set(constituent.code, [...(membershipByCode.get(constituent.code) ?? []), boardName]);
  }
}

function finiteNumber(value: number | string | undefined) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
