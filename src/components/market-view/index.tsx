import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ILoadOlderKlineInput } from '../kline-chart';
import { IndexCard } from './components/index-card';
import { IndexKlineModal } from './components/index-kline-modal';
import { StockTable } from './components/stock-table';
import { formatMarketCap, formatMoney, formatPercent, formatVolume, parsePercent } from './market-format';
import { applyMarketRowUpdateBatch, sameMarketRows } from './market-row-updates';
import { getStocksenseApi } from '../../shared/stocksense-api';
import type {
  BoardDetail,
  MarketBoardRow,
  MarketIndexPeriod,
  MarketIndexSnapshot,
  MarketPageSnapshot,
  MarketQuoteRow,
  MarketSearchResult,
  MarketTab,
  StockDetail,
} from '../../shared/types';
import { useAppStore } from '../../store/app-store';
import cx from '../../shared/cx';
import styles from './index.module.scss';

const MARKET_UPDATE_INTERVAL_MS = 520;
const MARKET_SCROLL_IDLE_MS = 200;

const tabs: Array<{ id: MarketTab; label: string }> = [
  { id: 'sh-main', label: '上海主板' },
  { id: 'sz-main', label: '深证主板' },
  { id: 'bj', label: '北交所' },
  { id: 'gem', label: '创业板' },
  { id: 'star', label: '科创板' },
];

const periods: Array<{ id: MarketIndexPeriod; label: string }> = [
  { id: '15m', label: '15分钟' },
  { id: '1h', label: '1小时' },
  { id: '1d', label: '天' },
  { id: '1w', label: '周' },
  { id: '1mo', label: '月' },
];

type SortDirection = 'asc' | 'desc' | undefined;

export function MarketView() {
  const [activeTab, setActiveTab] = useState<MarketTab>('sh-main');
  const [indexPeriod, setIndexPeriod] = useState<MarketIndexPeriod>('1d');
  const [indices, setIndices] = useState<MarketIndexSnapshot[]>([]);
  const [rowsByTab, setRowsByTab] = useState<Partial<Record<MarketTab, MarketQuoteRow[]>>>({});
  const rowsByTabRef = useRef<Partial<Record<MarketTab, MarketQuoteRow[]>>>({});
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [suggestions, setSuggestions] = useState<MarketSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [sortDirection, setSortDirection] = useState<SortDirection>();
  const [expandedIndexCode, setExpandedIndexCode] = useState<string>();
  const refreshTimer = useRef<number>();
  const scrollIdleRefreshTimer = useRef<number>();
  const updateTimer = useRef<number>();
  const isScrollingRef = useRef(false);
  const pendingRowsByTabRef = useRef<Partial<Record<MarketTab, { rows: MarketQuoteRow[]; allowReorder: boolean }>>>({});
  const activeTabRef = useRef(activeTab);
  const refreshActiveTabRef = useRef<() => void>(() => undefined);
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const [updateVersion, setUpdateVersion] = useState(0);
  const [changedCodes, setChangedCodes] = useState<string[]>([]);
  const [movedCodes, setMovedCodes] = useState<string[]>([]);
  const setSelectedStock = useAppStore((state) => state.setSelectedStock);
  const setSelectedBoard = useAppStore((state) => state.setSelectedBoard);
  const selectedBoard = useAppStore((state) => state.selectedBoard);
  const openRightPanel = useAppStore((state) => state.openRightPanel);
  const openBoardPanel = useAppStore((state) => state.openBoardPanel);

  useEffect(() => {
    rowsByTabRef.current = rowsByTab;
  }, [rowsByTab]);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  const schedulePendingRowUpdate = useCallback((delay = 0) => {
    window.clearTimeout(updateTimer.current);
    if (isScrollingRef.current) return;
    updateTimer.current = window.setTimeout(() => {
      if (isScrollingRef.current) return;
      const activeTab = activeTabRef.current;
      const pending = pendingRowsByTabRef.current[activeTab];
      if (!pending) return;
      const currentRows = rowsByTabRef.current[activeTab] ?? [];
      const batch = applyMarketRowUpdateBatch(currentRows, pending.rows, undefined, pending.allowReorder);
      if (!batch.changedCodes.length) {
        delete pendingRowsByTabRef.current[activeTab];
        return;
      }
      const nextRowsByTab = { ...rowsByTabRef.current, [activeTab]: batch.rows };
      rowsByTabRef.current = nextRowsByTab;
      setRowsByTab(nextRowsByTab);
      setChangedCodes(batch.changedCodes);
      setMovedCodes(batch.movedCodes);
      setUpdateVersion((version) => version + 1);
      if (batch.pending) schedulePendingRowUpdate(MARKET_UPDATE_INTERVAL_MS);
      else delete pendingRowsByTabRef.current[activeTab];
    }, delay);
  }, []);

  const queueSnapshotRows = useCallback(
    (data: MarketPageSnapshot) => {
      const currentRows = rowsByTabRef.current[data.tab] ?? [];
      if (!currentRows.length) {
        const nextRowsByTab = { ...rowsByTabRef.current, [data.tab]: data.rows };
        rowsByTabRef.current = nextRowsByTab;
        setRowsByTab(nextRowsByTab);
        return;
      }
      if (sameMarketRows(currentRows, data.rows)) return;
      pendingRowsByTabRef.current[data.tab] = { rows: data.rows, allowReorder: data.rowOrderSource === 'remote' };
      if (data.tab === activeTabRef.current) schedulePendingRowUpdate();
    },
    [schedulePendingRowUpdate],
  );

  useEffect(() => {
    let alive = true;
    const api = getStocksenseApi();
    const hasContent = (data: MarketPageSnapshot) => data.rows.length > 0;
    const applySnapshot = (data: MarketPageSnapshot, done = true) => {
      if (!alive) return;
      if (data.indices.length) setIndices((current) => mergeMarketIndexSnapshots(current, data.indices));
      queueSnapshotRows(data);
      if (data.tab === activeTab) {
        setUpdatedAt(data.updatedAt);
        if (done || hasContent(data)) setLoading(false);
      }
    };
    setLoading(!rowsByTabRef.current[activeTab]?.length);
    const loadTab = (tab: MarketTab, done = tab === activeTab) =>
      api
        .getMarketPageSnapshot(tab, indexPeriod)
        .then((data) => applySnapshot(data, done))
        .catch(console.error);
    refreshActiveTabRef.current = () => {
      if (alive) void loadTab(activeTab);
    };
    refreshActiveTabRef.current();
    for (const tab of tabs) {
      if (tab.id !== activeTab && !rowsByTabRef.current[tab.id]?.length) void loadTab(tab.id, false);
    }
    const unsubscribe = api.onMarketPageSnapshotUpdated?.((data) => {
      if (!alive || (data.period ?? '1d') !== indexPeriod) return;
      if (data.indices.length) setIndices((current) => mergeMarketIndexSnapshots(current, data.indices));
      queueSnapshotRows(data);
      if (data.tab === activeTab) {
        setUpdatedAt(data.updatedAt);
        setLoading(false);
      }
    });
    window.clearInterval(refreshTimer.current);
    refreshTimer.current = window.setInterval(() => {
      if (alive && isChinaMarketOpen()) refreshActiveTabRef.current();
    }, 15_000);
    return () => {
      alive = false;
      unsubscribe?.();
      window.clearInterval(refreshTimer.current);
      window.clearTimeout(scrollIdleRefreshTimer.current);
      window.clearTimeout(updateTimer.current);
    };
  }, [activeTab, indexPeriod, queueSnapshotRows]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchText.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    let alive = true;
    if (!debouncedSearch) {
      setSuggestions([]);
      setSearching(false);
      return () => {
        alive = false;
      };
    }
    setSearching(true);
    getStocksenseApi()
      .searchStocks(debouncedSearch)
      .then((items) => {
        if (alive) setSuggestions(items);
      })
      .catch(() => {
        if (alive) setSuggestions([]);
      })
      .finally(() => {
        if (alive) setSearching(false);
      });
    return () => {
      alive = false;
    };
  }, [debouncedSearch]);

  const visibleRows = rowsByTab[activeTab] ?? [];
  const expandedIndex = indices.find((item) => item.code === expandedIndexCode);
  const selectIndexPeriod = (period: MarketIndexPeriod) => {
    setIndexPeriod(period);
    setLoading(true);
  };
  const loadOlderIndexKline = useCallback(
    async ({ timeframe, limit, beforeTimestamp }: ILoadOlderKlineInput) => {
      const symbol = toMarketIndexSymbol(expandedIndexCode);
      if (!symbol || timeframe !== indexPeriod) return [];
      return getStocksenseApi().getKline(symbol, limit, timeframe, beforeTimestamp);
    },
    [expandedIndexCode, indexPeriod],
  );
  const sortedRows = useMemo(
    () =>
      sortDirection
        ? [...visibleRows].sort(
            (a, b) =>
              (parsePercent(a.changePercent) - parsePercent(b.changePercent)) * (sortDirection === 'asc' ? 1 : -1) ||
              String(a.code).localeCompare(String(b.code)),
          )
        : visibleRows,
    [sortDirection, visibleRows],
  );

  const handleTableScroll = () => {
    isScrollingRef.current = true;
    window.clearTimeout(updateTimer.current);
    window.clearTimeout(scrollIdleRefreshTimer.current);
    scrollIdleRefreshTimer.current = window.setTimeout(() => {
      isScrollingRef.current = false;
      schedulePendingRowUpdate();
    }, MARKET_SCROLL_IDLE_MS);
  };

  const changeTab = (tab: MarketTab) => {
    window.clearTimeout(updateTimer.current);
    setActiveTab(tab);
    activeTabRef.current = tab;
    setChangedCodes([]);
    setMovedCodes([]);
    tableWrapRef.current?.scrollTo({ top: 0 });
    schedulePendingRowUpdate();
  };

  const openStock = useCallback(
    async (row: MarketQuoteRow) => {
      const rowSnapshot: StockDetail = {
        code: row.code,
        name: row.name,
        price: row.price,
        changePercent: formatPercent(row.changePercent),
        open: row.open,
        high: row.high,
        low: row.low,
        prevClose: row.prevClose,
        volume: formatVolume(row.volume),
        turnover: formatMoney(row.amount),
        turnoverRate: formatPercent(row.turnoverRate),
        marketCap: formatMarketCap(row.marketCap),
        industry: row.industry,
      };
      openRightPanel();
      setSelectedStock(rowSnapshot);
      try {
        const detail = await getStocksenseApi().getStockDetail(row.code);
        setSelectedStock({
          ...rowSnapshot,
          ...detail,
          name: detail.name === detail.code ? rowSnapshot.name : detail.name,
        });
      } catch {
        setSelectedStock(rowSnapshot);
      }
    },
    [openRightPanel, setSelectedStock],
  );

  const openBoard = useCallback(
    async (row: MarketBoardRow) => {
      const rowSnapshot: BoardDetail = {
        code: row.code,
        name: row.name,
        changePercent: formatPercent(row.changePercent),
        kline: row.minutes ?? [],
        constituents: row.constituents ?? [],
      };
      openBoardPanel();
      if (selectedBoard?.code !== row.code) setSelectedBoard(rowSnapshot);
      try {
        const detail = await getStocksenseApi().getBoardDetail(row.code, false, row.name);
        if (useAppStore.getState().selectedBoard?.code !== row.code) return;
        setSelectedBoard({
          ...detail,
          name: detail.name === detail.code ? row.name : detail.name,
          changePercent: detail.changePercent ?? rowSnapshot.changePercent,
        });
      } catch {
        if (useAppStore.getState().selectedBoard?.code !== row.code) return;
        setSelectedBoard(rowSnapshot);
      }
    },
    [openBoardPanel, selectedBoard?.code, setSelectedBoard],
  );

  const openSearchResult = (row: MarketSearchResult) => {
    setSearchText('');
    setDebouncedSearch('');
    setSuggestions([]);
    if (row.kind === 'board') void openBoard(row);
    else void openStock(row);
  };

  return (
    <section className={styles.wrap}>
      <div className={styles.header}>
        <div>
          <h1>行情</h1>
          <p>
            全市场快照 · {updatedAt ? new Date(updatedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '加载中'}
          </p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.searchBox}>
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setSuggestions([]);
              }}
              placeholder='搜索代码 / 股票名称 / 板块'
            />
            {searchText ? (
              <div className={styles.suggestions}>
                {searching ? (
                  <div className={styles.suggestionEmpty}>搜索中…</div>
                ) : suggestions.length ? (
                  suggestions.map((row) => (
                    <button
                      key={`${row.kind ?? 'stock'}-${row.code}`}
                      className={styles.suggestionItem}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        openSearchResult(row);
                      }}
                      type='button'
                    >
                      <span>
                        {row.name}
                        <em>{row.kind === 'board' ? '板块' : '股票'}</em>
                      </span>
                      <code>{row.code}</code>
                    </button>
                  ))
                ) : debouncedSearch ? (
                  <div className={styles.suggestionEmpty}>无匹配结果</div>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className={styles.periods}>
            {periods.map((period) => (
              <button
                key={period.id}
                className={cx(indexPeriod === period.id && styles.periodActive)}
                onClick={() => selectIndexPeriod(period.id)}
                type='button'
              >
                {period.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className={styles.indices}>
        {(indices.length ? indices : [undefined, undefined]).map((item, index) =>
          item ? (
            <IndexCard key={item.code} item={item} onExpand={(index) => setExpandedIndexCode(index.code)} />
          ) : (
            <div key={index} className={styles.indexCard}>
              <div className={styles.noChart}>指数刷新中…</div>
            </div>
          ),
        )}
      </div>
      <div className={styles.tabs}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={cx(activeTab === tab.id && styles.active)}
            onClick={() => changeTab(tab.id)}
            type='button'
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div ref={tableWrapRef} className={styles.tableWrap} onScroll={handleTableScroll}>
        <StockTable
          rows={sortedRows}
          scrollRef={tableWrapRef}
          sortDirection={sortDirection}
          updateVersion={updateVersion}
          changedCodes={changedCodes}
          movedCodes={movedCodes}
          onSortChange={() => {
            window.clearTimeout(updateTimer.current);
            setChangedCodes([]);
            setMovedCodes([]);
            setSortDirection((direction) =>
              direction === undefined ? 'desc' : direction === 'desc' ? 'asc' : undefined,
            );
            tableWrapRef.current?.scrollTo({ top: 0 });
          }}
          onOpen={openStock}
        />
        {sortedRows.length ? <div className={styles.loadState}>共 {sortedRows.length} 只</div> : null}
      </div>
      {expandedIndex ? (
        <IndexKlineModal
          index={expandedIndex}
          period={indexPeriod}
          loadOlderKline={loadOlderIndexKline}
          onPeriodChange={selectIndexPeriod}
          onClose={() => setExpandedIndexCode(undefined)}
        />
      ) : null}
    </section>
  );
}

function mergeMarketIndexSnapshots(current: MarketIndexSnapshot[], next: MarketIndexSnapshot[]) {
  if (!current.length) return next;
  let changed = current.length !== next.length;
  const currentByCode = new Map(current.map((item) => [item.code, item]));
  const merged = next.map((item) => {
    const previous = currentByCode.get(item.code);
    if (previous?.minutes.length && !item.minutes.length) {
      changed = true;
      return previous;
    }
    if (previous !== item) changed = true;
    return item;
  });
  return changed ? merged : current;
}

function toMarketIndexSymbol(code: string | undefined) {
  if (code === '000001') return 'sh000001';
  if (code === '399001') return 'sz399001';
  return undefined;
}

function isChinaMarketOpen(date = new Date()) {
  const day = date.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = date.getHours() * 60 + date.getMinutes();
  return (minutes >= 9 * 60 + 25 && minutes <= 11 * 60 + 30) || (minutes >= 13 * 60 && minutes <= 15 * 60);
}
