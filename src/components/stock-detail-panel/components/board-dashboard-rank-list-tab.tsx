import type { IBoardDashboardMetric, TBoardDashboardRange } from '../../../shared/types';
import { selectTopBoardChangeRankings, selectTopBoardFundInflowRankings } from '../../../shared/board-dashboard-rankings';
import cx from '../../../shared/cx';
import styles from '../index.module.scss';

interface IBoardDashboardRankListTabProps {
  items: IBoardDashboardMetric[];
  range: TBoardDashboardRange;
  onOpenBoard(metric: IBoardDashboardMetric): void;
}

type TBoardRankingKind = 'change' | 'fund';

interface IBoardRankListProps {
  title: string;
  emptyText: string;
  kind: TBoardRankingKind;
  items: IBoardDashboardMetric[];
  onOpenBoard(metric: IBoardDashboardMetric): void;
}

const rangeLabels: Record<TBoardDashboardRange, string> = {
  today: '今日',
  'five-days': '近 5 日',
  'twenty-days': '近 20 日',
};

export function BoardDashboardRankListTab({ items, range, onOpenBoard }: IBoardDashboardRankListTabProps) {
  const changeRankings = selectTopBoardChangeRankings(items);
  const fundInflowRankings = selectTopBoardFundInflowRankings(items);
  const rangeLabel = rangeLabels[range];

  return (
    <div className={styles['board-dashboard-rank-tab']}>
      <BoardRankList
        title={`${rangeLabel}板块涨幅榜`}
        emptyText={`暂无${rangeLabel}板块涨幅榜数据`}
        kind='change'
        items={changeRankings}
        onOpenBoard={onOpenBoard}
      />
      <BoardRankList
        title={`${rangeLabel}资金净流入榜`}
        emptyText={`暂无${rangeLabel}资金净流入榜数据`}
        kind='fund'
        items={fundInflowRankings}
        onOpenBoard={onOpenBoard}
      />
    </div>
  );
}

function BoardRankList({ title, emptyText, kind, items, onOpenBoard }: IBoardRankListProps) {
  return (
    <section className={styles['board-dashboard-section']}>
      <div className={styles['section-title']}>{title}</div>
      {items.length ? (
        <div className={styles['board-dashboard-simple-ranking']}>
          {items.map((item, index) => (
            <button
              key={`${kind}-${item.boardCode}`}
              type='button'
              className={styles['board-dashboard-simple-row']}
              onClick={() => onOpenBoard(item)}
            >
              <span className={styles['board-rank']}>{index + 1}</span>
              <span className={styles['board-row-main']}>
                <strong>{item.boardName}</strong>
                <em>{item.boardKind ?? 'unknown'} · {item.reason}</em>
              </span>
              <span className={styles['board-row-side']}>
                <b className={cx(kind === 'change' ? trendClass(item.changePercent) : trendClass(item.mainNetInflow))}>{formatRankingValue(item, kind)}</b>
                <em>{kind === 'change' ? formatMoney(item.mainNetInflow) : formatPercent(item.changePercent)}</em>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className={styles['empty-list']}>{emptyText}</div>
      )}
    </section>
  );
}

function formatRankingValue(item: IBoardDashboardMetric, kind: TBoardRankingKind): string {
  return kind === 'change' ? formatPercent(item.changePercent) : formatMoney(item.mainNetInflow);
}

function formatPercent(value: number | null): string {
  if (value === null) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatMoney(value: number | null): string {
  if (value === null) return '--';
  return `${value >= 0 ? '+' : ''}${(value / 100000000).toFixed(2)}亿`;
}

function trendClass(value: number | null): string | undefined {
  if (value === null || value === 0) return undefined;
  return value > 0 ? 'up' : 'down';
}
