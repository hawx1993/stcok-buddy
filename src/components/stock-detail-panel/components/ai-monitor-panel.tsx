import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../../store/app-store';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { IMonitorEvent, TMonitorCategory, StockDetail } from '../../../shared/types';

const CATEGORY_CONFIG: Record<TMonitorCategory, { label: string; icon: string; color: string }> = {
  'large-order': { label: '大单异动', icon: '💵', color: '#22c55e' },
  chip: { label: '筹码变化', icon: '📊', color: '#f59e0b' },
  technical: { label: '技术信号', icon: '📈', color: '#3b82f6' },
  'dragon-tiger': { label: '龙虎榜', icon: '🐉', color: '#e8b84b' },
  news: { label: '新闻公告', icon: '📰', color: '#8b5cf6' },
  risk: { label: '风险预警', icon: '⚠️', color: '#ef4444' },
  'ai-opportunity': { label: 'AI机会', icon: '🤖', color: '#a855f7' },
  'ai-warning': { label: 'AI预警', icon: '🔴', color: '#f43f5e' },
};

const ALL_CATEGORIES: TMonitorCategory[] = [
  'large-order',
  'chip',
  'technical',
  'dragon-tiger',
  'news',
  'risk',
  'ai-opportunity',
  'ai-warning',
];

const STORAGE_KEY = 'stocksense-monitor-categories';
const PAGE_SIZE = 20;

function formatTime(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function chgClass(value?: number | string) {
  if (value === undefined || value === null) return '';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(num)) return '';
  return num >= 0 ? 'up' : 'down';
}

function formatChange(value?: number | string) {
  if (value === undefined || value === null) return '--';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(num)) return '--';
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}

function SparkLine({ data, color }: { data: number[]; color: string }) {
  if (!data.length) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const width = 90;
  const height = 34;
  const stepX = width / (data.length - 1);
  let d = `M 0 ${height - ((data[0] - min) / range) * height}`;
  for (let i = 1; i < data.length; i += 1) {
    d += ` L ${i * stepX} ${height - ((data[i] - min) / range) * height}`;
  }
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="monitor-sparkline">
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AiMonitorPanel({ isActive }: { isActive: boolean }) {
  const [events, setEvents] = useState<IMonitorEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TMonitorCategory | 'all'>('all');
  const [enabledCategories, setEnabledCategories] = useState<TMonitorCategory[]>(ALL_CATEGORIES);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>();
  const [error, setError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const feedRef = useRef<HTMLDivElement>(null);

  const setSelectedStock = useAppStore((state) => state.setSelectedStock);
  const openRightPanel = useAppStore((state) => state.openRightPanel);
  const setStockReturnContext = useAppStore((state) => state.setStockReturnContext);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as TMonitorCategory[];
        if (Array.isArray(parsed) && parsed.length) {
          setEnabledCategories(parsed);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(enabledCategories));
  }, [enabledCategories]);

  const toggleCategory = (category: TMonitorCategory) => {
    setEnabledCategories((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category],
    );
  };

  const loadFeed = async () => {
    try {
      setError('');
      const api = getStocksenseApi();
      const feed = await api.getMonitorFeed({ categories: enabledCategories, limit: 200 });
      setEvents((prev) => {
        const map = new Map<string, IMonitorEvent>();
        for (const e of prev) map.set(e.id, e);
        for (const e of feed.events) map.set(e.id, e);
        return Array.from(map.values()).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      });
      setLastUpdated(feed.updatedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : '监控数据加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isActive) return;
    setLoading(true);
    setCurrentPage(1);
    loadFeed();
  }, [enabledCategories, isActive]);

  useEffect(() => {
    if (!isActive || !autoRefresh) return;
    const id = setInterval(loadFeed, 30_000);
    return () => clearInterval(id);
  }, [autoRefresh, enabledCategories, isActive]);

  const filteredEvents = useMemo(() => {
    if (activeTab === 'all') return events;
    return events.filter((e) => e.category === activeTab);
  }, [events, activeTab]);

  const counts = useMemo(() => {
    const map = new Map<TMonitorCategory | 'all', number>();
    map.set('all', events.length);
    for (const cat of ALL_CATEGORIES) {
      map.set(cat, events.filter((e) => e.category === cat).length);
    }
    return map;
  }, [events]);

  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / PAGE_SIZE));
  const pageEvents = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredEvents.slice(start, start + PAGE_SIZE);
  }, [filteredEvents, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, events.length]);

  // Scroll feed to top when page changes.
  useEffect(() => {
    feedRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentPage, activeTab]);

  const handleStockClick = async (code: string, name: string) => {
    const snapshot = { code, name } as StockDetail;
    openRightPanel();
    setStockReturnContext({ tab: 'ai-monitor', code });
    setSelectedStock(snapshot);
    try {
      const detail = await getStocksenseApi().getStockDetail(code);
      setSelectedStock({ ...snapshot, ...detail, name: detail.name === detail.code ? name : detail.name });
    } catch {
      setSelectedStock(snapshot);
    }
  };

  const toggleStar = (id: string) => {
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, star: !e.star } : e)));
  };

  const goPage = (page: number) => {
    setCurrentPage((p) => {
      const next = Math.max(1, Math.min(totalPages, page));
      return next;
    });
  };

  return (
    <div className="ai-monitor-panel">
      <div className="ai-monitor-panel-head">
        <span className="ai-monitor-panel-title">
          <span className="ai-monitor-panel-icon">🤖</span>
          AI监控
        </span>
        <div className="ai-monitor-panel-controls">
          <button
            className={`monitor-refresh-btn${autoRefresh ? ' active' : ''}`}
            onClick={() => setAutoRefresh((v) => !v)}
            type="button"
          >
            {autoRefresh ? '● 实时' : '○ 暂停'}
          </button>
          <button className="monitor-refresh-btn" onClick={loadFeed} type="button">
            刷新
          </button>
        </div>
      </div>

      <div className="ai-monitor-panel-toggles">
        {ALL_CATEGORIES.map((cat) => (
          <label key={cat} className={`monitor-toggle${enabledCategories.includes(cat) ? ' active' : ''}`}>
            <input
              type="checkbox"
              checked={enabledCategories.includes(cat)}
              onChange={() => toggleCategory(cat)}
            />
            <span>{CATEGORY_CONFIG[cat].icon} {CATEGORY_CONFIG[cat].label}</span>
          </label>
        ))}
      </div>

      <div className="ai-monitor-panel-tabs">
        <button
          className={`monitor-tab${activeTab === 'all' ? ' active' : ''}`}
          onClick={() => setActiveTab('all')}
          type="button"
        >
          全部 <span className="monitor-count">{counts.get('all') ?? 0}</span>
        </button>
        {enabledCategories.map((cat) => (
          <button
            key={cat}
            className={`monitor-tab${activeTab === cat ? ' active' : ''}`}
            onClick={() => setActiveTab(cat)}
            type="button"
          >
            {CATEGORY_CONFIG[cat].label}
            <span className="monitor-count">{counts.get(cat) ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="ai-monitor-panel-feed" ref={feedRef}>
        {loading && !events.length ? (
          <div className="empty-block">正在加载 AI 监控数据...</div>
        ) : error ? (
          <div className="empty-block">{error}</div>
        ) : filteredEvents.length === 0 ? (
          <div className="empty-block">暂无监控事件，请开启更多监控类型</div>
        ) : (
          pageEvents.map((event) => {
            const cfg = CATEGORY_CONFIG[event.category];
            return (
              <div key={event.id} className="monitor-card">
                <div className="monitor-card-dot" style={{ background: cfg.color }} />
                <div className="monitor-card-body">
                  <div className="monitor-card-top">
                    <span className="monitor-card-category" style={{ color: cfg.color }}>
                      {cfg.icon} {cfg.label}
                    </span>
                    <span className="monitor-card-time">{formatTime(event.timestamp)}</span>
                    {event.badge ? <span className="monitor-card-badge">{event.badge}</span> : null}
                  </div>

                  <div className="monitor-card-stock">
                    <button
                      className="monitor-stock-btn"
                      onClick={() => handleStockClick(event.code, event.name)}
                      type="button"
                    >
                      <span className="monitor-stock-name">{event.name}</span>
                      <span className="monitor-stock-code">{event.code}</span>
                    </button>
                    {event.price !== undefined && event.price !== null ? (
                      <span className="monitor-stock-price">
                        ¥{typeof event.price === 'number' ? event.price.toFixed(2) : event.price}
                      </span>
                    ) : null}
                    <span className={`monitor-stock-chg ${chgClass(event.changePercent)}`}>
                      {formatChange(event.changePercent)}
                    </span>
                  </div>

                  <div className="monitor-card-title">{event.title}</div>

                  {event.details?.length ? (
                    <ul className="monitor-card-details">
                      {event.details.slice(0, 2).map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  ) : null}

                  <div className="monitor-card-ai">
                    <span className="monitor-ai-label">AI</span>
                    <span className="monitor-ai-text">{event.aiAnalysis}</span>
                  </div>

                  <div className="monitor-card-actions">
                    <button
                      className="monitor-action-btn"
                      onClick={() => handleStockClick(event.code, event.name)}
                      type="button"
                    >
                      查看详情
                    </button>
                    <button
                      className={`monitor-star-btn${event.star ? ' active' : ''}`}
                      onClick={() => toggleStar(event.id)}
                      type="button"
                    >
                      {event.star ? '★' : '☆'}
                    </button>
                  </div>
                </div>

                {event.chart ? (
                  <div className="monitor-card-chart">
                    <SparkLine data={event.chart.data} color={cfg.color} />
                    {event.score !== undefined ? (
                      <div className="monitor-score">
                        <span>AI评分</span>
                        <strong>{event.score}</strong>
                        <span>分</span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {filteredEvents.length > 0 && totalPages > 1 ? (
        <div className="monitor-pagination">
          <button
            className="monitor-page-btn"
            type="button"
            disabled={currentPage <= 1}
            onClick={() => goPage(currentPage - 1)}
          >
            ← 上一页
          </button>
          <div className="monitor-page-info">
            <span className="monitor-page-current">{currentPage}</span>
            <span className="monitor-page-sep">/</span>
            <span className="monitor-page-total">{totalPages}</span>
          </div>
          <button
            className="monitor-page-btn"
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => goPage(currentPage + 1)}
          >
            下一页 →
          </button>
        </div>
      ) : null}

      {lastUpdated ? (
        <div className="monitor-footer">
          更新于 {new Date(lastUpdated).toLocaleTimeString('zh-CN')}
        </div>
      ) : null}
    </div>
  );
}
