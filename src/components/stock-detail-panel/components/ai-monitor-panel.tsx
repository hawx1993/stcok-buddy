import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Banknote,
  Layers,
  TrendingUp,
  Flame,
  Newspaper,
  AlertTriangle,
  Bot,
  AlertCircle,
  RefreshCw,
  Star,
  Sparkles,
  CircleDot,
  Pause,
  LayoutGrid,
} from 'lucide-react';
import { useAppStore } from '../../../store/app-store';
import styles from '../index.module.scss';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { IMonitorEvent, TMonitorCategory, StockDetail } from '../../../shared/types';
import type { LucideIcon } from 'lucide-react';

const CATEGORY_CONFIG: Record<
  TMonitorCategory,
  { label: string; Icon: LucideIcon; color: string; glow: string }
> = {
  'large-order': {
    label: '大单异动',
    Icon: Banknote,
    color: '#22c55e',
    glow: 'rgba(34, 197, 94, 0.45)',
  },
  chip: {
    label: '筹码变化',
    Icon: Layers,
    color: '#f59e0b',
    glow: 'rgba(245, 158, 11, 0.45)',
  },
  technical: {
    label: '技术信号',
    Icon: TrendingUp,
    color: '#3b82f6',
    glow: 'rgba(59, 130, 246, 0.45)',
  },
  'dragon-tiger': {
    label: '龙虎榜',
    Icon: Flame,
    color: '#e8b84b',
    glow: 'rgba(232, 184, 75, 0.45)',
  },
  news: {
    label: '新闻公告',
    Icon: Newspaper,
    color: '#8b5cf6',
    glow: 'rgba(139, 92, 246, 0.45)',
  },
  risk: {
    label: '风险预警',
    Icon: AlertTriangle,
    color: '#ef4444',
    glow: 'rgba(239, 68, 68, 0.45)',
  },
  'ai-opportunity': {
    label: 'AI机会',
    Icon: Bot,
    color: '#a855f7',
    glow: 'rgba(168, 85, 247, 0.45)',
  },
  'ai-warning': {
    label: 'AI预警',
    Icon: AlertCircle,
    color: '#f43f5e',
    glow: 'rgba(244, 63, 94, 0.45)',
  },
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

const categoryStyle = (color: string, glow?: string): CSSProperties => ({
  '--cat-color': color,
  '--cat-glow': glow ?? color,
} as CSSProperties);

const cardAccentStyle = (color: string): CSSProperties => ({
  '--card-accent': color,
} as CSSProperties);

const classNames = (...classes: Array<string | false | undefined>) => classes.filter(Boolean).join(' ');

const PAGE_SIZE = 20;

function formatTime(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function chgClass(value?: number | string) {
  if (value === undefined || value === null) return undefined;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(num)) return undefined;
  return num >= 0 ? styles.up : styles.down;
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
  const width = 110;
  const height = 40;
  const stepX = width / (data.length - 1);
  let d = `M 0 ${height - ((data[0] - min) / range) * height}`;
  let areaD = d;
  for (let i = 1; i < data.length; i += 1) {
    d += ` L ${i * stepX} ${height - ((data[i] - min) / range) * height}`;
    areaD += ` L ${i * stepX} ${height - ((data[i] - min) / range) * height}`;
  }
  areaD += ` L ${width} ${height} L 0 ${height} Z`;
  const gradId = `sl-${Math.random().toString(36).slice(2, 9)}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={styles['monitor-sparkline']}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gradId})`} />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AiMonitorPanel({ isActive }: { isActive: boolean }) {
  const [events, setEvents] = useState<IMonitorEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TMonitorCategory | 'all'>('all');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>();
  const [error, setError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const feedRef = useRef<HTMLDivElement>(null);

  const setSelectedStock = useAppStore((state) => state.setSelectedStock);
  const openRightPanel = useAppStore((state) => state.openRightPanel);
  const setStockReturnContext = useAppStore((state) => state.setStockReturnContext);

  const loadFeed = async () => {
    try {
      setError('');
      const api = getStocksenseApi();
      const feed = await api.getMonitorFeed({ categories: ALL_CATEGORIES, limit: 200 });
      setEvents((prev) => {
        const map = new Map<string, IMonitorEvent>();
        for (const e of prev) map.set(e.id, e);
        for (const e of feed.events) map.set(e.id, e);
        return Array.from(map.values()).sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        );
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
  }, [isActive]);

  useEffect(() => {
    if (!isActive || !autoRefresh) return;
    const id = setInterval(loadFeed, 30_000);
    return () => clearInterval(id);
  }, [autoRefresh, isActive]);

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
    <div className={styles['ai-monitor-panel']}>
      <div className={styles['ai-monitor-panel-head']}>
        <span className={styles['ai-monitor-panel-title']}>
          <span className={styles['ai-monitor-panel-icon']}>
            <Sparkles size={18} strokeWidth={1.8} />
          </span>
          <span>AI监控</span>
        </span>
        <div className={styles['ai-monitor-panel-controls']}>
          <button
            className={classNames(styles['monitor-refresh-btn'], autoRefresh && styles.active)}
            onClick={() => setAutoRefresh((v) => !v)}
            type="button"
          >
            {autoRefresh ? (
              <>
                <CircleDot size={12} />
                <span>实时</span>
              </>
            ) : (
              <>
                <Pause size={12} />
                <span>暂停</span>
              </>
            )}
          </button>
          <button className={styles['monitor-refresh-btn']} onClick={loadFeed} type="button">
            <RefreshCw size={12} />
            <span>刷新</span>
          </button>
        </div>
      </div>

      <div className={styles['ai-monitor-panel-tabs']}>
        <button
          className={classNames(styles['monitor-tab'], activeTab === 'all' && styles.active)}
          onClick={() => setActiveTab('all')}
          type="button"
          style={categoryStyle('#a855f7', 'rgba(168, 85, 247, 0.45)')}
        >
          <span className={styles['monitor-tab-indicator']} />
          <LayoutGrid size={13} strokeWidth={2} className={styles['monitor-tab-icon']} />
          <span className={styles['monitor-tab-label']}>全部</span>
          <span className={styles['monitor-count']}>{counts.get('all') ?? 0}</span>
        </button>
        {ALL_CATEGORIES.map((cat) => {
          const cfg = CATEGORY_CONFIG[cat];
          const Icon = cfg.Icon;
          return (
            <button
              key={cat}
              className={classNames(styles['monitor-tab'], activeTab === cat && styles.active)}
              onClick={() => setActiveTab(cat)}
              type="button"
              style={categoryStyle(cfg.color, cfg.glow)}
            >
              <span className={styles['monitor-tab-indicator']} />
              <Icon size={13} strokeWidth={2} className={styles['monitor-tab-icon']} />
              <span className={styles['monitor-tab-label']}>{cfg.label}</span>
              <span className={styles['monitor-count']}>{counts.get(cat) ?? 0}</span>
            </button>
          );
        })}
      </div>

      <div className={styles['ai-monitor-panel-feed']} ref={feedRef}>
        {loading && !events.length ? (
          <div className={styles['empty-block']}>正在加载 AI 监控数据...</div>
        ) : error ? (
          <div className={styles['empty-block']}>{error}</div>
        ) : filteredEvents.length === 0 ? (
          <div className={styles['empty-block']}>暂无监控事件</div>
        ) : (
          pageEvents.map((event) => {
            const cfg = CATEGORY_CONFIG[event.category];
            const Icon = cfg.Icon;
            return (
              <div
                key={event.id}
                className={styles['monitor-card']}
                style={cardAccentStyle(cfg.color)}
              >
                {/* 左侧类别色条 + 图标 */}
                <div className={styles['monitor-card-rail']}>
                  <Icon size={13} strokeWidth={2} />
                </div>

                {/* 主内容 */}
                <div className={styles['monitor-card-main']}>
                  {/* 顶部行: 类别 | 时间 | badge | star */}
                  <div className={styles['monitor-card-head']}>
                    <div className={styles['monitor-card-left']}>
                      <span className={styles['monitor-cat-label']}>{cfg.label}</span>
                      <span className={styles['monitor-card-time']}>{formatTime(event.timestamp)}</span>
                    </div>
                    <div className={styles['monitor-card-right']}>
                      {event.badge ? (
                        <span className={styles['monitor-card-badge']}>{event.badge}</span>
                      ) : null}
                      <button
                        className={classNames(styles['monitor-star-btn'], event.star && styles.active)}
                        onClick={() => toggleStar(event.id)}
                        type="button"
                        aria-label={event.star ? '取消收藏' : '收藏'}
                      >
                        <Star
                          size={13}
                          strokeWidth={2}
                          fill={event.star ? 'currentColor' : 'none'}
                        />
                      </button>
                    </div>
                  </div>

                  {/* 股票行 */}
                  <div className={styles['monitor-card-stock']}>
                    <button
                      className={styles['monitor-stock-btn']}
                      onClick={() => handleStockClick(event.code, event.name)}
                      type="button"
                    >
                      <span className={styles['monitor-stock-name']}>{event.name}</span>
                      <span className={styles['monitor-stock-code']}>{event.code}</span>
                    </button>
                    <div className={styles['monitor-stock-market']}>
                      {event.price !== undefined && event.price !== null ? (
                        <span className={styles['monitor-stock-price']}>
                          {typeof event.price === 'number' ? event.price.toFixed(2) : event.price}
                        </span>
                      ) : null}
                      <span className={classNames(styles['monitor-stock-chg'], chgClass(event.changePercent))}>
                        {formatChange(event.changePercent)}
                      </span>
                    </div>
                  </div>

                  {/* 标题 */}
                  <div className={styles['monitor-card-title']}>{event.title}</div>

                  {/* 详情 */}
                  {event.details?.length ? (
                    <ul className={styles['monitor-card-details']}>
                      {event.details.slice(0, 2).map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  ) : null}

                  {/* AI分析 */}
                  {event.aiAnalysis ? (
                    <div className={styles['monitor-card-ai']}>
                      <span className={styles['monitor-ai-label']}>AI</span>
                      <span className={styles['monitor-ai-text']}>{event.aiAnalysis}</span>
                    </div>
                  ) : null}

                  {/* 底部行: sparkline + action */}
                  <div className={styles['monitor-card-foot']}>
                    {event.chart ? (
                      <SparkLine data={event.chart.data} color={cfg.color} />
                    ) : (
                      <span />
                    )}
                    <button
                      className={styles['monitor-action-btn']}
                      onClick={() => handleStockClick(event.code, event.name)}
                      type="button"
                    >
                      查看
                    </button>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {filteredEvents.length > 0 && totalPages > 1 ? (
        <div className={styles['monitor-pagination']}>
          <button
            className={styles['monitor-page-btn']}
            type="button"
            disabled={currentPage <= 1}
            onClick={() => goPage(currentPage - 1)}
          >
            ← 上一页
          </button>
          <div className={styles['monitor-page-info']}>
            <span className={styles['monitor-page-current']}>{currentPage}</span>
            <span className={styles['monitor-page-sep']}>/</span>
            <span className={styles['monitor-page-total']}>{totalPages}</span>
          </div>
          <button
            className={styles['monitor-page-btn']}
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => goPage(currentPage + 1)}
          >
            下一页 →
          </button>
        </div>
      ) : null}

      {lastUpdated ? (
        <div className={styles['monitor-footer']}>
          更新于 {new Date(lastUpdated).toLocaleTimeString('zh-CN')}
        </div>
      ) : null}
    </div>
  );
}
