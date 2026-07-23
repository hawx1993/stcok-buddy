import { useEffect, useMemo, useRef, useState } from 'react';
import { Filter } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { HotFocusItem, StockDetail } from '../../../shared/types';
import { Empty } from '../../empty';
import cx from '../../../shared/cx';
import styles from '../index.module.scss';

const SURGE_PAGE_SIZE = 20;
const SURGE_ROW_HEIGHT = 70;
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
  onOpenStock(stock: StockDetail): void;
  onClearReturnCode(): void;
}

export function StockSurgePanel({ isActive, returnCode, onOpenStock, onClearReturnCode }: IStockSurgePanelProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const loadIdRef = useRef(0);
  const [dateOptions] = useState(() => makeSurgeDateOptions());
  const [selectedDate, setSelectedDate] = useState(() => makeSurgeDateOptions()[0]);
  const [items, setItems] = useState<HotFocusItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [paging, setPaging] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [refreshMode, setRefreshMode] = useState<'manual' | 'poll'>('manual');
  const [isMonitoring, setMonitoring] = useState(() => isChinaMarketOpen());
  const [lastPollAt, setLastPollAt] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<SurgeFilter[]>(['全部']);

  const today = dateOptions[0];
  const filteredItems = useMemo(
    () => (filters.includes('全部') ? items : items.filter((item) => filters.includes(surgeReason(item) as SurgeFilter))),
    [filters, items],
  );
  const virtualizer = useVirtualizer({
    count: filteredItems.length + (hasMore && selectedDate !== today ? 1 : 0),
    getScrollElement: () => listRef.current,
    estimateSize: (index) => (index < filteredItems.length ? SURGE_ROW_HEIGHT : 36),
    overscan: 6,
  });



  useEffect(() => {
    if (!isActive) {
      loadIdRef.current += 1;
      setLoading(false);
      setPaging(false);
      return;
    }
    let alive = true;
    const loadId = ++loadIdRef.current;
    setItems([]);
    setError(undefined);
    setHasMore(true);
    setLoading(true);
    const load = selectedDate === today
      ? getStocksenseApi().listHotFocus('surge').then((rows) => rows.slice(0, SURGE_PAGE_SIZE))
      : getStocksenseApi().listSurgeHistory(selectedDate, 0, SURGE_PAGE_SIZE);
    load
      .then((rows) => {
        if (!alive || loadId !== loadIdRef.current) return;
        if (refreshMode === 'poll') setLastPollAt(Date.now());
        setItems(rows);
        setHasMore(rows.length === SURGE_PAGE_SIZE);
      })
      .catch((error: unknown) => {
        if (!alive || loadId !== loadIdRef.current) return;
        console.error(error);
        setError(error instanceof Error ? error.message : '异动数据加载失败，请稍后再试');
      })
      .finally(() => {
        if (alive && loadId === loadIdRef.current) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [isActive, refresh, refreshMode, selectedDate, today]);

  useEffect(() => {
    if (!isActive || selectedDate !== today) return;
    const checkMarket = () => {
      if (!isChinaMarketOpen()) setMonitoring(false);
    };
    checkMarket();
    const id = window.setInterval(checkMarket, 60_000);
    return () => window.clearInterval(id);
  }, [isActive, selectedDate, today]);

  useEffect(() => {
    if (!isActive || selectedDate !== today || !isMonitoring) return;
    const poll = () => {
      setRefreshMode('poll');
      setRefresh((value) => value + 1);
    };
    const id = window.setInterval(poll, 30_000);
    return () => window.clearInterval(id);
  }, [isActive, isMonitoring, selectedDate, today]);

  useEffect(() => {
    if (!returnCode || !isActive) return;
    const frame = window.requestAnimationFrame(() => {
      const index = filteredItems.findIndex((item) => item.code === returnCode);
      if (index >= 0) virtualizer.scrollToIndex(index, { align: 'center' });
      onClearReturnCode();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [filteredItems, isActive, onClearReturnCode, returnCode, virtualizer]);

  useEffect(() => {
    const virtualItems = virtualizer.getVirtualItems();
    const last = virtualItems[virtualItems.length - 1];
    if (!isActive || !last || last.index < filteredItems.length || paging || loading || !hasMore || selectedDate === today) return;
    let alive = true;
    setPaging(true);
    getStocksenseApi()
      .listSurgeHistory(selectedDate, items.length, SURGE_PAGE_SIZE)
      .then((rows) => {
        if (!alive) return;
        setItems((current) => [...current, ...rows]);
        setHasMore(rows.length === SURGE_PAGE_SIZE);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        console.error(error);
        setError(error instanceof Error ? error.message : '加载更多异动数据失败，请稍后再试');
      })
      .finally(() => {
        if (alive) setPaging(false);
      });
    return () => {
      alive = false;
    };
  }, [filteredItems.length, hasMore, isActive, items.length, loading, paging, selectedDate, today, virtualizer]);

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
    onOpenStock({
      code: item.code,
      name: item.name ?? item.title,
      price: item.price,
      changePercent: item.changePercent,
      turnover: item.turnover ?? item.amount,
      summary: item.description,
    });
  };

  const toggleMonitor = () => {
    if (isMonitoring) return setMonitoring(false);
    if (!isChinaMarketOpen()) return;
    setMonitoring(true);
  };
  const isPollFresh = isMonitoring && lastPollAt > 0;

  return (
    <>
      <div className={styles['right-panel-header']}>
        <div className={styles['surge-title-row']}>
          <span className={styles.title}>⚡ 个股异动</span>
          <button className={styles['surge-filter-label']} onClick={() => setFiltersOpen((open) => !open)} type='button'>
            筛选 <span className={styles['surge-filter-icon']}><Filter size={14} />{filters.includes('全部') ? null : <span className={styles['surge-filter-badge']}>{filters.length}</span>}</span>
          </button>
        </div>
        {filtersOpen ? <div className={styles['surge-filters']}>{surgeFilters.map((filter) => <button key={filter} className={cx(styles['surge-filter'], filters.includes(filter) && styles.active)} onClick={() => toggleFilter(filter)} type='button'>{filter}</button>)}</div> : null}
        <div className={styles['surge-date-row']}>
          <select className={styles['surge-date-select']} value={selectedDate} onChange={(event) => { setRefreshMode('manual'); setFilters(['全部']); setSelectedDate(event.target.value); }} aria-label='筛选异动日期'>
            {dateOptions.map((date, index) => <option key={date} value={date}>{index === 0 ? `今天 ${date.slice(5)}` : date}</option>)}
          </select>
          {selectedDate === today ? <><button className={styles['surge-date-button']} onClick={() => { setRefreshMode('manual'); setRefresh((value) => value + 1); }} type='button'>刷新</button><button className={cx(styles['surge-monitor-button'], isPollFresh && styles.active)} onClick={toggleMonitor} title={isMonitoring ? '关闭监控' : '开启监控'} aria-label={isMonitoring ? '关闭监控' : '开启监控'} type='button'><span /></button></> : null}
        </div>
      </div>
      <div className={styles['right-panel-body']} ref={listRef}>
        {loading && !items.length ? <SurgeSkeleton /> : error ? <div className={styles['empty-list']}>{error}</div> : filteredItems.length ? <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((row) => {
            const item = filteredItems[row.index];
            return <div key={item?.id ?? 'load-more'} data-index={row.index} ref={virtualizer.measureElement} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${row.start}px)` }}>
              {item ? <SurgeItem item={item} onClick={() => openStock(item)} /> : <div className={styles['surge-load-state']}>{paging ? <span className={styles.spinner} /> : '向下滚动加载更多'}</div>}
            </div>;
          })}
        </div> : <Empty text='暂无异动个股' />}
      </div>
    </>
  );
}

function SurgeItem({ item, onClick }: { item: HotFocusItem; onClick(): void }) {
  const isDown = String(item.changePercent).startsWith('-');
  return <button className={styles['surge-item']} data-surge-code={item.code} onClick={onClick} type='button'>
    <span className={styles['surge-time']}>{item.time ?? '--'}</span><span className={styles['surge-card']}><span className={styles['surge-main']}><b>{item.name ?? item.title}<em>{item.code}</em></b><small>当前 <span>{item.price ?? '--'}</span><span className={isDown ? 'down' : 'up'}>{item.changePercent ?? '--'}</span></small></span><span className={styles['surge-action']}><span>{surgeReason(item)}</span>{hasSurgeAmount(item.amount) ? <small>{item.amount}</small> : null}</span></span>
  </button>;
}

function SurgeSkeleton() { return <div className={styles['surge-skeleton']}>{Array.from({ length: 12 }, (_, index) => <div className={styles['surge-skeleton-item']} key={index}><span className={styles['surge-skeleton-time']} /><span className={styles['surge-skeleton-card']}><span className={styles['surge-skeleton-main']}><span className={styles['sk-name']} /><span className={styles['sk-price']} /></span><span className={styles['surge-skeleton-action']}><span className={styles['sk-tag']} /><span className={styles['sk-amount']} /></span></span></div>)}</div>; }
function isChinaMarketOpen(date = new Date()) { const day = date.getDay(); if (day === 0 || day === 6) return false; const minutes = date.getHours() * 60 + date.getMinutes(); return (minutes >= 565 && minutes <= 690) || (minutes >= 780 && minutes <= 900); }
function makeSurgeDateOptions() { return Array.from({ length: 7 }, (_, index) => { const date = new Date(); date.setDate(date.getDate() - index); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }); }
function surgeReason(item: HotFocusItem) { const reason = item.tag ?? item.description?.split(' · ')[0] ?? '--'; return ({ 涨停池: '封涨停板', 炸板池: '涨停开板', 跌停池: '封跌停板' } as Record<string, string>)[reason] ?? reason; }
function hasSurgeAmount(amount?: string) { return Boolean(amount && !/^(?:封单|成交额)?[+-]?0(?:\.00)?(?:手|万|亿)?$/.test(amount)); }
