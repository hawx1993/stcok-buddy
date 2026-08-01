import type { IBoardDashboardMetric } from '../../../shared/types';
import cx from '../../../shared/cx';
import styles from '../index.module.scss';

interface IBoardDashboardQuadrantProps {
  items: IBoardDashboardMetric[];
  onOpenBoard(metric: IBoardDashboardMetric): void;
}

export function BoardDashboardQuadrant({ items, onOpenBoard }: IBoardDashboardQuadrantProps) {
  const points = items.filter(
    (item) => item.fundScore !== null && item.momentumScore !== null,
  );

  if (!points.length) return <div className={styles['empty-list']}>暂无图表数据</div>;

  return (
    <div className={styles['board-dashboard-quadrant']} aria-label='资金强度和价格强度四象限'>
      <div className={styles['quadrant-axis-x']} />
      <div className={styles['quadrant-axis-y']} />
      <span className={cx(styles['quadrant-label'], styles['quadrant-label-hot'])}>风头正盛</span>
      <span className={cx(styles['quadrant-label'], styles['quadrant-label-potential'])}>潜力蓄势</span>
      <span className={cx(styles['quadrant-label'], styles['quadrant-label-risk'])}>谨慎追高</span>
      <span className={cx(styles['quadrant-label'], styles['quadrant-label-avoid'])}>回避观察</span>
      {points.slice(0, 40).map((item) => {
        const x = clampPoint(item.fundScore ?? 0);
        const y = 100 - clampPoint(item.momentumScore ?? 0);
        return (
          <button
            key={item.boardCode}
            type='button'
            className={cx(styles['quadrant-point'], styles[`bucket-${item.bucket}`])}
            style={{ left: `${x}%`, top: `${y}%` }}
            title={`${item.boardName}：资金 ${formatScore(item.fundScore)}，价格 ${formatScore(item.momentumScore)}`}
            aria-label={`${item.boardName}，资金强度 ${formatScore(item.fundScore)}，价格强度 ${formatScore(item.momentumScore)}`}
            onClick={() => onOpenBoard(item)}
          />
        );
      })}
    </div>
  );
}

function clampPoint(value: number): number {
  return Math.min(96, Math.max(4, value));
}

function formatScore(value: number | null): string {
  return value === null ? '暂无' : value.toFixed(0);
}
