import { useAppStore } from '../../store/app-store';
import { getStocksenseApi } from '../../shared/stocksense-api';
import styles from './index.module.scss';

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const config = useAppStore((state) => state.config);
  const setConfig = useAppStore((state) => state.setConfig);
  const setTheme = useAppStore((state) => state.setTheme);
  const theme = config?.theme ?? 'dark';
  const iconModeClass = theme === 'dark' ? styles.sun : styles.moon;

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
      {compact ? <ThemeModeIcon theme={theme} className={`${styles['theme-icon']} ${iconModeClass}`} /> : <span className={`${styles['item-icon']} ${styles['theme-icon-wrap']} ${iconModeClass}`}><ThemeModeIcon theme={theme} /></span>}
      {compact ? null : <span>{theme === 'dark' ? '深色模式' : '浅色模式'}</span>}
      {compact ? null : (
        <span className={`${styles['theme-switch']} ${theme === 'light' ? styles.light : ''}`}>
          <span className={styles.knob} />
        </span>
      )}
    </button>
  );
}

function ThemeModeIcon({ theme, className }: { theme: 'dark' | 'light'; className?: string }) {
  if (theme === 'dark') {
    return (
      <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="3.1" stroke="currentColor" strokeWidth="1.45" />
        <path d="M8 1.7v1.45M8 12.85v1.45M14.3 8h-1.45M3.15 8H1.7M12.45 3.55l-1.03 1.03M4.58 11.42l-1.03 1.03M12.45 12.45l-1.03-1.03M4.58 4.58 3.55 3.55" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M12.72 10.25A5.55 5.55 0 0 1 5.76 3.28 5.85 5.85 0 1 0 12.72 10.25Z" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
