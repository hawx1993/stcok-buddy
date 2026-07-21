import type { IDataSource } from './types';
import styles from './index.module.scss';
import cx from '../../../../shared/cx';

export function DataSources({ sources }: { sources: IDataSource[] }) {
  if (!sources.length) return null;

  const statusIcon = (status: IDataSource['status']) => {
    switch (status) {
      case 'done': return '✓';
      case 'loading': return '⏳';
      case 'error': return '✗';
      default: return '○';
    }
  };

  return (
    <div className={styles['data-sources']}>
      <div className={styles['section-title']}>📚 数据源</div>
      <div className={styles['source-list']}>
        {sources.map((source) => (
          <div key={source.name} className={cx(styles['source-item'], styles[source.status])}>
            <span className={styles['source-icon']}>{statusIcon(source.status)}</span>
            <span className={styles['source-name']}>{source.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
