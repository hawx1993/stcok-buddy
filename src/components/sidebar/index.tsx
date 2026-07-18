import { message as antdMessage } from 'antd';
import { BarChart3, MessageCircle, MoreHorizontal, Pencil, Settings, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/app-store';
import { ThemeToggle } from '../theme-toggle';
import { UpdateBanner } from './components/update-banner';
import { getStocksenseApi } from '../../shared/stocksense-api';
import type { ConversationSummary } from '../../shared/types';
import { trackButtonClick, trackPageView } from '../../shared/analytics';
import styles from './index.module.scss';
import cx from '../../shared/cx';

export function Sidebar({ searchOpen }: { searchOpen: boolean }) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [conversationMenuId, setConversationMenuId] = useState<string>();
  const [editingConversationId, setEditingConversationId] = useState<string>();
  const [editingTitle, setEditingTitle] = useState('');
  const conversations = useAppStore((state) => state.conversations);
  const activeConversationId = useAppStore((state) => state.activeConversationId);
  const mainView = useAppStore((state) => state.mainView);
  const search = useAppStore((state) => state.search);
  const isLeftSidebarCollapsed = useAppStore((state) => state.isLeftSidebarCollapsed);
  const setSearch = useAppStore((state) => state.setSearch);
  const setActiveConversation = useAppStore((state) => state.setActiveConversation);
  const setConversations = useAppStore((state) => state.setConversations);
  const setSelectedStock = useAppStore((state) => state.setSelectedStock);
  const clearMessages = useAppStore((state) => state.clearMessages);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
  const setMainView = useAppStore((state) => state.setMainView);

  const createConversation = async () => {
    trackButtonClick('create_conversation');
    if (activeConversationId === conversations[0]?.id && conversations[0]?.count === 0) {
      antdMessage.info('当前已处于最新会话');
      return;
    }
    const item = await getStocksenseApi().createConversation();
    setConversations([item, ...conversations]);
    setActiveConversation(item.id);
    setSelectedStock(undefined);
    clearMessages();
  };

  const deleteConversation = async (id: string) => {
    trackButtonClick('delete_conversation');
    const next = await getStocksenseApi().deleteConversation(id);
    setConversationMenuId(undefined);
    setConversations(next);
    if (activeConversationId === id) {
      setActiveConversation(next[0]?.id);
      if (!next.length) clearMessages();
    }
  };

  const startRename = (item: ConversationSummary) => {
    trackButtonClick('rename_conversation');
    setConversationMenuId(undefined);
    setEditingConversationId(item.id);
    setEditingTitle(item.title);
  };

  const saveRename = async (id: string) => {
    const title = editingTitle.trim();
    if (!title) {
      setEditingConversationId(undefined);
      return;
    }
    setConversations(await getStocksenseApi().renameConversation(id, title));
    setEditingConversationId(undefined);
    antdMessage.success('修改成功');
  };

  const query = search.toLowerCase();
  const filteredConversations = conversations.filter(
    (item) => !query || `${item.title}${item.preview}`.toLowerCase().includes(query),
  );
  const moveGlow = (event: React.MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--mx', `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty('--my', `${event.clientY - rect.top}px`);
  };

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  return (
    <aside className={cx(styles.sidebar, isLeftSidebarCollapsed && styles.collapsed)} data-sidebar>
      <div className={styles['sidebar-header']}>
        <button
          className={styles['btn-new-conversation']}
          onMouseMove={moveGlow}
          onClick={createConversation}
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

      <div className={styles['sidebar-list']}>
        {filteredConversations.length ? (
          filteredConversations.map((item) => (
            <div
              key={item.id}
              onMouseMove={moveGlow}
              className={cx(
                styles['source-item-wrap'],
                activeConversationId === item.id && styles.active,
                conversationMenuId === item.id && styles['menu-open'],
                editingConversationId === item.id && styles.editing,
              )}
            >
              {editingConversationId === item.id ? (
                <div className={styles['rename-row']}>
                  <MessageCircle size={17} className={styles['source-icon']} />
                  <input
                    value={editingTitle}
                    onChange={(event) => setEditingTitle(event.target.value)}
                    onBlur={() => void saveRename(item.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void saveRename(item.id);
                    }}
                    autoFocus
                  />
                </div>
              ) : (
                <>
                  <button
                    className={styles['source-item']}
                    onClick={() => {
                      trackButtonClick('select_conversation');
                      setConversationMenuId(undefined);
                      setActiveConversation(item.id);
                    }}
                    type='button'
                  >
                    <MessageCircle size={17} className={styles['source-icon']} />
                    <span className={styles.label}>{item.title}</span>
                    <span className={styles.count}>{item.count}</span>
                  </button>
                  <button
                    className={styles['source-more']}
                    onClick={(event) => {
                      event.stopPropagation();
                      setConversationMenuId(conversationMenuId === item.id ? undefined : item.id);
                    }}
                    type='button'
                    aria-label='更多操作'
                  >
                    <MoreHorizontal size={16} />
                  </button>
                  {conversationMenuId === item.id ? (
                    <div className={styles['conversation-menu']}>
                      <button className={styles['conversation-action']} onClick={() => startRename(item)} type='button'>
                        <Pencil size={15} />
                        <span>重命名</span>
                      </button>
                      <button
                        className={cx(styles['conversation-action'], styles.danger)}
                        onClick={() => void deleteConversation(item.id)}
                        type='button'
                      >
                        <Trash2 size={15} />
                        <span>删除对话</span>
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ))
        ) : (
          <div className={styles['empty-list']}>无匹配对话</div>
        )}
      </div>

      <UpdateBanner />

      <div className={styles['sidebar-footer']}>
        <button
          className={styles['footer-action']}
          onClick={() => {
            trackButtonClick('open_settings');
            setSettingsOpen(true);
          }}
          type='button'
          aria-label='系统设置'
        >
          <Settings size={15} />
          <span>设置</span>
        </button>
        <ThemeToggle compact />
      </div>
    </aside>
  );
}
