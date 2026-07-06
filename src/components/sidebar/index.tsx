import { message as antdMessage } from 'antd';
import { MessageCircle, MoreHorizontal, Pencil, Settings, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAppStore, type HotSubTab } from '../../store/app-store';
import { ThemeToggle } from '../theme-toggle';
import { getStocksenseApi } from '../../shared/stocksense-api';
import type { ConversationSummary, HotFocusItem, StockDetail } from '../../shared/types';
import styles from './index.module.scss';
import cx from '../../shared/cx';

const hotTabs: Array<{ id: HotSubTab; label: string }> = [
  { id: 'sector', label: '板块热点' },
  { id: 'market', label: '大盘热点' },
  { id: 'surge', label: '异动个股' },
  { id: 'strategy', label: '选股策略' },
  { id: 'diagnosis', label: '诊股' },
  { id: 'flow', label: '资金流向' },
];

export function Sidebar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [conversationMenuId, setConversationMenuId] = useState<string>();
  const [editingConversationId, setEditingConversationId] = useState<string>();
  const [editingTitle, setEditingTitle] = useState('');
  const [hotItemsByTab, setHotItemsByTab] = useState<Partial<Record<HotSubTab, HotFocusItem[]>>>({});
  const [hotLoadingTab, setHotLoadingTab] = useState<HotSubTab>();
  const conversations = useAppStore((state) => state.conversations);
  const activeConversationId = useAppStore((state) => state.activeConversationId);
  const search = useAppStore((state) => state.search);
  const sidebarMainTab = useAppStore((state) => state.sidebarMainTab);
  const hotSubTab = useAppStore((state) => state.hotSubTab);
  const isLeftSidebarCollapsed = useAppStore((state) => state.isLeftSidebarCollapsed);
  const setSearch = useAppStore((state) => state.setSearch);
  const setActiveConversation = useAppStore((state) => state.setActiveConversation);
  const setConversations = useAppStore((state) => state.setConversations);
  const setSelectedStock = useAppStore((state) => state.setSelectedStock);
  const setSelectedBoard = useAppStore((state) => state.setSelectedBoard);
  const openRightPanel = useAppStore((state) => state.openRightPanel);
  const clearMessages = useAppStore((state) => state.clearMessages);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
  const setSidebarMainTab = useAppStore((state) => state.setSidebarMainTab);
  const setHotSubTab = useAppStore((state) => state.setHotSubTab);

  const loadHot = async (tab = hotSubTab) => {
    if (hotItemsByTab[tab] || hotLoadingTab === tab) return;
    setHotLoadingTab(tab);
    try {
      const items = await getStocksenseApi().listHotFocus(tab);
      setHotItemsByTab((current) => ({ ...current, [tab]: items }));
    } catch {
      setHotItemsByTab((current) => ({ ...current, [tab]: current[tab] ?? [] }));
    } finally {
      setHotLoadingTab(undefined);
    }
  };

  useEffect(() => {
    if (sidebarMainTab === 'hot') void loadHot(hotSubTab);
  }, [sidebarMainTab, hotSubTab, hotItemsByTab, hotLoadingTab]);

  const createConversation = async () => {
    const item = await getStocksenseApi().createConversation();
    setConversations([item, ...conversations]);
    setActiveConversation(item.id);
    setSelectedStock(undefined);
    setSelectedBoard(undefined);
    clearMessages();
  };

  const openHotStock = async (item: HotFocusItem) => {
    if (!item.code) return;
    openRightPanel();
    if (hotSubTab === 'sector') {
      setSelectedBoard({ code: item.code, name: item.name ?? item.title, changePercent: item.changePercent });
      try {
        setSelectedBoard(await getStocksenseApi().getBoardDetail(item.code));
      } catch {
        setSelectedBoard({ code: item.code, name: item.name ?? item.title, changePercent: item.changePercent });
      }
      return;
    }
    const fallback: StockDetail = { code: item.code, name: item.name ?? item.title, price: item.price, changePercent: item.changePercent, turnover: item.turnover ?? item.amount, summary: item.description };
    setSelectedStock(fallback);
    try {
      setSelectedStock(await getStocksenseApi().getStockDetail(item.code));
    } catch {
      setSelectedStock(fallback);
    }
  };

  const switchMainTab = (tab: 'session' | 'hot') => {
    setSidebarMainTab(tab);
  };

  const switchHotTab = (tab: HotSubTab) => {
    setHotSubTab(tab);
  };

  const deleteConversation = async (id: string) => {
    const next = await getStocksenseApi().deleteConversation(id);
    setConversationMenuId(undefined);
    setConversations(next);
    if (activeConversationId === id) {
      setActiveConversation(next[0]?.id);
      if (!next.length) clearMessages();
    }
  };

  const startRename = (item: ConversationSummary) => {
    setConversationMenuId(undefined);
    setEditingConversationId(item.id);
    setEditingTitle(item.title);
  };

  const saveRename = async (id: string) => {
    const title = editingTitle.trim();
    if (!title) return;
    setConversations(await getStocksenseApi().renameConversation(id, title));
    setEditingConversationId(undefined);
    antdMessage.success('修改成功');
  };

  const query = search.toLowerCase();
  const hotItems = hotItemsByTab[hotSubTab] ?? [];
  const filteredConversations = conversations.filter((item) => !query || `${item.title}${item.preview}`.toLowerCase().includes(query));
  const filteredHotItems = hotItems.filter((item) => !query || `${item.title}${item.code ?? ''}${item.description ?? ''}`.toLowerCase().includes(query));

  return (
    <aside className={cx(styles.sidebar, isLeftSidebarCollapsed && styles.collapsed)} data-sidebar>
      <div className={styles['sidebar-header']}>
        <div className={styles['sidebar-brand']}><span>StockBuddy</span></div>
      </div>

      <div className={styles['main-tabs']}>
        <button className={cx(styles['main-tab'], sidebarMainTab === 'session' && styles.active)} onClick={() => switchMainTab('session')} type="button">会话</button>
        <button className={cx(styles['main-tab'], sidebarMainTab === 'hot' && styles.active)} onClick={() => switchMainTab('hot')} type="button">热点聚焦</button>
      </div>

      {sidebarMainTab === 'session' ? (
        <div className={styles['search-row']}>
          <div className={styles['search-input-wrap']}><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索…" /></div>
          <button className={styles['btn-new-icon']} onClick={createConversation} title="新建会话" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          </button>
        </div>
      ) : (
        <div className={styles['sub-tabs']}>
          {hotTabs.map((tab) => <button key={tab.id} className={cx(styles['sub-tab'], hotSubTab === tab.id && styles.active)} onClick={() => switchHotTab(tab.id)} type="button">{tab.label}</button>)}
        </div>
      )}

      <div className={styles['sidebar-list']}>
        {sidebarMainTab === 'session' ? (
          filteredConversations.length ? filteredConversations.map((item) => (
            <div key={item.id} className={cx(styles['source-item-wrap'], activeConversationId === item.id && styles.active, conversationMenuId === item.id && styles['menu-open'], editingConversationId === item.id && styles.editing)}>
              {editingConversationId === item.id ? (
                <div className={styles['rename-row']}>
                  <input value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void saveRename(item.id); }} autoFocus />
                </div>
              ) : (
                <>
                  <button className={styles['source-item']} onClick={() => { setConversationMenuId(undefined); setActiveConversation(item.id); }} type="button">
                    <MessageCircle size={17} className={styles['source-icon']} />
                    <span className={styles.label}>{item.title}</span>
                    <span className={styles.count}>{item.count}</span>
                  </button>
                  <button className={styles['source-more']} onClick={(event) => { event.stopPropagation(); setConversationMenuId(conversationMenuId === item.id ? undefined : item.id); }} type="button" aria-label="更多操作">
                    <MoreHorizontal size={16} />
                  </button>
                  {conversationMenuId === item.id ? (
                    <div className={styles['conversation-menu']}>
                      <button className={styles['conversation-action']} onClick={() => startRename(item)} type="button"><Pencil size={15} /><span>重命名</span></button>
                      <button className={cx(styles['conversation-action'], styles.danger)} onClick={() => void deleteConversation(item.id)} type="button"><Trash2 size={15} /><span>删除对话</span></button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )) : <div className={styles['empty-list']}>无匹配对话</div>
        ) : <HotContent items={filteredHotItems} loading={hotLoadingTab === hotSubTab && !hotItems.length} onStockClick={openHotStock} />}
      </div>

      <div className={styles['sidebar-footer']}>
        <button className={styles['user-trigger']} onClick={() => setMenuOpen((open) => !open)} type="button">
          <span className={styles['user-badge']}><span className={styles.avatar}>张</span><span className={styles['user-name']}>张三</span></span>
        </button>
        <div className={cx(styles['user-dropdown'], menuOpen && styles.open)}>
          <ThemeToggle />
          <button className={styles['dropdown-item']} onClick={() => setSettingsOpen(true)} type="button"><Settings size={15} /><span>系统设置</span></button>
          <div className={styles['dropdown-divider']} />
          <button className={cx(styles['dropdown-item'], styles.danger)} type="button"><span>🚪</span><span>退出登录</span></button>
        </div>
      </div>
    </aside>
  );
}

function HotContent({ items, loading, onStockClick }: { items: HotFocusItem[]; loading: boolean; onStockClick(item: HotFocusItem): void }) {
  if (loading) return <div className={styles['empty-list']}>数据正在加载中…</div>;
  if (!items.length) return <div className={styles['empty-list']}>暂无热点数据</div>;
  return <div className={styles['hot-timeline']}>{items.map((item) => <HotCard key={item.id} item={item} onStockClick={onStockClick} />)}</div>;
}

function getMarketBadge(code?: string) {
  if (!code) return undefined;
  if (code.startsWith('688')) return { label: '科', kind: 'star' };
  if (code.startsWith('6')) return { label: 'SH', kind: 'sh' };
  if (code.startsWith('0') || code.startsWith('3')) return { label: 'SZ', kind: 'sz' };
  return undefined;
}
function HotCard({ item, onStockClick }: { item: HotFocusItem; onStockClick(item: HotFocusItem): void }) {
  const clickable = Boolean(item.code);
  const market = getMarketBadge(item.code);
  const content = (
    <>
      <span className={styles['tl-time']}>{item.time ?? '--:--'}</span>
      <div className={styles['hc-title']}><span className={styles['hc-name']}>{market ? <span className={cx(styles['market-badge'], styles[market.kind])}>{market.label}</span> : null}{item.title}</span></div>
      {item.price !== undefined || item.changePercent ? <div className={styles['hc-desc']}>{[item.price !== undefined ? `现价 ${item.price}` : '', item.changePercent ? `涨跌幅 ${item.changePercent}` : ''].filter(Boolean).join(' · ')}</div> : item.description ? <div className={styles['hc-desc']}>{item.description}</div> : null}
    </>
  );
  if (!clickable) return <div className={styles['hot-card']}>{content}</div>;
  return <button className={styles['hot-card']} onClick={() => onStockClick(item)} type="button">{content}</button>;
}
