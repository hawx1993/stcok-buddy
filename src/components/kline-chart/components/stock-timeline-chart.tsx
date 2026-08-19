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
const PADDING_X = 58;
const PADDING_Y = 34;
const TIMELINE_REFRESH_INTERVAL_MS = 15_000;

export function StockTimelineChart({ stock, height = '100%', className }: IStockTimelineChartProps) {
  const marketColorMode = useAppDataStore((state) => state.config?.marketColorMode ?? 'red-up-green-down');
  const marketColors = useMemo(() => getMarketColors(marketColorMode), [marketColorMode]);
  const [snapshot, setSnapshot] = useState<IStockTimelineSnapshot>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [hoverIndex, setHoverIndex] = useState<number>();
  const [hoverY, setHoverY] = useState<number>();
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
  const timelineScale = getTimelinePriceScale(chart?.rows, snapshot?.preClose);
  const hoverCrosshair = resolveTimelineHoverCrosshair(hoverCoordinate, hoverY);
  const hoverChangePercent = getTimelineYChangePercent(hoverCrosshair?.percentLabelY, snapshot?.preClose, timelineScale);
  const style: TTimelineStyle = { height, '--timeline-price-color': isUp ? marketColors.upColor : marketColors.downColor };

  const updateHover = (event: MouseEvent<SVGSVGElement>) => {
    if (!chart?.coordinates.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const mouseX = ((event.clientX - rect.left) / rect.width) * VIEWBOX_WIDTH;
    const mouseY = clampTimelineHoverY(((event.clientY - rect.top) / rect.height) * VIEWBOX_HEIGHT);
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
    setHoverY(mouseY);
  };

  const clearHover = () => {
    setHoverIndex(undefined);
    setHoverY(undefined);
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
            onMouseLeave={clearHover}
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
            {hoverCrosshair ? (
              <>
                <path d={hoverCrosshair.verticalPath} className={styles['timeline-crosshair-line']} />
                <path d={hoverCrosshair.horizontalPath} className={styles['timeline-crosshair-line']} />
                {hoverChangePercent !== undefined ? (
                  <text
                    x={hoverCrosshair.percentLabelX}
                    y={hoverCrosshair.percentLabelY}
                    className={cx(
                      styles['timeline-y-label'],
                      styles['timeline-hover-percent'],
                      hoverChangePercent >= 0 ? styles.up : styles.down,
                    )}
                  >
                    {formatSigned(hoverChangePercent)}%
                  </text>
                ) : null}
              </>
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
  const changePercent = getTimelineChangePercent(point, preClose);
  return (
    <div className={styles['timeline-tooltip']}>
      <span>{point.time || '--'}</span>
      <b>价格 {formatPrice(point.price)}</b>
      {point.avgPrice !== undefined ? <b>均价 {formatPrice(point.avgPrice)}</b> : null}
      {changePercent !== undefined ? <em className={changePercent >= 0 ? styles.up : styles.down}>{formatSigned(changePercent)}%</em> : null}
    </div>
  );
}

export function getTimelineChangePercent(point: Pick<IStockTimelinePoint, 'price'> | undefined, preClose: number | undefined) {
  if (!point || preClose === undefined || preClose <= 0 || !Number.isFinite(preClose) || !Number.isFinite(point.price)) return undefined;
  return ((point.price - preClose) / preClose) * 100;
}

export function getTimelinePriceScale(
  rows: ReadonlyArray<Pick<IStockTimelinePoint, 'price' | 'avgPrice'>> | undefined,
  preClose: number | undefined,
) {
  const priceValues = (rows ?? []).map((point) => point.price).filter(Number.isFinite);
  const averageValues = (rows ?? []).map((point) => point.avgPrice).filter((value): value is number => Number.isFinite(value));
  const preCloseValues = preClose === undefined || !Number.isFinite(preClose) ? [] : [preClose];
  const values = [...priceValues, ...averageValues, ...preCloseValues];
  if (!values.length) return undefined;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max, range: max - min || 1 };
}

export function getTimelineYChangePercent(
  y: number | undefined,
  preClose: number | undefined,
  scale: ReturnType<typeof getTimelinePriceScale>,
) {
  if (y === undefined || !scale || preClose === undefined || preClose <= 0 || !Number.isFinite(preClose) || !Number.isFinite(y)) return undefined;
  const chartHeight = VIEWBOX_HEIGHT - PADDING_Y * 2;
  const price = scale.max - ((clampTimelineHoverY(y) - PADDING_Y) / chartHeight) * scale.range;
  return ((price - preClose) / preClose) * 100;
}

export function resolveTimelineHoverCrosshair(coordinate: { x: number; y: number } | undefined, horizontalY: number | undefined) {
  if (!coordinate || horizontalY === undefined) return undefined;
  const y = clampTimelineHoverY(horizontalY);
  return {
    verticalPath: `M ${coordinate.x},${PADDING_Y} L ${coordinate.x},${VIEWBOX_HEIGHT - PADDING_Y}`,
    horizontalPath: `M ${PADDING_X},${y} L ${VIEWBOX_WIDTH - PADDING_X},${y}`,
    percentLabelX: VIEWBOX_WIDTH - 8,
    percentLabelY: y,
  };
}

export function clampTimelineHoverY(y: number) {
  if (!Number.isFinite(y)) return PADDING_Y;
  return Math.min(VIEWBOX_HEIGHT - PADDING_Y, Math.max(PADDING_Y, y));
}

function formatPrice(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : '--';
}

function formatSigned(value: number) {
  if (!Number.isFinite(value)) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}
