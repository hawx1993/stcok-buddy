import { isChinaMarketOpen } from '../../../src/shared/market-time.js';
import { flushMonitorEventQueue } from './monitor-history-store.js';
import { captureMonitorEvents, persistMonitorCapture } from './monitor-service.js';

const CAPTURE_INTERVAL_MS = 20_000;
const FLUSH_INTERVAL_MS = 20_000;
const INITIAL_CAPTURE_DELAY_MS = 20_000;
const SCHEDULED_MONITOR_CATEGORIES = ['large-order', 'ai-opportunity', 'ai-warning'] as const;
let isCapturing = false;
let isFlushing = false;
let isStopped = false;
let captureTimer: NodeJS.Timeout | undefined;
let flushTimer: NodeJS.Timeout | undefined;
let initialCaptureTimer: NodeJS.Timeout | undefined;
let capturePromise: Promise<void> = Promise.resolve();
let flushPromise: Promise<void> = Promise.resolve();

type TSchedulerWaitOptions = {
  flushQueued?: boolean;
  timeoutMs?: number;
};

export function startMonitorHistoryScheduler() {
  if (captureTimer || flushTimer || initialCaptureTimer) return;
  isStopped = false;
  initialCaptureTimer = setTimeout(() => {
    initialCaptureTimer = undefined;
    void captureIfTradingTime();
  }, INITIAL_CAPTURE_DELAY_MS);
  initialCaptureTimer.unref?.();
  void flushQueuedEvents();
  captureTimer = setInterval(() => void captureIfTradingTime(), CAPTURE_INTERVAL_MS);
  captureTimer.unref?.();
  flushTimer = setInterval(() => void flushQueuedEvents(), FLUSH_INTERVAL_MS);
  flushTimer.unref?.();
}

export function stopMonitorHistoryScheduler() {
  isStopped = true;
  if (captureTimer) clearInterval(captureTimer);
  if (flushTimer) clearInterval(flushTimer);
  if (initialCaptureTimer) clearTimeout(initialCaptureTimer);
  captureTimer = undefined;
  flushTimer = undefined;
  initialCaptureTimer = undefined;
}

export function isMonitorHistorySchedulerRunning() {
  return Boolean(captureTimer || flushTimer || initialCaptureTimer) && !isStopped;
}

export async function waitForMonitorHistoryScheduler(options: TSchedulerWaitOptions = {}) {
  await waitForSchedulerPromise(capturePromise, options.timeoutMs, 'capture');
  await waitForSchedulerPromise(flushPromise, options.timeoutMs, 'flush');
  if (options.flushQueued !== false) await flushMonitorEventQueue();
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
  if (result === 'timeout') console.warn(`[monitor-history] quit wait for ${label} timed out after ${timeoutMs}ms`);
}

function captureIfTradingTime(now = new Date()) {
  if (isStopped || isCapturing || !isChinaMarketOpen(now)) return capturePromise;
  capturePromise = runCapture(now);
  return capturePromise;
}

async function runCapture(now: Date) {
  isCapturing = true;
  try {
    const events = await captureMonitorEvents(now, [...SCHEDULED_MONITOR_CATEGORIES]);
    await persistMonitorCapture(events, now);
  } catch (error) {
    console.warn('[monitor-history] capture failed', error);
  } finally {
    isCapturing = false;
  }
}

function flushQueuedEvents() {
  if (isStopped || isFlushing) return flushPromise;
  flushPromise = runFlush();
  return flushPromise;
}

async function runFlush() {
  isFlushing = true;
  try {
    await flushMonitorEventQueue();
  } catch (error) {
    console.warn('[monitor-history] flush failed', error);
  } finally {
    isFlushing = false;
  }
}
