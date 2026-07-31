import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IndexCard } from './components/index-card';
import { IndexKlineModal } from './components/index-kline-modal';
import { StockTable } from './components/stock-table';
import type { TMarketCellField, TSortDirection } from './components/stock-table';
import { formatMarketCap, formatMoney, formatPercent, formatVolume, parsePercent } from './market-format';
import { applyMarketRowValueUpdate, sameMarketRows } from './market-row-updates';
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

const MARKET_ORDER_CHECK_INTERVAL_MS = 60_000;
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

type SortDirection = TSortDirection;

type TAshareMarketPhase = { label: string; isTrading: boolean };

export function MarketView() {
  const [activeTab, setActiveTab] = useState<MarketTab>('sh-main');
  const [indexPeriod, setIndexPeriod] = useState<MarketIndexPeriod>('1d');
  const [marketPhase, setMarketPhase] = useState(() => getAshareMarketPhase(new Date()));
  const [indices, setIndices] = useState<MarketIndexSnapshot[]>([]);
  const [rowsByTab, setRowsByTab] = useState<Partial<Record<MarketTab, MarketQuoteRow[]>>>({});
  const rowsByTabRef = useRef<Partial<Record<MarketTab, MarketQuoteRow[]>>>({});
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [suggestions, setSuggestions] = useState<MarketSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [sortField, setSortField] = useState<TMarketCellField | undefined>('changePercent');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [expandedIndexCode, setExpandedIndexCode] = useState<string>();
  const refreshTimer = useRef<number>();
  const scrollIdleRefreshTimer = useRef<number>();
  const updateTimer = useRef<number>();
  const isScrollingRef = useRef(false);
  const pendingRowsByTabRef = useRef<Partial<Record<MarketTab, MarketQuoteRow[]>>>({});
  const activeTabRef = useRef(activeTab);
  const sortDirectionRef = useRef(sortDirection);
  const sortFieldRef = useRef(sortField);
  const refreshActiveTabRef = useRef<() => void>(() => undefined);
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const [updateVersion, setUpdateVersion] = useState(0);
  const [reorderingVersion, setReorderingVersion] = useState(0);
  const [changedCodes, setChangedCodes] = useState<string[]>([]);
  const setSelectedStock = useAppStore((state) => state.setSelectedStock);
  const setStockReturnContext = useAppStore((state) => state.setStockReturnContext);
  const setSelectedBoard = useAppStore((state) => state.setSelectedBoard);
  const selectedBoard = useAppStore((state) => state.selectedBoard);
  const openRightPanel = useAppStore((state) => state.openRightPanel);
  const openBoardPanel = useAppStore((state) => state.openBoardPanel);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setMarketPhase(getAshareMarketPhase(new Date()));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    rowsByTabRef.current = rowsByTab;
  }, [rowsByTab]);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    sortDirectionRef.current = sortDirection;
    sortFieldRef.current = sortField;
  }, [sortDirection, sortField]);

  const sortRowsByDirection = useCallback(
    (rows: MarketQuoteRow[], field: TMarketCellField | undefined, direction: SortDirection) => {
      if (!direction || !field) return rows;
      const getValue = (row: MarketQuoteRow): number => {
        switch (field) {
          case 'changePercent':
            return parsePercent(row.changePercent);
          case 'turnoverRate':
            return parsePercent(row.turnoverRate);
          case 'volume':
            return Number(row.volume) || 0;
          case 'amount':
            return Number(row.amount) || 0;
          case 'marketCap':
            return Number(row.marketCap) || 0;
          default:
            return 0;
        }
      };
      return [...rows].sort(
        (a, b) =>
          (getValue(a) - getValue(b)) * (direction === 'asc' ? 1 : -1) ||
          String(a.code).localeCompare(String(b.code)),
      );
    },
    [],
  );

  // 数值更新：一次性全量应用（保持当前显示顺序），所有变化单元格在同一帧同时闪烁高亮
  const runPendingUpdate = useCallback(() => {
    const activeTab = activeTabRef.current;
    const pendingRows = pendingRowsByTabRef.current[activeTab];
    if (!pendingRows) return;
    delete pendingRowsByTabRef.current[activeTab];
    const currentRows = rowsByTabRef.current[activeTab] ?? [];
    const { rows: nextRows, changedCodes } = applyMarketRowValueUpdate(currentRows, pendingRows);
    if (!changedCodes.length) return;
    const nextRowsByTab = { ...rowsByTabRef.current, [activeTab]: nextRows };
    rowsByTabRef.current = nextRowsByTab;
    setRowsByTab(nextRowsByTab);
    setChangedCodes(changedCodes);
    setUpdateVersion((version) => version + 1);
  }, []);

  // 排序检查：每隔 1 分钟校验当前行顺序是否与表格指定的涨跌幅排序一致，
  // 不一致则一次性整体重排（由 StockTable 的 FLIP 拖拽动画完成位置过渡）；滚动时跳过本次检查
  const runSortOrderCheck = useCallback(() => {
    if (isScrollingRef.current) return;
    const direction = sortDirectionRef.current;
    if (!direction) return;
    const activeTab = activeTabRef.current;
    const currentRows = rowsByTabRef.current[activeTab] ?? [];
    if (currentRows.length < 2) return;
    const sortedRows = sortRowsByDirection(currentRows, sortFieldRef.current, direction);
    const orderChanged = sortedRows.some((row, index) => row.code !== currentRows[index]?.code);
    if (!orderChanged) return;
    const nextRowsByTab = { ...rowsByTabRef.current, [activeTab]: sortedRows };
    rowsByTabRef.current = nextRowsByTab;
    setRowsByTab(nextRowsByTab);
    setChangedCodes([]);
    setReorderingVersion((version) => version + 1);
  }, [sortRowsByDirection]);

  const schedulePendingRowUpdate = useCallback(
    (delay = 0) => {
      window.clearTimeout(updateTimer.current);
      updateTimer.current = window.setTimeout(() => runPendingUpdate(), delay);
    },
    [runPendingUpdate],
  );

  const queueSnapshotRows = useCallback(
    (data: MarketPageSnapshot) => {
      // eslint-disable-next-line no-console
      const filteredRows = data.rows.filter((row) => quoteMatchesTab(row.code, data.tab));
      const sortedRows = sortRowsByDirection(filteredRows, sortFieldRef.current, sortDirectionRef.current);
      const currentRows = rowsByTabRef.current[data.tab] ?? [];
      if (!currentRows.length) {
        const nextRowsByTab = { ...rowsByTabRef.current, [data.tab]: sortedRows };
        rowsByTabRef.current = nextRowsByTab;
        setRowsByTab(nextRowsByTab);
        return;
      }
      if (sameMarketRows(currentRows, sortedRows)) return;
      pendingRowsByTabRef.current[data.tab] = sortedRows;
      if (data.tab === activeTabRef.current) schedulePendingRowUpdate();
    },
    [schedulePendingRowUpdate, sortRowsByDirection],
  );

  useEffect(() => {
    const timer = window.setInterval(runSortOrderCheck, MARKET_ORDER_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [runSortOrderCheck]);

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
  const sortedRows = useMemo(() => visibleRows, [visibleRows]);

  const changeSortDirection = useCallback(
    (field: TMarketCellField) => {
      window.clearTimeout(updateTimer.current);
      // Same field: cycle desc → asc → undefined (no sort); different field: start desc
      const isSameField = field === sortFieldRef.current;
      const nextDirection: SortDirection = isSameField
        ? sortDirectionRef.current === 'desc'
          ? 'asc'
          : sortDirectionRef.current === 'asc'
            ? undefined
            : 'desc'
        : 'desc';
      const nextField: TMarketCellField | undefined = nextDirection ? field : undefined;
      setSortField(nextField);
      setSortDirection(nextDirection);
      setChangedCodes([]);
      tableWrapRef.current?.scrollTo({ top: 0 });
      const currentRows = rowsByTabRef.current[activeTabRef.current] ?? [];
      if (!currentRows.length) return;
      const nextRows = sortRowsByDirection(currentRows, nextField, nextDirection);
      const nextRowsByTab = { ...rowsByTabRef.current, [activeTabRef.current]: nextRows };
      rowsByTabRef.current = nextRowsByTab;
      setRowsByTab(nextRowsByTab);
      setUpdateVersion((version) => version + 1);
      setReorderingVersion((version) => version + 1);
    },
    [sortRowsByDirection],
  );

  const handleTableScroll = () => {
    isScrollingRef.current = true;
    window.clearTimeout(scrollIdleRefreshTimer.current);
    scrollIdleRefreshTimer.current = window.setTimeout(() => {
      isScrollingRef.current = false;
      schedulePendingRowUpdate(0);
    }, MARKET_SCROLL_IDLE_MS);
  };

  const changeTab = (tab: MarketTab) => {
    window.clearTimeout(updateTimer.current);
    setActiveTab(tab);
    activeTabRef.current = tab;
    setChangedCodes([]);
    setReorderingVersion(0);
    tableWrapRef.current?.scrollTo({ top: 0 });
    // 切 tab 时立即把该 tab 的行整理为当前排序方向（表格整体重挂载，无需动画）
    const direction = sortDirectionRef.current;
    const currentRows = rowsByTabRef.current[tab] ?? [];
    if (direction && currentRows.length > 1) {
      const sortedRows = sortRowsByDirection(currentRows, sortFieldRef.current, direction);
      if (sortedRows.some((row, index) => row.code !== currentRows[index]?.code)) {
        const nextRowsByTab = { ...rowsByTabRef.current, [tab]: sortedRows };
        rowsByTabRef.current = nextRowsByTab;
        setRowsByTab(nextRowsByTab);
      }
    }
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
      setStockReturnContext(undefined);
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
    [openRightPanel, setSelectedStock, setStockReturnContext],
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
          <p className={styles.snapshotMeta}>
            <span>
              全市场快照 · {updatedAt ? new Date(updatedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '加载中'}
            </span>
            <span className={cx(styles.phasePill, !marketPhase.isTrading && styles.phasePillInactive)}>
              <span className={cx(styles.liveDot, !marketPhase.isTrading && styles.liveDotInactive)} />
              {marketPhase.label}
            </span>
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
            <IndexCard
              key={`${item.code}-${indexPeriod}`}
              item={item}
              period={indexPeriod}
              onExpand={(index) => setExpandedIndexCode(index.code)}
            />
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
          key={activeTab}
          rows={sortedRows}
          scrollRef={tableWrapRef}
          sortField={sortField}
          sortDirection={sortDirection}
          updateVersion={updateVersion}
          reorderingVersion={reorderingVersion}
          changedCodes={changedCodes}
          onSortChange={changeSortDirection}
          onOpen={openStock}
        />
        {sortedRows.length ? <div className={styles.loadState}>共 {sortedRows.length} 只</div> : null}
      </div>
      {expandedIndex ? (
        <IndexKlineModal
          index={expandedIndex}
          initialPeriod={indexPeriod}
          onClose={() => setExpandedIndexCode(undefined)}
        />
      ) : null}
    </section>
  );
}

function mergeMarketIndexSnapshots(current: MarketIndexSnapshot[], next: MarketIndexSnapshot[]) {
  if (!current.length) return next;
  if (current.length !== next.length) return next;
  const currentByCode = new Map(current.map((item) => [item.code, item]));
  for (const item of next) {
    const previous = currentByCode.get(item.code);
    if (!previous) return next;
    if (previous.minutes.length !== item.minutes.length) return next;
    if (previous.minutes[0]?.time !== item.minutes[0]?.time) return next;
    if (previous.minutes[previous.minutes.length - 1]?.time !== item.minutes[item.minutes.length - 1]?.time)
      return next;
    if (previous.price !== item.price) return next;
  }
  return current;
}

function toMarketIndexSymbol(code: string | undefined) {
  if (code === '000001') return 'sh000001';
  if (code === '399001') return 'sz399001';
  return undefined;
}

function getAshareMarketPhase(now: Date): TAshareMarketPhase {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const day = now.getDay();
  const isWeekday = day >= 1 && day <= 5;

  if (!isWeekday) return { label: '非交易日', isTrading: false };
  if (minutes < 9 * 60 + 25) return { label: '盘前', isTrading: false };
  if (minutes < 9 * 60 + 30) return { label: '集合竞价', isTrading: true };
  if (minutes <= 11 * 60 + 30) return { label: '盘中', isTrading: true };
  if (minutes < 13 * 60) return { label: '午间休市', isTrading: false };
  if (minutes <= 15 * 60) return { label: '盘中', isTrading: true };
  return { label: '已收盘', isTrading: false };
}

function isChinaMarketOpen(date = new Date()) {
  const day = date.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = date.getHours() * 60 + date.getMinutes();
  return (minutes >= 9 * 60 + 25 && minutes <= 11 * 60 + 30) || (minutes >= 13 * 60 && minutes <= 15 * 60);
}

function quoteMatchesTab(code: string, tab: MarketTab) {
  if (tab === 'star') return code.startsWith('688');
  if (tab === 'gem') return code.startsWith('300') || code.startsWith('301');
  if (tab === 'bj') return code.startsWith('4') || code.startsWith('8') || code.startsWith('92');
  if (tab === 'sh-main') return code.startsWith('6') && !code.startsWith('688');
  if (tab === 'sz-main') return /^(000|001|002|003)/.test(code);
  return true;
}
