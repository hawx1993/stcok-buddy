import { BarChart3, Building2, TrendingUp, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { getStocksenseApi } from '../../shared/stocksense-api';
import { useAppStore } from '../../store/app-store';
import type { DataSyncTaskType, IDataSyncTaskProgress } from '../../shared/types';
import styles from './index.module.scss';

interface ISyncTaskDef {
  type: DataSyncTaskType;
  icon: React.ReactNode;
  title: string;
  desc: string;
}

const SYNC_TASKS: ISyncTaskDef[] = [
  {
    type: 'kline',
    icon: <BarChart3 size={18} />,
    title: '日K线数据',
    desc: '同步所有A股历史日K（近十年）到本地数据库',
  },
  {
    type: 'surge',
    icon: <Zap size={18} />,
    title: '异动记录',
    desc: '同步热门异动、个股异动历史记录，支持离线查看',
  },
  {
    type: 'stockDetail',
    icon: <Building2 size={18} />,
    title: '个股基础信息',
    desc: '批量获取全部A股行情快照（价格、市值、PE/PB），存入本地数据库',
  },
  {
    type: 'marketSnapshot',
    icon: <TrendingUp size={18} />,
    title: '行情页快照',
    desc: '同步上证、深证、北交所、创业板、科创板行情页数据',
  },
];

interface ITaskState {
  status: 'idle' | 'running' | 'completed' | 'error';
  processed: number;
  total: number;
  message: string;
  lastSyncTime?: string;
  error?: string;
}

function initialState(): Record<DataSyncTaskType, ITaskState> {
  return {
    kline: { status: 'idle', processed: 0, total: 100, message: '' },
    surge: { status: 'idle', processed: 0, total: 1, message: '' },
    stockDetail: { status: 'idle', processed: 0, total: 100, message: '' },
    marketSnapshot: { status: 'idle', processed: 0, total: 1, message: '' },
  };
}

function loadLastSyncTimes(): Record<string, string | undefined> {
  try {
    const raw = localStorage.getItem('dataSync_lastTimes');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveLastSyncTime(taskType: string, time: string) {
  try {
    const times = loadLastSyncTimes();
    times[taskType] = time;
    localStorage.setItem('dataSync_lastTimes', JSON.stringify(times));
  } catch {
    /* ignore */
  }
}

export function DataSyncModal() {
  const isOpen = useAppStore((state) => state.isDataSyncOpen);
  const setOpen = useAppStore((state) => state.setDataSyncOpen);
  const syncProgress = useAppStore((state) => state.syncProgress);
  const syncProgressRef = useRef(syncProgress);
  syncProgressRef.current = syncProgress;
  const [tasks, setTasks] = useState(initialState);
  const runningRef = useRef<Set<string>>(new Set());
  const removeDataSyncListenerRef = useRef<(() => void) | undefined>();
  const removeMarketDataListenerRef = useRef<(() => void) | undefined>();
  // ponytail: React 18 auto-batches all updates including IPC callbacks.
  // We store latest progress in a ref and use flushSync inside a throttled
  // interval to force synchronous renders — otherwise 5000 events collapse
  // into one final "completed" frame and the user never sees the progress bar.
  // Initial state is empty string so the interval skips until the listener
  // receives a real event from main — otherwise we'd immediately overwrite
  // startSync's "正在启动同步…" with 0/0/running and the bar stays at 0%.
  const klineProgressRef = useRef<{
    processed: number;
    total: number;
    message: string;
    state: string;
  }>({ processed: 0, total: 0, message: '', state: '' });
  const klineIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>();
  // ponytail: counts consecutive 80ms ticks where the bar sits at 100% with no
  // terminal event — used to trigger a one-shot status re-poll for stall recovery.
  const klineStallRef = useRef(0);

  const isAnyRunning = Object.values(tasks).some((t) => t.status === 'running');

  const updateTask = useCallback((taskType: DataSyncTaskType, patch: Partial<ITaskState>) => {
    setTasks((prev) => ({
      ...prev,
      [taskType]: { ...prev[taskType], ...patch },
    }));
  }, []);

  // Listen for data sync progress from main process (surge, stockDetail, marketSnapshot)
  useEffect(() => {
    if (!isOpen) {
      removeDataSyncListenerRef.current?.();
      removeDataSyncListenerRef.current = undefined;
      removeMarketDataListenerRef.current?.();
      removeMarketDataListenerRef.current = undefined;
      if (klineIntervalRef.current) {
        clearInterval(klineIntervalRef.current);
        klineIntervalRef.current = undefined;
      }
      return;
    }

    const api = getStocksenseApi();

    // K-line progress: store in ref (no React state update in IPC callback),
    // render via throttled interval + flushSync to break React 18 auto-batching.
    if (api.onMarketDataProgress) {
      removeMarketDataListenerRef.current = api.onMarketDataProgress((status) => {
        if (!runningRef.current.has('kline')) return;
        // ponytail: main process emits 'idle' in two scenarios:
        //   1. User cancelled sync from elsewhere (settings modal close)
        //   2. dataSync:syncKlines IPC handler stops an in-progress scheduler
        //      sync before starting a fresh force sync — in this case a new
        //      'checking'/'syncing' event will follow within seconds.
        // We can't reliably tell the two apart here, so just clear the ref
        // and let startSync's IPC-resolve logic (which inspects result.state)
        // decide the final task status. This avoids spuriously marking the
        // task as failed right before the real force sync kicks off.
        if (status.state === 'idle') {
          klineProgressRef.current = { processed: 0, total: 0, message: '', state: '' };
          return;
        }
        klineProgressRef.current = {
          processed: status.processedSymbols,
          total: status.totalSymbols,
          message: status.message ?? '',
          state: status.state,
        };
      });

      // Throttled interval reads the ref and forces React to render
      klineIntervalRef.current = setInterval(() => {
        if (!runningRef.current.has('kline')) return;
        const p = klineProgressRef.current;
        if (!p.state) return;

        const isFinal = p.state === 'completed' || p.state === 'partial';
        const isFailed = p.state === 'failed';
        if (isFinal) saveLastSyncTime('kline', new Date().toISOString());

        flushSync(() => {
          updateTask('kline', {
            status: isFinal ? 'completed' : isFailed ? 'error' : 'running',
            processed: p.processed,
            total: p.total,
            message:
              p.message ||
              (isFinal
                ? '日K线同步完成'
                : isFailed
                  ? '日K线同步失败'
                  : `正在同步日K线数据（${p.processed}/${p.total}）`),
            error: isFailed ? p.message || '日K线同步失败' : undefined,
            lastSyncTime: isFinal ? new Date().toISOString() : undefined,
          });
        });

        if (isFinal || isFailed) {
          clearInterval(klineIntervalRef.current);
          klineIntervalRef.current = undefined;
          runningRef.current.delete('kline');
          klineStallRef.current = 0;
          return;
        }

        // ponytail: stall recovery. When the bar has reached 100% (all symbols
        // processed) but no terminal event has arrived for a while, the final
        // 'completed' event may have been missed, or the sync may have finished
        // while this modal was closed. Re-poll the authoritative status once
        // and sync the ref so the interval can transition — instead of sitting
        // at "同步中" forever with all buttons disabled.
        if (p.total > 0 && p.processed >= p.total) {
          klineStallRef.current += 1;
          if (klineStallRef.current >= 50) {
            // ~4s at 80ms per tick
            klineStallRef.current = 0;
            const api = getStocksenseApi();
            api
              .getMarketDataSyncStatus()
              .then((status) => {
                if (!runningRef.current.has('kline')) return;
                if (status.state === 'completed' || status.state === 'partial' || status.state === 'failed') {
                  klineProgressRef.current = {
                    processed: status.processedSymbols,
                    total: status.totalSymbols,
                    message: status.message ?? '',
                    state: status.state,
                  };
                }
              })
              .catch(() => {
                /* ignore */
              });
          }
        } else {
          klineStallRef.current = 0;
        }
      }, 80);
    }

    // Other sync tasks via dataSync:taskProgress
    if (api.onDataSyncProgress) {
      removeDataSyncListenerRef.current = api.onDataSyncProgress((progress: IDataSyncTaskProgress) => {
        if (!runningRef.current.has(progress.taskType)) return;
        if (progress.status === 'running') {
          const pct = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;
          updateTask(progress.taskType as DataSyncTaskType, {
            status: 'running',
            processed: progress.processed,
            total: progress.total,
            message: progress.message,
          });
        } else if (progress.status === 'completed') {
          const now = new Date().toISOString();
          saveLastSyncTime(progress.taskType, now);
          updateTask(progress.taskType as DataSyncTaskType, {
            status: 'completed',
            lastSyncTime: now,
            message: progress.message,
          });
          runningRef.current.delete(progress.taskType);
        } else if (progress.status === 'error') {
          updateTask(progress.taskType as DataSyncTaskType, {
            status: 'error',
            error: progress.error ?? progress.message,
            message: progress.message,
          });
          runningRef.current.delete(progress.taskType);
        }
      });
    }

    return () => {
      removeDataSyncListenerRef.current?.();
      removeDataSyncListenerRef.current = undefined;
      removeMarketDataListenerRef.current?.();
      removeMarketDataListenerRef.current = undefined;
      if (klineIntervalRef.current) {
        clearInterval(klineIntervalRef.current);
        klineIntervalRef.current = undefined;
      }
    };
  }, [isOpen, updateTask]);

  // Load last sync times on open
  useEffect(() => {
    if (!isOpen) return;
    const times = loadLastSyncTimes();
    setTasks((prev) => {
      const next = { ...prev };
      for (const [key, time] of Object.entries(times)) {
        if (next[key as DataSyncTaskType]) {
          next[key as DataSyncTaskType] = { ...next[key as DataSyncTaskType], lastSyncTime: time };
        }
      }
      // Seed running tasks from global store (background sync still in progress)
      for (const [key, sp] of Object.entries(syncProgressRef.current)) {
        if (sp.status === 'running' && next[key as DataSyncTaskType]) {
          next[key as DataSyncTaskType] = {
            ...next[key as DataSyncTaskType],
            status: 'running',
            processed: sp.processed,
            total: sp.total,
            message: sp.message,
          };
          runningRef.current.add(key);
          if (key === 'kline') {
            klineProgressRef.current = {
              processed: sp.processed,
              total: sp.total,
              message: sp.message,
              state: 'syncing',
            };
          }
        }
      }
      return next;
    });
    // Also load K-line last sync from marketData stats
    const api = getStocksenseApi();
    api
      .getMarketDataSyncStatus()
      .then((status) => {
        if (status.finishedAt) {
          setTasks((prev) => ({
            ...prev,
            kline: { ...prev.kline, lastSyncTime: status.finishedAt },
          }));
        }
      })
      .catch(() => {
        /* ignore */
      });
  }, [isOpen]);

  const startSync = useCallback(
    async (taskType: DataSyncTaskType) => {
      if (runningRef.current.has(taskType)) return;
      runningRef.current.add(taskType);
      updateTask(taskType, { status: 'running', processed: 0, total: 0, message: '正在启动同步…', error: undefined });
      // ponytail: seed the kline ref so the throttled interval has something to
      // render before the first main-process progress event arrives. Without
      // this the bar collapses to 0% for the first 80ms+ and users report it
      // "stuck at 0%" when the main process is still resolving the trade date.
      if (taskType === 'kline') {
        klineProgressRef.current = {
          processed: 0,
          total: 0,
          message: '正在启动同步…',
          state: 'syncing',
        };
      }

      const api = getStocksenseApi();
      try {
        let result: { state?: string; message?: string } | undefined;
        if (taskType === 'kline') {
          result = await api.syncKlines();
        } else if (taskType === 'surge') {
          await api.syncSurgeHistory();
        } else if (taskType === 'stockDetail') {
          await api.syncStockDetails();
        } else if (taskType === 'marketSnapshot') {
          await api.syncMarketSnapshot();
        }
        // ponytail: progress events may arrive before ipc resolves; ensure done state.
        // But only mark completed if the IPC result actually says so — otherwise a
        // cancelled/idle sync would be mislabelled "完成" while the bar shows 0%.
        if (runningRef.current.has(taskType)) {
          // For kline, the interval already handles completed/partial transitions.
          // If IPC resolved but the interval hasn't seen a final event yet, trust
          // the IPC result; if the result is idle/cancelled, surface as error.
          if (taskType === 'kline' && result && (result.state === 'completed' || result.state === 'partial')) {
            // Interval will pick up the final state, but in case the last event
            // was missed, mark completed now.
            const now = new Date().toISOString();
            saveLastSyncTime(taskType, now);
            updateTask(taskType, {
              status: 'completed',
              lastSyncTime: now,
              message: result.message || '同步完成',
            });
            runningRef.current.delete(taskType);
            if (klineIntervalRef.current) {
              clearInterval(klineIntervalRef.current);
              klineIntervalRef.current = undefined;
            }
          } else if (taskType === 'kline' && result && (result.state === 'idle' || result.state === 'failed')) {
            const errMsg = result.message || '同步未真正启动或已被取消';
            updateTask(taskType, {
              status: 'error',
              error: errMsg,
              message: errMsg,
            });
            runningRef.current.delete(taskType);
            if (klineIntervalRef.current) {
              clearInterval(klineIntervalRef.current);
              klineIntervalRef.current = undefined;
            }
          } else if (taskType !== 'kline') {
            const now = new Date().toISOString();
            saveLastSyncTime(taskType, now);
            updateTask(taskType, { status: 'completed', lastSyncTime: now, message: '同步完成' });
            runningRef.current.delete(taskType);
          }
          // For kline without a clear result.state, leave it to the interval —
          // main process is still emitting progress events.
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : '同步失败';
        updateTask(taskType, {
          status: 'error',
          error: errMsg,
          message: errMsg,
        });
        runningRef.current.delete(taskType);
        if (taskType === 'kline' && klineIntervalRef.current) {
          clearInterval(klineIntervalRef.current);
          klineIntervalRef.current = undefined;
        }
      }
    },
    [updateTask],
  );

  const startAll = useCallback(async () => {
    for (const task of SYNC_TASKS) {
      await startSync(task.type);
    }
  }, [startSync]);

  if (!isOpen) return null;

  return (
    <div className={`${styles['modal-overlay']} ${styles.open}`} onClick={() => setOpen(false)}>
      <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
        <div className={styles['modal-header']}>
          <h2>数据同步</h2>
          <button className={styles['modal-close']} onClick={() => setOpen(false)} type='button'>
            ✕
          </button>
        </div>

        <div className={styles['modal-body']}>
          <div className={styles['task-list']}>
            {SYNC_TASKS.map((task) => {
              const state = tasks[task.type];
              const rawPct = state.total > 0 ? (state.processed / state.total) * 100 : 0;
              // ponytail: when sync just started and no symbols have been
              // processed yet, show a thin indeterminate bar so the user can
              // see "it's working" instead of an invisible 0% bar. Once the
              // first symbol completes we switch to a real percentage.
              const isStarting = state.status === 'running' && state.processed === 0;
              const barWidth = isStarting
                ? 100 // full width container, inner bar uses indeterminate animation
                : state.processed > 0
                  ? Math.max(rawPct, 0.5)
                  : 0;
              const pct = rawPct;
              const badgeText = isStarting
                ? '准备中'
                : pct < 1 && state.processed > 0
                  ? `${state.processed}/${state.total}`
                  : `${pct.toFixed(1)}%`;

              return (
                <div key={task.type} className={styles['task-item']}>
                  <div className={styles['task-icon']}>{task.icon}</div>
                  <div className={styles['task-body']}>
                    <div className={styles['task-head']}>
                      <span className={styles['task-title']}>{task.title}</span>
                      {state.status === 'running' && <span className={styles['task-badge-running']}>{badgeText}</span>}
                      {state.status === 'completed' && <span className={styles['task-badge-done']}>已完成</span>}
                      {state.status === 'error' && <span className={styles['task-badge-error']}>失败</span>}
                    </div>
                    <div className={styles['task-desc']}>{state.status === 'running' ? state.message : task.desc}</div>
                    {state.lastSyncTime && (
                      <div className={styles['task-meta']}>
                        上次同步：{new Date(state.lastSyncTime).toLocaleString('zh-CN')}
                      </div>
                    )}
                    {state.status === 'running' && (
                      <div className={styles['task-progress']}>
                        {isStarting ? (
                          <div className={styles['task-progress-bar-indeterminate']} />
                        ) : (
                          <div className={styles['task-progress-bar']} style={{ width: `${barWidth}%` }} />
                        )}
                      </div>
                    )}
                    {state.status === 'error' && state.error && (
                      <div className={styles['task-error']}>{state.error}</div>
                    )}
                  </div>
                  <button
                    className={styles['task-action']}
                    disabled={isAnyRunning}
                    onClick={() => startSync(task.type)}
                    type='button'
                  >
                    {state.status === 'running' ? '同步中…' : state.status === 'completed' ? '重新同步' : '立即同步'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className={styles['modal-footer']}>
          <span className={styles['footer-hint']}>可关闭弹窗后台继续同步数据</span>
          <button className={styles['btn-cancel']} onClick={() => setOpen(false)} type='button'>
            关闭
          </button>
          <button className={styles['btn-sync-all']} disabled={isAnyRunning} onClick={startAll} type='button'>
            {isAnyRunning ? '同步中…' : '一键全部同步'}
          </button>
        </div>
      </div>
    </div>
  );
}
