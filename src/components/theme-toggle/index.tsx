import { useAppStore } from '../../store/app-store';
import { getStocksenseApi } from '../../shared/stocksense-api';
import styles from './index.module.scss';

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const config = useAppStore((state) => state.config);
  const setConfig = useAppStore((state) => state.setConfig);
  const setTheme = useAppStore((state) => state.setTheme);
  const theme = config?.theme ?? 'dark';

  const toggle = async () => {
    if (!config) return;
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    const saved = await getStocksenseApi().setConfig({ ...config, theme: next });
    setConfig(saved);
  };

  return (
    <button
      className={`${styles['dropdown-item']} ${styles['theme-row']} ${compact ? styles.compact : ''}`}
      onClick={toggle}
      type='button'
      aria-label={theme === 'dark' ? '切换浅色模式' : '切换深色模式'}
    >
      {compact ? null : <span className={styles['item-icon']}>{theme === 'dark' ? '🌙' : '☀️'}</span>}
      {compact ? null : <span>{theme === 'dark' ? '深色模式' : '浅色模式'}</span>}
      <span className={`${styles['theme-switch']} ${theme === 'light' ? styles.light : ''}`}>
        <span className={styles.knob} />
      </span>
    </button>
  );
}
