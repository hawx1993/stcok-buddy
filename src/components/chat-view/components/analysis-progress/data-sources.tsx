import { Database } from 'lucide-react';
import type { IDataSource } from './types';
import cx from '../../../../shared/cx';
import styles from './index.module.scss';
import { normalizeProgressLabel } from './presentation';
import { DATA_SOURCE_STATUS_ICONS } from './status-icons';

export function DataSources({ sources }: { sources: IDataSource[] }) {
  if (!sources.length) return null;

  return (
    <div className={styles['data-sources']}>
      <div className={styles['section-title']}>
        <Database aria-hidden='true' size={13} strokeWidth={1.8} />
        <span>数据源</span>
      </div>
      <div className={styles['source-list']}>
        {sources.map((source) => {
          const statusIcon = DATA_SOURCE_STATUS_ICONS[source.status];
          const StatusIcon = statusIcon.Icon;

          return (
            <div key={source.name} className={cx(styles['source-item'], styles[source.status])}>
              <span className={styles['source-icon']}>
                <StatusIcon
                  aria-label={statusIcon.label}
                  className={statusIcon.spin ? styles['icon-spinning'] : undefined}
                  role='img'
                  size={10}
                  strokeWidth={1.8}
                />
              </span>
              <span className={styles['source-name']}>{normalizeProgressLabel(source.name)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
