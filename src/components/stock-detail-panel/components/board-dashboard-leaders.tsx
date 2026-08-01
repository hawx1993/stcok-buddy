import type { IBoardDashboardMetric } from '../../../shared/types';
import styles from '../index.module.scss';

interface IBoardDashboardLeadersProps {
  items: IBoardDashboardMetric[];
  onOpenBoard(metric: IBoardDashboardMetric): void;
}

export function BoardDashboardLeaders({ items, onOpenBoard }: IBoardDashboardLeadersProps) {
  return (
    <section className={styles['board-dashboard-section']}>
      <div className={styles['section-title']}>板块龙头候选</div>
      {items.length ? (
        <div className={styles['board-dashboard-leaders']}>
          {items.slice(0, 8).map((item) => (
            <button key={item.boardCode} type='button' onClick={() => onOpenBoard(item)}>
              <span>
                <strong className={styles['board-leader-board-name']}>{item.boardName}</strong>
                <em className={styles['board-leader-score']}>{item.leaderScore === null ? '暂无龙头评分' : `龙头强度 ${item.leaderScore.toFixed(0)}`}</em>
              </span>
              <ul>
                {item.leaders.slice(0, 3).map((leader) => (
                  <li key={leader.code}>
                    <b className={styles['board-leader-stock-name']}>{leader.name}</b>
                    <small>
                      <span className={styles['board-leader-score']}>{leader.leaderScore === null ? '--' : leader.leaderScore.toFixed(0)}</span> · {leader.reason}
                    </small>
                  </li>
                ))}
              </ul>
            </button>
          ))}
        </div>
      ) : (
        <div className={styles['empty-list']}>暂无龙头候选数据</div>
      )}
    </section>
  );
}
