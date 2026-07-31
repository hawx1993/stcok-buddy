import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { IStockTimelinePoint, IStockTimelineSnapshot, StockDetail } from '../../../shared/types';
import { getMarketColors } from '../../../shared/market-color';
import {
  A_SHARE_MORNING_CLOSE_MINUTE,
  A_SHARE_MARKET_OPEN_MINUTE,
  A_SHARE_TOTAL_TRADING_MINUTES,
  getAShareTradingMinuteOffset,
  isChinaMarketOpen,
} from '../../../shared/market-time';
import { useAppStore } from '../../../store/app-store';
import cx from '../../../shared/cx';
import styles from '../index.module.scss';

type TTimelineStock = Pick<StockDetail, 'code' | 'name'>;
type TTimelineStyle = CSSProperties & { '--timeline-price-color': string };

interface IStockTimelineChartProps {
  stock?: TTimelineStock;
  height?: number | string;
  className?: string;
}

interface IChartPathResult {
  priceLine: string;
  priceArea: string;
  averageLine?: string;
  preCloseLine?: string;
  rows: IStockTimelinePoint[];
  coordinates: Array<{ x: number; y: number }>;
  yLabels: Array<{ y: number; label: string }>;
  xLabels: Array<{ x: number; label: string }>;
}

const VIEWBOX_WIDTH = 960;
const VIEWBOX_HEIGHT = 360;
const PADDING_X = 58;
const PADDING_Y = 34;
const CHART_WIDTH = VIEWBOX_WIDTH - PADDING_X * 2;
const TIMELINE_REFRESH_INTERVAL_MS = 15_000;
const TIMELINE_X_LABELS = [
  { time: '09:30', offset: 0 },
  { time: '11:30', offset: A_SHARE_MORNING_CLOSE_MINUTE - A_SHARE_MARKET_OPEN_MINUTE },
  { time: '15:00', offset: A_SHARE_TOTAL_TRADING_MINUTES },
];

export function StockTimelineChart({ stock, height = '100%', className }: IStockTimelineChartProps) {
  const marketColorMode = useAppStore((state) => state.config?.marketColorMode ?? 'red-up-green-down');
  const marketColors = useMemo(() => getMarketColors(marketColorMode), [marketColorMode]);
  const [snapshot, setSnapshot] = useState<IStockTimelineSnapshot>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [hoverIndex, setHoverIndex] = useState<number>();

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

  const chart = useMemo(() => buildChartPath(snapshot), [snapshot]);
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

function buildChartPath(snapshot: IStockTimelineSnapshot | undefined): IChartPathResult | undefined {
  const rows = (snapshot?.points ?? []).filter((point) => Number.isFinite(point.price));
  const timelineRows = rows
    .map((point) => {
      const x = toTimelineX(point.time);
      return x === undefined ? undefined : { point, x };
    })
    .filter((row): row is { point: IStockTimelinePoint; x: number } => Boolean(row));
  if (timelineRows.length < 2) return undefined;
  const chartRows = timelineRows.map((row) => row.point);
  const priceValues = chartRows.map((point) => point.price);
  const averageValues = chartRows.map((point) => point.avgPrice).filter((value): value is number => Number.isFinite(value));
  const preCloseValues = snapshot?.preClose === undefined ? [] : [snapshot.preClose];
  const values = [...priceValues, ...averageValues, ...preCloseValues];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const toY = (value: number) => round(PADDING_Y + ((max - value) / range) * (VIEWBOX_HEIGHT - PADDING_Y * 2));
  const toCoordinate = (value: number, x: number) => `${round(x)},${toY(value)}`;
  const coordinates = timelineRows.map(({ point, x }) => ({ x: round(x), y: toY(point.price) }));
  const priceLine = `M ${coordinates.map((point) => `${point.x},${point.y}`).join(' L ')}`;
  const averageCoordinates = timelineRows
    .map(({ point, x }) => (point.avgPrice === undefined ? undefined : toCoordinate(point.avgPrice, x)))
    .filter((value): value is string => Boolean(value));
  const firstX = PADDING_X;
  const lastDataX = coordinates[coordinates.length - 1].x;
  const lastX = VIEWBOX_WIDTH - PADDING_X;
  const baseline = VIEWBOX_HEIGHT - PADDING_Y;
  const preCloseY = snapshot?.preClose === undefined ? undefined : toY(snapshot.preClose);
  return {
    rows: chartRows,
    coordinates,
    priceLine,
    priceArea: `${priceLine} L ${round(lastDataX)},${baseline} L ${firstX},${baseline} Z`,
    averageLine: averageCoordinates.length >= 2 ? `M ${averageCoordinates.join(' L ')}` : undefined,
    preCloseLine: preCloseY ? `M ${firstX},${preCloseY} L ${round(lastX)},${preCloseY}` : undefined,
    yLabels: buildYLabels(snapshot?.preClose, min, max, range),
    xLabels: buildXLabels(),
  };
}

function buildYLabels(preClose: number | undefined, min: number, max: number, range: number) {
  if (!preClose) return [];
  return [max, (max + min) / 2, min].map((value) => ({
    y: round(PADDING_Y + ((max - value) / range) * (VIEWBOX_HEIGHT - PADDING_Y * 2)),
    label: `${formatSigned(((value - preClose) / preClose) * 100)}%`,
  }));
}

function buildXLabels() {
  return TIMELINE_X_LABELS.map((item) => ({
    x: round(PADDING_X + (item.offset / A_SHARE_TOTAL_TRADING_MINUTES) * CHART_WIDTH),
    label: item.time,
  }));
}

function toTimelineX(time: string): number | undefined {
  const offset = getAShareTradingMinuteOffset(time);
  if (offset === undefined) return undefined;
  return PADDING_X + (offset / A_SHARE_TOTAL_TRADING_MINUTES) * CHART_WIDTH;
}

function round(value: number) {
  return Number(value.toFixed(2));
}

function formatPrice(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : '--';
}

function formatSigned(value: number) {
  if (!Number.isFinite(value)) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}
