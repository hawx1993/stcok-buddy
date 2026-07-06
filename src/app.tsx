import { useEffect } from 'react';
import { useAppStore } from './store/app-store';
import { Sidebar } from './components/sidebar';
import { ChatView } from './components/chat-view';
import { StockDetailPanel } from './components/stock-detail-panel';
import { SettingsModal } from './components/settings-modal';
import { ErrorBoundary } from './components/error-boundary';
import { getStocksenseApi } from './shared/stocksense-api';
import styles from './styles/app.module.scss';
import cx from './shared/cx';


export function App() {
  const config = useAppStore((state) => state.config);
  const setConfig = useAppStore((state) => state.setConfig);
  const setConversations = useAppStore((state) => state.setConversations);
  const activeConversationId = useAppStore((state) => state.activeConversationId);
  const setMessages = useAppStore((state) => state.setMessages);
  const isLeftSidebarCollapsed = useAppStore((state) => state.isLeftSidebarCollapsed);
  const isRightPanelCollapsed = useAppStore((state) => state.isRightPanelCollapsed);
  const toggleLeftSidebar = useAppStore((state) => state.toggleLeftSidebar);
  const toggleRightPanel = useAppStore((state) => state.toggleRightPanel);

  useEffect(() => {
    const api = getStocksenseApi();
    api.getConfig().then(setConfig).catch(console.error);
    api.listConversations().then(setConversations).catch(console.error);
  }, [setConfig, setConversations]);

  useEffect(() => {
    if (!activeConversationId) return;
    getStocksenseApi().listMessages(activeConversationId).then(setMessages).catch(console.error);
  }, [activeConversationId, setMessages]);

  useEffect(() => {
    document.documentElement.dataset.theme = config?.theme ?? 'dark';
    document.documentElement.classList.toggle('dark', (config?.theme ?? 'dark') === 'dark');
    document.documentElement.classList.toggle('light', config?.theme === 'light');
  }, [config?.theme]);

  return (
    <div className={styles.app}>
      <div className={styles.titlebar}>
        <div className={styles['traffic-lights']} aria-hidden="true">
          <span className={cx(styles.dot, styles.close)} />
          <span className={cx(styles.dot, styles.minimize)} />
          <span className={cx(styles.dot, styles.maximize)} />
        </div>
        <button className={cx(styles['collapse-btn'], isLeftSidebarCollapsed && styles.collapsed)} onClick={toggleLeftSidebar} title={isLeftSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'} type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <div className={styles['titlebar-label']}>StockBuddy</div>
        <div className={styles['titlebar-spacer']} />
      </div>

      <div className={styles.body}>
        <ErrorBoundary name="左侧栏"><Sidebar /></ErrorBoundary>
        <main className={styles.main}>
          <ErrorBoundary name="聊天区"><ChatView /></ErrorBoundary>
        </main>
        <div className={cx(styles['right-wrapper'], isRightPanelCollapsed && styles.collapsed)}>
          <ErrorBoundary name="右侧栏"><StockDetailPanel /></ErrorBoundary>
          <button className={styles['right-toggle-btn']} onClick={toggleRightPanel} type="button" title={isRightPanelCollapsed ? '展开侧边栏' : '收起侧边栏'}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
        </div>
        <ErrorBoundary name="设置"><SettingsModal /></ErrorBoundary>
      </div>
    </div>
  );
}
