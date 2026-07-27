import type { MarketIndexPeriod, MarketIndexSnapshot } from '../../../src/shared/types.js';

export const marketIndexCache = new Map<
  MarketIndexPeriod,
  { rows?: MarketIndexSnapshot[]; refreshing?: Promise<MarketIndexSnapshot[]> }
>();
