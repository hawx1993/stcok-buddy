import { isRemoteTradingDay } from './providers.js';
import { toShanghaiMarketTime } from './trade-date-resolver.js';
import { getMarketNewsSummaryState, refreshMarketNewsSummary } from '../stock/news-client.js';

const MIN_DELAY_MS = 15 * 60 * 1000;
const MAX_DELAY_MS = 150 * 60 * 1000;
let timer: NodeJS.Timeout | undefined;

export async function startMarketNewsSummaryScheduler() {
  stopMarketNewsSummaryScheduler();
  const marketTime = toShanghaiMarketTime(new Date());
  if (!await isRemoteTradingDay(marketTime.date)) return;
  const state = await getMarketNewsSummaryState();
  if (state.summary) return;
  const delay = marketTime.minutes < 15 * 60 ? millisecondsUntilMarketClose(marketTime.minutes) : randomDelay();
  timer = setTimeout(() => {
    void refreshMarketNewsSummary().catch((error: unknown) => console.warn('[news-summary] refresh failed', error));
  }, delay);
}

export function stopMarketNewsSummaryScheduler() {
  if (!timer) return;
  clearTimeout(timer);
  timer = undefined;
}

function millisecondsUntilMarketClose(currentMinutes: number) {
  const remainingMinutes = Math.max(0, 15 * 60 - currentMinutes);
  return Math.max(MIN_DELAY_MS, remainingMinutes * 60 * 1000 + randomDelay());
}

function randomDelay() {
  return MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
}
