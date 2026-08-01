import type { IDragonTigerSummary } from '../../../shared/types';
import { formatMoney } from '../market-format';
import styles from '../index.module.scss';

export function DragonTigerSummary({ summary }: { summary: IDragonTigerSummary }) {
  const buyRatio = summary.totalCount ? `${Math.round((summary.netBuyCount / summary.totalCount) * 100)}%` : '--';
  const cards = [
    { label: '最新交易日', value: summary.tradeDate },
    { label: '上榜记录', value: `${summary.totalCount} 条` },
    { label: '净买额合计', value: formatMoney(summary.netBuyAmount) },
    { label: '净买入占比', value: buyRatio },
  ];

  return (
    <div className={styles.dragonTigerSummary}>
      {cards.map((card) => (
        <div key={card.label} className={styles.dragonTigerMetric}>
          <span>{card.label}</span>
          <strong>{card.value}</strong>
        </div>
      ))}
    </div>
  );
}
