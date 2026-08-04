import type { KLineData } from 'klinecharts';
import type { ChipDistribution, IStockTimelinePoint, IStockTimelineSnapshot, KlinePoint } from '../shared/types';

export interface IKlinePeriodLike {
  type: string;
  span: number;
}

export interface IKlineBuildInput {
  data: KlinePoint[];
  period: IKlinePeriodLike;
}

export interface IKlineMergeInput {
  older: KlinePoint[];
  current: KlinePoint[];
  period: IKlinePeriodLike;
}

export interface IKlineTimestampInput {
  value: string;
  index: number;
  total: number;
  period: IKlinePeriodLike;
}

export interface IFavoriteTimelinePath {
  line: string;
  area: string;
}

export interface IStockTimelineChartPath {
  priceLine: string;
  priceArea: string;
  averageLine?: string;
  preCloseLine?: string;
  rows: IStockTimelinePoint[];
  coordinates: Array<{ x: number; y: number }>;
  yLabels: Array<{ y: number; label: string }>;
  xLabels: Array<{ x: number; label: string }>;
}

export interface IChipPreparedPoint {
  price: number;
  weight: number;
  width: number;
}

export interface IChipPreparedLayout {
  date: string;
  points: IChipPreparedPoint[];
}

export interface IPrepareChipInput {
  chips: ChipDistribution;
  barWidth: number;
}

export interface IStockComputeApi {
  buildKlineData(input: IKlineBuildInput): KLineData[];
  mergeKlineData(input: IKlineMergeInput): KlinePoint[];
  parseKlineTimestamp(input: IKlineTimestampInput): number;
  buildStockTimelinePath(snapshot: IStockTimelineSnapshot | undefined): IStockTimelineChartPath | undefined;
  buildFavoriteTimelinePath(points: IStockTimelinePoint[] | undefined): IFavoriteTimelinePath | undefined;
  prepareChipLayout(input: IPrepareChipInput): IChipPreparedLayout;
}
