import type { IDragonTigerReasonStat } from '../../../shared/types';
import { formatMoney } from '../market-format';
import styles from '../index.module.scss';

export function DragonTigerReasonList({ reasons }: { reasons: IDragonTigerReasonStat[] }) {
  const maxCount = Math.max(...reasons.map((item) => item.count), 1);

  return (
    <div className={styles.dragonTigerReasonCard}>
      <div className={styles.dragonTigerSubTitle}>上榜原因聚合</div>
      {reasons.length ? (
        <div className={styles.dragonTigerReasons}>
          {reasons.slice(0, 6).map((item) => (
            <div key={item.reason} className={styles.dragonTigerReasonItem}>
              <div className={styles.dragonTigerReasonHead}>
                <span>{item.reason}</span>
                <em>{item.count} 次 · {formatMoney(item.netBuyAmount)}</em>
              </div>
              <div className={styles.dragonTigerReasonTrack}>
                <span style={{ width: `${Math.max(8, (item.count / maxCount) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.dragonTigerEmpty}>暂无上榜原因聚合</div>
      )}
    </div>
  );
}
