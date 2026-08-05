import { ConfigProvider, Select } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Banknote,
  Layers,
  TrendingUp,
  Newspaper,
  AlertTriangle,
  Bot,
  AlertCircle,
  RefreshCw,
  Star,
  Search,
  Sparkles,
  LayoutGrid,
} from 'lucide-react';
import { useAppDataStore, useAppUiStore } from '../../../store/app-store';
import type { IAiMonitorReturnState } from '../../../store/app-store';
import styles from '../index.module.scss';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { IMonitorEvent, TMonitorCategory, TMonitorMode, StockDetail } from '../../../shared/types';
import type { LucideIcon } from 'lucide-react';
import { MarketPhasePill } from '../../market-phase-pill';

type TVisibleMonitorCategory = Exclude<TMonitorCategory, 'dragon-tiger'>;
type TVisibleMonitorEvent = IMonitorEvent & { category: TVisibleMonitorCategory };

const CATEGORY_CONFIG: Record<TVisibleMonitorCategory, { label: string; Icon: LucideIcon; color: string; glow: string }> = {
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

const ALL_CATEGORIES: TVisibleMonitorCategory[] = [
  'large-order',
  'chip',
  'technical',
  'news',
  'risk',
  'ai-opportunity',
  'ai-warning',
];

const categoryStyle = (color: string, glow?: string): CSSProperties =>
  ({
    '--cat-color': color,
    '--cat-glow': glow ?? color,
  }) as CSSProperties;

const cardAccentStyle = (color: string): CSSProperties =>
  ({
    '--card-accent': color,
  }) as CSSProperties;

const classNames = (...classes: Array<string | false | undefined>) => classes.filter(Boolean).join(' ');

function isVisibleMonitorEvent(event: IMonitorEvent): event is TVisibleMonitorEvent {
  return event.category !== 'dragon-tiger';
}

function matchesMonitorQuery(event: TVisibleMonitorEvent, normalizedQuery: string) {
  if (!normalizedQuery) return true;
  return [
    event.code,
    event.name,
    event.title,
    event.badge,
    event.aiAnalysis,
    ...event.details,
  ].some((value) => value?.toLowerCase().includes(normalizedQuery));
}

const PAGE_SIZE = 20;
const MONITOR_FEED_CACHE_TTL_MS = 15_000;

interface IAiMonitorFeedCache {
  activeTab: TVisibleMonitorCategory | 'all';
  cachedAt: number;
  categoryTotals: Partial<Record<TMonitorCategory, number>>;
  currentPage: number;
  events: IMonitorEvent[];
  isTradingTime: boolean;
  lastUpdated?: string;
  mode: TMonitorMode;
  selectedDate: string;
  totalCount: number;
}

let aiMonitorFeedCache: IAiMonitorFeedCache | undefined;

export function isAiMonitorFeedCacheFresh(cache: { cachedAt: number } | undefined, now = Date.now()) {
  return cache !== undefined && now - cache.cachedAt <= MONITOR_FEED_CACHE_TTL_MS;
}

export function shouldLoadAiMonitorFeedOnActiveTransition({
  currentFeedKey,
  didRestore,
  hasEvents,
  isActive,
  nextFeedKey,
  wasActive,
}: {
  currentFeedKey: string;
  didRestore: boolean;
  hasEvents: boolean;
  isActive: boolean;
  nextFeedKey: string;
  wasActive: boolean;
}) {
  if (!isActive || wasActive) return false;
  if (didRestore) return true;
  return !hasEvents || currentFeedKey !== nextFeedKey;
}

function makeMonitorFeedKey(
  monitorMode: TMonitorMode,
  monitorDate: string,
  monitorPage: number,
  monitorTab: TVisibleMonitorCategory | 'all',
) {
  return `${monitorMode}:${monitorDate}:${monitorPage}:${monitorTab}`;
}

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
        <linearGradient id={gradId} x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0%' stopColor={color} stopOpacity='0.32' />
          <stop offset='100%' stopColor={color} stopOpacity='0' />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gradId})`} />
      <path d={d} fill='none' stroke={color} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  );
}

function AiMonitorSkeletonList() {
  return (
    <div className={styles['monitor-skeleton-list']} aria-label='AI 监控加载中'>
      {Array.from({ length: 5 }, (_, index) => (
        <div className={styles['monitor-skeleton-card']} key={index}>
          <div className={styles['monitor-skeleton-rail']} />
          <div className={styles['monitor-skeleton-main']}>
            <div className={styles['monitor-skeleton-head']}>
              <span className={classNames(styles['monitor-skeleton-line'], styles.category)} />
              <span className={classNames(styles['monitor-skeleton-line'], styles.time)} />
              <span className={classNames(styles['monitor-skeleton-line'], styles.badge)} />
            </div>
            <div className={styles['monitor-skeleton-stock']}>
              <span className={classNames(styles['monitor-skeleton-line'], styles.name)} />
              <span className={classNames(styles['monitor-skeleton-line'], styles.code)} />
              <span className={classNames(styles['monitor-skeleton-line'], styles.price)} />
              <span className={classNames(styles['monitor-skeleton-line'], styles.change)} />
            </div>
            <span className={classNames(styles['monitor-skeleton-line'], styles.title)} />
            <span className={classNames(styles['monitor-skeleton-line'], styles.detail)} />
            <div className={styles['monitor-skeleton-ai']}>
              <span className={classNames(styles['monitor-skeleton-line'], styles.aiLabel)} />
              <span className={classNames(styles['monitor-skeleton-line'], styles.aiText)} />
            </div>
            <div className={styles['monitor-skeleton-foot']}>
              <span className={classNames(styles['monitor-skeleton-line'], styles.chart)} />
              <span className={classNames(styles['monitor-skeleton-line'], styles.button)} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function AiMonitorPanel({ isActive, restoreState }: { isActive: boolean; restoreState?: IAiMonitorReturnState }) {
  const restoredFeedKey = restoreState
    ? makeMonitorFeedKey(restoreState.mode, restoreState.selectedDate, restoreState.currentPage, restoreState.activeTab)
    : undefined;
  const cachedFeedKey = aiMonitorFeedCache
    ? makeMonitorFeedKey(
        aiMonitorFeedCache.mode,
        aiMonitorFeedCache.selectedDate,
        aiMonitorFeedCache.currentPage,
        aiMonitorFeedCache.activeTab,
      )
    : undefined;
  const canUseInitialCache = restoredFeedKey === undefined || restoredFeedKey === cachedFeedKey;
  const initialCache = canUseInitialCache && isAiMonitorFeedCacheFresh(aiMonitorFeedCache) ? aiMonitorFeedCache : undefined;
  const initialFeedState: IAiMonitorReturnState | undefined = restoreState ?? (initialCache
    ? {
        activeTab: initialCache.activeTab,
        currentPage: initialCache.currentPage,
        selectedDate: initialCache.selectedDate,
        mode: initialCache.mode,
      }
    : undefined);
  const [events, setEvents] = useState<IMonitorEvent[]>(initialCache?.events ?? []);
  const [loading, setLoading] = useState(!initialCache);
  const [activeTab, setActiveTab] = useState<TVisibleMonitorCategory | 'all'>(initialFeedState?.activeTab ?? 'all');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [mode, setMode] = useState<TMonitorMode>(initialFeedState?.mode ?? 'history');
  const [isTradingTime, setTradingTime] = useState(initialCache?.isTradingTime ?? false);
  const [dateOptions] = useState(() => makeMonitorDateOptions());
  const [selectedDate, setSelectedDate] = useState(() => initialFeedState?.selectedDate ?? makeMonitorDateOptions()[0]);
  const [lastUpdated, setLastUpdated] = useState<string | undefined>(initialCache?.lastUpdated);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(initialFeedState?.currentPage ?? 1);
  const [totalCount, setTotalCount] = useState(initialCache?.totalCount ?? 0);
  const [categoryTotals, setCategoryTotals] = useState<Partial<Record<TMonitorCategory, number>>>(
    initialCache?.categoryTotals ?? {},
  );
  const [currentFeedKey, setCurrentFeedKey] = useState(() =>
    initialCache
      ? makeMonitorFeedKey(initialCache.mode, initialCache.selectedDate, initialCache.currentPage, initialCache.activeTab)
      : '',
  );
  const selectedDateRef = useRef(selectedDate);
  const currentFeedKeyRef = useRef(currentFeedKey);
  const eventsLengthRef = useRef(events.length);
  const restoreStateRef = useRef(restoreState);
  const didRestoreRef = useRef(false);
  const wasActiveRef = useRef(false);
  const feedRequestSeqRef = useRef(0);
  const feedRef = useRef<HTMLDivElement>(null);

  const setSelectedStock = useAppDataStore((state) => state.setSelectedStock);
  const openRightPanel = useAppUiStore((state) => state.openRightPanel);
  const setStockReturnContext = useAppDataStore((state) => state.setStockReturnContext);
  const setAiMonitorState = useAppDataStore((state) => state.setAiMonitorState);

  const loadFeed = useCallback(
    async (nextMode: TMonitorMode, nextDate: string, nextPage: number, nextTab: TVisibleMonitorCategory | 'all') => {
      const requestSeq = feedRequestSeqRef.current + 1;
      feedRequestSeqRef.current = requestSeq;
      try {
        setError('');
        const api = getStocksenseApi();
        const feed = await api.getMonitorFeed({
          categories: nextTab === 'all' ? ALL_CATEGORIES : [nextTab],
          limit: PAGE_SIZE,
          offset: (nextPage - 1) * PAGE_SIZE,
          mode: nextMode,
          date: nextMode === 'history' ? nextDate : undefined,
        });
        if (requestSeq !== feedRequestSeqRef.current) return;
        const nextEvents = feed.events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        const nextTotalCount = feed.total ?? feed.events.length;
        const nextCategoryTotals = feed.categoryTotals ?? {};
        const nextFeedKey = makeMonitorFeedKey(feed.mode, feed.selectedDate ?? nextDate, nextPage, nextTab);
        setMode(feed.mode);
        setActiveTab(nextTab);
        setCurrentPage(nextPage);
        setTradingTime(feed.isTradingTime);
        setSelectedDate(feed.selectedDate ?? nextDate);
        setEvents(nextEvents);
        setTotalCount(nextTotalCount);
        setCategoryTotals(nextCategoryTotals);
        setLastUpdated(feed.updatedAt);
        setCurrentFeedKey(nextFeedKey);
        setAiMonitorState({ activeTab: nextTab, currentPage: nextPage, selectedDate: feed.selectedDate ?? nextDate, mode: feed.mode });
        aiMonitorFeedCache = {
          activeTab: nextTab,
          cachedAt: Date.now(),
          categoryTotals: nextCategoryTotals,
          currentPage: nextPage,
          events: nextEvents,
          isTradingTime: feed.isTradingTime,
          lastUpdated: feed.updatedAt,
          mode: feed.mode,
          selectedDate: feed.selectedDate ?? nextDate,
          totalCount: nextTotalCount,
        };
        window.dispatchEvent(new CustomEvent('monitor:feedUpdated'));
      } catch (err) {
        if (requestSeq !== feedRequestSeqRef.current) return;
        setError(err instanceof Error ? err.message : '监控数据加载失败');
      } finally {
        if (requestSeq === feedRequestSeqRef.current) setLoading(false);
      }
    },
    [setAiMonitorState],
  );

  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  useEffect(() => {
    currentFeedKeyRef.current = currentFeedKey;
  }, [currentFeedKey]);

  useEffect(() => {
    eventsLengthRef.current = events.length;
  }, [events.length]);

  useEffect(() => {
    restoreStateRef.current = restoreState;
  }, [restoreState]);

  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = isActive;
    if (!isActive) return;
    const didRestore = didRestoreRef.current;
    const restoreState = didRestore ? undefined : restoreStateRef.current;
    const nextPage = restoreState?.currentPage ?? currentPage;
    const nextMode = restoreState?.mode ?? mode;
    const nextDate = restoreState?.selectedDate ?? selectedDateRef.current;
    const nextTab = restoreState?.activeTab ?? activeTab;
    const nextFeedKey = makeMonitorFeedKey(nextMode, nextDate, nextPage, nextTab);
    const shouldLoad = shouldLoadAiMonitorFeedOnActiveTransition({
      currentFeedKey: currentFeedKeyRef.current,
      didRestore,
      hasEvents: eventsLengthRef.current > 0,
      isActive,
      nextFeedKey,
      wasActive,
    });
    if (!didRestore) {
      didRestoreRef.current = true;
      setActiveTab(nextTab);
      setCurrentPage(nextPage);
    }
    if (!shouldLoad) return;
    setLoading(true);
    void loadFeed(nextMode, nextDate, nextPage, nextTab);
  }, [activeTab, currentPage, isActive, loadFeed, mode]);

  useEffect(() => {
    if (!isActive || !autoRefresh || !isTradingTime || mode !== 'realtime') return;
    const id = setInterval(() => void loadFeed('realtime', selectedDate, currentPage, activeTab), 30_000);
    return () => clearInterval(id);
  }, [activeTab, autoRefresh, currentPage, isActive, isTradingTime, loadFeed, mode, selectedDate]);

  useEffect(() => {
    const handleMonitorHistoryCleared = () => {
      setEvents([]);
      setTotalCount(0);
      setCategoryTotals({});
      setCurrentPage(1);
      setLastUpdated(undefined);
      setCurrentFeedKey('');
      aiMonitorFeedCache = undefined;
      if (!isActive) return;
      setLoading(true);
      void loadFeed('history', selectedDateRef.current, 1, activeTab);
    };
    window.addEventListener('monitor:historyCleared', handleMonitorHistoryCleared);
    return () => window.removeEventListener('monitor:historyCleared', handleMonitorHistoryCleared);
  }, [activeTab, isActive, loadFeed]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredEvents = useMemo(
    () => events.filter(isVisibleMonitorEvent).filter((event) => matchesMonitorQuery(event, normalizedQuery)),
    [events, normalizedQuery],
  );

  const counts = useMemo(() => {
    const map = new Map<TMonitorCategory | 'all', number>();
    const allTotal = ALL_CATEGORIES.reduce((sum, cat) => sum + (categoryTotals[cat] ?? 0), 0);
    map.set('all', allTotal || totalCount);
    for (const cat of ALL_CATEGORIES) {
      map.set(cat, categoryTotals[cat] ?? 0);
    }
    return map;
  }, [categoryTotals, totalCount]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const displayTotalPages = normalizedQuery ? Math.max(1, Math.ceil(filteredEvents.length / PAGE_SIZE)) : totalPages;
  const pageEvents = filteredEvents;

  useEffect(() => {
    if (loading || totalCount === 0 || currentPage <= displayTotalPages) return;
    setCurrentPage(displayTotalPages);
  }, [currentPage, displayTotalPages, loading, totalCount]);

  // Scroll feed to top when page changes.
  useEffect(() => {
    feedRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentPage, activeTab]);

  const handleStockClick = async (code: string, name: string) => {
    const snapshot = { code, name } as StockDetail;
    const aiMonitorState = useAppDataStore.getState().aiMonitorState ?? { activeTab, currentPage, selectedDate, mode };
    openRightPanel();
    setStockReturnContext({ tab: 'ai-monitor', code, aiMonitor: aiMonitorState });
    setSelectedStock(snapshot);
    try {
      const detail = await getStocksenseApi().getStockDetail(code);
      setSelectedStock({ ...snapshot, ...detail, name: detail.name === detail.code ? name : detail.name });
    } catch {
      setSelectedStock(snapshot);
    }
  };

  const toggleStar = (eventId: string) => {
    setEvents((prev) => {
      const target = prev.find((event) => event.id === eventId);
      if (!target) return prev;
      const nextStar = !target.star;
      return prev.map((event) => (event.code === target.code ? { ...event, star: nextStar } : event));
    });
  };

  const goPage = (page: number) => {
    const next = Math.max(1, Math.min(displayTotalPages, page));
    setCurrentPage(next);
    setAiMonitorState({ activeTab, currentPage: next, selectedDate, mode });
    if (normalizedQuery) return;
    setLoading(true);
    void loadFeed(mode, selectedDate, next, activeTab);
  };

  const getMonitorDateSelectPopupContainer = (trigger: HTMLElement) => trigger.parentElement ?? document.body;
  const monitorDateSelectClassNames = {
    popup: {
      root: styles['surge-date-select-popup'],
      listItem: styles['surge-date-select-option'],
    },
  };
  const monitorDateSelectTheme = {
    token: {
      colorBgContainer: 'var(--input-bg)',
      colorBgElevated: 'var(--surface)',
      colorBorder: 'var(--border)',
      colorText: 'var(--fg)',
      colorTextPlaceholder: 'var(--fg-secondary)',
      colorTextQuaternary: 'var(--fg-secondary)',
      colorIcon: 'var(--fg-secondary)',
    },
    components: {
      Select: {
        selectorBg: 'var(--input-bg)',
        optionActiveBg: 'var(--surface-hover)',
        optionSelectedBg: 'var(--surface-active)',
        optionSelectedColor: 'var(--fg)',
        hoverBorderColor: 'var(--accent)',
        activeBorderColor: 'var(--accent)',
        activeOutlineColor: 'transparent',
      },
    },
  };

  const handleRealtimeClick = () => {
    if (!isTradingTime) return;
    setLoading(true);
    setCurrentPage(1);
    setAiMonitorState({ activeTab, currentPage: 1, selectedDate, mode: 'realtime' });
    void loadFeed('realtime', selectedDate, 1, activeTab);
  };

  const handleHistoryDateClick = (date: string) => {
    setLoading(true);
    setCurrentPage(1);
    setAiMonitorState({ activeTab, currentPage: 1, selectedDate: date, mode: 'history' });
    void loadFeed('history', date, 1, activeTab);
  };

  const handleRefresh = () => {
    const nextMode = mode === 'realtime' && isTradingTime ? 'realtime' : 'history';
    setLoading(true);
    setCurrentPage(1);
    setAiMonitorState({ activeTab, currentPage: 1, selectedDate, mode: nextMode });
    void loadFeed(nextMode, selectedDate, 1, activeTab);
  };

  const emptyText = normalizedQuery ? '当前日期未匹配到监控事件' : mode === 'history' ? '该交易日暂无此分类监控事件' : '暂无监控事件';

  return (
    <div className={styles['ai-monitor-panel']}>
      <div className={styles['ai-monitor-panel-head']}>
        <span className={styles['ai-monitor-panel-title']}>
          <span className={styles['ai-monitor-panel-icon']}>
            <Sparkles size={18} strokeWidth={1.8} />
          </span>
          <span>AI监控</span>
        </span>
      </div>

      <div className={styles['surge-date-row']}>
        <ConfigProvider theme={monitorDateSelectTheme}>
          <Select
            aria-label='筛选 AI 监控日期'
            className={styles['surge-date-select']}
            classNames={monitorDateSelectClassNames}
            getPopupContainer={getMonitorDateSelectPopupContainer}
            value={selectedDate}
            options={dateOptions.map((date, index) => ({
              value: date,
              label: index === 0 ? `今天 ${date.slice(5)}` : date,
            }))}
            onChange={(date: string) => handleHistoryDateClick(date)}
          />
        </ConfigProvider>
        <button
          aria-label={loading ? '正在刷新 AI 监控' : '刷新 AI 监控'}
          className={styles['surge-date-button']}
          disabled={loading}
          onClick={handleRefresh}
          type='button'
        >
          <RefreshCw aria-hidden='true' className={loading ? styles['refreshing-icon'] : undefined} size={12} />
          <span style={{ paddingLeft: '2px' }}>{loading ? '刷新中' : '刷新'}</span>
        </button>
        <MarketPhasePill
          active={isTradingTime}
          ariaLabel={
            isTradingTime
              ? autoRefresh && mode === 'realtime'
                ? '关闭实时监控'
                : '开启实时监控'
              : '非交易时段不可开启实时监控'
          }
          disabled={!isTradingTime}
          label={autoRefresh && mode === 'realtime' ? '监控中' : '监控'}
          onClick={() => {
            if (!isTradingTime) return;
            if (mode !== 'realtime') {
              handleRealtimeClick();
              return;
            }
            setAutoRefresh((value) => !value);
          }}
          onPhaseChange={(phase) => setTradingTime(phase.isTrading)}
        />
      </div>

      <div className={styles['ai-monitor-search-row']}>
        <label className={styles['rp-search-row']}>
          <Search aria-hidden='true' size={14} />
          <input
            aria-label='搜索 AI 监控事件'
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCurrentPage(1);
            }}
            placeholder='搜索代码 / 名称 / 事件'
          />
        </label>
      </div>

      <div className={styles['ai-monitor-panel-tabs']}>
        <button
          className={classNames(styles['monitor-tab'], activeTab === 'all' && styles.active)}
          onClick={() => {
            setActiveTab('all');
            setCurrentPage(1);
            setAiMonitorState({ activeTab: 'all', currentPage: 1, selectedDate, mode });
            setLoading(true);
            void loadFeed(mode, selectedDate, 1, 'all');
          }}
          type='button'
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
              onClick={() => {
                setActiveTab(cat);
                setCurrentPage(1);
                setAiMonitorState({ activeTab: cat, currentPage: 1, selectedDate, mode });
                setLoading(true);
                void loadFeed(mode, selectedDate, 1, cat);
              }}
              type='button'
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
          <AiMonitorSkeletonList />
        ) : error ? (
          <div className={styles['empty-block']}>{error}</div>
        ) : filteredEvents.length === 0 ? (
          <div className={styles['empty-block']}>{emptyText}</div>
        ) : (
          pageEvents.map((event) => {
            const cfg = CATEGORY_CONFIG[event.category];
            const Icon = cfg.Icon;
            return (
              <div key={event.id} className={styles['monitor-card']} style={cardAccentStyle(cfg.color)}>
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
                      {event.badge ? <span className={styles['monitor-card-badge']}>{event.badge}</span> : null}
                      <button
                        className={classNames(styles['monitor-star-btn'], event.star && styles.active)}
                        onClick={() => toggleStar(event.id)}
                        type='button'
                        aria-label={event.star ? '取消收藏' : '收藏'}
                      >
                        <Star size={13} strokeWidth={2} fill={event.star ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                  </div>

                  {/* 股票行 */}
                  <div className={styles['monitor-card-stock']}>
                    <button
                      className={styles['monitor-stock-btn']}
                      onClick={() => handleStockClick(event.code, event.name)}
                      type='button'
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
                    {event.chart ? <SparkLine data={event.chart.data} color={cfg.color} /> : <span />}
                    <button
                      className={styles['monitor-action-btn']}
                      onClick={() => handleStockClick(event.code, event.name)}
                      type='button'
                    >
                      查看
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {filteredEvents.length > 0 && displayTotalPages > 1 ? (
        <div className={styles['monitor-pagination']}>
          <button
            className={styles['monitor-page-btn']}
            type='button'
            disabled={currentPage <= 1}
            onClick={() => goPage(currentPage - 1)}
          >
            ← 上一页
          </button>
          <div className={styles['monitor-page-info']}>
            <span className={styles['monitor-page-current']}>{currentPage}</span>
            <span className={styles['monitor-page-sep']}>/</span>
            <span className={styles['monitor-page-total']}>{displayTotalPages}</span>
          </div>
          <button
            className={styles['monitor-page-btn']}
            type='button'
            disabled={currentPage >= displayTotalPages}
            onClick={() => goPage(currentPage + 1)}
          >
            下一页 →
          </button>
        </div>
      ) : null}

      {lastUpdated ? (
        <div className={styles['monitor-footer']}>
          {mode === 'realtime' && isTradingTime
            ? `实时更新于 ${new Date(lastUpdated).toLocaleTimeString('zh-CN')}`
            : `历史数据更新于 ${new Date(lastUpdated).toLocaleTimeString('zh-CN')}`}
        </div>
      ) : null}
    </div>
  );
}

function makeMonitorDateOptions() {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - index);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
}
