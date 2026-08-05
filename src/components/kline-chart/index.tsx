import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { dispose, init } from 'klinecharts';
import type { Chart, Crosshair, KLineData, Period, VisibleRange } from 'klinecharts';
import { getStocksenseApi } from '../../shared/stocksense-api';
import { useAppDataStore } from '../../store/app-store';
import type { KlinePoint, StockDetail } from '../../shared/types';
import { getMarketColors } from '../../shared/market-color';
import cx from '../../shared/cx';
import styles from './index.module.scss';
import { ChipOverlay } from './components/chip-overlay';
import { findChipDistributionByDate, useChipDistribution } from './components/use-chip-distribution';
import { KlineHoverInfo } from './components/kline-hover-info';
import { KlineModalFrame } from './components/kline-modal-frame';
import { StockTimelineChart } from './components/stock-timeline-chart';
import { getStockComputeWorker } from '../../workers/stock-compute-client';
import { klineTimeframes } from './constants';
import type { TimeframeId, TLoadOlderKline } from './constants';

type KlineStock = Pick<StockDetail, 'code' | 'name' | 'pe' | 'price'>;

const EMPTY_KLINE_DATA: KlinePoint[] = [];
const KLINE_LOAD_STEP = 240;
const KLINE_MAX_LIMIT = 1200;

interface StockKlineChartProps {
  stock?: KlineStock;
  data?: KlinePoint[];
  className?: string;
  height?: number | string;
  showSwitcher?: boolean;
  showChips?: boolean;
  chipsOpen?: boolean;
  showIndicators?: boolean;
  showLegend?: boolean;
  timeframe?: TimeframeId;
  onTimeframeChange?: (timeframe: TimeframeId) => void;
  loadOlderKline?: TLoadOlderKline;
  staticData?: boolean;
}

export function StockKlineChart({
  stock,
  data = EMPTY_KLINE_DATA,
  className,
  height = 210,
  showSwitcher = false,
  showChips = false,
  chipsOpen = false,
  showIndicators = false,
  showLegend = true,
  timeframe,
  onTimeframeChange,
  loadOlderKline,
  staticData = false,
}: StockKlineChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const loadingMoreRef = useRef(false);
  const loadedLimitRef = useRef(0);
  const hasMoreOlderDataRef = useRef(true);
  const chartDataRef = useRef<KlinePoint[]>([]);
  const marketColorMode = useAppDataStore((state) => state.config?.marketColorMode ?? 'red-up-green-down');
  const marketColors = useMemo(() => getMarketColors(marketColorMode), [marketColorMode]);
  const [localTf, setLocalTf] = useState<TimeframeId>('1d');
  const requestedTf = timeframe ?? localTf;
  const tf = requestedTf;
  const isTimeline = tf === 'timeline';
  const usesProvidedData = data.length > 0 && staticData;
  const [loadedData, setLoadedData] = useState<KlinePoint[]>(() => {
    if (usesProvidedData || (data.length > 0 && !staticData)) {
      loadedLimitRef.current = data.length;
      hasMoreOlderDataRef.current = true;
      return data;
    }
    return [];
  });
  const [hoverIndex, setHoverIndex] = useState<number | undefined>();
  const [hoverPoint, setHoverPoint] = useState<KlinePoint | undefined>();
  const [tooltipSide, setTooltipSide] = useState<'left' | 'right'>('right');
  const [chartInstance, setChartInstance] = useState<Chart | null>(null);
  const [chipLayoutVersion, setChipLayoutVersion] = useState(0);
  const frame = klineTimeframes.find((item) => item.id === tf) ?? klineTimeframes[3];
  const chartData = loadedData;
  chartDataRef.current = chartData;
  const [klineData, setKlineData] = useState<KLineData[]>([]);
  const chipsEnabled = tf === '1d' && showChips && chipsOpen;
  const {
    distribution: latestChipDistribution,
    distributions: chipDistributions,
    source: chipSource,
    loading: chipLoading,
    empty: chipEmpty,
    error: chipError,
  } = useChipDistribution(chipsEnabled && stock ? toKlineRequestSymbol(stock) : undefined, chipsEnabled);
  const activeKlinePoint = hoverPoint ?? chartData[chartData.length - 1];
  const chipDistribution =
    (hoverPoint ? findChipDistributionByDate(chipDistributions, hoverPoint.time) : latestChipDistribution) ??
    latestChipDistribution;

  useEffect(() => {
    if (!chartData.length) {
      setKlineData([]);
      return;
    }
    let alive = true;
    getStockComputeWorker()
      .buildKlineData({ data: chartData, period: frame.period })
      .then((next) => {
        if (alive) setKlineData(next);
      })
      .catch((error: unknown) => {
        console.error('[kline] worker build data failed', error);
        if (alive) setKlineData([]);
      });
    return () => {
      alive = false;
    };
  }, [chartData, frame.period]);

  useEffect(() => {
    if (usesProvidedData) setLoadedData(data);
  }, [data, usesProvidedData]);

  useEffect(() => {
    if (!stock?.code || usesProvidedData || isTimeline) return;
    let alive = true;
    // For daily timeframe use provided data as seed, allow loadOlderData to fetch more on drag-left.
    // For other timeframes always fetch via API since the data prop is daily-only.
    const hasDailySeed = data.length > 0 && !staticData && tf === '1d';
    if (hasDailySeed) {
      console.log('[kline] using parent seed data', { code: stock?.code, bars: data.length });
      setLoadedData(data);
      loadedLimitRef.current = data.length;
      hasMoreOlderDataRef.current = true;
      setHoverIndex(undefined);
      setHoverPoint(undefined);
    } else {
      setLoadedData([]);
      loadedLimitRef.current = 0;
      hasMoreOlderDataRef.current = true;
      setHoverIndex(undefined);
      setHoverPoint(undefined);
    }
    console.log(hasDailySeed ? '[kline] refreshing seed data from API' : '[kline] no seed data, fetching from API', { code: stock?.code });
    getStocksenseApi()
      .getKline(toKlineRequestSymbol(stock), frame.limit, tf)
      .then(async (next) => {
        console.log('[kline] API fetch done', { code: stock?.code, bars: next.length, firstDate: next[0]?.time });
        if (alive) {
          const merged = hasDailySeed
            ? await getStockComputeWorker().mergeKlineData({ older: data, current: next, period: frame.period })
            : next;
          if (!alive) return;
          setLoadedData(merged);
          loadedLimitRef.current = hasDailySeed ? Math.max(data.length, next.length) : frame.limit;
          hasMoreOlderDataRef.current = true;
          setHoverIndex(undefined);
          setHoverPoint(undefined);
        }
      })
      .catch((err) => {
        console.error('[kline] API fetch error', {
          code: stock?.code,
          error: err instanceof Error ? err.message : String(err),
        });
        if (alive) {
          setLoadedData([]);
          loadedLimitRef.current = 0;
          hasMoreOlderDataRef.current = false;
        }
      });
    return () => {
      alive = false;
    };
  }, [usesProvidedData, isTimeline, stock?.code, frame.limit, frame.period, tf, data, staticData]);

  const loadOlderData = useCallback(
    async (options: { anchorTimestamp?: number } = {}) => {
      if (
        !stock?.code ||
        loadingMoreRef.current ||
        !hasMoreOlderDataRef.current ||
        loadedLimitRef.current >= KLINE_MAX_LIMIT ||
        !chartDataRef.current.length
      )
        return [];
      const firstTimestamp =
        options.anchorTimestamp ??
        chartDataRef.current[0]?.timestamp ??
        (chartDataRef.current[0]
          ? await getStockComputeWorker().parseKlineTimestamp({
              value: chartDataRef.current[0].time,
              index: 0,
              total: chartDataRef.current.length,
              period: frame.period,
            })
          : undefined);
      loadingMoreRef.current = true;
      const nextLimit = Math.min(
        KLINE_MAX_LIMIT,
        Math.max(loadedLimitRef.current + KLINE_LOAD_STEP, frame.limit + KLINE_LOAD_STEP),
      );
      try {
        const next = loadOlderKline
          ? await loadOlderKline({ timeframe: tf, limit: nextLimit, beforeTimestamp: firstTimestamp })
          : await getStocksenseApi().getKline(toKlineRequestSymbol(stock), nextLimit, tf, firstTimestamp);
        const normalizedNext = await getStockComputeWorker().mergeKlineData({ older: next, current: [], period: frame.period });
        const older = firstTimestamp === undefined ? normalizedNext : normalizedNext.filter((point) => (point.timestamp ?? 0) < firstTimestamp);
        if (!older.length) {
          hasMoreOlderDataRef.current = false;
          return [];
        }
        loadedLimitRef.current = Math.min(KLINE_MAX_LIMIT, chartDataRef.current.length + older.length);
        const currentData = chartDataRef.current;
        const merged = await getStockComputeWorker().mergeKlineData({ older, current: currentData, period: frame.period });
        setLoadedData(merged);
        return older;
      } finally {
        loadingMoreRef.current = false;
      }
    },
    [frame.limit, frame.period, loadOlderKline, stock, tf],
  );
  const loadOlderDataRef = useRef(loadOlderData);

  const requestOlderData = useCallback((anchorTimestamp?: number) => {
    void loadOlderDataRef.current({ anchorTimestamp });
  }, []);

  useEffect(() => {
    loadOlderDataRef.current = loadOlderData;
  }, [loadOlderData]);

  useEffect(() => {
    if (!hostRef.current) return;
    const klineStyles = getKlineStyles(marketColors);
    const chart = init(hostRef.current, {
      styles: {
        ...klineStyles,
        candle: { ...klineStyles.candle, tooltip: { showRule: showLegend ? 'always' : 'none', showType: 'standard' } },
        indicator: {
          ...klineStyles.indicator,
          tooltip: { showRule: showLegend ? 'always' : 'none', showType: 'standard' },
        },
        grid: {
          show: true,
          horizontal: { show: true, size: 1, color: 'rgba(148, 163, 184, 0.1)' },
          vertical: { show: true, size: 1, color: 'rgba(148, 163, 184, 0.06)' },
        },
        xAxis: {
          show: true,
          size: 28,
          axisLine: { show: false },
          tickLine: { show: false },
          tickText: { show: true, color: 'rgba(148, 163, 184, 0.78)', size: 10, marginStart: 4, marginEnd: 4 },
        },
        yAxis: getYAxisStyles(showIndicators && chipsEnabled),
        separator: { size: 1, color: 'rgba(148, 163, 184, 0.12)' },
      },
    });
    if (!chart) return;
    chartRef.current = chart;
    chart.setRightMinVisibleBarCount(2);
    setChartInstance(chart);
    const refreshFrameRef = { current: 0 };
    const refreshChipLayout = () => {
      if (refreshFrameRef.current) return;
      refreshFrameRef.current = window.requestAnimationFrame(() => {
        refreshFrameRef.current = 0;
        setChipLayoutVersion((value) => value + 1);
      });
    };
    const updateHoverIndex = (nextIndex: number | undefined) => {
      const currentLength = chartDataRef.current.length;
      const normalizedIndex =
        nextIndex === undefined || !currentLength ? undefined : Math.max(0, Math.min(currentLength - 1, nextIndex));
      if (normalizedIndex !== undefined && normalizedIndex < 12)
        requestOlderData(getFirstKlineTimestamp(chartDataRef.current));
      setHoverIndex((current) => (current === normalizedIndex ? current : normalizedIndex));
      setHoverPoint((current) => {
        const nextPoint = normalizedIndex === undefined ? undefined : chartDataRef.current[normalizedIndex];
        return current === nextPoint ? current : nextPoint;
      });
    };
    const onCrosshairChange = (value?: unknown) => {
      updateHoverIndex(resolveCrosshairIndex(value as Crosshair | undefined, chartDataRef.current));
    };
    const onVisibleRangeChange = (value?: unknown) => {
      const range = value as VisibleRange | undefined;
      if (range && range.from === 0) requestOlderData(getFirstKlineTimestamp(chartDataRef.current));
      refreshChipLayout();
    };
    const onChartLayoutChange = () => refreshChipLayout();
    const onMouseMove = (event: MouseEvent) => {
      const rect = hostRef.current?.getBoundingClientRect();
      if (rect) setTooltipSide(event.clientX - rect.left > rect.width / 2 ? 'left' : 'right');
      updateHoverIndex(resolveMouseIndex(chart, hostRef.current, event));
    };
    const onMouseLeave = () => updateHoverIndex(undefined);
    hostRef.current.addEventListener('mousemove', onMouseMove);
    hostRef.current.addEventListener('mouseleave', onMouseLeave);
    chart.subscribeAction('onCrosshairChange', onCrosshairChange);
    chart.subscribeAction('onVisibleRangeChange', onVisibleRangeChange);
    chart.subscribeAction('onZoom', onChartLayoutChange);
    chart.subscribeAction('onScroll', onChartLayoutChange);
    chart.subscribeAction('onPaneDrag', onChartLayoutChange);
    const resizeObserver = new ResizeObserver(() => {
      chart.resize();
      refreshChipLayout();
    });
    resizeObserver.observe(hostRef.current);
    return () => {
      if (refreshFrameRef.current) window.cancelAnimationFrame(refreshFrameRef.current);
      resizeObserver.disconnect();
      chart.unsubscribeAction('onCrosshairChange', onCrosshairChange);
      chart.unsubscribeAction('onVisibleRangeChange', onVisibleRangeChange);
      chart.unsubscribeAction('onZoom', onChartLayoutChange);
      chart.unsubscribeAction('onScroll', onChartLayoutChange);
      chart.unsubscribeAction('onPaneDrag', onChartLayoutChange);
      hostRef.current?.removeEventListener('mousemove', onMouseMove);
      hostRef.current?.removeEventListener('mouseleave', onMouseLeave);
      dispose(chart);
      chartRef.current = null;
      setChartInstance(null);
    };
  }, [requestOlderData, showLegend, frame.period, showIndicators, chipsEnabled]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setStyles({
      ...getKlineStyles(marketColors),
      yAxis: getYAxisStyles(showIndicators && chipsEnabled),
    });
    chart.setRightMinVisibleBarCount(2);
    chart.resize();
  }, [marketColors, showIndicators, chipsEnabled]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setSymbol({
      ticker: stock?.code || 'kline',
      name: stock?.name || 'K线',
      pricePrecision: 2,
      volumePrecision: 0,
    });
    chart.setPeriod(frame.period as Period);
    chart.setDataLoader({
      getBars: async ({ type, timestamp, callback }) => {
        if (type === 'forward') {
          await loadOlderData({ anchorTimestamp: timestamp ?? undefined });
          callback([], { forward: hasMoreOlderDataRef.current, backward: false });
          return;
        }
        callback(klineData, {
          forward: klineData.length > 0 && hasMoreOlderDataRef.current && loadedLimitRef.current < KLINE_MAX_LIMIT,
          backward: false,
        });
      },
    });
    chart.resetData();
    chart.removeIndicator();
    chart.createIndicator('MA', { isStack: true, pane: { id: 'candle_pane' } });
    if (showIndicators) {
      chart.createIndicator('VOL', { pane: { height: 96 } });
      chart.createIndicator('MACD', { pane: { height: 96 } });
    }
    chart.resize();
    setChipLayoutVersion((value) => value + 1);
  }, [frame.period, klineData, loadOlderData, showIndicators, staticData, stock?.code, stock?.name]);

  const setTimeframe = (next: TimeframeId) => {
    setLocalTf(next);
    onTimeframeChange?.(next);
  };

  if (isTimeline) {
    return (
      <div className={cx(styles.wrap, className)} style={{ height }}>
        <StockTimelineChart stock={stock} height='100%' />
        {showSwitcher ? (
          <div className={styles.timeframes}>
            {klineTimeframes.map((item) => (
              <button
                key={item.id}
                className={cx(styles.tf, tf === item.id && styles.active)}
                onClick={() => setTimeframe(item.id)}
                type='button'
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cx(styles.wrap, className)} style={{ height }}>
      <div className={styles.chart} ref={hostRef} />
      {hoverPoint ? (
        <KlineHoverInfo
          point={hoverPoint}
          previous={hoverIndex ? chartData[hoverIndex - 1] : undefined}
          pe={stock?.pe}
          side={tooltipSide}
          period={frame.period}
        />
      ) : null}
      {chipDistribution && chartInstance && activeKlinePoint ? (
        <ChipOverlay
          chips={chipDistribution}
          chart={chartInstance}
          currentPrice={activeKlinePoint.close}
          layoutVersion={chipLayoutVersion}
          profitColor={marketColors.upColor}
          trappedColor={marketColors.downColor}
          source={chipSource}
          showSummary={showIndicators}
          showPriceAxis={showIndicators}
        />
      ) : null}
      {chipsEnabled && hoverPoint && !chipDistribution && !chipLoading ? (
        <div className={styles['chip-state']}>该日期暂无筹码数据</div>
      ) : chipsEnabled && !latestChipDistribution && !chipLoading ? (
        <div className={styles['chip-state']} title={chipError}>
          {chipError ? '筹码数据暂不可用' : chipEmpty ? '暂无筹码数据' : '暂无筹码数据'}
        </div>
      ) : null}
      {showSwitcher ? (
        <div className={styles.timeframes}>
          {klineTimeframes.map((item) => (
            <button
              key={item.id}
              className={cx(styles.tf, tf === item.id && styles.active)}
              onClick={() => setTimeframe(item.id)}
              type='button'
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function KlineModal({
  stock,
  data,
  onClose,
  chipsOpen = true,
}: {
  stock: KlineStock;
  data?: KlinePoint[];
  onClose(): void;
  chipsOpen?: boolean;
}) {
  const modal = (
    <KlineModalFrame
      stock={stock}
      data={data}
      onClose={onClose}
      chipsOpen={chipsOpen}
      renderChart={(tf, setTf) => (
        <StockKlineChart
          stock={stock}
          data={data}
          height='100%'
          showSwitcher
          showChips
          chipsOpen={chipsOpen}
          showIndicators
          timeframe={tf}
          onTimeframeChange={setTf}
        />
      )}
    />
  );
  return createPortal(modal, document.body);
}

function getFirstKlineTimestamp(data: KlinePoint[]) {
  return data[0]?.timestamp;
}

function toKlineRequestSymbol(stock: KlineStock) {
  if (stock.name === '上证指数' && stock.code === '000001') return 'sh000001';
  if (stock.name === '深证成指' && stock.code === '399001') return 'sz399001';
  return stock.code;
}

function resolveMouseIndex(chart: Chart, host: HTMLDivElement | null, event: MouseEvent) {
  if (!host) return undefined;
  const x = event.clientX - host.getBoundingClientRect().left;
  const point = chart.convertFromPixel([{ x }], { paneId: 'candle_pane' });
  const dataIndex = Array.isArray(point) ? point[0]?.dataIndex : undefined;
  return typeof dataIndex === 'number' ? clampIndex(Math.round(dataIndex), chartDataLength(chart)) : undefined;
}

function chartDataLength(chart: Chart) {
  return Math.max(chart.getDataList().length, 1);
}

function resolveCrosshairIndex(crosshair: Crosshair | undefined, data: KlinePoint[]) {
  if (!crosshair || !data.length) return undefined;
  if (typeof crosshair.dataIndex === 'number') return clampIndex(crosshair.dataIndex, data.length);
  if (typeof crosshair.realDataIndex === 'number') return clampIndex(crosshair.realDataIndex, data.length);
  const timestamp = crosshair.kLineData?.timestamp ?? crosshair.timestamp;
  if (typeof timestamp !== 'number') return undefined;
  const index = data.findIndex((item) => item.timestamp === timestamp);
  return index >= 0 ? index : undefined;
}

function clampIndex(index: number, length: number) {
  return Math.max(0, Math.min(length - 1, index));
}

function getYAxisStyles(hideLabels: boolean) {
  return {
    show: true,
    size: hideLabels ? 0 : ('auto' as const),
    axisLine: { show: false },
    tickLine: { show: false },
    tickText: {
      show: !hideLabels,
      color: 'rgba(148, 163, 184, 0.78)',
      size: 10,
      marginStart: 4,
      marginEnd: 4,
    },
  };
}

function getKlineStyles({ upColor, downColor }: ReturnType<typeof getMarketColors>) {
  return {
    candle: {
      bar: {
        upColor,
        downColor,
        noChangeColor: upColor,
        upBorderColor: upColor,
        downBorderColor: downColor,
        noChangeBorderColor: upColor,
        upWickColor: upColor,
        downWickColor: downColor,
        noChangeWickColor: upColor,
      },
      priceMark: { last: { upColor, downColor, noChangeColor: upColor } },
    },
    indicator: { ohlc: { upColor, downColor, noChangeColor: upColor } },
  };
}
