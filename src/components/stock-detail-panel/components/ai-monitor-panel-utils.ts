const MONITOR_FEED_CACHE_TTL_MS = 15_000;

export function isAiMonitorFeedCacheFresh(cache: { cachedAt: number } | undefined, now = Date.now()) {
  return cache !== undefined && now - cache.cachedAt <= MONITOR_FEED_CACHE_TTL_MS;
}

export function shouldLoadAiMonitorFeedOnActiveTransition({
  currentFeedKey,
  didRestore,
  hasEvents,
  isActive,
  nextFeedKey,
  wasActive,
}: {
  currentFeedKey: string;
  didRestore: boolean;
  hasEvents: boolean;
  isActive: boolean;
  nextFeedKey: string;
  wasActive: boolean;
}) {
  if (!isActive || wasActive) return false;
  if (didRestore) return true;
  return !hasEvents || currentFeedKey !== nextFeedKey;
}
