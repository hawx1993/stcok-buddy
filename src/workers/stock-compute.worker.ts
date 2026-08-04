import { expose } from 'comlink';
import type { KLineData } from 'klinecharts';
import type { IStockTimelinePoint, KlinePoint } from '../shared/types';
import {
  A_SHARE_MORNING_CLOSE_MINUTE,
  A_SHARE_MARKET_OPEN_MINUTE,
  A_SHARE_TOTAL_TRADING_MINUTES,
  getAShareTradingMinuteOffset,
} from '../shared/market-time';
import type {
  IFavoriteTimelinePath,
  IChipPreparedLayout,
  IKlineMergeInput,
  IKlinePeriodLike,
  IPrepareChipInput,
  IStockComputeApi,
  IStockTimelineChartPath,
  IKlineBuildInput,
  IKlineTimestampInput,
} from './stock-compute-types';

const STOCK_TIMELINE_VIEWBOX_WIDTH = 960;
const STOCK_TIMELINE_VIEWBOX_HEIGHT = 360;
const STOCK_TIMELINE_PADDING_X = 58;
const STOCK_TIMELINE_PADDING_Y = 34;
const STOCK_TIMELINE_CHART_WIDTH = STOCK_TIMELINE_VIEWBOX_WIDTH - STOCK_TIMELINE_PADDING_X * 2;
const STOCK_TIMELINE_X_LABELS = [
  { time: '09:30', offset: 0 },
  { time: '11:30', offset: A_SHARE_MORNING_CLOSE_MINUTE - A_SHARE_MARKET_OPEN_MINUTE },
  { time: '15:00', offset: A_SHARE_TOTAL_TRADING_MINUTES },
];

const FAVORITE_TIMELINE_VIEWBOX_WIDTH = 240;
const FAVORITE_TIMELINE_VIEWBOX_HEIGHT = 72;
const FAVORITE_TIMELINE_PADDING = 6;

const api: IStockComputeApi = {
  buildKlineData({ data, period }: IKlineBuildInput) {
    return data
      .map((point, index) => toKLineData(point, index, data.length, period))
      .sort((left, right) => left.timestamp - right.timestamp);
  },

  mergeKlineData({ older, current, period }: IKlineMergeInput) {
    const rows = new Map<number, KlinePoint>();
    const total = older.length + current.length;
    for (const [index, point] of [...older, ...current].entries()) {
      const timestamp = point.timestamp ?? parseKlineTimestamp(point.time, index, total, period);
      rows.set(timestamp, { ...point, timestamp });
    }
    return [...rows.values()].sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0));
  },

  parseKlineTimestamp({ value, index, total, period }: IKlineTimestampInput) {
    return parseKlineTimestamp(value, index, total, period);
  },

  buildStockTimelinePath(snapshot) {
    const rows = (snapshot?.points ?? []).filter((point) => Number.isFinite(point.price));
    const timelineRows = rows
      .map((point) => {
        const x = toTimelineX(point.time, STOCK_TIMELINE_PADDING_X, STOCK_TIMELINE_CHART_WIDTH);
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
    const toY = (value: number) =>
      round(STOCK_TIMELINE_PADDING_Y + ((max - value) / range) * (STOCK_TIMELINE_VIEWBOX_HEIGHT - STOCK_TIMELINE_PADDING_Y * 2));
    const toCoordinate = (value: number, x: number) => `${round(x)},${toY(value)}`;
    const coordinates = timelineRows.map(({ point, x }) => ({ x: round(x), y: toY(point.price) }));
    const priceLine = `M ${coordinates.map((point) => `${point.x},${point.y}`).join(' L ')}`;
    const averageCoordinates = timelineRows
      .map(({ point, x }) => (point.avgPrice === undefined ? undefined : toCoordinate(point.avgPrice, x)))
      .filter((value): value is string => Boolean(value));
    const firstX = STOCK_TIMELINE_PADDING_X;
    const lastDataX = coordinates[coordinates.length - 1].x;
    const lastX = STOCK_TIMELINE_VIEWBOX_WIDTH - STOCK_TIMELINE_PADDING_X;
    const baseline = STOCK_TIMELINE_VIEWBOX_HEIGHT - STOCK_TIMELINE_PADDING_Y;
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
    } satisfies IStockTimelineChartPath;
  },

  buildFavoriteTimelinePath(points) {
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
      const x = FAVORITE_TIMELINE_PADDING + (point.offset / A_SHARE_TOTAL_TRADING_MINUTES) * (FAVORITE_TIMELINE_VIEWBOX_WIDTH - FAVORITE_TIMELINE_PADDING * 2);
      const y = FAVORITE_TIMELINE_PADDING + ((max - point.price) / range) * (FAVORITE_TIMELINE_VIEWBOX_HEIGHT - FAVORITE_TIMELINE_PADDING * 2);
      return `${round(x)},${round(y)}`;
    });
    const line = `M ${coordinates.join(' L ')}`;
    const firstX = FAVORITE_TIMELINE_PADDING;
    const lastX = FAVORITE_TIMELINE_PADDING + (timelinePoints[timelinePoints.length - 1].offset / A_SHARE_TOTAL_TRADING_MINUTES) * (FAVORITE_TIMELINE_VIEWBOX_WIDTH - FAVORITE_TIMELINE_PADDING * 2);
    const baseline = FAVORITE_TIMELINE_VIEWBOX_HEIGHT - FAVORITE_TIMELINE_PADDING;
    return {
      line,
      area: `${line} L ${round(lastX)},${baseline} L ${firstX},${baseline} Z`,
    } satisfies IFavoriteTimelinePath;
  },

  prepareChipLayout({ chips, barWidth }: IPrepareChipInput) {
    const points = chips.points
      .filter((point) => Number.isFinite(point.price) && Number.isFinite(point.weight) && point.weight > 0)
      .sort((left, right) => left.price - right.price);
    const maxWeight = Math.max(...points.map((point) => point.weight), 0);
    return {
      date: chips.date,
      points: points.map((point) => ({
        price: point.price,
        weight: point.weight,
        width: maxWeight > 0 ? Math.max(1, (point.weight / maxWeight) * barWidth) : 0,
      })),
    } satisfies IChipPreparedLayout;
  },
};

function toKLineData(point: KlinePoint, index: number, total: number, period: IKlinePeriodLike): KLineData {
  return {
    timestamp:
      (Number.isFinite(point.timestamp) ? point.timestamp : undefined) ??
      parseKlineTimestamp(point.time, index, total, period),
    open: point.open,
    high: point.high,
    low: point.low,
    close: point.close,
    volume: point.volume,
    turnover: point.amount,
    source: point,
  };
}

function parseKlineTimestamp(value: string, index: number, total: number, period: IKlinePeriodLike) {
  const text = String(value || '').trim();
  const date = text.includes('-')
    ? new Date(text).getTime()
    : Number(text.length === 8 ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}` : text);
  if (Number.isFinite(date) && date > 10_000_000_000) return date;
  const compactMinute = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (compactMinute)
    return new Date(
      `${compactMinute[1]}-${compactMinute[2]}-${compactMinute[3]}T${compactMinute[4]}:${compactMinute[5]}:00+08:00`,
    ).getTime();
  const compactDay = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactDay) return new Date(`${compactDay[1]}-${compactDay[2]}-${compactDay[3]}T00:00:00+08:00`).getTime();
  const span =
    period.type === 'minute'
      ? period.span * 60_000
      : period.type === 'hour'
        ? period.span * 3_600_000
        : period.type === 'week'
          ? 7 * 86_400_000
          : period.type === 'month'
            ? 30 * 86_400_000
            : 86_400_000;
  return new Date('2024-01-01').getTime() + (index - total) * span;
}

function buildYLabels(preClose: number | undefined, min: number, max: number, range: number) {
  if (!preClose) return [];
  return [max, (max + min) / 2, min].map((value) => ({
    y: round(STOCK_TIMELINE_PADDING_Y + ((max - value) / range) * (STOCK_TIMELINE_VIEWBOX_HEIGHT - STOCK_TIMELINE_PADDING_Y * 2)),
    label: `${formatSigned(((value - preClose) / preClose) * 100)}%`,
  }));
}

function buildXLabels() {
  return STOCK_TIMELINE_X_LABELS.map((item) => ({
    x: round(STOCK_TIMELINE_PADDING_X + (item.offset / A_SHARE_TOTAL_TRADING_MINUTES) * STOCK_TIMELINE_CHART_WIDTH),
    label: item.time,
  }));
}

function toTimelineX(time: string, paddingX: number, chartWidth: number): number | undefined {
  const offset = getAShareTradingMinuteOffset(time);
  if (offset === undefined) return undefined;
  return paddingX + (offset / A_SHARE_TOTAL_TRADING_MINUTES) * chartWidth;
}

function round(value: number) {
  return Number(value.toFixed(2));
}

function formatSigned(value: number) {
  if (!Number.isFinite(value)) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

expose(api);
