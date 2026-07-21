import type { IStep } from './types';
import styles from './index.module.scss';
import cx from '../../../../shared/cx';

export function ProgressBar({ stockName, steps }: { stockName?: string; steps: IStep[] }) {
  const completed = steps.filter((s) => s.status === 'completed').length;
  const percent = steps.length ? Math.round((completed / steps.length) * 100) : 0;

  return (
    <div className={styles['progress-bar']}>
      {stockName ? <div className={styles['stock-label']}>📊 正在分析 {stockName}</div> : null}
      <div className={styles['bar-row']}>
        <div className={styles['bar-track']}>
          <div className={styles['bar-fill']} style={{ width: `${percent}%` }} />
        </div>
        <span className={styles['bar-percent']}>{percent}%</span>
      </div>
      <div className={styles['step-list']}>
        {steps.map((step) => (
          <div key={step.id} className={cx(styles['step-item'], styles[step.status])}>
            <span className={styles['step-icon']}>
              {step.status === 'completed' ? '✓' : step.status === 'running' ? '⏳' : step.status === 'error' ? '✗' : '○'}
            </span>
            <span className={styles['step-label']}>{step.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
