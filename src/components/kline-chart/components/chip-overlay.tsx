import { useMemo, useState } from 'react';
import type { Chart } from 'klinecharts';
import type { ChipDistribution, TChipDistributionSource } from '../../../shared/types';
import styles from '../index.module.scss';

export const MODAL_CHIP_COLUMN_WIDTH = 220;
const SMALL_CHIP_WIDTH = 118;
const MODAL_CHIP_WIDTH = 164;
const PRICE_AXIS_WIDTH = MODAL_CHIP_COLUMN_WIDTH - MODAL_CHIP_WIDTH;

interface IChipOverlayProps {
  chips: ChipDistribution;
  chart: Chart;
  currentPrice: number;
  layoutVersion: number;
  profitColor: string;
  trappedColor: string;
  source?: TChipDistributionSource;
  showSummary?: boolean;
  showPriceAxis?: boolean;
}

interface IHoveredChip {
  price: number;
  weight: number;
  y: number;
  profit: boolean;
}

export function ChipOverlay({
  chips,
  chart,
  currentPrice,
  layoutVersion,
  profitColor,
  trappedColor,
  source,
  showSummary = false,
  showPriceAxis = false,
}: IChipOverlayProps) {
  const [hovered, setHovered] = useState<IHoveredChip>();
  const layout = useMemo(() => getChipLayout(chips, chart, showPriceAxis), [chips, chart, layoutVersion, showPriceAxis]);
  const priceTicks = useMemo(() => showPriceAxis ? getPriceTicks(chart, layout.height) : [], [chart, layout.height, layoutVersion, showPriceAxis]);

  const currentY = priceToY(chart, currentPrice);
  const averageY = chips.avgCost === undefined ? undefined : priceToY(chart, chips.avgCost);

  return (
    <div
      className={`${styles['chip-overlay']} ${showPriceAxis ? styles['modal-chip-overlay'] : ''}`}
      style={showPriceAxis ? undefined : { top: layout.top, height: layout.height }}
      aria-label={`筹码分布，数据日期 ${chips.date}`}
    >
      <div
        className={showPriceAxis ? styles['modal-chip-plot'] : undefined}
        style={showPriceAxis ? { top: layout.top, height: layout.height } : undefined}
      >
        <svg className={styles.chips} viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio='none'>
        <line className={styles['chip-column-divider']} x1={layout.barWidth} x2={layout.barWidth} y1='0' y2={layout.height} />
        {layout.points.map((point) => {
          const profit = point.price <= currentPrice;
          return (
            <rect
              key={point.price}
              className={styles['chip-bar']}
              x={layout.barWidth - point.width}
              y={point.y - point.height / 2}
              width={point.width}
              height={point.height}
              fill={profit ? profitColor : trappedColor}
              onMouseEnter={() => setHovered({ price: point.price, weight: point.weight, y: point.y, profit })}
              onMouseLeave={() => setHovered(undefined)}
            />
          );
        })}
        {isVisibleY(currentY, layout.height) ? (
          <g className={styles['chip-price-line']}>
            <line x1='0' x2={layout.barWidth} y1={currentY} y2={currentY} />
            <text x={showPriceAxis ? layout.barWidth + PRICE_AXIS_WIDTH - 4 : layout.barWidth - 2} y={currentY - 3} textAnchor='end'>现价 {currentPrice.toFixed(2)}</text>
          </g>
        ) : null}
        {averageY !== undefined && isVisibleY(averageY, layout.height) ? (
          <g className={styles['chip-average-line']}>
            <line x1='0' x2={layout.barWidth} y1={averageY} y2={averageY} />
            <text x='2' y={averageY - 3}>均价 {chips.avgCost?.toFixed(2)}</text>
          </g>
        ) : null}
        {showPriceAxis ? priceTicks.map((tick) => (
          <text
            className={styles['chip-axis-tick']}
            key={`${tick.value}-${tick.y}`}
            x={layout.width - 4}
            y={tick.y + 3}
            textAnchor='end'
          >
            {tick.text}
          </text>
        )) : null}
        </svg>
      </div>
      {hovered ? (
        <div className={styles['chip-tooltip']} style={{ top: hovered.y }}>
          <b>{hovered.price.toFixed(2)}</b>
          <span>{formatPercent(hovered.weight)}</span>
          <span>{hovered.profit ? '获利盘' : '套牢盘'}</span>
        </div>
      ) : null}
      {showSummary ? (
        <div className={styles['chip-summary']} style={{ top: layout.top + layout.height + 12 }}>
          <div className={styles['chip-summary-head']}>
            <div className={styles['chip-legend']}>
              <span><i style={{ background: profitColor }} />获利盘</span>
              <span><i style={{ background: trappedColor }} />套牢盘</span>
            </div>
            <b className={styles['chip-profit-ratio']}>{formatPercent(chips.profitRatio)}</b>
          </div>
          <div className={styles['chip-primary-metric']}>
            <span>平均成本</span>
            <b>{formatPrice(chips.avgCost)}</b>
          </div>
          <div className={styles['chip-summary-row']}><span>70% 成本区间</span><b>{chips.cost70 ?? '--'}</b></div>
          <div className={styles['chip-summary-row']}><span>90% 成本区间</span><b>{chips.cost90 ?? '--'}</b></div>
          <small>
            <span>{chips.date}</span>
            <span>{source === 'a-stock-data' ? 'a-stock-data' : 'stock-sdk'}</span>
          </small>
        </div>
      ) : null}
    </div>
  );
}

function getChipLayout(chips: ChipDistribution, chart: Chart, showPriceAxis: boolean) {
  const size = chart.getSize('candle_pane', 'main');
  const barWidth = showPriceAxis ? MODAL_CHIP_WIDTH : SMALL_CHIP_WIDTH;
  const width = showPriceAxis ? MODAL_CHIP_COLUMN_WIDTH : SMALL_CHIP_WIDTH;
  const height = size?.height ?? 0;
  const top = size?.top ?? 0;
  const points = chips.points
    .filter((point) => Number.isFinite(point.price) && Number.isFinite(point.weight) && point.weight > 0)
    .sort((left, right) => left.price - right.price);
  const maxWeight = Math.max(...points.map((point) => point.weight), 0);
  const coordinates = chart.convertToPixel(points.map((point) => ({ value: point.price })), { paneId: 'candle_pane' });
  const pixels = Array.isArray(coordinates) ? coordinates : [coordinates];
  const visible = points.flatMap((point, index) => {
    const y = pixels[index]?.y;
    if (typeof y !== 'number' || y < 0 || y > height || maxWeight <= 0) return [];
    return [{ ...point, y, width: Math.max(1, (point.weight / maxWeight) * barWidth) }];
  });
  const gaps = visible.slice(1).map((point, index) => Math.abs(point.y - visible[index].y)).filter((gap) => gap > 0);
  const barHeight = Math.max(1, Math.min(3, (gaps.length ? Math.min(...gaps) : 2) * 0.86));
  return { top, width, barWidth, height, points: visible.map((point) => ({ ...point, height: barHeight })) };
}

function getPriceTicks(chart: Chart, height: number) {
  if (!height) return [];
  const points = Array.from({ length: 6 }, (_, index) => {
    const y = (height / 5) * index;
    const converted = chart.convertFromPixel([{ y }], { paneId: 'candle_pane' });
    const point = Array.isArray(converted) ? converted[0] : converted;
    return { value: point.value ?? y, text: typeof point.value === 'number' ? point.value.toFixed(2) : '', y };
  });
  return points.filter((item) => item.text);
}

function priceToY(chart: Chart, price: number) {
  const coordinate = chart.convertToPixel({ value: price }, { paneId: 'candle_pane' });
  return Array.isArray(coordinate) ? coordinate[0]?.y : coordinate.y;
}

function isVisibleY(value: number | undefined, height: number): value is number {
  return typeof value === 'number' && value >= 0 && value <= height;
}

function formatPercent(value: number | undefined) {
  return value === undefined ? '--' : `${(value * 100).toFixed(1)}%`;
}

function formatPrice(value: number | undefined) {
  return value === undefined ? '--' : value.toFixed(2);
}
