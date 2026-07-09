import { listHotFocus } from './stock-client.js';
import { pruneSurgeHistory, saveSurgeSnapshot } from './surge-history-store.js';

const CAPTURE_INTERVAL_MS = 30_000;
let isCapturing = false;
let isStopped = false;
let timer: NodeJS.Timeout | undefined;

export function startSurgeHistoryScheduler() {
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
  if (isStopped || isCapturing || !isTradingWindow(now)) return;
  isCapturing = true;
  try {
    const items = await listHotFocus('surge');
    if (!isStopped && items.length) await saveSurgeSnapshot(items, now);
    if (!isStopped) await pruneSurgeHistory(7);
  } catch (error) {
    console.warn('[surge-history] capture failed', error);
  } finally {
    isCapturing = false;
  }
}

function isTradingWindow(date: Date) {
  const day = date.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes >= 9 * 60 + 25 && minutes <= 15 * 60;
}
