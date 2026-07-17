import { Activity, Layers, LineChart, Newspaper, Search, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAppStore } from './store/app-store';
import { Sidebar } from './components/sidebar';
import { ChatView } from './components/chat-view';
import { MarketView } from './components/market-view';
import { StockDetailPanel } from './components/stock-detail-panel';
import { SettingsModal } from './components/settings-modal';
import { ErrorBoundary } from './components/error-boundary';
import { getStocksenseApi } from './shared/stocksense-api';
import { track, trackButtonClick, trackPageView } from './shared/analytics';
import styles from './styles/app.module.scss';
import cx from './shared/cx';

export function App() {
  const [searchOpen, setSearchOpen] = useState(false);
  const config = useAppStore((state) => state.config);
  const setConfig = useAppStore((state) => state.setConfig);
  const setConversations = useAppStore((state) => state.setConversations);
  const setFavoriteStocks = useAppStore((state) => state.setFavoriteStocks);
  const activeConversationId = useAppStore((state) => state.activeConversationId);
  const mainView = useAppStore((state) => state.mainView);
  const setMessages = useAppStore((state) => state.setMessages);
  const isLeftSidebarCollapsed = useAppStore((state) => state.isLeftSidebarCollapsed);
  const isRightPanelCollapsed = useAppStore((state) => state.isRightPanelCollapsed);
  const toggleLeftSidebar = useAppStore((state) => state.toggleLeftSidebar);
  const rightPanelTab = useAppStore((state) => state.rightPanelTab);
  const setRightPanelTab = useAppStore((state) => state.setRightPanelTab);

  useEffect(() => {
    const api = getStocksenseApi();
    api.getConfig().then(setConfig).catch(console.error);
    api.listConversations().then(setConversations).catch(console.error);
    api.listFavoriteStocks().then(setFavoriteStocks).catch(console.error);
  }, [setConfig, setConversations, setFavoriteStocks]);

  useEffect(() => {
    if (!activeConversationId) return;
    getStocksenseApi()
      .listMessages(activeConversationId)
      .then((items) => {
        const state = useAppStore.getState();
        if (state.activeConversationId !== activeConversationId) return;
        if (
          (state.isSending || state.messages.some((message) => message.thinking)) &&
          items.length < state.messages.length
        )
          return;
        setMessages(items);
      })
      .catch(console.error);
  }, [activeConversationId, setMessages]);

  useEffect(() => {
    document.documentElement.dataset.theme = config?.theme ?? 'dark';
    document.documentElement.dataset.marketColor = config?.marketColorMode ?? 'red-up-green-down';
    document.documentElement.classList.toggle('dark', (config?.theme ?? 'dark') === 'dark');
    document.documentElement.classList.toggle('light', config?.theme === 'light');
  }, [config?.marketColorMode, config?.theme]);
  useEffect(() => {
    trackPageView(mainView);
  }, [mainView]);

  useEffect(() => {
    const startedAt = Date.now();
    const reportDuration = () =>
      track('online_duration', { duration_seconds: Math.round((Date.now() - startedAt) / 1000) });
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') reportDuration();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('beforeunload', reportDuration);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', reportDuration);
      reportDuration();
    };
  }, []);
  const openRightRail = (tab: typeof rightPanelTab) => {
    trackButtonClick(`right_rail_${tab}`);
    trackPageView(`right_panel_${tab}`);
    setRightPanelTab(tab);
  };

  return (
    <div className={styles.app}>
      <div className={styles.titlebar} />
      <div className={styles.body}>
        <div className={styles['left-tools']}>
          <button
            className={styles['collapse-btn']}
            onClick={() => {
              trackButtonClick('toggle_left_sidebar');
              toggleLeftSidebar();
            }}
            title={isLeftSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            type='button'
          >
            <svg
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='1.8'
              strokeLinecap='round'
              strokeLinejoin='round'
            >
              <rect x='3' y='4' width='18' height='16' rx='2' />
              <line x1='9' y1='4' x2='9' y2='20' />
            </svg>
          </button>
          <button
            className={styles['search-btn']}
            onClick={() => {
              trackButtonClick('toggle_search');
              setSearchOpen((open) => !open);
            }}
            title='搜索'
            type='button'
            aria-label='搜索'
          >
            <Search size={17} />
          </button>
        </div>
        <ErrorBoundary name='左侧栏'>
          <Sidebar searchOpen={searchOpen} />
        </ErrorBoundary>
        <main className={styles.main}>
          <ErrorBoundary name={mainView === 'market' ? '行情区' : '聊天区'}>
            {mainView === 'market' ? <MarketView /> : <ChatView />}
          </ErrorBoundary>
        </main>
        <div className={cx(styles['right-wrapper'], isRightPanelCollapsed && styles.collapsed)}>
          <div className={styles['right-rail']}>
            <button
              className={cx(
                styles['rail-btn'],
                rightPanelTab === 'favorites' && !isRightPanelCollapsed && styles.active,
              )}
              onClick={() => openRightRail('favorites')}
              type='button'
              title='收藏个股'
              aria-label='收藏个股'
            >
              <Star size={18} />
            </button>
            <button
              className={cx(styles['rail-btn'], rightPanelTab === 'stock' && !isRightPanelCollapsed && styles.active)}
              onClick={() => openRightRail('stock')}
              type='button'
              title='个股详情'
              aria-label='个股详情'
            >
              <LineChart size={18} />
            </button>
            <button
              className={cx(styles['rail-btn'], rightPanelTab === 'board' && !isRightPanelCollapsed && styles.active)}
              onClick={() => openRightRail('board')}
              type='button'
              title='板块详情'
              aria-label='板块详情'
            >
              <Layers size={18} />
            </button>
            <button
              className={cx(styles['rail-btn'], rightPanelTab === 'surge' && !isRightPanelCollapsed && styles.active)}
              onClick={() => openRightRail('surge')}
              type='button'
              title='个股异动'
              aria-label='个股异动'
            >
              <Activity size={18} />
            </button>
            <button
              className={cx(styles['rail-btn'], rightPanelTab === 'news' && !isRightPanelCollapsed && styles.active)}
              onClick={() => openRightRail('news')}
              type='button'
              title='热点新闻'
              aria-label='热点新闻'
            >
              <Newspaper size={18} />
            </button>
          </div>
          <ErrorBoundary name='右侧栏'>
            <StockDetailPanel />
          </ErrorBoundary>
        </div>
        <ErrorBoundary name='设置'>
          <SettingsModal />
        </ErrorBoundary>
      </div>
    </div>
  );
}
