import { useAppStore } from '../store/appStore';
import { getStocksenseApi } from '../shared/stocksenseApi';

export function ThemeToggle() {
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
    <button className="dropdown-item theme-row" onClick={toggle} type="button">
      <span className="item-icon">{theme === 'dark' ? '🌙' : '☀️'}</span>
      <span>{theme === 'dark' ? '深色模式' : '浅色模式'}</span>
      <span className={`theme-switch ${theme === 'light' ? 'light' : ''}`}>
        <span className="knob" />
      </span>
    </button>
  );
}
