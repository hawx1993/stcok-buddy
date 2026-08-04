import { isChinaMarketOpen } from '../../../src/shared/market-time.js';
import { listHotFocus } from './stock-client.js';
import { flushSurgeSnapshotQueue, pruneSurgeHistory } from './surge-history-store.js';

const CAPTURE_INTERVAL_MS = 20_000;
const FLUSH_INTERVAL_MS = 20_000;
const INITIAL_CAPTURE_DELAY_MS = 20_000;
let isCapturing = false;
let isFlushing = false;
let isStopped = false;
let captureTimer: NodeJS.Timeout | undefined;
let flushTimer: NodeJS.Timeout | undefined;
let initialCaptureTimer: NodeJS.Timeout | undefined;
let capturePromise: Promise<void> = Promise.resolve();
let flushPromise: Promise<void> = Promise.resolve();
let lastPrunedDate = '';

export function ensureSurgeHistoryCapture() {
  if (captureTimer || flushTimer || initialCaptureTimer) return;
  isStopped = false;
  initialCaptureTimer = setTimeout(() => {
    initialCaptureTimer = undefined;
    void captureIfTradingTime();
  }, INITIAL_CAPTURE_DELAY_MS);
  void flushQueuedSnapshots();
  captureTimer = setInterval(() => void captureIfTradingTime(), CAPTURE_INTERVAL_MS);
  flushTimer = setInterval(() => void flushQueuedSnapshots(), FLUSH_INTERVAL_MS);
}

export function stopSurgeHistoryScheduler() {
  isStopped = true;
  if (captureTimer) clearInterval(captureTimer);
  if (flushTimer) clearInterval(flushTimer);
  if (initialCaptureTimer) clearTimeout(initialCaptureTimer);
  captureTimer = undefined;
  flushTimer = undefined;
  initialCaptureTimer = undefined;
}

export function isSurgeHistorySchedulerRunning() {
  return Boolean(captureTimer || flushTimer || initialCaptureTimer) && !isStopped;
}

export async function waitForSurgeHistoryScheduler() {
  await capturePromise;
  await flushPromise;
  await flushSurgeSnapshotQueue();
}

function captureIfTradingTime(now = new Date()) {
  if (isStopped || isCapturing || !isChinaMarketOpen(now)) return capturePromise;
  capturePromise = runCapture(now);
  return capturePromise;
}

async function runCapture(now: Date) {
  isCapturing = true;
  try {
    await listHotFocus('surge');
    await flushSurgeSnapshotQueue();
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

function flushQueuedSnapshots() {
  if (isStopped || isFlushing) return flushPromise;
  flushPromise = runFlush();
  return flushPromise;
}

async function runFlush() {
  isFlushing = true;
  try {
    await flushSurgeSnapshotQueue();
  } catch (error) {
    console.warn('[surge-history] flush failed', error);
  } finally {
    isFlushing = false;
  }
}

