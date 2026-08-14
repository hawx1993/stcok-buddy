import type { StockSurgeEvent } from '../../../shared/types';

const DEFAULT_INTERVAL_MS = 30_000;

type TTimerHandle = number;

type TSetInterval = (callback: () => void, milliseconds: number) => TTimerHandle;
type TClearInterval = (handle: TTimerHandle) => void;

interface IStockSurgePollerOptions {
  load(): Promise<StockSurgeEvent[]>;
  onItems(items: StockSurgeEvent[]): void;
  onError(error: unknown): void;
  intervalMs?: number;
  setIntervalFn?: TSetInterval;
  clearIntervalFn?: TClearInterval;
}

export interface IStockSurgePoller {
  stop(): void;
}

export function createStockSurgePoller(options: IStockSurgePollerOptions): IStockSurgePoller {
  const setIntervalFn = options.setIntervalFn ?? ((callback, milliseconds) => window.setInterval(callback, milliseconds));
  const clearIntervalFn = options.clearIntervalFn ?? ((handle) => window.clearInterval(handle));
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  let stopped = false;
  let inFlight = false;

  const poll = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const items = await options.load();
      if (!stopped) options.onItems(items);
    } catch (error: unknown) {
      if (!stopped) options.onError(error);
    } finally {
      inFlight = false;
    }
  };

  const timer = setIntervalFn(() => void poll(), intervalMs);
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearIntervalFn(timer);
    },
  };
}
