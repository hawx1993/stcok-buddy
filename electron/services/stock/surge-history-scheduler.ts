import { isChinaMarketOpen } from '../../../src/shared/market-time.js';
import { listHotFocus } from './stock-client.js';
import { pruneSurgeHistory, saveSurgeSnapshot } from './surge-history-store.js';

const CAPTURE_INTERVAL_MS = 30_000;
let isCapturing = false;
let isStopped = false;
let timer: NodeJS.Timeout | undefined;
let lastPrunedDate = '';

export function ensureSurgeHistoryCapture() {
  if (timer) return;
  isStopped = false;
  void captureIfTradingTime();
  timer = setInterval(() => void captureIfTradingTime(), CAPTURE_INTERVAL_MS);
}

export function stopSurgeHistoryScheduler() {
  isStopped = true;
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
}

async function captureIfTradingTime(now = new Date()) {
  if (isStopped || isCapturing || !isChinaMarketOpen(now)) return;
  isCapturing = true;
  try {
    const items = await listHotFocus('surge');
    if (!isStopped && items.length) await saveSurgeSnapshot(items, now);
    const dateKey = now.toISOString().slice(0, 10);
    if (!isStopped && lastPrunedDate !== dateKey) {
      await pruneSurgeHistory(7);
      lastPrunedDate = dateKey;
    }
  } catch (error) {
    console.warn('[surge-history] capture failed', error);
  } finally {
    isCapturing = false;
  }
}

