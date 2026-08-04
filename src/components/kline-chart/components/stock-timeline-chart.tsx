import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { IStockTimelinePoint, IStockTimelineSnapshot, StockDetail } from '../../../shared/types';
import { getMarketColors } from '../../../shared/market-color';
import { isChinaMarketOpen } from '../../../shared/market-time';
import { useAppDataStore } from '../../../store/app-store';
import { getStockComputeWorker } from '../../../workers/stock-compute-client';
import type { IStockTimelineChartPath } from '../../../workers/stock-compute-types';
import cx from '../../../shared/cx';
import styles from '../index.module.scss';

type TTimelineStock = Pick<StockDetail, 'code' | 'name'>;
type TTimelineStyle = CSSProperties & { '--timeline-price-color': string };

interface IStockTimelineChartProps {
  stock?: TTimelineStock;
  height?: number | string;
  className?: string;
}

const VIEWBOX_WIDTH = 960;
const VIEWBOX_HEIGHT = 360;
const PADDING_Y = 34;
const TIMELINE_REFRESH_INTERVAL_MS = 15_000;

export function StockTimelineChart({ stock, height = '100%', className }: IStockTimelineChartProps) {
  const marketColorMode = useAppDataStore((state) => state.config?.marketColorMode ?? 'red-up-green-down');
  const marketColors = useMemo(() => getMarketColors(marketColorMode), [marketColorMode]);
  const [snapshot, setSnapshot] = useState<IStockTimelineSnapshot>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [hoverIndex, setHoverIndex] = useState<number>();
  const [chart, setChart] = useState<IStockTimelineChartPath>();

  useEffect(() => {
    if (!stock?.code) {
      setSnapshot(undefined);
      setError(undefined);
      return;
    }
    let alive = true;
    let timer: number | undefined;
    const refreshTimeline = (showLoading: boolean) => {
      if (showLoading) setLoading(true);
      setError(undefined);
      getStocksenseApi()
        .getStockTimelines([stock.code])
        .then((rows) => {
          if (alive) setSnapshot(rows[stock.code]);
        })
        .catch((err: unknown) => {
          if (!alive) return;
          setSnapshot(undefined);
          setError(err instanceof Error ? err.message : '分时数据加载失败');
        })
        .finally(() => {
          if (alive && showLoading) setLoading(false);
        });
    };

    refreshTimeline(true);
    if (isChinaMarketOpen()) timer = window.setInterval(() => refreshTimeline(false), TIMELINE_REFRESH_INTERVAL_MS);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [stock?.code]);

  useEffect(() => {
    let alive = true;
    getStockComputeWorker()
      .buildStockTimelinePath(snapshot)
      .then((next) => {
        if (alive) setChart(next);
      })
      .catch((err: unknown) => {
        console.error('[timeline] worker build path failed', err);
        if (alive) setChart(undefined);
      });
    return () => {
      alive = false;
    };
  }, [snapshot]);

  const latest = chart?.rows[chart.rows.length - 1];
  const isUp = latest && snapshot?.preClose ? latest.price >= snapshot.preClose : true;
  const hoverPoint = hoverIndex === undefined ? latest : chart?.rows[hoverIndex];
  const hoverCoordinate = hoverIndex === undefined ? undefined : chart?.coordinates[hoverIndex];
  const style: TTimelineStyle = { height, '--timeline-price-color': isUp ? marketColors.upColor : marketColors.downColor };

  const updateHover = (event: MouseEvent<SVGSVGElement>) => {
    if (!chart?.coordinates.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const mouseX = ((event.clientX - rect.left) / rect.width) * VIEWBOX_WIDTH;
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    chart.coordinates.forEach((point, index) => {
      const distance = Math.abs(point.x - mouseX);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    setHoverIndex(closestIndex);
  };

  return (
    <div className={cx(styles['timeline-chart-wrap'], className)} style={style}>
      {chart ? (
        <>
          <svg
            className={styles['timeline-chart-svg']}
            viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
            preserveAspectRatio='xMidYMid meet'
            onMouseMove={updateHover}
            onMouseLeave={() => setHoverIndex(undefined)}
          >
            <path d={chart.priceArea} className={styles['timeline-price-area']} />
            {chart.yLabels.map((label) => (
              <text key={label.label} x={8} y={label.y} className={styles['timeline-y-label']}>
                {label.label}
              </text>
            ))}
            {chart.xLabels.map((label) => (
              <text key={label.label} x={label.x} y={VIEWBOX_HEIGHT - 5} className={styles['timeline-x-label']}>
                {label.label}
              </text>
            ))}
            {chart.preCloseLine ? <path d={chart.preCloseLine} className={styles['timeline-preclose-line']} /> : null}
            {chart.averageLine ? <path d={chart.averageLine} className={styles['timeline-average-line']} /> : null}
            <path d={chart.priceLine} className={styles['timeline-price-line']} />
            {hoverCoordinate ? (
              <path
                d={`M ${hoverCoordinate.x},${PADDING_Y} L ${hoverCoordinate.x},${VIEWBOX_HEIGHT - PADDING_Y}`}
                className={styles['timeline-crosshair-line']}
              />
            ) : null}
          </svg>
          {hoverPoint ? <TimelineTooltip point={hoverPoint} preClose={snapshot?.preClose} /> : null}
        </>
      ) : (
        <div className={styles['timeline-empty']}>{loading ? '分时数据加载中…' : error ? '分时数据暂不可用' : '暂无分时数据'}</div>
      )}
    </div>
  );
}

function TimelineTooltip({ point, preClose }: { point: IStockTimelinePoint; preClose?: number }) {
  const change = preClose ? point.price - preClose : undefined;
  const changePercent = change !== undefined && preClose ? (change / preClose) * 100 : undefined;
  return (
    <div className={styles['timeline-tooltip']}>
      <span>{point.time || '--'}</span>
      <b>价格 {formatPrice(point.price)}</b>
      {point.avgPrice !== undefined ? <b>均价 {formatPrice(point.avgPrice)}</b> : null}
      {changePercent !== undefined ? <em className={changePercent >= 0 ? styles.up : styles.down}>{formatSigned(changePercent)}%</em> : null}
    </div>
  );
}

function formatPrice(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : '--';
}

function formatSigned(value: number) {
  if (!Number.isFinite(value)) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}
