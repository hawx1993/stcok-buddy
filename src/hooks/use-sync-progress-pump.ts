import { useEffect, useRef } from 'react';
import { getStocksenseApi } from '../shared/stocksense-api';
import { useAppUiStore } from '../store/app-store';
import type { DataSyncTaskType } from '../shared/types';

/**
 * Always-mounted hook that listens for sync progress IPC events
 * and writes them to the zustand store so the SyncBanner (and
 * DataSyncModal) can display progress even after the modal closes.
 */
export function useSyncProgressPump() {
  const setSyncProgress = useAppUiStore((state) => state.setSyncProgress);
  const runningRef = useRef<Set<string>>(new Set());
  const removeKlineRef = useRef<(() => void) | undefined>();
  const removeTaskRef = useRef<(() => void) | undefined>();

  useEffect(() => {
    const api = getStocksenseApi();

    // K-line progress via marketData:progress
    if (api.onMarketDataProgress) {
      removeKlineRef.current = api.onMarketDataProgress((status) => {
        if (status.state === 'idle') return;
        const isFinal = status.state === 'completed' || status.state === 'partial';
        setSyncProgress('kline', {
          status: isFinal ? 'completed' : 'running',
          processed: status.processedSymbols,
          total: status.totalSymbols,
          message: isFinal ? '日K线同步完成' : `正在同步日K线（${status.processedSymbols}/${status.totalSymbols}）`,
        });
        if (isFinal) runningRef.current.delete('kline');
      });
    }

    // Other task progress via dataSync:taskProgress
    if (api.onDataSyncProgress) {
      removeTaskRef.current = api.onDataSyncProgress((progress) => {
        setSyncProgress(progress.taskType as DataSyncTaskType, {
          status: progress.status,
          processed: progress.processed,
          total: progress.total,
          message: progress.message,
        });
        if (progress.status === 'completed' || progress.status === 'error') {
          runningRef.current.delete(progress.taskType);
        }
      });
    }

    return () => {
      removeKlineRef.current?.();
      removeTaskRef.current?.();
    };
  }, [setSyncProgress]);
}
