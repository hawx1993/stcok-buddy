import { message as antdMessage, Skeleton } from 'antd';
import { Bot, Filter, Pin, PinOff, Star, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import gsap from 'gsap';
import { useAppStore } from '../../store/app-store';
import { getStocksenseApi } from '../../shared/stocksense-api';
import type { BoardConstituent, HotFocusItem, MarketNewsItem, StockDetail } from '../../shared/types';
import { KlineModal, StockKlineChart } from '../kline-chart';
import { Empty } from '../empty';
import styles from './index.module.scss';
import cx from '../../shared/cx';

const NEWS_PAGE_SIZE = 30;
const SURGE_PAGE_SIZE = 20;
const surgeFilters = ['全部', '60日新高', '60日新低', '快速涨幅', '快速跌幅', '封跌停板', '封涨停板', '跌停开板', '涨停开板', '特大单买入', '特大单卖出'] as const;
type SurgeFilter = typeof surgeFilters[number];

export function StockDetailPanel() {
  const detailRef = useRef<HTMLDivElement>(null);
  const surgeLoadRef = useRef(0);
  const surgeCacheRef = useRef<Record<string, HotFocusItem[]>>({});
  const [newsQuery, setNewsQuery] = useState('');
  const [newsPage, setNewsPage] = useState(1);
  const [newsRefresh, setNewsRefresh] = useState(0);
  const [newsTotal, setNewsTotal] = useState(0);
  const [newsLoading, setNewsLoading] = useState(false);
  const [news, setNews] = useState<MarketNewsItem[]>([]);
  const [surgeLoading, setSurgeLoading] = useState(false);
  const [surgeItems, setSurgeItems] = useState<HotFocusItem[]>([]);
  const [surgeDateOptions, setSurgeDateOptions] = useState(() => makeSurgeDateOptions());
  const [selectedSurgeDate, setSelectedSurgeDate] = useState(surgeDateOptions[0]);
  const [isSurgeMonitoring, setSurgeMonitoring] = useState(() => isChinaMarketOpen());
  const [surgeRefresh, setSurgeRefresh] = useState(0);
  const [surgeRefreshMode, setSurgeRefreshMode] = useState<'manual' | 'poll'>('manual');
  const [surgeFiltersOpen, setSurgeFiltersOpen] = useState(false);
  const [surgeFilter, setSurgeFilter] = useState<SurgeFilter[]>(['全部']);
  const [visibleSurgeCount, setVisibleSurgeCount] = useState(SURGE_PAGE_SIZE);
  const [surgePaging, setSurgePaging] = useState(false);
  const [isKlineModalOpen, setKlineModalOpen] = useState(false);
  const [chipsOpen, setChipsOpen] = useState(true);
  const [favoriteQuotes, setFavoriteQuotes] = useState<Record<string, StockDetail>>({});
  const selectedStock = useAppStore((state) => state.selectedStock);
  const selectedBoard = useAppStore((state) => state.selectedBoard);
  const favoriteStocks = useAppStore((state) => state.favoriteStocks);
  const rightPanelTab = useAppStore((state) => state.rightPanelTab);
  const setFavoriteStocks = useAppStore((state) => state.setFavoriteStocks);
  const setRightPanelTab = useAppStore((state) => state.setRightPanelTab);
  const setSelectedStock = useAppStore((state) => state.setSelectedStock);
  const openRightPanel = useAppStore((state) => state.openRightPanel);

  const todaySurgeDate = surgeDateOptions[0];

  useEffect(() => {
    const refreshDates = () => {
      const next = makeSurgeDateOptions();
      setSurgeDateOptions(next);
      setSelectedSurgeDate((date) => date === todaySurgeDate ? next[0] : next.includes(date) ? date : next[0]);
      setSurgeRefreshMode('manual');
      setSurgeRefresh((value) => value + 1);
    };
    const id = window.setInterval(() => {
      if (makeSurgeDateOptions()[0] !== todaySurgeDate) refreshDates();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [todaySurgeDate]);

  useLayoutEffect(() => {
    if (!selectedStock || !detailRef.current) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power2.out', duration: 0.25 } });
      tl.from('[data-stockheader]', { opacity: 0, y: -6 });
      tl.from('[data-klinebox]', { opacity: 0, y: 6 }, '-=0.1');
      tl.from('[data-stockgrid] .si', { opacity: 0, y: 8, stagger: 0.03 }, '-=0.05');
      tl.from('[data-rating] .r', { opacity: 0, y: 6, stagger: 0.02 }, '-=0.05');
      tl.from('[data-summary]', { opacity: 0, y: 6 }, '-=0.05');
    }, detailRef);
    return () => ctx.revert();
  }, [selectedStock?.code]);

  useEffect(() => {
    if (!selectedStock?.code || selectedStock.kline?.length) return;
    let alive = true;
    getStocksenseApi().getKline(selectedStock.code, 120, '1d').then((kline) => {
      if (alive && kline.length) useAppStore.getState().setSelectedStock({ ...selectedStock, kline });
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [selectedStock]);

  useEffect(() => {
    if (rightPanelTab !== 'news') return;
    let alive = true;
    setNewsLoading(true);
    getStocksenseApi().listMarketNews(newsQuery, newsPage, NEWS_PAGE_SIZE).then((result) => {
      if (!alive) return;
      setNews(result.items);
      setNewsTotal(result.total);
    }).catch(console.error).finally(() => {
      if (alive) setNewsLoading(false);
    });
    return () => { alive = false; };
  }, [rightPanelTab, newsQuery, newsPage, newsRefresh]);

  useEffect(() => {
    if (rightPanelTab !== 'surge') return;
    let alive = true;
    const loadId = ++surgeLoadRef.current;
    const cached = selectedSurgeDate === todaySurgeDate ? undefined : surgeCacheRef.current[selectedSurgeDate];
    setSurgeItems(cached ?? []);
    setVisibleSurgeCount(SURGE_PAGE_SIZE);
    setSurgeLoading(selectedSurgeDate === todaySurgeDate);
    const load = selectedSurgeDate === todaySurgeDate
      ? getStocksenseApi().listHotFocus('surge')
      : getStocksenseApi().listSurgeHistory(selectedSurgeDate);
    load.then((items) => {
      if (!alive || loadId !== surgeLoadRef.current) return;
      if (selectedSurgeDate !== todaySurgeDate) surgeCacheRef.current[selectedSurgeDate] = items;
      setSurgeItems(items);
      setVisibleSurgeCount(SURGE_PAGE_SIZE);
    }).catch(console.error).finally(() => {
      if (alive && loadId === surgeLoadRef.current) setSurgeLoading(false);
    });
    return () => { alive = false; };
  }, [rightPanelTab, selectedSurgeDate, surgeRefresh, todaySurgeDate]);

  useEffect(() => {
    if (rightPanelTab !== 'surge' || selectedSurgeDate !== todaySurgeDate) return;
    const checkMarket = () => {
      if (!isChinaMarketOpen()) setSurgeMonitoring(false);
    };
    checkMarket();
    const id = window.setInterval(checkMarket, 60_000);
    return () => window.clearInterval(id);
  }, [rightPanelTab, selectedSurgeDate, todaySurgeDate]);

  useEffect(() => {
    if (rightPanelTab !== 'surge' || selectedSurgeDate !== todaySurgeDate || !isSurgeMonitoring) return;
    const id = window.setInterval(() => { setSurgeRefreshMode('poll'); setSurgeRefresh((value) => value + 1); }, 15_000);
    return () => window.clearInterval(id);
  }, [isSurgeMonitoring, rightPanelTab, selectedSurgeDate, todaySurgeDate]);

  const filteredSurgeItems = useMemo(() => surgeFilter.includes('全部') ? surgeItems : surgeItems.filter((item) => surgeFilter.includes(surgeReason(item) as SurgeFilter)), [surgeFilter, surgeItems]);
  const selectedIsFavorite = Boolean(selectedStock && favoriteStocks.some((item) => item.code === selectedStock.code));

  useEffect(() => {
    setVisibleSurgeCount(SURGE_PAGE_SIZE);
  }, [surgeFilter]);

  useEffect(() => {
    if (rightPanelTab !== 'favorites' || !favoriteStocks.length) return;
    let alive = true;
    const refresh = async () => {
      const quotes = await Promise.all(favoriteStocks.map((item) => getStocksenseApi().getStockDetail(item.code).catch(() => undefined)));
      if (!alive) return;
      setFavoriteQuotes(Object.fromEntries(quotes.filter((quote): quote is StockDetail => Boolean(quote)).map((quote) => [quote.code, quote])));
    };
    void refresh();
    const id = window.setInterval(refresh, 30_000);
    return () => { alive = false; window.clearInterval(id); };
  }, [favoriteStocks, rightPanelTab]);

  const toggleSurgeMonitor = () => {
    if (isSurgeMonitoring) {
      setSurgeMonitoring(false);
      return;
    }
    if (!isChinaMarketOpen()) {
      antdMessage.error('非交易时段');
      return;
    }
    setSurgeMonitoring(true);
  };

  const toggleSurgeFilter = (filter: SurgeFilter) => {
    setSurgeFilter((current) => {
      if (filter === '全部') return ['全部'];
      const withoutAll = current.filter((item) => item !== '全部');
      const next = withoutAll.includes(filter) ? withoutAll.filter((item) => item !== filter) : [...withoutAll, filter];
      return next.length ? next : ['全部'];
    });
  };

  const loadMoreSurge = () => {
    if (surgePaging || visibleSurgeCount >= filteredSurgeItems.length) return;
    setSurgePaging(true);
    window.setTimeout(() => {
      setVisibleSurgeCount((count) => Math.min(count + SURGE_PAGE_SIZE, filteredSurgeItems.length));
      setSurgePaging(false);
    }, 250);
  };

  const openSurgeStock = async (item: HotFocusItem) => {
    if (!item.code) return;
    const fallback: StockDetail = { code: item.code, name: item.name ?? item.title, price: item.price, changePercent: item.changePercent, turnover: item.turnover ?? item.amount, summary: item.description };
    openRightPanel();
    setSelectedStock(fallback);
    try {
      setSelectedStock(await getStocksenseApi().getStockDetail(item.code));
    } catch {
      setSelectedStock(fallback);
    }
  };

  const sendStockReport = (code: string) => {
    window.dispatchEvent(new CustomEvent('stocksense:send-report', { detail: code }));
  };

  const toggleSelectedFavorite = async () => {
    if (!selectedStock) return;
    const nextFavorite = !selectedIsFavorite;
    const stock = { code: selectedStock.code, name: selectedStock.name };
    const next = nextFavorite
      ? [{ ...stock, pinned: false, createdAt: new Date().toISOString() }, ...favoriteStocks]
      : favoriteStocks.filter((item) => item.code !== stock.code);
    setFavoriteStocks(next);
    setFavoriteQuotes((quotes) => nextFavorite ? { ...quotes, [stock.code]: selectedStock } : quotes);
    try {
      const saved = nextFavorite
        ? await getStocksenseApi().upsertFavoriteStock(stock)
        : await getStocksenseApi().removeFavoriteStock(stock.code);
      setFavoriteStocks(saved);
      antdMessage.success(nextFavorite ? '收藏成功' : '取消收藏成功');
    } catch (error) {
      setFavoriteStocks(favoriteStocks);
      antdMessage.error(error instanceof Error ? error.message : '收藏操作失败');
    }
  };

  const removeFavorite = async (code: string) => {
    setFavoriteStocks(await getStocksenseApi().removeFavoriteStock(code));
    setFavoriteQuotes((quotes) => {
      const next = { ...quotes };
      delete next[code];
      return next;
    });
    antdMessage.success('取消收藏成功');
  };

  const toggleFavoritePin = async (code: string) => {
    setFavoriteStocks(await getStocksenseApi().toggleFavoriteStockPin(code));
  };

  const openFavoriteStock = async (stock: StockDetail) => {
    setRightPanelTab('stock');
    openRightPanel();
    setSelectedStock(stock);
    try {
      setSelectedStock(await getStocksenseApi().getStockDetail(stock.code));
    } catch {
      setSelectedStock(stock);
    }
  };

  const totalPages = Math.max(1, Math.ceil(newsTotal / NEWS_PAGE_SIZE));

  return (
    <aside className={`${styles['right-panel']} right-panel`}>
      {rightPanelTab === 'favorites' ? (
        <>
          <div className={styles['right-panel-header']}>
            <span className={styles.title}>⭐ 收藏个股</span>
          </div>
          <div className={cx(styles['right-panel-body'], styles['news-panel-body'])}>
            {favoriteStocks.length ? favoriteStocks.map((item) => {
              const quote = favoriteQuotes[item.code] ?? item;
              const change = String(quote.changePercent ?? '--');
              return <FavoriteStockItem key={item.code} stock={{ ...quote, code: item.code, name: quote.name ?? item.name }} pinned={Boolean(item.pinned)} isUp={!change.startsWith('-')} onOpen={() => void openFavoriteStock({ ...quote, code: item.code, name: quote.name ?? item.name })} onRemove={() => void removeFavorite(item.code)} onTogglePin={() => void toggleFavoritePin(item.code)} />;
            }) : <Empty text={<>暂无收藏个股。打开个股详情后点击<span className={styles.hl}>星标</span>收藏。</>} />}
          </div>
        </>
      ) : rightPanelTab === 'news' ? (
        <>
          <div className={styles['right-panel-header']}>
            <span className={styles.title}>📰 市场热点</span>
            <div className={styles['news-search-row']}>
              <div className={styles['rp-search-row']}><input value={newsQuery} onChange={(event) => { setNewsQuery(event.target.value); setNewsPage(1); }} placeholder="搜索新闻…" /></div>
              <button className={styles['news-refresh']} onClick={() => setNewsRefresh((value) => value + 1)} disabled={newsLoading} type="button">{newsLoading ? '刷新中…' : '刷新'}</button>
            </div>
          </div>
          <div className={cx(styles['right-panel-body'], styles['news-panel-body'])}>
            <div className={styles['news-section-title']}>📌 热门新闻 <span>{newsTotal} 条</span></div>
            <div className={styles['right-news-list']}>
              {newsLoading ? <NewsSkeleton rows={10} /> : news.length ? news.map((item) => <NewsItem key={item.id} item={item} />) : <div className={styles['empty-list']}>无匹配新闻</div>}
            </div>
            <div className={styles['news-pager']}>
              <button onClick={() => setNewsPage((value) => Math.max(1, value - 1))} disabled={newsPage <= 1 || newsLoading} type="button">上一页</button>
              <span>{newsPage} / {totalPages}</span>
              <button onClick={() => setNewsPage((value) => Math.min(totalPages, value + 1))} disabled={newsPage >= totalPages || newsLoading} type="button">下一页</button>
            </div>
          </div>
        </>
      ) : rightPanelTab === 'surge' ? (
        <>
          <div className={styles['right-panel-header']}>
            <div className={styles['surge-title-row']}>
              <span className={styles.title}>⚡ 个股异动</span>
              <button className={styles['surge-filter-label']} onClick={() => setSurgeFiltersOpen((open) => !open)} type="button">筛选 <span className={styles['surge-filter-icon']}><Filter size={14} />{surgeFilter.includes('全部') ? null : <span className={styles['surge-filter-badge']}>{surgeFilter.length}</span>}</span></button>
            </div>
            {surgeFiltersOpen ? <div className={styles['surge-filters']}>
              {surgeFilters.map((filter) => <button key={filter} className={cx(styles['surge-filter'], surgeFilter.includes(filter) && styles.active)} onClick={() => toggleSurgeFilter(filter)} type="button">{filter}</button>)}
            </div> : null}
            <div className={styles['surge-date-row']}>
              <select className={styles['surge-date-select']} value={selectedSurgeDate} onChange={(event) => { setSurgeRefreshMode('manual'); setSurgeFilter(['全部']); setSelectedSurgeDate(event.target.value); }} aria-label="筛选异动日期">
                {surgeDateOptions.map((date, index) => <option key={date} value={date}>{index === 0 ? `今天 ${date.slice(5)}` : date}</option>)}
              </select>
              {selectedSurgeDate === todaySurgeDate ? <>
                <button className={styles['surge-date-button']} onClick={() => { setSurgeRefreshMode('manual'); setSurgeRefresh((value) => value + 1); }} type="button">刷新</button>
                <button className={cx(styles['surge-monitor-button'], isSurgeMonitoring && styles.active)} onClick={toggleSurgeMonitor} title={isSurgeMonitoring ? '关闭监控' : '开启监控'} aria-label={isSurgeMonitoring ? '关闭监控' : '开启监控'} type="button"><span /></button>
              </> : null}
            </div>
          </div>
          <div className={styles['right-panel-body']} onScroll={(event) => {
            const el = event.currentTarget;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) loadMoreSurge();
          }}>
            {surgeLoading ? <SurgeSkeleton /> : filteredSurgeItems.length ? <>
              {filteredSurgeItems.slice(0, visibleSurgeCount).map((item) => <SurgeItem key={item.id} item={item} onClick={() => void openSurgeStock(item)} />)}
              <div className={styles['surge-load-state']}>{visibleSurgeCount < filteredSurgeItems.length ? (surgePaging ? <span className={styles.spinner} /> : '向下滚动加载更多') : '没有更多数据了'}</div>
            </> : <Empty text="暂无异动个股" />}
          </div>
        </>
      ) : (
        <>
          <div className={styles['right-panel-header']}>
            <span className={styles.title}>个股详情</span>
          </div>
          {selectedBoard ? <BoardDetailView /> : selectedStock ? (
            <div className={styles['stock-detail']} ref={detailRef}>
          <div className={styles['stock-header']} data-stockheader>
            <div className={styles['stock-name']}>{selectedStock.name}<span className={styles.code}>{selectedStock.code} · {selectedStock.exchange ?? 'A股'}</span></div>
            <div className={styles['stock-side']}>
              <div className={styles['stock-actions']}>
                <button className={styles['robot-btn']} onClick={() => sendStockReport(selectedStock.code)} title="诊股" aria-label="诊股" type="button"><Bot size={15} /></button>
                <button className={cx(styles['robot-btn'], styles['favorite-btn'], selectedIsFavorite && styles.active)} onClick={() => void toggleSelectedFavorite()} title={selectedIsFavorite ? '取消收藏' : '收藏'} aria-label={selectedIsFavorite ? '取消收藏' : '收藏'} type="button"><Star size={15} fill={selectedIsFavorite ? 'currentColor' : 'none'} /></button>
              </div>
              <div className={styles['stock-price']}><div className={styles.price}>{selectedStock.price ?? '--'}</div><div className={cx(styles.chg, String(selectedStock.changePercent).startsWith('-') ? 'down' : 'up')}>{selectedStock.changePercent ?? '--'} ({selectedStock.change ?? '--'})</div></div>
            </div>
          </div>
          <div className={styles['kline-box']} data-klinebox>
            <button className={styles['kline-expand']} onClick={() => setKlineModalOpen(true)} title="放大K线图" type="button">⛶</button>
            <StockKlineChart stock={selectedStock} data={selectedStock.kline} showSwitcher showChips chipsOpen={chipsOpen} showLegend={false} />
            <div className={styles['chip-label']}>
              <span><span className={cx(styles.bar, styles.up)} />获利 <span className={cx(styles.bar, styles.down)} />亏损 <span className={styles['chip-note']}>估算</span></span>
              <button className={styles['chip-toggle']} onClick={() => setChipsOpen((value) => !value)} type="button">筹码峰{chipsOpen ? '收起' : '展开'}</button>
            </div>
          </div>
          <div className={styles['stock-grid']} data-stockgrid>
            <Metric label="PE(TTM)" value={selectedStock.pe ?? '--'} />
            <Metric label="PB" value={selectedStock.pb ?? '--'} />
            <Metric label="ROE" value={selectedStock.roe ?? '--'} />
            <Metric label="市值" value={selectedStock.marketCap ?? '--'} />
            <Metric label="成交量" value={selectedStock.volume ?? '--'} />
            <Metric label="成交额" value={selectedStock.turnover ?? '--'} />
          </div>
          <div className={styles.divider} />
          <div className={styles['section-title']}>综合评级</div>
          <div className={styles['rating-grid']} data-rating>
            <Rating label="基本面" score={selectedStock.rating?.fundamental ?? '待评估'} tone="up" />
            <Rating label="估值" score={selectedStock.rating?.valuation ?? '待评估'} tone="warn" />
            <Rating label="技术面" score={selectedStock.rating?.tech ?? '待分析'} tone="warn" />
            <Rating label="风险" score={selectedStock.rating?.risk ?? '中性'} tone="up" />
          </div>
          <div className={styles.divider} />
          <div className={styles['section-title']}>快评</div>
          <div className={styles['summary-box']} data-summary>{selectedStock.summary ?? '暂无摘要。'}</div>
        </div>
      ) : (
            <Empty text={<>点击聊天中的<span className={styles.hl}>股票</span>或左侧热点列表，查看个股详情。</>} />
          )}
        </>
      )}
      {isKlineModalOpen && selectedStock ? <KlineModal stock={selectedStock} data={selectedStock.kline} onClose={() => setKlineModalOpen(false)} chipsOpen={chipsOpen} /> : null}
    </aside>
  );
}

function isChinaMarketOpen(date = new Date()) {
  const day = date.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = date.getHours() * 60 + date.getMinutes();
  return (minutes >= 9 * 60 + 25 && minutes <= 11 * 60 + 30) || (minutes >= 13 * 60 && minutes <= 15 * 60);
}

function makeSurgeDateOptions() {
  return Array.from({ length: 7 }, (_, index) => formatDateOffset(index));
}

function formatDateOffset(offset: number) {
  const date = new Date();
  date.setDate(date.getDate() - offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function FavoriteStockItem({ stock, pinned, isUp, onOpen, onRemove, onTogglePin }: { stock: StockDetail; pinned: boolean; isUp: boolean; onOpen(): void; onRemove(): void; onTogglePin(): void }) {
  const stop = (event: MouseEvent, action: () => void) => {
    event.stopPropagation();
    action();
  };
  return (
    <div className={styles['favorite-item']} onClick={onOpen} onKeyDown={(event) => { if (event.key === 'Enter') onOpen(); }} role="button" tabIndex={0}>
      <span className={styles['favorite-main']}>
        <b>{stock.name}<em>{stock.code}</em>{pinned ? <small>置顶</small> : null}</b>
        <span>{stock.turnover ? `成交额 ${stock.turnover}` : stock.summary ?? '实时行情'}</span>
      </span>
      <span className={styles['favorite-side']}>
        <strong>{stock.price ?? '--'}</strong>
        <span className={isUp ? 'up' : 'down'}>{stock.changePercent ?? '--'}</span>
        <span className={styles['favorite-actions']}>
          <button onClick={(event) => stop(event, onTogglePin)} title={pinned ? '取消置顶' : '置顶'} type="button">{pinned ? <PinOff size={13} /> : <Pin size={13} />}</button>
          <button onClick={(event) => stop(event, onRemove)} title="取消收藏" type="button"><Trash2 size={13} /></button>
        </span>
      </span>
    </div>
  );
}

function BoardDetailView() {
  const board = useAppStore((state) => state.selectedBoard);
  const setSelectedStock = useAppStore((state) => state.setSelectedStock);
  if (!board) return null;
  const stocks = board.constituents ?? [];
  return (
    <div className={styles['board-detail']}>
      <div className={styles['stock-header']}>
        <div className={styles['stock-name']}>{board.name}<span className={styles.code}>{board.code} · 板块</span></div>
        <div className={cx(styles['board-change'], String(board.changePercent).startsWith('-') ? 'down' : 'up')}>{board.changePercent ?? '--'}</div>
      </div>
      <div className={styles['board-stock-section']}>
        <div className={styles['section-title']}>成分股 <span>{stocks.length} 只</span></div>
        <div className={styles['board-stock-list']}>
          {stocks.length ? stocks.map((stock) => <BoardStockItem key={stock.code} stock={stock} onClick={() => setSelectedStock({ ...stock, turnover: stock.turnover ?? stock.amount, summary: `${board.name}板块成分股。` })} />) : <div className={styles['empty-list']}>暂无成分股数据</div>}
        </div>
      </div>
    </div>
  );
}

function BoardStockItem({ stock, onClick }: { stock: BoardConstituent; onClick(): void }) {
  return (
    <button className={styles['board-stock-item']} onClick={onClick} type="button">
      <span><b>{stock.name}</b><em>{stock.code}</em></span>
      <span className={String(stock.changePercent).startsWith('-') ? 'down' : 'up'}>{stock.changePercent ?? '--'}</span>
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

function SurgeItem({ item, onClick }: { item: HotFocusItem; onClick(): void }) {
  const isDown = String(item.changePercent).startsWith('-');
  return (
    <button className={styles['surge-item']} onClick={onClick} type="button">
      <span className={styles['surge-time']}>{item.time ?? '--'}</span>
      <span className={styles['surge-card']}>
        <span className={styles['surge-main']}>
          <b>{item.name ?? item.title}<em>{item.code}</em></b>
          <small>当前 <span>{item.price ?? '--'}</span><span className={isDown ? 'down' : 'up'}>{item.changePercent ?? '--'}</span></small>
        </span>
        <span className={styles['surge-action']}>
          <span>{surgeReason(item)}</span>
          {hasSurgeAmount(item.amount) ? <small>{item.amount}</small> : null}
        </span>
      </span>
    </button>
  );
}

function surgeReason(item: HotFocusItem) {
  const reason = item.tag ?? item.description?.split(' · ')[0] ?? '--';
  return ({ 涨停池: '封涨停板', 炸板池: '涨停开板', 跌停池: '封跌停板' } as Record<string, string>)[reason] ?? reason;
}

function hasSurgeAmount(amount?: string) {
  return Boolean(amount && !/^(?:封单|成交额)?[+-]?0(?:\.00)?(?:手|万|亿)?$/.test(amount));
}

function NewsSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className={styles['news-skeleton']}>
      {Array.from({ length: rows }, (_, index) => <Skeleton key={index} active paragraph={{ rows: 1 }} title={{ width: '72%' }} className={styles['news-skeleton-row']} />)}
    </div>
  );
}

function NewsItem({ item }: { item: MarketNewsItem }) {
  const content = (
    <>
      <div className={styles['news-time']}>{item.time}{item.source ? ` · ${item.source}` : ''}</div>
      <div className={styles['news-title']}>{item.title}</div>
      <div className={styles['news-tags']}>{item.tags.map((tag) => <span className={cx(styles.nt, item.tagType ? styles[item.tagType] : undefined)} key={tag}>{tag}</span>)}</div>
    </>
  );
  if (!item.url) return <div className={styles['news-item']}>{content}</div>;
  return <button className={styles['news-item']} onClick={() => window.open(item.url, '_blank', 'noopener,noreferrer')} type="button">{content}</button>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className={styles.si}><div className={styles.lbl}>{label}</div><div className={styles.v}>{value}</div></div>;
}

function Rating({ label, score, tone }: { label: string; score: string; tone: 'up' | 'warn' }) {
  return <div className={styles.r}><div className={cx(styles.s, tone === 'warn' ? styles.warn : 'up')}>{score}</div><div className={styles.l}>{label}</div></div>;
}
