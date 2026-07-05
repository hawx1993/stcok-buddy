import { Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAppStore, type HotSubTab } from '../store/appStore';
import { ThemeToggle } from './ThemeToggle';
import { getStocksenseApi } from '../shared/stocksenseApi';
import type { HotFocusItem, StockDetail } from '../shared/types';

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

  const query = search.toLowerCase();
  const hotItems = hotItemsByTab[hotSubTab] ?? [];
  const filteredConversations = conversations.filter((item) => !query || `${item.title}${item.preview}`.toLowerCase().includes(query));
  const filteredHotItems = hotItems.filter((item) => !query || `${item.title}${item.code ?? ''}${item.description ?? ''}`.toLowerCase().includes(query));

  return (
    <aside className={`sidebar ${isLeftSidebarCollapsed ? 'collapsed' : ''}`} data-sidebar>
      <div className="sidebar-header">
        <div className="sidebar-brand"><span>StockBuddy</span></div>
      </div>

      <div className="main-tabs">
        <button className={`main-tab ${sidebarMainTab === 'session' ? 'active' : ''}`} onClick={() => switchMainTab('session')} type="button">会话</button>
        <button className={`main-tab ${sidebarMainTab === 'hot' ? 'active' : ''}`} onClick={() => switchMainTab('hot')} type="button">热点聚焦</button>
      </div>

      {sidebarMainTab === 'session' ? (
        <div className="search-row">
          <div className="search-input-wrap"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索…" /></div>
          <button className="btn-new-icon" onClick={createConversation} title="新建会话" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          </button>
        </div>
      ) : (
        <div className="sub-tabs">
          {hotTabs.map((tab) => <button key={tab.id} className={`sub-tab ${hotSubTab === tab.id ? 'active' : ''}`} onClick={() => switchHotTab(tab.id)} type="button">{tab.label}</button>)}
        </div>
      )}

      <div className="sidebar-list">
        {sidebarMainTab === 'session' ? (
          filteredConversations.length ? filteredConversations.map((item) => (
            <button key={item.id} className={`source-item ${activeConversationId === item.id ? 'active' : ''}`} onClick={() => setActiveConversation(item.id)} type="button">
              <span className="label">{item.title}</span><span className="count">{item.count}</span>
            </button>
          )) : <div className="empty-list">无匹配对话</div>
        ) : <HotContent items={filteredHotItems} loading={hotLoadingTab === hotSubTab && !hotItems.length} onStockClick={openHotStock} />}
      </div>

      <div className="sidebar-footer">
        <button className="user-trigger" onClick={() => setMenuOpen((open) => !open)} type="button">
          <span className="user-badge"><span className="avatar">张</span><span className="user-name">张三</span></span>
        </button>
        <div className={`user-dropdown ${menuOpen ? 'open' : ''}`}>
          <ThemeToggle />
          <button className="dropdown-item" onClick={() => setSettingsOpen(true)} type="button"><Settings size={15} /><span>系统设置</span></button>
          <div className="dropdown-divider" />
          <button className="dropdown-item danger" type="button"><span>🚪</span><span>退出登录</span></button>
        </div>
      </div>
    </aside>
  );
}

function HotContent({ items, loading, onStockClick }: { items: HotFocusItem[]; loading: boolean; onStockClick(item: HotFocusItem): void }) {
  if (loading) return <div className="empty-list">数据正在加载中…</div>;
  if (!items.length) return <div className="empty-list">暂无热点数据</div>;
  return <>{items.map((item) => <HotCard key={item.id} item={item} onStockClick={onStockClick} />)}</>;
}

function HotCard({ item, onStockClick }: { item: HotFocusItem; onStockClick(item: HotFocusItem): void }) {
  const clickable = Boolean(item.code);
  const content = (
    <>
      <div className="hc-title">{item.title}<span className={`hc-tag ${item.type ?? 'neutral'}`}>{item.tag ?? item.type ?? '热点'}</span></div>
      {item.code ? <div className="hc-code">{item.code}</div> : null}
      <div className="hc-meta">
        {item.price !== undefined ? <span><b>{item.price}</b></span> : null}
        {item.changePercent ? <span className={String(item.changePercent).startsWith('-') ? 'down' : 'up'}>{item.changePercent}</span> : null}
        {item.amount ?? item.turnover ? <span>{item.amount ?? item.turnover}</span> : null}
      </div>
      {item.description ? <div className="hc-desc">{item.description}</div> : null}
    </>
  );
  if (!clickable) return <div className="hot-card">{content}</div>;
  return <button className="hot-card" onClick={() => onStockClick(item)} type="button">{content}</button>;
}
