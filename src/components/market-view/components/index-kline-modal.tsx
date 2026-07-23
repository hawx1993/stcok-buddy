import { createPortal } from 'react-dom';
import { StockKlineChart } from '../../kline-chart';
import type { TLoadOlderKline } from '../../kline-chart';
import type { MarketIndexPeriod, MarketIndexSnapshot } from '../../../shared/types';
import cx from '../../../shared/cx';
import styles from '../../kline-chart/index.module.scss';

const periods: Array<{ id: MarketIndexPeriod; label: string }> = [
  { id: '15m', label: '15分钟' },
  { id: '1h', label: '1小时' },
  { id: '4h', label: '4小时' },
  { id: '1d', label: '天' },
];

interface IndexKlineModalProps {
  index: MarketIndexSnapshot;
  period: MarketIndexPeriod;
  loadOlderKline: TLoadOlderKline;
  onPeriodChange(period: MarketIndexPeriod): void;
  onClose(): void;
}

export function IndexKlineModal({ index, period, loadOlderKline, onPeriodChange, onClose }: IndexKlineModalProps) {
  const latestTime = index.minutes[index.minutes.length - 1]?.time ?? 'empty';
  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
        <div className={styles.header}>
          <div>{index.name}（{index.code || '--'}）K线图</div>
          <button onClick={onClose} type='button'>
            ✕
          </button>
        </div>
        <div className={styles.wrap}>
          <StockKlineChart
            key={`${index.code}-${period}-${latestTime}`}
            stock={index}
            data={index.minutes}
            height='100%'
            showIndicators
            timeframe={period}
            loadOlderKline={loadOlderKline}
            staticData
          />
          <div className={styles.timeframes}>
            {periods.map((item) => (
              <button
                key={item.id}
                className={cx(styles.tf, period === item.id && styles.active)}
                onClick={() => onPeriodChange(item.id)}
                type='button'
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
