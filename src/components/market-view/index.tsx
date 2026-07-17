import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { KlineModal, StockKlineChart } from '../kline-chart';
import { getStocksenseApi } from '../../shared/stocksense-api';
import type { BoardDetail, MarketBoardRow, MarketIndexPeriod, MarketIndexSnapshot, MarketPageSnapshot, MarketQuoteRow, MarketSearchResult, MarketTab, StockDetail } from '../../shared/types';
import { useAppStore } from '../../store/app-store';
import cx from '../../shared/cx';
import styles from './index.module.scss';

const MARKET_PAGE_SIZE = 20;

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
  { id: '4h', label: '4小时' },
  { id: '1d', label: '天' },
];

type SortDirection = 'asc' | 'desc' | undefined;

export function MarketView() {
  const [activeTab, setActiveTab] = useState<MarketTab>('sh-main');
  const [indexPeriod, setIndexPeriod] = useState<MarketIndexPeriod>('1d');
  const [indices, setIndices] = useState<MarketIndexSnapshot[]>([]);
  const [rowsByTab, setRowsByTab] = useState<Partial<Record<MarketTab, MarketQuoteRow[]>>>({});
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [suggestions, setSuggestions] = useState<MarketSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [visibleRowCount, setVisibleRowCount] = useState(MARKET_PAGE_SIZE);
  const [sortDirection, setSortDirection] = useState<SortDirection>();
  const [expandedIndex, setExpandedIndex] = useState<MarketIndexSnapshot>();
  const refreshTimer = useRef<number>();
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const setSelectedStock = useAppStore((state) => state.setSelectedStock);
  const setSelectedBoard = useAppStore((state) => state.setSelectedBoard);
  const selectedBoard = useAppStore((state) => state.selectedBoard);
  const openRightPanel = useAppStore((state) => state.openRightPanel);
  const openBoardPanel = useAppStore((state) => state.openBoardPanel);

  useEffect(() => {
    let alive = true;
    const api = getStocksenseApi();
    setLoading(true);
    const hasContent = (data: MarketPageSnapshot) => data.rows.length > 0;
    const applySnapshot = (data: MarketPageSnapshot, done = true) => {
      if (!alive) return;
      if (data.indices.length) setIndices(data.indices);
      setRowsByTab((current) => ({ ...current, [data.tab]: data.rows }));
      if (data.tab === activeTab) {
        setUpdatedAt(data.updatedAt);
        if (done || hasContent(data)) setLoading(false);
      }
    };
    const load = () => api.getMarketPageSnapshot(activeTab, indexPeriod).then((data) => applySnapshot(data)).catch(console.error);
    void load();
    const unsubscribe = api.onMarketPageSnapshotUpdated?.((data) => {
      if (!alive || (data.period ?? '1d') !== indexPeriod) return;
      if (data.indices.length) setIndices(data.indices);
      setRowsByTab((current) => ({ ...current, [data.tab]: data.rows }));
      if (data.tab === activeTab) {
        setUpdatedAt(data.updatedAt);
        setLoading(false);
      }
    });
    window.clearInterval(refreshTimer.current);
    if (isChinaMarketOpen()) refreshTimer.current = window.setInterval(() => { if (alive) void load(); }, 15_000);
    return () => { alive = false; unsubscribe?.(); window.clearInterval(refreshTimer.current); };
  }, [activeTab, indexPeriod]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchText.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    let alive = true;
    if (!debouncedSearch) {
      setSuggestions([]);
      setSearching(false);
      return () => { alive = false; };
    }
    setSearching(true);
    getStocksenseApi().searchStocks(debouncedSearch)
      .then((items) => { if (alive) setSuggestions(items); })
      .catch(() => { if (alive) setSuggestions([]); })
      .finally(() => { if (alive) setSearching(false); });
    return () => { alive = false; };
  }, [debouncedSearch]);

  const visibleRows = rowsByTab[activeTab] ?? [];
  const sortedRows = sortDirection ? [...visibleRows].sort((a, b) => (parsePercent(a.changePercent) - parsePercent(b.changePercent)) * (sortDirection === 'asc' ? 1 : -1)) : visibleRows;
  const renderedRows = sortedRows.slice(0, visibleRowCount);

  const changeTab = (tab: MarketTab) => {
    setActiveTab(tab);
    setVisibleRowCount(MARKET_PAGE_SIZE);
    tableWrapRef.current?.scrollTo({ top: 0 });
  };

  const loadMoreRows = () => {
    if (visibleRowCount >= sortedRows.length) return;
    setVisibleRowCount((count) => Math.min(count + MARKET_PAGE_SIZE, sortedRows.length));
  };

  const openStock = useCallback(async (row: MarketQuoteRow) => {
    const stock: StockDetail = {
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
    };
    openRightPanel();
    setSelectedStock(stock);
    try {
      const detail = await getStocksenseApi().getStockDetail(row.code);
      setSelectedStock({ ...stock, ...detail, name: detail.name === detail.code ? stock.name : detail.name });
    } catch {
      setSelectedStock(stock);
    }
  }, [openRightPanel, setSelectedStock]);

  const openBoard = useCallback(async (row: MarketBoardRow) => {
    const preview: BoardDetail = { code: row.code, name: row.name, changePercent: formatPercent(row.changePercent), kline: row.minutes ?? [], constituents: row.constituents ?? [] };
    openBoardPanel();
    if (selectedBoard?.code !== row.code) setSelectedBoard(preview);
    try {
      const detail = await getStocksenseApi().getBoardDetail(row.code, false, row.name);
      if (useAppStore.getState().selectedBoard?.code !== row.code) return;
      setSelectedBoard({ ...detail, name: detail.name === detail.code ? row.name : detail.name, changePercent: detail.changePercent ?? preview.changePercent });
    } catch {
      if (useAppStore.getState().selectedBoard?.code !== row.code) return;
      setSelectedBoard(preview);
    }
  }, [openBoardPanel, selectedBoard?.code, setSelectedBoard]);

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
        <div><h1>行情</h1><p>全市场快照 · {updatedAt ? new Date(updatedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '加载中'}</p></div>
        <div className={styles.headerActions}>
          <div className={styles.searchBox}>
            <input value={searchText} onChange={(event) => setSearchText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setSuggestions([]); }} placeholder="搜索代码 / 股票名称 / 板块" />
            {searchText ? <div className={styles.suggestions}>
              {searching ? <div className={styles.suggestionEmpty}>搜索中…</div> : suggestions.length ? suggestions.map((row) => (
                <button key={`${row.kind ?? 'stock'}-${row.code}`} className={styles.suggestionItem} onMouseDown={(event) => { event.preventDefault(); openSearchResult(row); }} type="button">
                  <span>{row.name}<em>{row.kind === 'board' ? '板块' : '股票'}</em></span><code>{row.code}</code>
                </button>
              )) : debouncedSearch ? <div className={styles.suggestionEmpty}>无匹配股票</div> : null}
            </div> : null}
          </div>
          <div className={styles.periods}>{periods.map((period) => <button key={period.id} className={cx(indexPeriod === period.id && styles.periodActive)} onClick={() => { setIndexPeriod(period.id); setLoading(true); }} type="button">{period.label}</button>)}</div>
        </div>
      </div>
      <div className={styles.indices}>
        {(indices.length ? indices : [undefined, undefined]).map((item, index) => item ? <IndexCard key={item.code} item={item} onExpand={setExpandedIndex} /> : <div key={index} className={styles.indexCard}><div className={styles.noChart}>指数刷新中…</div></div>)}
      </div>
      <div className={styles.tabs}>{tabs.map((tab) => <button key={tab.id} className={cx(activeTab === tab.id && styles.active)} onClick={() => changeTab(tab.id)} type="button">{tab.label}</button>)}</div>
      <div ref={tableWrapRef} className={styles.tableWrap} onScroll={(event) => {
        const el = event.currentTarget;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) loadMoreRows();
      }}>
        <StockTable rows={renderedRows} sortDirection={sortDirection} onSortChange={() => { setSortDirection((direction) => direction === undefined ? 'desc' : direction === 'desc' ? 'asc' : undefined); setVisibleRowCount(MARKET_PAGE_SIZE); }} onOpen={openStock} />
        {sortedRows.length ? <div className={styles.loadState}>{visibleRowCount < sortedRows.length ? '向下滚动加载更多' : `已加载全部 ${sortedRows.length} 只`}</div> : null}
      </div>
      {expandedIndex ? <KlineModal stock={expandedIndex} data={expandedIndex.minutes} onClose={() => setExpandedIndex(undefined)} chipsOpen={false} /> : null}
    </section>
  );
}

const IndexCard = memo(function IndexCard({ item, onExpand }: { item: MarketIndexSnapshot; onExpand(item: MarketIndexSnapshot): void }) {
  const isDown = Number(item.changePercent) < 0;
  return (
    <div className={styles.indexCard}>
      <button className={styles.expandButton} onClick={() => onExpand(item)} title="放大指数图" type="button">⛶</button>
      <div className={styles.indexTitle}><span>{item.name}</span><strong className={isDown ? 'down' : 'up'}>{item.price ?? '--'}</strong><em className={isDown ? 'down' : 'up'}>{formatSigned(item.change)} {formatPercent(item.changePercent)}</em></div>
      <div className={styles.chart}>
        {item.minutes.length ? <StockKlineChart key={`${item.code}-${item.minutes[0]?.time}-${item.minutes[item.minutes.length - 1]?.time}`} stock={item} data={item.minutes} height="100%" showLegend={false} staticData /> : <span className={styles.noChart}>暂无数据</span>}
      </div>
      <div className={styles.indexMeta}><span>今开 {item.open ?? '--'}</span><span>最高 {item.high ?? '--'}</span><span>最低 {item.low ?? '--'}</span><span>成交额 {formatMoney(item.amount)}</span></div>
    </div>
  );
});

function StockTable({ rows, sortDirection, onSortChange, onOpen }: { rows: MarketQuoteRow[]; sortDirection: SortDirection; onSortChange(): void; onOpen(row: MarketQuoteRow): void }) {
  const sortMark = sortDirection === 'asc' ? '↑' : sortDirection === 'desc' ? '↓' : '↕';
  return <table className={styles.marketTable}><thead><tr><th>序号</th><th>代码</th><th>名称</th><th><button className={styles.sortButton} onClick={onSortChange} type="button">涨跌幅 {sortMark}</button></th><th>换手率</th><th>成交量</th><th>成交额</th><th>最新价</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.code} onClick={() => onOpen(row)}><td>{index + 1}</td><td>{row.code}</td><td>{row.name}</td><td className={tone(row.changePercent)}>{formatPercent(row.changePercent)}</td><td>{formatPercent(row.turnoverRate)}</td><td>{formatVolume(row.volume)}</td><td>{formatMoney(row.amount)}</td><td className={tone(row.changePercent)}>{row.price ?? '--'}</td></tr>)}</tbody></table>;
}

function isChinaMarketOpen(date = new Date()) {
  const day = date.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = date.getHours() * 60 + date.getMinutes();
  return (minutes >= 9 * 60 + 25 && minutes <= 11 * 60 + 30) || (minutes >= 13 * 60 && minutes <= 15 * 60);
}

function tone(value: unknown) { return Number(value) < 0 || String(value).startsWith('-') ? 'down' : 'up'; }
function parsePercent(value: unknown) { const num = Number.parseFloat(String(value ?? '').replace('%', '')); return Number.isFinite(num) ? num : 0; }
function formatSigned(value: unknown) { const num = Number(value); return Number.isFinite(num) ? `${num > 0 ? '+' : ''}${num.toFixed(2)}` : '--'; }
function formatPercent(value: unknown) { const raw = String(value ?? ''); const num = Number.parseFloat(raw.replace('%', '')); return Number.isFinite(num) ? `${num > 0 ? '+' : ''}${num.toFixed(2)}%` : String(value ?? '--'); }
function formatVolume(value: unknown) { const num = Number(value); if (!Number.isFinite(num)) return String(value ?? '--'); return num >= 100_000_000 ? `${(num / 100_000_000).toFixed(2)}亿手` : num >= 10_000 ? `${(num / 10_000).toFixed(2)}万手` : `${num.toFixed(0)}手`; }
function formatMoney(value: unknown) { const num = Number(value); if (!Number.isFinite(num)) return String(value ?? '--'); return num >= 100_000_000 ? `${(num / 100_000_000).toFixed(2)}亿` : num >= 10_000 ? `${(num / 10_000).toFixed(2)}万` : `${num.toFixed(0)}`; }
function formatMarketCap(value: unknown) { const num = Number(value); if (!Number.isFinite(num)) return String(value ?? '--'); return num >= 10_000 ? `${(num / 10_000).toFixed(2)}万亿` : `${num.toFixed(1)}亿`; }
