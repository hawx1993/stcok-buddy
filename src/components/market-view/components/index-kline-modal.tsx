import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { StockKlineChart } from '../../kline-chart';
import type { TimeframeId, TLoadOlderKline } from '../../kline-chart';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { MarketIndexPeriod, MarketIndexSnapshot } from '../../../shared/types';
import cx from '../../../shared/cx';
import styles from '../../kline-chart/index.module.scss';

const periods: Array<{ id: MarketIndexPeriod; label: string }> = [
  { id: '15m', label: '15分钟' },
  { id: '1h', label: '1小时' },
  { id: '1d', label: '天' },
  { id: '1w', label: '周' },
  { id: '1mo', label: '月' },
];

interface IndexKlineModalProps {
  index: MarketIndexSnapshot;
  initialPeriod: MarketIndexPeriod;
  onClose(): void;
}

/**
 * 指数 K 线弹窗。
 * 周期在弹窗内部自管理（与行情页大图的 period 解耦）：
 * - 切周期不触发全市场快照重取，K 线组件按新周期自行清空并重新拉取，不会跨周期错乱/闪现；
 * - 数据由 StockKlineChart 通过 getKline 按周期拉取（15m/1h 各 240 根，铺满全屏）；
 * - 向右拖拽到左边缘时通过 loadOlderKline 自动加载更早历史。
 */
export function IndexKlineModal({ index, initialPeriod, onClose }: IndexKlineModalProps) {
  const [period, setPeriod] = useState<MarketIndexPeriod>(initialPeriod);
  // price 不放入依赖：行情快照每 15s 刷新会产生新对象，避免图表数据效果被反复触发
  const chartStock = useMemo(
    () => ({ code: index.code, name: index.name, price: index.price }),
    [index.code, index.name],
  );
  const loadOlderKline = useCallback<TLoadOlderKline>(
    async ({ timeframe, limit, beforeTimestamp }) => {
      const symbol = toIndexSymbol(index.code);
      if (!symbol || timeframe !== period) return [];
      return getStocksenseApi().getKline(symbol, limit, timeframe, beforeTimestamp);
    },
    [index.code, period],
  );
  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
        <div className={styles.header}>
          <div>
            {index.name}（{index.code || '--'}）K线图
          </div>
          <button onClick={onClose} type='button'>
            ✕
          </button>
        </div>
        <div className={styles.wrap}>
          <StockKlineChart
            key={index.code}
            stock={chartStock}
            height='100%'
            showIndicators
            timeframe={period as TimeframeId}
            loadOlderKline={loadOlderKline}
          />
          <div className={styles.timeframes}>
            {periods.map((item) => (
              <button
                key={item.id}
                className={cx(styles.tf, period === item.id && styles.active)}
                onClick={() => setPeriod(item.id)}
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

function toIndexSymbol(code: string | undefined) {
  if (code === '000001') return 'sh000001';
  if (code === '399001') return 'sz399001';
  return undefined;
}
