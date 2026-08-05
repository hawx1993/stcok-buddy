import { memo } from 'react';
import type { MarketIndexPeriod, MarketIndexSnapshot } from '../../../shared/types';
import { StockKlineChart } from '../../kline-chart';
import type { TimeframeId } from '../../kline-chart/constants';
import { formatMoney, formatPercent, formatSigned } from '../market-format';
import styles from '../index.module.scss';

export const IndexCard = memo(function IndexCard({
  item,
  period,
  onExpand,
}: {
  item: MarketIndexSnapshot;
  period: MarketIndexPeriod;
  onExpand(item: MarketIndexSnapshot): void;
}) {
  const isDown = Number(item.changePercent) < 0;
  return (
    <div className={styles.indexCard}>
      <button className={styles.expandButton} onClick={() => onExpand(item)} title='放大指数图' type='button'>
        ⛶
      </button>
      <div className={styles.indexTitle}>
        <span>{item.name}</span>
        <strong className={isDown ? 'down' : 'up'}>{item.price ?? '--'}</strong>
        <em className={isDown ? 'down' : 'up'}>
          {formatSigned(item.change)} {formatPercent(item.changePercent)}
        </em>
      </div>
      <div className={styles.chart}>
        {item.minutes.length ? (
          <StockKlineChart
            key={`${item.code}-${period}-${item.minutes[0]?.time}-${item.minutes[item.minutes.length - 1]?.time}`}
            stock={item}
            data={item.minutes}
            height='100%'
            showLegend={false}
            timeframe={period as TimeframeId}
            staticData
          />
        ) : (
          <span className={styles.noChart}>暂无数据</span>
        )}
      </div>
      <div className={styles.indexMeta}>
        <span>今开 {item.open ?? '--'}</span>
        <span>最高 {item.high ?? '--'}</span>
        <span>最低 {item.low ?? '--'}</span>
        <span>成交额 {formatMoney(item.amount)}</span>
      </div>
    </div>
  );
});
