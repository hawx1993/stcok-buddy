import { BarChart3 } from 'lucide-react';
import type { IStep } from './types';
import cx from '../../../../shared/cx';
import styles from './index.module.scss';
import { normalizeProgressLabel } from './presentation';
import { STEP_STATUS_ICONS } from './status-icons';

export function ProgressBar({ stockName, steps }: { stockName?: string; steps: IStep[] }) {
  const terminal = steps.filter((s) => s.status === 'completed' || s.status === 'skipped' || s.status === 'error').length;
  const percent = steps.length ? Math.round((terminal / steps.length) * 100) : 0;

  return (
    <div className={styles['progress-bar']}>
      {stockName ? (
        <div className={styles['stock-label']}>
          <BarChart3 aria-hidden='true' size={14} strokeWidth={1.8} />
          <span>正在分析 {stockName}</span>
        </div>
      ) : null}
      <div className={styles['bar-row']}>
        <div className={styles['bar-track']}>
          <div className={styles['bar-fill']} style={{ width: `${percent}%` }} />
        </div>
        <span className={styles['bar-percent']}>{percent}%</span>
      </div>
      <div className={styles['step-list']}>
        {steps.map((step) => {
          const statusIcon = STEP_STATUS_ICONS[step.status];
          const StatusIcon = statusIcon.Icon;

          return (
            <div key={step.id} className={cx(styles['step-item'], styles[step.status])}>
              <span className={styles['step-icon']}>
                <StatusIcon
                  aria-label={statusIcon.label}
                  className={statusIcon.spin ? styles['icon-spinning'] : undefined}
                  role='img'
                  size={11}
                  strokeWidth={1.8}
                />
              </span>
              <span className={styles['step-label']}>{normalizeProgressLabel(step.label)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
