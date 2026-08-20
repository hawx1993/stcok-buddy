import type { MarketIndexPeriod, MarketIndexSnapshot, MarketPageSnapshot, MarketQuoteRow, MarketTab } from '../../shared/types.js';

interface IMarketViewCachedState {
  indices: MarketIndexSnapshot[];
  rowsByTab: Partial<Record<MarketTab, MarketQuoteRow[]>>;
  updatedAt: string;
}

const snapshotsByKey = new Map<string, MarketPageSnapshot>();

export function cacheMarketViewSnapshot(snapshot: MarketPageSnapshot) {
  const key = snapshotKey(snapshot.tab, snapshot.period ?? '1d');
  const current = snapshotsByKey.get(key);
  const next: MarketPageSnapshot = {
    ...snapshot,
    indices: snapshot.indices.length ? snapshot.indices : (current?.indices ?? snapshot.indices),
    rows: snapshot.rows.length ? snapshot.rows : (current?.rows ?? snapshot.rows),
  };
  if (!next.indices.length && !next.rows.length) return;
  snapshotsByKey.set(key, next);
}

export function getCachedMarketViewState(tab: MarketTab, period: MarketIndexPeriod): IMarketViewCachedState {
  const snapshots = [...snapshotsByKey.values()].filter((snapshot) => (snapshot.period ?? '1d') === period);
  const activeSnapshot = snapshotsByKey.get(snapshotKey(tab, period));
  const indexSnapshot = activeSnapshot?.indices.length ? activeSnapshot : snapshots.find((snapshot) => snapshot.indices.length);
  const rowsByTab: Partial<Record<MarketTab, MarketQuoteRow[]>> = {};

  for (const snapshot of snapshots) {
    if (snapshot.rows.length) rowsByTab[snapshot.tab] = snapshot.rows;
  }

  return {
    indices: indexSnapshot?.indices ?? [],
    rowsByTab,
    updatedAt: activeSnapshot?.updatedAt ?? indexSnapshot?.updatedAt ?? '',
  };
}

function snapshotKey(tab: MarketTab, period: MarketIndexPeriod) {
  return `${tab}:${period}`;
}
