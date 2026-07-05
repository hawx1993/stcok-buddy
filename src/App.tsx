import { useEffect } from 'react';
import { useAppStore } from './store/appStore';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { StockDetailPanel } from './components/StockDetailPanel';
import { SettingsModal } from './components/SettingsModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { getStocksenseApi } from './shared/stocksenseApi';

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
    <div className="app">
      <div className="titlebar">
        <div className="traffic-lights" aria-hidden="true">
          <span className="dot close" />
          <span className="dot minimize" />
          <span className="dot maximize" />
        </div>
        <button className={`collapse-btn ${isLeftSidebarCollapsed ? 'collapsed' : ''}`} onClick={toggleLeftSidebar} title={isLeftSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'} type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <div className="titlebar-label">StockBuddy</div>
        <div className="titlebar-spacer" />
      </div>

      <div className="body">
        <ErrorBoundary name="左侧栏"><Sidebar /></ErrorBoundary>
        <main className="main">
          <ErrorBoundary name="聊天区"><ChatView /></ErrorBoundary>
        </main>
        <div className={`right-wrapper ${isRightPanelCollapsed ? 'collapsed' : ''}`}>
          <ErrorBoundary name="右侧栏"><StockDetailPanel /></ErrorBoundary>
          <button className="right-toggle-btn" onClick={toggleRightPanel} type="button" title={isRightPanelCollapsed ? '展开侧边栏' : '收起侧边栏'}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
        </div>
        <ErrorBoundary name="设置"><SettingsModal /></ErrorBoundary>
      </div>
    </div>
  );
}
