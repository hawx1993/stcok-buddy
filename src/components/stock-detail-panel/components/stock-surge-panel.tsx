import { ConfigProvider, Select } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Filter } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { HotFocusItem, StockDetail } from '../../../shared/types';
import { isChinaMarketOpen } from '../../../shared/market-time';
import { Empty } from '../../empty';
import { MarketPhasePill } from '../../market-phase-pill';
import cx from '../../../shared/cx';
import styles from '../index.module.scss';
import { findSurgeReturnIndex } from './stock-surge-navigation';

const SURGE_PAGE_SIZE = 100;
const SURGE_ROW_HEIGHT = 70;
const SURGE_HIGHLIGHT_DURATION_MS = 1_150;
const surgeFilters = [
  '全部',
  '60日新高',
  '60日新低',
  '快速涨幅',
  '快速跌幅',
  '封跌停板',
  '封涨停板',
  '跌停开板',
  '涨停开板',
  '特大单买入',
  '特大单卖出',
] as const;
type SurgeFilter = (typeof surgeFilters)[number];

interface IStockSurgePanelProps {
  isActive: boolean;
  returnCode?: string;
  returnId?: string;
  onOpenStock(stock: StockDetail, surgeId?: string): void;
  onClearReturnCode(): void;
}

interface ISurgePanelCache {
  filters: SurgeFilter[];
  hasMore: boolean;
  items: HotFocusItem[];
  loadedDate?: string;
  selectedDate: string;
}

let surgePanelCache: ISurgePanelCache | undefined;

export function StockSurgePanel({ isActive, returnCode, returnId, onOpenStock, onClearReturnCode }: IStockSurgePanelProps) {
  const [dateOptions] = useState(() => makeSurgeDateOptions());
  const cachedSelectedDate = surgePanelCache?.selectedDate;
  const initialSelectedDate = cachedSelectedDate && dateOptions.includes(cachedSelectedDate) ? cachedSelectedDate : dateOptions[0];
  const cacheForDate =
    surgePanelCache?.selectedDate === initialSelectedDate && surgePanelCache.loadedDate === initialSelectedDate
      ? surgePanelCache
      : undefined;
  const cachedItems = cacheForDate?.items ?? [];
  const listRef = useRef<HTMLDivElement>(null);
  const loadIdRef = useRef(0);
  const pagingRef = useRef(false);
  const highlightTimerRef = useRef<number>();
  const reuseCacheRef = useRef(Boolean(cacheForDate));
  const loadPendingRef = useRef(false);
  const pagingRequestIdRef = useRef(0);
  const itemsRef = useRef<HotFocusItem[]>(cachedItems);
  const loadedDateRef = useRef<string | undefined>(cacheForDate?.loadedDate);
  const [selectedDate, setSelectedDate] = useState(initialSelectedDate);
  const [items, setItems] = useState<HotFocusItem[]>(cachedItems);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [paging, setPaging] = useState(false);
  const [hasMore, setHasMore] = useState(() => cacheForDate?.hasMore ?? true);
  const [highlightTarget, setHighlightTarget] = useState<{ id?: string; code: string }>();
  const [refresh, setRefresh] = useState(0);
  const [refreshMode, setRefreshMode] = useState<'manual' | 'poll'>('manual');
  const [isMonitoring, setMonitoring] = useState(() => isChinaMarketOpen());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<SurgeFilter[]>(() => cacheForDate?.filters ?? ['全部']);

  const today = dateOptions[0];
  const filteredItems = useMemo(
    () =>
      filters.includes('全部') ? items : items.filter((item) => filters.includes(surgeReason(item) as SurgeFilter)),
    [filters, items],
  );
  const isFiltered = !filters.includes('全部');
  // Today is captured continuously in the background (DuckDB), so the same
  // pagination rules as historical dates apply: the user can scroll back
  // through the whole session's surge history instead of only the newest page.
  const hasLoadMoreRow = hasMore;
  const shouldRenderList = filteredItems.length > 0 || hasLoadMoreRow;
  const virtualizer = useVirtualizer({
    count: filteredItems.length + (hasLoadMoreRow ? 1 : 0),
    getScrollElement: () => listRef.current,
    estimateSize: (index) => (index < filteredItems.length ? SURGE_ROW_HEIGHT : 36),
    overscan: 6,
  });

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => () => window.clearTimeout(highlightTimerRef.current), []);

  useEffect(() => {
    surgePanelCache = { filters, hasMore, items, loadedDate: loadedDateRef.current, selectedDate };
  }, [filters, hasMore, items, selectedDate]);

  useEffect(() => {
    if (!isActive) {
      loadIdRef.current += 1;
      pagingRequestIdRef.current += 1;
      loadPendingRef.current = false;
      pagingRef.current = false;
      setLoading(false);
      setPaging(false);
      return;
    }
    let alive = true;
    const loadId = ++loadIdRef.current;
    if (reuseCacheRef.current && loadedDateRef.current === selectedDate) {
      reuseCacheRef.current = false;
      loadPendingRef.current = false;
      setLoading(false);
      // Show the cached list immediately, but refresh in the background so a
      // reopened panel is not stuck on stale rows until the next 30s poll.
      setRefresh((value) => value + 1);
      return () => {
        alive = false;
      };
    }
    reuseCacheRef.current = false;
    const shouldKeepItems = loadedDateRef.current === selectedDate && itemsRef.current.length > 0;
    if (!shouldKeepItems) {
      itemsRef.current = [];
      setItems([]);
    }
    setError(undefined);
    setHasMore(true);
    pagingRequestIdRef.current += 1;
    setPaging(false);
    pagingRef.current = false;
    loadPendingRef.current = true;
    setLoading(true);
    const load = getStocksenseApi().listSurgeHistory(selectedDate, 0, SURGE_PAGE_SIZE);
    load
      .then((rows) => {
        if (!alive || loadId !== loadIdRef.current) return;
        loadedDateRef.current = selectedDate;
        // When the panel already holds loaded history (e.g. a 30s poll while
        // the user scrolled back through today's events), merge the fresh
        // first page in instead of replacing the list — otherwise every poll
        // would collapse the view back to the newest page and the earlier
        // captured events would look "gone" again.
        const next = shouldKeepItems ? mergeSurgeItems(rows, itemsRef.current) : rows;
        itemsRef.current = next;
        setItems(next);
        setHasMore(rows.length === SURGE_PAGE_SIZE);
      })
      .catch((error: unknown) => {
        if (!alive || loadId !== loadIdRef.current) return;
        console.error(error);
        setError(error instanceof Error ? error.message : '异动数据加载失败，请稍后再试');
      })
      .finally(() => {
        if (alive && loadId === loadIdRef.current) {
          loadPendingRef.current = false;
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [isActive, refresh, refreshMode, selectedDate, today]);

  useEffect(() => {
    if (!isActive || selectedDate !== today || !isMonitoring) return;
    const poll = () => {
      setRefreshMode('poll');
      setRefresh((value) => value + 1);
    };
    const id = window.setInterval(poll, 30_000);
    return () => window.clearInterval(id);
  }, [isActive, isMonitoring, selectedDate, today]);

  // ponytail: when the user clears surge history from the storage manager,
  // drop the in-memory list before reloading so stale rows do not linger.
  useEffect(() => {
    const onCleared = () => {
      surgePanelCache = undefined;
      loadIdRef.current += 1;
      pagingRequestIdRef.current += 1;
      pagingRef.current = false;
      itemsRef.current = [];
      loadedDateRef.current = undefined;
      setItems([]);
      setPaging(false);
      setError(undefined);
      setRefreshMode('manual');
      setRefresh((value) => value + 1);
    };
    window.addEventListener('surge:historyCleared', onCleared);
    return () => window.removeEventListener('surge:historyCleared', onCleared);
  }, []);

  useEffect(() => {
    if (!returnCode || !isActive || loadPendingRef.current) return;
    let scrollFrame = 0;
    const measureFrame = window.requestAnimationFrame(() => {
      if (loadPendingRef.current) return;
      virtualizer.measure();
      scrollFrame = window.requestAnimationFrame(() => {
        if (loadPendingRef.current) return;
        const index = findSurgeReturnIndex(filteredItems, { id: returnId, code: returnCode });
        if (index < 0) return;
        virtualizer.scrollToIndex(index, { align: 'center' });
        setHighlightTarget({ id: returnId, code: returnCode });
        window.clearTimeout(highlightTimerRef.current);
        const highlightedId = returnId;
        const highlightedCode = returnCode;
        highlightTimerRef.current = window.setTimeout(() => {
          setHighlightTarget((current) =>
            current?.id === highlightedId && current?.code === highlightedCode ? undefined : current,
          );
        }, SURGE_HIGHLIGHT_DURATION_MS);
        onClearReturnCode();
      });
    });
    return () => {
      window.cancelAnimationFrame(measureFrame);
      window.cancelAnimationFrame(scrollFrame);
    };
  }, [filteredItems, isActive, loading, onClearReturnCode, returnCode, returnId, virtualizer]);

  const loadMore = useCallback(() => {
    if (!isActive || pagingRef.current || loading || !hasMore) return;
    const loadId = loadIdRef.current;
    const requestId = ++pagingRequestIdRef.current;
    const offset = itemsRef.current.length;
    pagingRef.current = true;
    setPaging(true);
    getStocksenseApi()
      .listSurgeHistory(selectedDate, offset, SURGE_PAGE_SIZE)
      .then((rows) => {
        if (loadId !== loadIdRef.current || requestId !== pagingRequestIdRef.current) return;
        if (!rows.length) {
          setHasMore(false);
          return;
        }
        setItems((current) => {
          const next = [...current, ...rows];
          itemsRef.current = next;
          return next;
        });
        setHasMore(rows.length === SURGE_PAGE_SIZE);
      })
      .catch((error: unknown) => {
        if (loadId !== loadIdRef.current || requestId !== pagingRequestIdRef.current) return;
        console.error(error);
        setError(error instanceof Error ? error.message : '加载更多异动数据失败，请稍后再试');
      })
      .finally(() => {
        if (requestId !== pagingRequestIdRef.current) return;
        pagingRef.current = false;
        setPaging(false);
      });
  }, [hasMore, isActive, loading, selectedDate]);

  useEffect(() => {
    if (isFiltered || !hasLoadMoreRow) return;
    const virtualItems = virtualizer.getVirtualItems();
    const last = virtualItems[virtualItems.length - 1];
    if (last?.index === filteredItems.length) loadMore();
  }, [filteredItems.length, hasLoadMoreRow, isFiltered, loadMore, virtualizer]);

  const toggleFilter = (filter: SurgeFilter) => {
    setFilters((current) => {
      if (filter === '全部') return ['全部'];
      const withoutAll = current.filter((item) => item !== '全部');
      const next = withoutAll.includes(filter) ? withoutAll.filter((item) => item !== filter) : [...withoutAll, filter];
      return next.length ? next : ['全部'];
    });
  };

  const openStock = (item: HotFocusItem) => {
    if (!item.code) return;
    onOpenStock(
      {
        code: item.code,
        name: item.name ?? item.title,
        price: item.price,
        changePercent: item.changePercent,
        turnover: item.turnover ?? item.amount,
        summary: item.description,
      },
      item.id,
    );
  };

  const toggleMonitor = () => {
    if (isMonitoring) return setMonitoring(false);
    if (!isChinaMarketOpen()) return;
    setMonitoring(true);
  };

  const getSurgeDateSelectPopupContainer = (trigger: HTMLElement) => trigger.parentElement ?? document.body;
  const surgeDateSelectClassNames = {
    popup: {
      root: styles['surge-date-select-popup'],
      listItem: styles['surge-date-select-option'],
    },
  };
  const surgeDateSelectTheme = {
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

  return (
    <>
      <div className={styles['right-panel-header']}>
        <div className={styles['surge-title-row']}>
          <span className={styles.title}>
            <Activity className={styles['panel-title-icon']} size={16} />
            个股异动
          </span>
          <button
            className={styles['surge-filter-label']}
            onClick={() => setFiltersOpen((open) => !open)}
            type='button'
          >
            筛选{' '}
            <span className={styles['surge-filter-icon']}>
              <Filter size={14} />
              {filters.includes('全部') ? null : <span className={styles['surge-filter-badge']}>{filters.length}</span>}
            </span>
          </button>
        </div>
        {filtersOpen ? (
          <div className={styles['surge-filters']}>
            {surgeFilters.map((filter) => (
              <button
                key={filter}
                className={cx(styles['surge-filter'], filters.includes(filter) && styles.active)}
                onClick={() => toggleFilter(filter)}
                type='button'
              >
                {filter}
              </button>
            ))}
          </div>
        ) : null}
        <div className={styles['surge-date-row']}>
          <ConfigProvider theme={surgeDateSelectTheme}>
            <Select
              aria-label='筛选异动日期'
              className={styles['surge-date-select']}
              classNames={surgeDateSelectClassNames}
              getPopupContainer={getSurgeDateSelectPopupContainer}
              value={selectedDate}
              options={dateOptions.map((date, index) => ({
                value: date,
                label: index === 0 ? `今天 ${date.slice(5)}` : date,
              }))}
              onChange={(date: string) => {
                setRefreshMode('manual');
                setFilters(['全部']);
                setSelectedDate(date);
              }}
            />
          </ConfigProvider>
          {selectedDate === today ? (
            <>
              <button
                className={styles['surge-date-button']}
                onClick={() => {
                  setRefreshMode('manual');
                  setRefresh((value) => value + 1);
                }}
                type='button'
              >
                刷新
              </button>
              <MarketPhasePill
                active={isMonitoring}
                ariaLabel={isMonitoring ? '关闭监控' : '开启监控'}
                label={isMonitoring ? '监控中' : '监控'}
                onClick={toggleMonitor}
                onPhaseChange={(phase) => setMonitoring((current) => (phase.isTrading ? current : false))}
              />
            </>
          ) : null}
        </div>
      </div>
      <div
        className={styles['right-panel-body']}
        ref={listRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          if (element.scrollTop + element.clientHeight >= element.scrollHeight - 24) loadMore();
        }}
      >
        {loading && !items.length ? (
          <SurgeSkeleton />
        ) : error ? (
          <div className={styles['empty-list']}>{error}</div>
        ) : shouldRenderList ? (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((row) => {
              const item = filteredItems[row.index];
              return (
                <div
                  key={item?.id ?? 'load-more'}
                  data-index={row.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${row.start}px)`,
                  }}
                >
                  {item ? (
                    <SurgeItem
                      item={item}
                      highlight={item.id === highlightTarget?.id || (!highlightTarget?.id && item.code === highlightTarget?.code)}
                      onClick={() => openStock(item)}
                    />
                  ) : (
                    <button
                      className={cx(styles['surge-load-state'], styles['surge-load-button'])}
                      disabled={paging}
                      onClick={loadMore}
                      type='button'
                    >
                      {paging ? <span className={styles.spinner} /> : isFiltered ? '加载更多' : '向下滚动加载更多'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <Empty text='暂无异动个股' />
        )}
      </div>
    </>
  );
}

function SurgeItem({ item, highlight, onClick }: { item: HotFocusItem; highlight: boolean; onClick(): void }) {
  const isDown = String(item.changePercent).startsWith('-');
  return (
    <button className={cx(styles['surge-item'], highlight && styles.highlight)} data-surge-code={item.code} onClick={onClick} type='button'>
      <span className={styles['surge-time']}>{item.time ?? '--'}</span>
      <span className={styles['surge-card']}>
        <span className={styles['surge-main']}>
          <b>
            {item.name ?? item.title}
            <em>{item.code}</em>
          </b>
          <small>
            当前 <span className={isDown ? 'down' : 'up'}>{item.price ?? '--'}</span>
            <span className={isDown ? 'down' : 'up'}>{item.changePercent ?? '--'}</span>
          </small>
        </span>
        <span className={styles['surge-action']}>
          <span>{surgeReason(item)}</span>
          {hasSurgeAmount(item.amount) ? <small>{item.amount}</small> : null}
        </span>
      </span>
    </button>
  );
}

function SurgeSkeleton() {
  return (
    <div className={styles['surge-skeleton']}>
      {Array.from({ length: 12 }, (_, index) => (
        <div className={styles['surge-skeleton-item']} key={index}>
          <span className={styles['surge-skeleton-time']} />
          <span className={styles['surge-skeleton-card']}>
            <span className={styles['surge-skeleton-main']}>
              <span className={styles['sk-name']} />
              <span className={styles['sk-price']} />
            </span>
            <span className={styles['surge-skeleton-action']}>
              <span className={styles['sk-tag']} />
              <span className={styles['sk-amount']} />
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
function makeSurgeDateOptions() {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - index);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
}

function mergeSurgeItems(incoming: HotFocusItem[], existing: HotFocusItem[]): HotFocusItem[] {
  const byId = new Map<string, HotFocusItem>();
  for (const item of incoming) byId.set(item.id, item);
  for (const item of existing) byId.set(item.id, item);
  // Keep the same ordering as the DuckDB query (time DESC, id DESC) so
  // pagination offsets stay consistent after a merge.
  return Array.from(byId.values()).sort(
    (a, b) => surgeTimeValue(b.time) - surgeTimeValue(a.time) || b.id.localeCompare(a.id),
  );
}

function surgeTimeValue(time?: string) {
  const [hour, minute, second = '0'] = String(time ?? '').split(':');
  return (Number(hour) || 0) * 3600 + (Number(minute) || 0) * 60 + (Number(second) || 0);
}

function surgeReason(item: HotFocusItem) {
  const reason = item.tag ?? item.description?.split(' · ')[0] ?? '--';
  return ({ 涨停池: '封涨停板', 炸板池: '涨停开板', 跌停池: '封跌停板' } as Record<string, string>)[reason] ?? reason;
}
function hasSurgeAmount(amount?: string) {
  return Boolean(amount && !/^(?:封单|成交额)?[+-]?0(?:\.00)?(?:手|万|亿)?$/.test(amount));
}
