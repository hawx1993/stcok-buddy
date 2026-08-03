import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DragonTigerPanel } from './components/dragon-tiger-panel';
import { IndexCard } from './components/index-card';
import { IndexKlineModal } from './components/index-kline-modal';
import { StockTable } from './components/stock-table';
import type { TMarketCellField, TSortDirection } from './components/stock-table';
import { parsePercent } from './market-format';
import { applyMarketRowValueUpdate, sameMarketRows } from './market-row-updates';
import { getStocksenseApi } from '../../shared/stocksense-api';
import { getAshareMarketPhase } from '../../shared/market-time';
import { MarketPhasePill } from '../market-phase-pill';
import type { MarketIndexPeriod, MarketIndexSnapshot, MarketPageSnapshot, MarketQuoteRow, MarketTab } from '../../shared/types';
import { useOpenMarketSearchResult } from '../../hooks/use-open-market-search-result';
import { getGlobalSearchShortcutLabel } from '../global-stock-search/shortcut';
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

interface IMarketViewProps {
  onOpenGlobalSearch?(): void;
}

type SortDirection = TSortDirection;
type TMarketViewTab = MarketTab | 'dragon-tiger';

const viewTabs: Array<{ id: TMarketViewTab; label: string }> = [...tabs, { id: 'dragon-tiger', label: '龙虎榜' }];

export function MarketView({ onOpenGlobalSearch }: IMarketViewProps = {}) {
  const [activeTab, setActiveTab] = useState<MarketTab>('sh-main');
  const [activeViewTab, setActiveViewTab] = useState<TMarketViewTab>('sh-main');
  const [indexPeriod, setIndexPeriod] = useState<MarketIndexPeriod>('1d');
  const [indices, setIndices] = useState<MarketIndexSnapshot[]>([]);
  const [rowsByTab, setRowsByTab] = useState<Partial<Record<MarketTab, MarketQuoteRow[]>>>({});
  const rowsByTabRef = useRef<Partial<Record<MarketTab, MarketQuoteRow[]>>>({});
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(false);
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
  const { openStock } = useOpenMarketSearchResult();
  const shortcutLabel = getGlobalSearchShortcutLabel();

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
    const loadTab = async (tab: MarketTab, done = tab === activeTab) => {
      try {
        await api.ensureMarketDataReady();
        const data = await api.getMarketPageSnapshot(tab, indexPeriod);
        applySnapshot(data, done);
      } catch (error) {
        console.error(error);
        if (alive && tab === activeTab) setLoading(false);
      }
    };
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

  const changeTab = (tab: TMarketViewTab) => {
    window.clearTimeout(updateTimer.current);
    setActiveViewTab(tab);
    if (tab === 'dragon-tiger') {
      setChangedCodes([]);
      setReorderingVersion(0);
      return;
    }
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

  return (
    <section className={styles.wrap}>
      <div className={styles.header}>
        <div>
          <h1>行情</h1>
          <p className={styles.snapshotMeta}>
            <span>
              全市场快照 · {updatedAt ? new Date(updatedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '加载中'}
            </span>
            <MarketPhasePill />
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.searchBox} onClick={onOpenGlobalSearch} type='button'>
            <span>搜索代码 / 股票名称 / 板块</span>
            <kbd>{shortcutLabel}</kbd>
          </button>
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
        {viewTabs.map((tab) => (
          <button
            key={tab.id}
            className={cx(activeViewTab === tab.id && styles.active)}
            onClick={() => changeTab(tab.id)}
            type='button'
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeViewTab === 'dragon-tiger' ? (
        <DragonTigerPanel onOpen={openStock} />
      ) : (
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
      )}
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

function isChinaMarketOpen(date = new Date()) {
  return getAshareMarketPhase(date).isTrading;
}

function quoteMatchesTab(code: string, tab: MarketTab) {
  if (tab === 'star') return code.startsWith('688');
  if (tab === 'gem') return code.startsWith('300') || code.startsWith('301');
  if (tab === 'bj') return code.startsWith('4') || code.startsWith('8') || code.startsWith('92');
  if (tab === 'sh-main') return code.startsWith('6') && !code.startsWith('688');
  if (tab === 'sz-main') return /^(000|001|002|003)/.test(code);
  return true;
}
