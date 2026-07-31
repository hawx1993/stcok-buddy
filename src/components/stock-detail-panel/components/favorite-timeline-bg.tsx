import { useMemo } from 'react';
import type { IStockTimelinePoint } from '../../../shared/types';
import { A_SHARE_TOTAL_TRADING_MINUTES, getAShareTradingMinuteOffset } from '../../../shared/market-time';
import cx from '../../../shared/cx';
import styles from '../index.module.scss';

interface IFavoriteTimelineBgProps {
  points: IStockTimelinePoint[] | undefined;
  isUp: boolean;
}

const VIEWBOX_WIDTH = 240;
const VIEWBOX_HEIGHT = 72;
const PADDING = 6;

export function FavoriteTimelineBg({ points, isUp }: IFavoriteTimelineBgProps) {
  const path = useMemo(() => buildTimelinePath(points), [points]);
  if (!path) return null;

  return (
    <svg
      className={cx(styles['favorite-timeline-bg'], isUp ? styles.up : styles.down)}
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      preserveAspectRatio='none'
      aria-hidden='true'
      focusable='false'
    >
      <path d={path.area} className={styles['favorite-timeline-area']} />
      <path d={path.line} className={styles['favorite-timeline-line']} />
    </svg>
  );
}

function buildTimelinePath(points: IStockTimelinePoint[] | undefined) {
  const timelinePoints = (points ?? [])
    .map((point) => {
      const offset = getAShareTradingMinuteOffset(point.time);
      return offset === undefined || !Number.isFinite(point.price) ? undefined : { price: point.price, offset };
    })
    .filter((point): point is { price: number; offset: number } => Boolean(point));
  if (timelinePoints.length < 2) return undefined;
  const prices = timelinePoints.map((point) => point.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const coordinates = timelinePoints.map((point) => {
    const x = PADDING + (point.offset / A_SHARE_TOTAL_TRADING_MINUTES) * (VIEWBOX_WIDTH - PADDING * 2);
    const y = PADDING + ((max - point.price) / range) * (VIEWBOX_HEIGHT - PADDING * 2);
    return `${round(x)},${round(y)}`;
  });
  const line = `M ${coordinates.join(' L ')}`;
  const firstX = PADDING;
  const lastX = PADDING + (timelinePoints[timelinePoints.length - 1].offset / A_SHARE_TOTAL_TRADING_MINUTES) * (VIEWBOX_WIDTH - PADDING * 2);
  const baseline = VIEWBOX_HEIGHT - PADDING;
  return {
    line,
    area: `${line} L ${round(lastX)},${baseline} L ${firstX},${baseline} Z`,
  };
}

function round(value: number) {
  return Number(value.toFixed(2));
}
