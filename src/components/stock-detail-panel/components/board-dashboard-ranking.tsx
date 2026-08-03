import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { IBoardDashboardMetric } from '../../../shared/types';
import cx from '../../../shared/cx';
import styles from '../index.module.scss';

interface IBoardDashboardRankingProps {
  title: string;
  items: IBoardDashboardMetric[];
  onOpenBoard(metric: IBoardDashboardMetric): void;
}

const ROW_HEIGHT = 72;

export function BoardDashboardRanking({ title, items, onOpenBoard }: IBoardDashboardRankingProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5,
  });

  return (
    <section className={styles['board-dashboard-section']}>
      <div className={styles['section-title']}>{title}</div>
      {items.length ? (
        <div className={styles['board-dashboard-ranking']} ref={listRef}>
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((row) => {
              const item = items[row.index];
              if (!item) return null;
              return (
                <button
                  key={item.boardCode}
                  ref={virtualizer.measureElement}
                  data-index={row.index}
                  type='button'
                  className={styles['board-dashboard-row']}
                  style={{ transform: `translateY(${row.start}px)` }}
                  onClick={() => onOpenBoard(item)}
                >
                  <span className={styles['board-rank']}>{item.heatRank ?? row.index + 1}</span>
                  <span className={styles['board-row-main']}>
                    <strong>{item.boardName}</strong>
                    <em>{formatBoardDescription(item)}</em>
                  </span>
                  <span className={styles['board-row-side']}>
                    <b>{item.heatScore === null ? '--' : item.heatScore?.toFixed(1)}</b>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className={styles['empty-list']}>暂无榜单数据</div>
      )}
    </section>
  );
}

function formatBoardDescription(item: IBoardDashboardMetric): string {
  const kindLabel = item.boardKind === 'industry' ? '行业' : item.boardKind === 'concept' ? '概念' : '';
  return kindLabel ? `${kindLabel} · ${item.reason}` : item.reason;
}

function formatPercent(value: number | null): string {
  if (value === null) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function trendClass(value: number | null): string | undefined {
  if (value === null || value === 0) return undefined;
  return value > 0 ? 'up' : 'down';
}
