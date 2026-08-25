import { useMemo, useState } from 'react';
import type { MarketBoardRow } from '../../../shared/types';
import { formatMoney, formatPercent, formatVolume, tone } from '../market-format';
import cx from '../../../shared/cx';
import styles from '../index.module.scss';

type TBoardFilter = 'industry' | 'concept';

const BOARD_HEAT_SKELETON_ROWS = ['rank-1', 'rank-2', 'rank-3', 'rank-4', 'rank-5', 'rank-6', 'rank-7', 'rank-8'];

interface IBoardHeatPanelProps {
  boards: MarketBoardRow[];
  loading: boolean;
  error?: string;
  onOpen(board: MarketBoardRow): void;
}

/** Ranks boards from the latest quotation snapshot; heat combines turnover and intraday momentum. */
export function BoardHeatPanel({ boards, error, loading, onOpen }: IBoardHeatPanelProps) {
  const [filter, setFilter] = useState<TBoardFilter>('industry');
  const rankedBoards = useMemo(() => rankBoards(boards, filter), [boards, filter]);

  return (
    <section className={styles.boardHeatPanel} aria-label='板块热度'>
      <div className={styles.boardHeatHeader}>
        <div>
          <h2>板块热度</h2>
          <p>按同花顺板块热度顺序展示，点击可查看板块详情</p>
        </div>
        <div className={styles.boardHeatFilters}>
          {(['industry', 'concept'] as const).map((item) => (
            <button
              key={item}
              className={cx(filter === item && styles.boardHeatFilterActive)}
              onClick={() => setFilter(item)}
              type='button'
            >
              {item === 'industry' ? '行业板块' : '概念板块'}
            </button>
          ))}
        </div>
      </div>
      {rankedBoards.length ? (
        <div className={styles.boardHeatList}>
          {rankedBoards.map((item, index) => (
            <button key={item.board.code} className={styles.boardHeatRow} onClick={() => onOpen(item.board)} type='button'>
              <span className={cx(styles.boardHeatRank, index < 3 && styles[`boardHeatRank${index + 1}`])}>{index + 1}</span>
              <span className={styles.boardHeatName}>
                <span className={styles.boardHeatTitle}>
                  <strong>{item.board.name}</strong>
                  {item.tags.length ? (
                    <span className={styles.boardHeatTags}>
                      {item.tags.map((tag) => <em key={tag}>{tag}</em>)}
                    </span>
                  ) : null}
                </span>
                <small>{item.board.amount === undefined ? '成交额 --' : `成交额 ${formatMoney(item.board.amount)}`}</small>
              </span>
              <span className={styles.boardHeatScore}>{item.activityLabel}</span>
              <strong className={cx(styles.boardHeatChange, styles[tone(item.changePercent)])}>
                {formatPercent(item.changePercent)}
              </strong>
              <span className={styles.boardHeatArrow} aria-hidden='true'>›</span>
            </button>
          ))}
        </div>
      ) : loading ? (
        <BoardHeatSkeleton />
      ) : (
        <div className={styles.boardHeatState}>{error ?? '暂无可用的板块行情'}</div>
      )}
    </section>
  );
}

export function rankBoards(boards: MarketBoardRow[], filter: TBoardFilter) {
  return boards
    .filter((board) => (board.boardKind ?? 'industry') === filter)
    .slice(0, 30)
    .map((board, index) => ({
      board,
      activityLabel: formatBoardActivityLabel(board),
      changePercent: board.changePercent,
      tags: buildBoardHeatTags(board, index),
    }));
}

export function formatBoardActivityLabel(board: MarketBoardRow) {
  if (board.volume !== undefined) return `量能 ${formatVolume(toBoardLotVolume(board.volume))}`;
  if (board.amount !== undefined) return `成交额 ${formatMoney(board.amount)}`;
  return '活跃度 --';
}

export function buildBoardHeatTags(board: MarketBoardRow, index: number) {
  const tags: string[] = [];
  if (index < 3) tags.push('热榜前三');
  const changePercent = toNumber(board.changePercent);
  if (changePercent !== undefined && changePercent >= 2) tags.push('涨幅居前');
  const amount = toNumber(board.amount);
  if (amount !== undefined && amount >= 10_000_000_000) tags.push('成交活跃');
  return tags.slice(0, 2);
}

function toBoardLotVolume(value: number | string) {
  const num = toNumber(value);
  if (num === undefined) return value;
  return num / 100;
}

function toNumber(value: number | string | undefined) {
  if (value === undefined) return undefined;
  const parsed = typeof value === 'string' ? Number(value.replace(/[,，%]/g, '').trim()) : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function BoardHeatSkeleton() {
  return (
    <div className={styles.boardHeatSkeleton} aria-label='板块热度加载中'>
      {BOARD_HEAT_SKELETON_ROWS.map((key) => (
        <div className={styles.boardHeatSkeletonRow} key={key}>
          <span className={styles.boardHeatSkeletonRank} />
          <span className={styles.boardHeatSkeletonName}>
            <i />
            <em />
          </span>
          <span className={styles.boardHeatSkeletonMetric} />
          <span className={styles.boardHeatSkeletonChange} />
          <span className={styles.boardHeatSkeletonArrow} />
        </div>
      ))}
    </div>
  );
}
