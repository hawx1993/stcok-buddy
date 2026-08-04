import { isChinaMarketOpen } from '../../../src/shared/market-time.js';
import { listHotFocus } from './stock-client.js';
import { flushSurgeSnapshotQueue, pruneSurgeHistory } from './surge-history-store.js';

const CAPTURE_INTERVAL_MS = 20_000;
const FLUSH_INTERVAL_MS = 20_000;
const INITIAL_CAPTURE_DELAY_MS = 20_000;
let isCapturing = false;
let isFlushing = false;
let isStopped = false;
let isShutdownRequested = false;
let captureTimer: NodeJS.Timeout | undefined;
let flushTimer: NodeJS.Timeout | undefined;
let initialCaptureTimer: NodeJS.Timeout | undefined;
let capturePromise: Promise<void> = Promise.resolve();
let flushPromise: Promise<void> = Promise.resolve();
let lastPrunedDate = '';

type TSchedulerWaitOptions = {
  flushQueued?: boolean;
  timeoutMs?: number;
};

export function ensureSurgeHistoryCapture() {
  if (isShutdownRequested || captureTimer || flushTimer || initialCaptureTimer) return;
  isStopped = false;
  initialCaptureTimer = setTimeout(() => {
    initialCaptureTimer = undefined;
    void captureIfTradingTime();
  }, INITIAL_CAPTURE_DELAY_MS);
  initialCaptureTimer.unref?.();
  void flushQueuedSnapshots();
  captureTimer = setInterval(() => void captureIfTradingTime(), CAPTURE_INTERVAL_MS);
  captureTimer.unref?.();
  flushTimer = setInterval(() => void flushQueuedSnapshots(), FLUSH_INTERVAL_MS);
  flushTimer.unref?.();
}

export function stopSurgeHistoryScheduler() {
  isStopped = true;
  clearSchedulerTimers();
}

export function shutdownSurgeHistoryScheduler() {
  isShutdownRequested = true;
  stopSurgeHistoryScheduler();
}

function clearSchedulerTimers() {
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

export async function waitForSurgeHistoryScheduler(options: TSchedulerWaitOptions = {}) {
  await waitForSchedulerPromise(capturePromise, options.timeoutMs, 'capture');
  await waitForSchedulerPromise(flushPromise, options.timeoutMs, 'flush');
  if (options.flushQueued !== false) await flushSurgeSnapshotQueue();
}

async function waitForSchedulerPromise(promise: Promise<void>, timeoutMs: number | undefined, label: string) {
  if (!timeoutMs || timeoutMs <= 0) {
    await promise;
    return;
  }
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    timeout = setTimeout(() => resolve('timeout'), timeoutMs);
    timeout.unref?.();
  });
  const result = await Promise.race([promise.then(() => 'done' as const), timeoutPromise]);
  if (timeout) clearTimeout(timeout);
  if (result === 'timeout') console.warn(`[surge-history] quit wait for ${label} timed out after ${timeoutMs}ms`);
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

