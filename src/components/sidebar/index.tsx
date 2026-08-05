import { Dropdown, message as antdMessage } from 'antd';
import type { MenuProps } from 'antd';
import { BarChart3, CloudDownload, Compass, Database, FileText, HelpCircle, Info, RefreshCw, Settings } from 'lucide-react';
import { useCallback, useDeferredValue, useEffect, type ReactNode, useMemo, useRef, useState } from 'react';
import { useAppDataStore, useAppUiStore } from '../../store/app-store';
import { usePanelResize } from '../../hooks/use-panel-resize';
import { ThemeToggle } from '../theme-toggle';
import { createChatConversation } from './components/create-chat-conversation';
import { getStocksenseApi } from '../../shared/stocksense-api';
import { UpdateBanner } from './components/update-banner';
import { SyncBanner } from './components/sync-banner';
import { OfflineIndicator } from './components/offline-indicator';
import type { ConversationSummary } from '../../shared/types';
import { trackButtonClick, trackPageView } from '../../shared/analytics';
import { WhaleLogo } from '../chat-view/components/whale-logo';
import { ConversationList } from './components/conversation-list';
import { groupConversations } from './components/conversation-groups';
import styles from './index.module.scss';
import cx from '../../shared/cx';

export { groupConversations } from './components/conversation-groups';

const releaseNotesUrl = 'https://ncnidfotktyq.feishu.cn/wiki/XX5RwTiQzi3HGwkpA0RcwF4UnLd';

function getUpdateCheckMessage(status: string, latestVersion?: string) {
  if (status === 'available') return latestVersion ? `发现新版本 v${latestVersion}` : '发现新版本';
  if (status === 'not-available') return '当前已是最新版本';
  if (status === 'downloaded') return '新版本已下载，可安装更新';
  if (status === 'downloading') return '更新包正在下载中';
  if (status === 'error') return '检查更新失败';
  return '检查更新完成';
}

function menuLabel(icon: ReactNode, label: string, shortcut?: string) {
  return (
    <span className={styles['menu-label']}>
      <span className={styles['menu-label-main']}>
        {icon}
        <span>{label}</span>
      </span>
      {shortcut ? <kbd>{shortcut}</kbd> : null}
    </span>
  );
}

function isMacPlatform() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

export function Sidebar({ searchOpen }: { searchOpen: boolean }) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [conversationMenuId, setConversationMenuId] = useState<string>();
  const [editingConversationId, setEditingConversationId] = useState<string>();
  const [editingTitle, setEditingTitle] = useState('');
  const conversations = useAppDataStore((state) => state.conversations);
  const activeConversationId = useAppDataStore((state) => state.activeConversationId);
  const respondingConversationId = useAppDataStore((state) => state.respondingConversationId);
  const mainView = useAppUiStore((state) => state.mainView);
  const search = useAppUiStore((state) => state.search);
  const isLeftSidebarCollapsed = useAppUiStore((state) => state.isLeftSidebarCollapsed);
  const setSearch = useAppUiStore((state) => state.setSearch);
  const setActiveConversation = useAppDataStore((state) => state.setActiveConversation);
  const setConversations = useAppDataStore((state) => state.setConversations);
  const clearMessages = useAppDataStore((state) => state.clearMessages);
  const setSettingsOpen = useAppUiStore((state) => state.setSettingsOpen);
  const setAboutOpen = useAppUiStore((state) => state.setAboutOpen);
  const setStorageManagerOpen = useAppUiStore((state) => state.setStorageManagerOpen);
  const setDataSyncOpen = useAppUiStore((state) => state.setDataSyncOpen);
  const setMainView = useAppUiStore((state) => state.setMainView);

  const isMac = useMemo(isMacPlatform, []);
  const settingsShortcut = isMac ? '⌘,' : 'Ctrl,';
  const deferredSearch = useDeferredValue(search);

  const selectConversation = useCallback(
    (item: ConversationSummary) => {
      trackButtonClick('select_conversation');
      setConversationMenuId(undefined);
      if (activeConversationId === item.id) return;
      setActiveConversation(item.id);
    },
    [activeConversationId, setActiveConversation],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      trackButtonClick('delete_conversation');
      const next = await getStocksenseApi().deleteConversation(id);
      setConversationMenuId(undefined);
      setConversations(next);
      if (activeConversationId === id) {
        setActiveConversation(next[0]?.id);
        if (!next.length) clearMessages();
      }
    },
    [activeConversationId, clearMessages, setActiveConversation, setConversations],
  );

  const startRename = useCallback((item: ConversationSummary) => {
    trackButtonClick('rename_conversation');
    setConversationMenuId(undefined);
    setEditingConversationId(item.id);
    setEditingTitle(item.title);
  }, []);

  const saveRename = useCallback(
    async (id: string) => {
      const title = editingTitle.trim();
      if (!title) {
        setEditingConversationId(undefined);
        return;
      }
      setConversations(await getStocksenseApi().renameConversation(id, title));
      setEditingConversationId(undefined);
      antdMessage.success('修改成功');
    },
    [editingTitle, setConversations],
  );

  const checkUpdate = useCallback(async () => {
    trackButtonClick('sidebar_check_update');
    if (!navigator.onLine) {
      antdMessage.info('网络已断开，无法检查更新');
      return;
    }
    const hideLoading = antdMessage.loading('正在检查更新…', 0);
    try {
      const state = await getStocksenseApi().checkAppUpdate();
      hideLoading();
      const content = getUpdateCheckMessage(state.status, state.latestVersion);
      if (state.status === 'error') antdMessage.error(state.error ?? state.message ?? content);
      else if (state.status === 'available' || state.status === 'downloaded') antdMessage.success(content);
      else antdMessage.info(state.message ?? content);
    } catch (error) {
      hideLoading();
      antdMessage.error(error instanceof Error ? error.message : '检查更新失败');
    }
  }, []);

  const menuItems = useMemo<MenuProps['items']>(
    () => [
      { key: 'about', label: menuLabel(<Info size={15} />, '关于 StockBuddy'), className: styles['about-menu-item'] },
      { key: 'settings', label: menuLabel(<Settings size={15} />, '系统设置', settingsShortcut) },
      { key: 'storage', label: menuLabel(<Database size={15} />, '存储空间管理') },
      { key: 'data-sync', label: menuLabel(<CloudDownload size={15} />, '数据同步') },
      { key: 'check-update', label: menuLabel(<RefreshCw size={15} />, '检查更新') },
      { key: 'release-notes', label: menuLabel(<FileText size={15} />, '更新日志') },
      { key: 'feedback', label: menuLabel(<HelpCircle size={15} />, '帮助与反馈') },
    ],
    [settingsShortcut],
  );

  const runAccountMenuAction = useCallback<NonNullable<MenuProps['onClick']>>(
    ({ key }) => {
      if (key === 'settings') {
        trackButtonClick('open_settings');
        setSettingsOpen(true);
        return;
      }
      if (key === 'check-update') {
        void checkUpdate();
        return;
      }
      if (key === 'release-notes') {
        trackButtonClick('open_release_notes');
        window.open(releaseNotesUrl, '_blank', 'noopener,noreferrer');
        return;
      }
      if (key === 'feedback') {
        trackButtonClick('open_feedback_email');
        getStocksenseApi()
          .openFeedbackEmail()
          .catch((error: unknown) => {
            antdMessage.error(error instanceof Error ? error.message : '打开邮件客户端失败');
          });
        return;
      }
      if (key === 'about') {
        trackButtonClick('open_about_stockbuddy');
        setAboutOpen(true);
        return;
      }
      if (key === 'storage') {
        trackButtonClick('open_storage_manager');
        setStorageManagerOpen(true);
        return;
      }
      if (key === 'data-sync') {
        trackButtonClick('open_data_sync');
        setDataSyncOpen(true);
      }
    },
    [checkUpdate, setAboutOpen, setDataSyncOpen, setSettingsOpen, setStorageManagerOpen],
  );

  const query = deferredSearch.toLowerCase();
  const conversationGroups = useMemo(() => {
    const filtered = conversations.filter((item) => {
      const searchText = `${item.title ?? ''}${item.preview ?? ''}`.toLowerCase();
      return !query || searchText.includes(query);
    });
    return groupConversations(filtered);
  }, [conversations, query]);

  const moveGlow = useCallback((event: React.MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--mx', `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty('--my', `${event.clientY - rect.top}px`);
  }, []);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    const openSettingsByShortcut = (event: KeyboardEvent) => {
      const modifierPressed = isMac ? event.metaKey : event.ctrlKey;
      if (!modifierPressed || event.key !== ',') return;
      event.preventDefault();
      trackButtonClick('open_settings_shortcut');
      setSettingsOpen(true);
    };
    window.addEventListener('keydown', openSettingsByShortcut);
    return () => window.removeEventListener('keydown', openSettingsByShortcut);
  }, [isMac, setSettingsOpen]);

  const leftResize = usePanelResize('--sidebar-width', 200, 450);

  return (
    <aside className={cx(styles.sidebar, isLeftSidebarCollapsed && styles.collapsed)} data-sidebar>
      <div className={styles['sidebar-header']}>
        <button
          className={styles['btn-new-conversation']}
          onMouseMove={moveGlow}
          onClick={createChatConversation}
          type='button'
        >
          <span>＋</span>新建会话
        </button>
        <button
          className={cx(styles['market-entry'], mainView === 'market' && styles.active)}
          onMouseMove={moveGlow}
          onClick={() => {
            trackButtonClick('open_market');
            trackPageView('market');
            setConversationMenuId(undefined);
            setMainView('market');
          }}
          type='button'
        >
          <BarChart3 size={17} />
          行情
        </button>
        <button
          className={cx(styles['market-entry'], mainView === 'discovery' && styles.active)}
          onMouseMove={moveGlow}
          onClick={() => {
            trackButtonClick('open_discovery');
            trackPageView('discovery');
            setConversationMenuId(undefined);
            setMainView('discovery');
          }}
          type='button'
        >
          <Compass size={17} />
          探索
        </button>
        {searchOpen ? (
          <input
            ref={searchRef}
            className={styles['sidebar-search']}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder='搜索…'
          />
        ) : null}
      </div>

      <ConversationList
        conversationGroups={conversationGroups}
        activeConversationId={activeConversationId}
        respondingConversationId={respondingConversationId}
        conversationMenuId={conversationMenuId}
        editingConversationId={editingConversationId}
        editingTitle={editingTitle}
        onEditingTitleChange={setEditingTitle}
        onSelectConversation={selectConversation}
        onToggleConversationMenu={(id) => setConversationMenuId((current) => (current === id ? undefined : id))}
        onStartRename={startRename}
        onSaveRename={(id) => void saveRename(id)}
        onDeleteConversation={(id) => void deleteConversation(id)}
        onMoveGlow={moveGlow}
      />

      <UpdateBanner />
      <SyncBanner />

      <OfflineIndicator />
      <div className={styles['sidebar-footer']}>
        <Dropdown
          menu={{ items: menuItems, onClick: runAccountMenuAction }}
          overlayClassName={styles['account-dropdown']}
          placement='topLeft'
          trigger={['click']}
        >
          <button className={styles['brand-trigger']} type='button' aria-label='打开 StockBuddy 菜单'>
            <span className={styles['brand-avatar']}>
              <WhaleLogo />
            </span>
            <span className={styles['brand-name']}>StockBuddy</span>
          </button>
        </Dropdown>
        <ThemeToggle compact />
      </div>
      <div className={styles['sidebar-resize-handle']} onMouseDown={leftResize.onMouseDown} />
    </aside>
  );
}
