import { isChinaMarketOpen } from '../../../src/shared/market-time.js';
import { flushMonitorEventQueue } from './monitor-history-store.js';
import { captureMonitorEvents, persistMonitorCapture } from './monitor-service.js';

const CAPTURE_INTERVAL_MS = 20_000;
const FLUSH_INTERVAL_MS = 20_000;
let isCapturing = false;
let isFlushing = false;
let isStopped = false;
let captureTimer: NodeJS.Timeout | undefined;
let flushTimer: NodeJS.Timeout | undefined;
let capturePromise: Promise<void> = Promise.resolve();
let flushPromise: Promise<void> = Promise.resolve();

export function startMonitorHistoryScheduler() {
  if (captureTimer || flushTimer) return;
  isStopped = false;
  void captureIfTradingTime();
  void flushQueuedEvents();
  captureTimer = setInterval(() => void captureIfTradingTime(), CAPTURE_INTERVAL_MS);
  flushTimer = setInterval(() => void flushQueuedEvents(), FLUSH_INTERVAL_MS);
}

export function stopMonitorHistoryScheduler() {
  isStopped = true;
  if (captureTimer) clearInterval(captureTimer);
  if (flushTimer) clearInterval(flushTimer);
  captureTimer = undefined;
  flushTimer = undefined;
}

export function isMonitorHistorySchedulerRunning() {
  return Boolean(captureTimer || flushTimer) && !isStopped;
}

export async function waitForMonitorHistoryScheduler() {
  await capturePromise;
  await flushPromise;
  await flushMonitorEventQueue();
}

function captureIfTradingTime(now = new Date()) {
  if (isStopped || isCapturing || !isChinaMarketOpen(now)) return capturePromise;
  capturePromise = runCapture(now);
  return capturePromise;
}

async function runCapture(now: Date) {
  isCapturing = true;
  try {
    const events = await captureMonitorEvents(now);
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
