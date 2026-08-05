import { Activity, Bot, Layers, LineChart, MessageSquarePlus, Newspaper, Search, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { hasLocalAssistantDraft, useAppDataStore, useAppUiStore } from './store/app-store';
import { usePanelResize } from './hooks/use-panel-resize';
import { Sidebar } from './components/sidebar';
import { createChatConversation } from './components/sidebar/components/create-chat-conversation';
import { ChatView } from './components/chat-view';
import { MarketView } from './components/market-view';
import { DiscoveryView } from './components/discovery-view';
import { NewsReader } from './components/news-reader';
import { StockDetailPanel } from './components/stock-detail-panel';
import { SettingsModal } from './components/settings-modal';
import { AboutModal } from './components/about-modal';
import { StorageManagerModal } from './components/storage-manager-modal';
import { DataSyncModal } from './components/data-sync-modal';
import { GlobalStockSearch } from './components/global-stock-search';
import { getGlobalSearchShortcutLabel, isGlobalSearchShortcut, isMacPlatform } from './components/global-stock-search/shortcut';
import { ErrorBoundary } from './components/error-boundary';
import { getStocksenseApi } from './shared/stocksense-api';
import { track, trackButtonClick, trackPageView } from './shared/analytics';
import { useSyncProgressPump } from './hooks/use-sync-progress-pump';
import styles from './styles/app.module.scss';
import cx from './shared/cx';

export function App() {
  useSyncProgressPump();
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const globalSearchShortcutLabel = getGlobalSearchShortcutLabel();
  const config = useAppDataStore((state) => state.config);
  const setConfig = useAppDataStore((state) => state.setConfig);
  const setConversations = useAppDataStore((state) => state.setConversations);
  const setFavoriteStocks = useAppDataStore((state) => state.setFavoriteStocks);
  const activeConversationId = useAppDataStore((state) => state.activeConversationId);
  const respondingConversationId = useAppDataStore((state) => state.respondingConversationId);
  const mainView = useAppUiStore((state) => state.mainView);
  const setMessages = useAppDataStore((state) => state.setMessages);
  const isLeftSidebarCollapsed = useAppUiStore((state) => state.isLeftSidebarCollapsed);
  const isRightPanelCollapsed = useAppUiStore((state) => state.isRightPanelCollapsed);
  const toggleLeftSidebar = useAppUiStore((state) => state.toggleLeftSidebar);
  const rightPanelTab = useAppUiStore((state) => state.rightPanelTab);
  const setRightPanelTab = useAppUiStore((state) => state.setRightPanelTab);

  useEffect(() => {
    const api = getStocksenseApi();
    api.getConfig().then(setConfig).catch(console.error);
    api.listConversations().then(setConversations).catch(console.error);
    api.listFavoriteStocks().then(setFavoriteStocks).catch(console.error);

    const removeListener = api.onFavoritesCleared?.(() => {
      api.listFavoriteStocks().then(setFavoriteStocks).catch(console.error);
    });

    return () => removeListener?.();
  }, [setConfig, setConversations, setFavoriteStocks]);

  useEffect(() => {
    if (!activeConversationId) return;
    getStocksenseApi()
      .listMessages(activeConversationId)
      .then((items) => {
        const state = useAppDataStore.getState();
        if (state.activeConversationId !== activeConversationId) return;
        if (
          items.length < state.messages.length &&
          (state.respondingConversationId === activeConversationId || state.isSending || hasLocalAssistantDraft(state.messages))
        )
          return;
        setMessages(items);
      })
      .catch(console.error);
  }, [activeConversationId, respondingConversationId, setMessages]);

  useEffect(() => {
    document.documentElement.dataset.theme = config?.theme ?? 'dark';
    document.documentElement.dataset.marketColor = config?.marketColorMode ?? 'red-up-green-down';
    document.documentElement.classList.toggle('dark', (config?.theme ?? 'dark') === 'dark');
    document.documentElement.classList.toggle('light', config?.theme === 'light');
  }, [config?.marketColorMode, config?.theme]);
  useEffect(() => {
    const isMac = isMacPlatform();
    const openGlobalSearchByShortcut = (event: KeyboardEvent) => {
      if (!isGlobalSearchShortcut(event, isMac)) return;
      event.preventDefault();
      trackButtonClick('open_global_search_shortcut');
      setGlobalSearchOpen(true);
    };
    window.addEventListener('keydown', openGlobalSearchByShortcut);
    return () => window.removeEventListener('keydown', openGlobalSearchByShortcut);
  }, []);

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
  const rightResize = usePanelResize('--right-width', 348, 500, 'w');

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
              if (isLeftSidebarCollapsed) {
                void createChatConversation();
                return;
              }
              trackButtonClick('open_global_search_sidebar');
              setGlobalSearchOpen(true);
            }}
            title={isLeftSidebarCollapsed ? '新建会话' : `全局搜索 ${globalSearchShortcutLabel}`}
            type='button'
            aria-label={isLeftSidebarCollapsed ? '新建会话' : '搜索'}
          >
            {isLeftSidebarCollapsed ? <MessageSquarePlus size={17} /> : <Search size={17} />}
          </button>
        </div>
        <ErrorBoundary name='左侧栏'>
          <Sidebar searchOpen={false} />
        </ErrorBoundary>
        <main className={styles.main}>
          <ErrorBoundary
            name={
              mainView === 'market'
                ? '行情区'
                : mainView === 'news-reader'
                  ? '新闻阅读区'
                  : mainView === 'discovery'
                    ? '探索区'
                    : '聊天区'
            }
          >
            {mainView === 'news-reader' ? (
              <NewsReader />
            ) : mainView === 'market' ? (
              <MarketView onOpenGlobalSearch={() => setGlobalSearchOpen(true)} />
            ) : mainView === 'discovery' ? (
              <DiscoveryView />
            ) : (
              <ChatView />
            )}
          </ErrorBoundary>
        </main>
        <div className={cx(styles['right-wrapper'], isRightPanelCollapsed && styles.collapsed)} data-right-wrapper>
          <div className={styles['right-resize-handle']} onMouseDown={rightResize.onMouseDown} />
          <div className={styles['right-rail']}>
            <button
              className={cx(
                styles['rail-btn'],
                rightPanelTab === 'favorites' && !isRightPanelCollapsed && styles.active,
              )}
              onClick={() => openRightRail('favorites')}
              type='button'
              title='收藏个股'
              data-label='收藏个股'
              aria-label='收藏个股'
            >
              <Star size={18} />
            </button>
            <button
              className={cx(styles['rail-btn'], rightPanelTab === 'stock' && !isRightPanelCollapsed && styles.active)}
              onClick={() => openRightRail('stock')}
              type='button'
              title='个股详情'
              data-label='个股详情'
              aria-label='个股详情'
            >
              <LineChart size={18} />
            </button>
            <button
              className={cx(styles['rail-btn'], rightPanelTab === 'board' && !isRightPanelCollapsed && styles.active)}
              onClick={() => openRightRail('board')}
              type='button'
              title='板块详情'
              data-label='板块详情'
              aria-label='板块详情'
            >
              <Layers size={18} />
            </button>
            <button
              className={cx(styles['rail-btn'], rightPanelTab === 'surge' && !isRightPanelCollapsed && styles.active)}
              onClick={() => openRightRail('surge')}
              type='button'
              title='个股异动'
              data-label='个股异动'
              aria-label='个股异动'
            >
              <Activity size={18} />
            </button>
            <button
              className={cx(
                styles['rail-btn'],
                rightPanelTab === 'ai-monitor' && !isRightPanelCollapsed && styles.active,
              )}
              onClick={() => openRightRail('ai-monitor')}
              type='button'
              title='AI监控'
              data-label='AI监控'
              aria-label='AI监控'
            >
              <Bot size={18} />
            </button>
            <button
              className={cx(styles['rail-btn'], rightPanelTab === 'news' && !isRightPanelCollapsed && styles.active)}
              onClick={() => openRightRail('news')}
              type='button'
              title='热点新闻'
              data-label='热点新闻'
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
        <ErrorBoundary name='关于 StockBuddy'>
          <AboutModal />
        </ErrorBoundary>
        <ErrorBoundary name='存储空间管理'>
          <StorageManagerModal />
        </ErrorBoundary>
        <ErrorBoundary name='数据同步'>
          <DataSyncModal />
        </ErrorBoundary>
        <ErrorBoundary name='全局搜索'>
          <GlobalStockSearch open={globalSearchOpen} onOpenChange={setGlobalSearchOpen} />
        </ErrorBoundary>
      </div>
    </div>
  );
}
