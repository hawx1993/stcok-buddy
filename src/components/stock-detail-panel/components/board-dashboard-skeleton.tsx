import styles from '../index.module.scss';

const KPI_SKELETON_COUNT = 4;
const RANKING_SKELETON_COUNT = 5;

export function BoardDashboardSkeleton() {
  return (
    <div className={styles['board-dashboard-skeleton']} aria-label='板块 Dashboard 加载中'>
      <div className={styles['board-dashboard-skeleton-summary']}>
        {Array.from({ length: KPI_SKELETON_COUNT }, (_, index) => (
          <div className={styles['board-dashboard-skeleton-kpi']} key={index}>
            <span />
            <strong />
            <em />
            <small />
          </div>
        ))}
      </div>

      <section className={styles['board-dashboard-section']}>
        <div className={styles['board-dashboard-skeleton-title']} />
        <div className={styles['board-dashboard-skeleton-ranking']}>
          {Array.from({ length: RANKING_SKELETON_COUNT }, (_, index) => (
            <div className={styles['board-dashboard-skeleton-row']} key={index}>
              <span />
              <strong />
              <em />
            </div>
          ))}
        </div>
      </section>

      <section className={styles['board-dashboard-section']}>
        <div className={styles['board-dashboard-skeleton-title']} />
        <div className={styles['board-dashboard-skeleton-quadrant']}>
          <span />
          <span />
          <span />
          <span />
        </div>
      </section>
    </div>
  );
}
