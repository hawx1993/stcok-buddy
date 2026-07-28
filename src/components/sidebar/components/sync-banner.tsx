import { Loader2, X } from 'lucide-react';
import { useMemo } from 'react';
import { useAppStore } from '../../../store/app-store';
import styles from '../index.module.scss';

const TASK_LABELS: Record<string, string> = {
  kline: '日K线',
  surge: '异动记录',
  stockDetail: '个股信息',
  marketSnapshot: '行情快照',
};

export function SyncBanner() {
  const syncProgress = useAppStore((state) => state.syncProgress);
  const isDataSyncOpen = useAppStore((state) => state.isDataSyncOpen);
  const setSyncProgress = useAppStore((state) => state.setSyncProgress);

  const running = useMemo(() => {
    return Object.values(syncProgress).filter((t) => t.status === 'running');
  }, [syncProgress]);

  // Hide when modal is open (it has its own progress bars)
  if (!running.length || isDataSyncOpen) return null;

  const dismiss = (taskType: string) => {
    setSyncProgress(taskType as never, { status: 'completed' as const });
  };

  return (
    <div className={styles['sync-banner']}>
      {running.map((task) => {
        const rawPct = task.total > 0 ? (task.processed / task.total * 100) : 0;
        const badgeText = rawPct < 1 && task.processed > 0
          ? `${task.processed}/${task.total}`
          : `${rawPct.toFixed(1)}%`;
        const barWidth = task.processed > 0 ? Math.max(rawPct, 0.5) : 0;
        return (
          <div key={task.taskType} className={styles['sync-banner-item']}>
            <Loader2 size={12} className={styles['sync-banner-spin']} />
            <span className={styles['sync-banner-label']}>
              {TASK_LABELS[task.taskType] ?? task.taskType}
            </span>
            <span className={styles['sync-banner-pct']}>{badgeText}</span>
            <div className={styles['sync-banner-bar']}>
              <div className={styles['sync-banner-fill']} style={{ width: `${barWidth}%` }} />
            </div>
            <button
              className={styles['sync-banner-dismiss']}
              onClick={() => dismiss(task.taskType)}
              type="button"
              aria-label="隐藏同步进度"
            >
              <X size={10} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
