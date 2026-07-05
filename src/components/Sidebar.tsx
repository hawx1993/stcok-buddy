import { Settings } from 'lucide-react';
import { useState } from 'react';
import { useAppStore, type HotSubTab, type SurgeStock } from '../store/appStore';
import { ThemeToggle } from './ThemeToggle';
import { getStocksenseApi } from '../shared/stocksenseApi';
import type { StockDetail } from '../shared/types';

const hotTabs: Array<{ id: HotSubTab; label: string }> = [
  { id: 'sector', label: '板块热点' },
  { id: 'market', label: '大盘热点' },
  { id: 'surge', label: '异动个股' },
  { id: 'strategy', label: '选股策略' },
  { id: 'diagnosis', label: '诊股' },
  { id: 'flow', label: '资金流向' },
];

const sectorHot = [
  { n: '白酒', c: '+1.72%', v: '285亿', u: true, d: '中秋动销预期升温' },
  { n: '半导体', c: '+2.35%', v: '412亿', u: true, d: '国产替代加速' },
  { n: '光伏', c: '+1.08%', v: '198亿', u: true, d: '出口回暖' },
  { n: '银行', c: '+0.56%', v: '156亿', u: true, d: '高股息轮动' },
  { n: '计算机', c: '-1.23%', v: '224亿', u: false, d: '芯片限制传闻' },
  { n: '医药', c: '+0.89%', v: '167亿', u: true, d: '创新药审批加速' },
];

const marketHot = [
  { n: '上证指数', v: '3115.89', c: '+0.23%', u: true },
  { n: '深证成指', v: '9822.16', c: '+0.41%', u: true },
  { n: '创业板指', v: '1835.62', c: '-0.12%', u: false },
  { n: '科创50', v: '742.80', c: '+0.95%', u: true },
  { n: '沪深300', v: '3720.15', c: '+0.31%', u: true },
];

const strategyHot = [
  { n: '高股息精选', m: '股息率>5% + ROE>12%', d: '招商银行、中国神华等15只' },
  { n: '成长龙头', m: '营收增速>30% + 毛利率>40%', d: '宁德时代、比亚迪等12只' },
  { n: '困境反转', m: 'PE<20 + 近3年跌幅>40%', d: '关注超跌消费医药' },
  { n: '北向增持榜', m: '近5日净流入前10', d: '茅台、宁德、美的获加仓' },
];

const flowHot = [
  { s: '白酒', n: '+5.2亿', a: '加仓', u: true },
  { s: '银行', n: '+3.8亿', a: '加仓', u: true },
  { s: '光伏设备', n: '+2.1亿', a: '加仓', u: true },
  { s: '半导体', n: '+1.8亿', a: '加仓', u: true },
  { s: '计算机', n: '-1.7亿', a: '减仓', u: false },
];

export function Sidebar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const conversations = useAppStore((state) => state.conversations);
  const activeConversationId = useAppStore((state) => state.activeConversationId);
  const search = useAppStore((state) => state.search);
  const surgeStocks = useAppStore((state) => state.surgeStocks);
  const sidebarMainTab = useAppStore((state) => state.sidebarMainTab);
  const hotSubTab = useAppStore((state) => state.hotSubTab);
  const isLeftSidebarCollapsed = useAppStore((state) => state.isLeftSidebarCollapsed);
  const setSearch = useAppStore((state) => state.setSearch);
  const setActiveConversation = useAppStore((state) => state.setActiveConversation);
  const setConversations = useAppStore((state) => state.setConversations);
  const setSelectedStock = useAppStore((state) => state.setSelectedStock);
  const clearMessages = useAppStore((state) => state.clearMessages);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
  const setSidebarMainTab = useAppStore((state) => state.setSidebarMainTab);
  const setHotSubTab = useAppStore((state) => state.setHotSubTab);

  const createConversation = async () => {
    const item = await getStocksenseApi().createConversation();
    setConversations([item, ...conversations]);
    setActiveConversation(item.id);
    clearMessages();
  };

  const query = search.toLowerCase();
  const filteredConversations = conversations.filter((item) => !query || `${item.title}${item.preview}`.toLowerCase().includes(query));
  const filteredSurges = surgeStocks.filter((item) => !query || `${item.name}${item.code}${item.reason}`.toLowerCase().includes(query));

  return (
    <aside className={`sidebar ${isLeftSidebarCollapsed ? 'collapsed' : ''}`} data-sidebar>
      <div className="sidebar-header">
        <div className="sidebar-brand"><div className="logo">察</div><span>股察</span></div>
      </div>

      <div className="main-tabs">
        <button className={`main-tab ${sidebarMainTab === 'session' ? 'active' : ''}`} onClick={() => setSidebarMainTab('session')} type="button">会话</button>
        <button className={`main-tab ${sidebarMainTab === 'hot' ? 'active' : ''}`} onClick={() => setSidebarMainTab('hot')} type="button">热点聚焦</button>
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
          {hotTabs.map((tab) => <button key={tab.id} className={`sub-tab ${hotSubTab === tab.id ? 'active' : ''}`} onClick={() => setHotSubTab(tab.id)} type="button">{tab.label}</button>)}
        </div>
      )}

      <div className="sidebar-list">
        {sidebarMainTab === 'session' ? (
          filteredConversations.length ? filteredConversations.map((item) => (
            <button key={item.id} className={`source-item ${activeConversationId === item.id ? 'active' : ''}`} onClick={() => setActiveConversation(item.id)} type="button">
              <span className="label">{item.title}</span><span className="count">{item.count}</span>
            </button>
          )) : <div className="empty-list">无匹配对话</div>
        ) : <HotContent tab={hotSubTab} query={query} surges={filteredSurges} onStockClick={setSelectedStock} />}
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

function HotContent({ tab, query, surges, onStockClick }: { tab: HotSubTab; query: string; surges: SurgeStock[]; onStockClick(stock: StockDetail): void }) {
  if (tab === 'market') return <>{marketHot.filter((x) => !query || x.n.includes(query)).map((x) => <div className="cap-row" key={x.n}><span className="cap-name">{x.n}</span><span className={`cap-val ${x.u ? 'cap-up' : 'cap-down'}`}>{x.v}</span><span className={x.u ? 'cap-up' : 'cap-down'}>{x.c}</span></div>)}</>;
  if (tab === 'surge') return <><div className="surge-count">今日异动 <span>{surges.length}</span> 只</div>{surges.map((s) => <button key={s.code} className="hot-card" onClick={() => onStockClick(s)} type="button"><div className="hc-title">{s.name}<span className={`hc-tag ${s.type}`}>{s.type === 'surge' ? '拉升' : s.type === 'plummet' ? '跳水' : '放量'}</span></div><div className="hc-meta"><span><b>{s.price}</b></span><span className={String(s.changePercent).startsWith('-') ? 'down' : 'up'}>{s.changePercent}</span><span>{s.turnover}</span></div><div className="hc-desc">{s.reason}</div></button>)}</>;
  if (tab === 'strategy') return <>{strategyHot.filter((x) => !query || `${x.n}${x.d}`.includes(query)).map((x) => <div className="strategy-card" key={x.n}><div className="sc-title">{x.n}</div><div className="sc-meta">{x.m}</div><div className="sc-desc">{x.d}</div></div>)}</>;
  if (tab === 'diagnosis') return <>{surges.map((s) => <button className="diag-item" key={s.code} onClick={() => onStockClick(s)} type="button"><span className="diag-name">{s.name}<span>{s.code}</span></span><span className="diag-score">{s.rating?.fundamental ?? '7.5/10'}</span></button>)}</>;
  if (tab === 'flow') return <><div className="surge-count">板块资金流向</div>{flowHot.filter((x) => !query || x.s.includes(query)).map((x) => <div className="hot-card" key={x.s}><div className="hc-title">{x.s}<span className={`hc-tag ${x.u ? 'plummet' : 'surge'}`}>{x.a}</span></div><div className="hc-meta"><span className={x.u ? 'up' : 'down'}>{x.n}</span></div></div>)}</>;
  return <><div className="surge-count">板块热度排行</div>{sectorHot.filter((x) => !query || x.n.includes(query)).map((x) => <div className="hot-card" key={x.n}><div className="hc-title">{x.n}<span className={`hc-tag ${x.u ? 'plummet' : 'surge'}`}>{x.u ? '🔥' : '💧'}</span></div><div className="hc-meta"><span className={x.u ? 'up' : 'down'}>{x.c}</span><span>成交 {x.v}</span></div><div className="hc-desc">{x.d}</div></div>)}</>;
}
