import type { ChipDistribution, KlinePoint, TChipDistributionPeriod, TChipDistributionSource } from '../../shared/types';

export const klineTimeframes = [
  { id: 'timeline', label: '分时', limit: 0, period: { type: 'minute', span: 1 } },
  { id: '15m', label: '15分钟', limit: 240, period: { type: 'minute', span: 15 } },
  { id: '1h', label: '1小时', limit: 240, period: { type: 'hour', span: 1 } },
  { id: '1d', label: '天', limit: 360, period: { type: 'day', span: 1 } },
  { id: '1w', label: '周', limit: 240, period: { type: 'week', span: 1 } },
  { id: '1mo', label: '月', limit: 120, period: { type: 'month', span: 1 } },
] as const;

export type TimeframeId = (typeof klineTimeframes)[number]['id'];

export interface IChipStateCacheEntry {
  distribution?: ChipDistribution;
  distributions: ChipDistribution[];
  source?: TChipDistributionSource;
}

const CHIP_CACHE_FALLBACK_PERIODS: TChipDistributionPeriod[] = ['1d', '15m', '1h', '1w', '1mo'];

export function supportsChipDistribution(timeframe: TimeframeId) {
  return timeframe === '15m' || timeframe === '1h' || timeframe === '1d' || timeframe === '1w' || timeframe === '1mo';
}

export function shouldReserveModalChipColumn(
  timeframe: TimeframeId,
  showIndicators: boolean,
  showChips: boolean,
  chipsOpen: boolean,
) {
  return showIndicators && showChips && chipsOpen && supportsChipDistribution(timeframe);
}

export function shouldKeepPreviousChipOverlay(
  loading: boolean,
  enabled: boolean,
  currentPeriod: TChipDistributionPeriod | undefined,
  loadedPeriod: TChipDistributionPeriod | undefined,
) {
  return loading || (enabled && loadedPeriod !== currentPeriod);
}

export function shouldUseCachedChipState(
  loading: boolean,
  currentPeriod: TChipDistributionPeriod | undefined,
  loadedPeriod: TChipDistributionPeriod | undefined,
  hasLoadedCurrentData: boolean,
) {
  return Boolean(currentPeriod && (loadedPeriod !== currentPeriod || (loading && !hasLoadedCurrentData)));
}

export function getChipStateCacheKey(symbol: string, period: TChipDistributionPeriod) {
  return `${symbol}|${period}`;
}

export function resolveChipStateCacheEntry(
  cache: ReadonlyMap<string, IChipStateCacheEntry>,
  symbol: string,
  period: TChipDistributionPeriod,
) {
  const exact = cache.get(getChipStateCacheKey(symbol, period));
  if (exact) return exact;
  for (const fallbackPeriod of CHIP_CACHE_FALLBACK_PERIODS) {
    if (fallbackPeriod === period) continue;
    const cached = cache.get(getChipStateCacheKey(symbol, fallbackPeriod));
    if (cached) return adaptChipStateCacheEntry(cached, period);
  }
  return undefined;
}

export function adaptChipStateCacheEntry(entry: IChipStateCacheEntry, period: TChipDistributionPeriod): IChipStateCacheEntry {
  return {
    distribution: entry.distribution ? { ...entry.distribution, period } : undefined,
    distributions: entry.distributions.map((distribution) => ({ ...distribution, period })),
    source: entry.source,
  };
}

export function resolveChipOverlayDistribution<TDistribution>(
  current: TDistribution | undefined,
  previous: TDistribution | undefined,
  loading: boolean,
) {
  return current ?? (loading ? previous : undefined);
}

export interface ILoadOlderKlineInput {
  timeframe: TimeframeId;
  limit: number;
  beforeTimestamp?: number;
}

export type TLoadOlderKline = (input: ILoadOlderKlineInput) => Promise<KlinePoint[]>;
