import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { useAppStore } from '../../store/app-store';
import { getStocksenseApi } from '../../shared/stocksense-api';
import type { BoardConstituent, MarketNewsItem, StockDetail } from '../../shared/types';
import { KlineModal, StockKlineChart } from '../kline-chart';
import styles from './index.module.scss';
import cx from '../../shared/cx';

const NEWS_PAGE_SIZE = 30;

export function StockDetailPanel() {
  const detailRef = useRef<HTMLDivElement>(null);
  const [newsQuery, setNewsQuery] = useState('');
  const [newsPage, setNewsPage] = useState(1);
  const [newsRefresh, setNewsRefresh] = useState(0);
  const [newsTotal, setNewsTotal] = useState(0);
  const [newsLoading, setNewsLoading] = useState(false);
  const [news, setNews] = useState<MarketNewsItem[]>([]);
  const [isKlineModalOpen, setKlineModalOpen] = useState(false);
  const [chipsOpen, setChipsOpen] = useState(true);
  const selectedStock = useAppStore((state) => state.selectedStock);
  const selectedBoard = useAppStore((state) => state.selectedBoard);

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
    if (selectedStock || selectedBoard) return;
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
  }, [selectedStock, selectedBoard, newsQuery, newsPage, newsRefresh]);

  const totalPages = Math.max(1, Math.ceil(newsTotal / NEWS_PAGE_SIZE));

  return (
    <aside className={`${styles['right-panel']} right-panel`}>
      {!selectedStock && !selectedBoard ? (
        <>
          <div className={styles['right-panel-header']}>
            <span className={styles.title}>📰 市场热点</span>
            <div className={styles['rp-search-row']}><input value={newsQuery} onChange={(event) => { setNewsQuery(event.target.value); setNewsPage(1); }} placeholder="搜索新闻…" /></div>
            <button className={styles['news-refresh']} onClick={() => setNewsRefresh((value) => value + 1)} disabled={newsLoading} type="button">{newsLoading ? '刷新中…' : '刷新'}</button>
          </div>
          <div className={styles['right-panel-body']}>
            <div className={styles['news-section-title']}>📌 热门新闻 <span>{newsTotal} 条</span></div>
            <div className={styles['right-news-list']}>
              {newsLoading ? <div className={styles['empty-list']}>加载中…</div> : news.length ? news.map((item) => <NewsItem key={item.id} item={item} />) : <div className={styles['empty-list']}>无匹配新闻</div>}
            </div>
            <div className={styles['news-pager']}>
              <button onClick={() => setNewsPage((value) => Math.max(1, value - 1))} disabled={newsPage <= 1 || newsLoading} type="button">上一页</button>
              <span>{newsPage} / {totalPages}</span>
              <button onClick={() => setNewsPage((value) => Math.min(totalPages, value + 1))} disabled={newsPage >= totalPages || newsLoading} type="button">下一页</button>
            </div>
          </div>
        </>
      ) : selectedBoard ? (
        <BoardDetailView />
      ) : selectedStock ? (
        <div className={styles['stock-detail']} ref={detailRef}>
          <div className={styles['stock-header']} data-stockheader>
            <div className={styles['stock-name']}>{selectedStock.name}<span className={styles.code}>{selectedStock.code} · {selectedStock.exchange ?? 'A股'}</span></div>
            <div className={styles['stock-price']}><div className={styles.price}>{selectedStock.price ?? '--'}</div><div className={cx(styles.chg, String(selectedStock.changePercent).startsWith('-') ? 'down' : 'up')}>{selectedStock.changePercent ?? '--'} ({selectedStock.change ?? '--'})</div></div>
          </div>
          <div className={styles['kline-box']} data-klinebox>
            <button className={styles['kline-expand']} onClick={() => setKlineModalOpen(true)} title="放大K线图" type="button">⛶</button>
            <StockKlineChart stock={selectedStock} data={selectedStock.kline} showSwitcher showChips chipsOpen={chipsOpen} />
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
      ) : null}
      {isKlineModalOpen && selectedStock ? <KlineModal stock={selectedStock} data={selectedStock.kline} onClose={() => setKlineModalOpen(false)} chipsOpen={chipsOpen} /> : null}
    </aside>
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
