import type { IBoardDashboardMetric, IBoardDashboardSnapshot } from '../../../shared/types';
import styles from '../index.module.scss';

interface IBoardDashboardSummaryProps {
  snapshot: IBoardDashboardSnapshot;
  onOpenBoard(metric: IBoardDashboardMetric): void;
}

export function BoardDashboardSummary({ snapshot, onOpenBoard }: IBoardDashboardSummaryProps) {
  const cards = [
    { key: 'hottest', title: '热度最强板块', metric: snapshot.summary.hottest },
    { key: 'potential', title: '潜力最高板块', metric: snapshot.summary.potential },
    { key: 'avoid', title: '风险最高板块', metric: snapshot.summary.avoid },
    { key: 'leader', title: '龙头最强板块', metric: snapshot.summary.strongestLeader },
  ];

  return (
    <div className={styles['board-dashboard-summary']}>
      {cards.map((card) => (
        <button
          key={card.key}
          type='button'
          className={styles['board-dashboard-kpi']}
          disabled={!card.metric}
          onClick={() => card.metric && onOpenBoard(card.metric)}
        >
          <span>{card.title}</span>
          <strong>{card.metric?.boardName ?? '暂无数据'}</strong>
          <em>{card.metric?.heatScore === null || card.metric?.heatScore === undefined ? '暂无评分' : `${card.metric.heatScore.toFixed(1)} 分`}</em>
          <small>{card.metric?.reason ?? '等待真实板块数据补齐'}</small>
        </button>
      ))}
    </div>
  );
}
