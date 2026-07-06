import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { useAppStore } from '../../store/app-store';
import { getStocksenseApi } from '../../shared/stocksense-api';
import type { BoardConstituent, ChipDistribution, KlinePoint, MarketNewsItem, StockDetail } from '../../shared/types';
import styles from './index.module.scss';
import cx from '../../shared/cx';


const NEWS_PAGE_SIZE = 30;

const CHIP_WIDTH = 108;

const timeframes = [
  { id: '15m', label: '15分钟', limit: 48 },
  { id: '1h', label: '1小时', limit: 72 },
  { id: '4h', label: '4小时', limit: 90 },
  { id: '1d', label: '天', limit: 120 },
  { id: '1w', label: '周', limit: 104 },
  { id: '1mo', label: '月', limit: 60 },
];

export function StockDetailPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const [tf, setTf] = useState('1d');
  const [newsQuery, setNewsQuery] = useState('');
  const [newsPage, setNewsPage] = useState(1);
  const [newsRefresh, setNewsRefresh] = useState(0);
  const [newsTotal, setNewsTotal] = useState(0);
  const [newsLoading, setNewsLoading] = useState(false);
  const [news, setNews] = useState<MarketNewsItem[]>([]);
  const [kline, setKline] = useState<KlinePoint[]>([]);
  const [klineHoverIndex, setKlineHoverIndex] = useState<number | undefined>();
  const [isKlineModalOpen, setKlineModalOpen] = useState(false);
  const [chipsOpen, setChipsOpen] = useState(true);
  const selectedStock = useAppStore((state) => state.selectedStock);
  const selectedBoard = useAppStore((state) => state.selectedBoard);
  const theme = useAppStore((state) => state.config?.theme ?? 'dark');
  const limit = timeframes.find((item) => item.id === tf)?.limit ?? 120;
  const klineData = selectedStock ? (kline.length ? kline : makeKData(Number(selectedStock.price) || 100, limit, tf)) : [];

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
    if (!selectedStock) {
      setKline([]);
      return;
    }
    let alive = true;
    const limit = timeframes.find((item) => item.id === tf)?.limit ?? 120;
    const api = getStocksenseApi();
    api.getKline(selectedStock.code, limit, tf).then((data) => {
      if (alive) setKline(data);
    }).catch(() => {
      if (alive) setKline([]);
    });
    return () => { alive = false; };
  }, [selectedStock?.code, tf]);

  useEffect(() => {
    if (!selectedStock || !canvasRef.current) return;
    const limit = timeframes.find((item) => item.id === tf)?.limit ?? 21;
    const data = kline.length ? kline : makeKData(Number(selectedStock.price) || 100, limit, tf);
    const chips = tf === '1d' && chipsOpen ? estimateChips(data, klineHoverIndex) : undefined;
    drawKLine(canvasRef.current, data, theme, chips, klineHoverIndex, false);
  }, [selectedStock, tf, theme, kline, chipsOpen, klineHoverIndex]);

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
  const hoverKline = klineHoverIndex === undefined ? undefined : klineData[klineHoverIndex];

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
            <canvas
              ref={canvasRef}
              onMouseMove={(event) => setKlineHoverIndex(getKlineHoverIndex(event, klineData, chipsOpen))}
              onMouseLeave={() => setKlineHoverIndex(undefined)}
            />
            {hoverKline ? <KlineHoverInfo point={hoverKline} previous={klineHoverIndex ? klineData[klineHoverIndex - 1] : undefined} pe={selectedStock.pe} /> : null}
          {tf === '1d' && (
              <div className={styles['chip-label']}>
                <span><span className={cx(styles.bar, styles.up)} />获利 <span className={cx(styles.bar, styles.down)} />亏损 <span className={styles['chip-note']}>估算</span></span>
                <button className={styles['chip-toggle']} onClick={() => setChipsOpen((value) => !value)} type="button">筹码峰{chipsOpen ? '收起' : '展开'}</button>
              </div>
            )}
            <div className={styles['kline-tf']}>
              {timeframes.map((item) => <button key={item.id} className={cx(styles['tf-btn'], tf === item.id && styles.active)} onClick={() => setTf(item.id)} type="button">{item.label}</button>)}
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
      {isKlineModalOpen && selectedStock ? <KlineModal stock={selectedStock} data={klineData} onClose={() => setKlineModalOpen(false)} chipsOpen={chipsOpen} /> : null}
    </aside>
  );
}

export function getKlineHoverIndex(event: React.MouseEvent<HTMLCanvasElement>, data: KlinePoint[], chipsOpen: boolean) {
  if (!data.length) return undefined;
  const canvas = event.currentTarget;
  const rect = canvas.getBoundingClientRect();
  const width = canvas.clientWidth || 316;
  const chartLeft = 60;
  const chipWidth = chipsOpen ? CHIP_WIDTH : 0;
  const chartRight = width - 8 - chipWidth;
  const gap = (chartRight - chartLeft) / data.length;
  return Math.max(0, Math.min(data.length - 1, Math.floor((event.clientX - rect.left - chartLeft) / gap)));
}

export function KlineHoverInfo({ point, previous, pe }: { point: KlinePoint; previous?: KlinePoint; pe?: string | number }) {
  const change = point.change ?? point.close - (previous?.close ?? point.open);
  const changePercent = point.changePercent ?? (previous?.close ? (change / previous.close) * 100 : 0);
  return (
    <div className={styles['kline-hover-info']}>
      <div className={styles.date}>{formatKlineTime(point.time)}</div>
      <KlineInfoRow label="开盘" value={formatPrice(point.open)} />
      <KlineInfoRow label="最高" value={formatPrice(point.high)} tone={point.high >= point.open ? 'up' : 'down'} />
      <KlineInfoRow label="最低" value={formatPrice(point.low)} tone={point.low >= point.open ? 'up' : 'down'} />
      <KlineInfoRow label="收盘" value={formatPrice(point.close)} tone={point.close >= point.open ? 'up' : 'down'} />
      <KlineInfoRow label="涨跌额" value={formatSigned(change)} tone={change >= 0 ? 'up' : 'down'} />
      <KlineInfoRow label="涨跌幅" value={`${formatSigned(changePercent)}%`} tone={changePercent >= 0 ? 'up' : 'down'} />
      <KlineInfoRow label="换手率" value={point.turnoverRate === undefined || Number.isNaN(point.turnoverRate) ? '--' : `${point.turnoverRate.toFixed(2)}%`} />
      <KlineInfoRow label="成交量" value={formatVolume(point.volume)} />
      <KlineInfoRow label="成交额" value={formatMoney(point.amount)} />
      <KlineInfoRow label="市盈率" value={String(point.pe ?? pe ?? '--')} />
    </div>
  );
}

function KlineInfoRow({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return <div className={styles['kline-info-row']}><span>{label}</span><b className={tone ? styles[tone] : undefined}>{value}</b></div>;
}

function formatKlineTime(value: string) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(text)) return text;
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const timestamp = Number(text);
  if (Number.isFinite(timestamp) && timestamp > 10_000_000_000) return new Date(timestamp).toLocaleDateString('zh-CN');
  return text || '--';
}

function formatPrice(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : '--';
}

function formatSigned(value: number) {
  if (!Number.isFinite(value)) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function formatVolume(value: number) {
  if (!Number.isFinite(value)) return '--';
  return value >= 10000 ? `${(value / 10000).toFixed(2)}万手` : `${value.toFixed(0)}手`;
}

function formatMoney(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return '--';
  if (Math.abs(value) >= 100000000) return `${(value / 100000000).toFixed(2)}亿`;
  if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(2)}万`;
  return value.toFixed(0);
}

export function KlineModal({ stock, data, onClose, chipsOpen = true }: { stock: Pick<StockDetail, 'code' | 'name' | 'pe'>; data: KlinePoint[]; onClose(): void; chipsOpen?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tf, setTf] = useState('1d');
  const [hoverIndex, setHoverIndex] = useState<number | undefined>();
  const [modalData, setModalData] = useState(data);
  const theme = useAppStore((state) => state.config?.theme ?? 'dark');
  const hoverKline = hoverIndex === undefined ? undefined : modalData[hoverIndex];

  useEffect(() => setModalData(data), [data]);

  useEffect(() => {
    if (!stock.code) return;
    let alive = true;
    const limit = timeframes.find((item) => item.id === tf)?.limit ?? 120;
    getStocksenseApi().getKline(stock.code, limit, tf).then((next) => {
      if (alive && next.length) setModalData(next);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [stock.code, tf]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const chips = tf === '1d' && chipsOpen ? estimateChips(modalData, hoverIndex) : undefined;
    drawKLine(canvasRef.current, modalData, theme, chips, hoverIndex, true);
  }, [modalData, theme, chipsOpen, hoverIndex, tf]);

  return (
    <div className={styles['kline-modal-overlay']} onClick={onClose}>
      <div className={styles['kline-modal']} onClick={(event) => event.stopPropagation()}>
        <div className={styles['kline-modal-header']}>
          <div>{stock.name}（{stock.code || '--'}）K线图</div>
          <button onClick={onClose} type="button">✕</button>
        </div>
        <div className={styles['kline-modal-chart']}>
          <canvas
            ref={canvasRef}
            onMouseMove={(event) => setHoverIndex(getKlineHoverIndex(event, modalData, chipsOpen && tf === '1d'))}
            onMouseLeave={() => setHoverIndex(undefined)}
          />
          {hoverKline ? <KlineHoverInfo point={hoverKline} previous={hoverIndex ? modalData[hoverIndex - 1] : undefined} pe={stock.pe} /> : null}
        </div>
        <div className={styles['kline-modal-footer']}>
          <div className={styles['modal-tf']}>{timeframes.map((item) => <button key={item.id} className={cx(styles['tf-btn'], tf === item.id && styles.active)} onClick={() => setTf(item.id)} type="button">{item.label}</button>)}</div>
        </div>
      </div>
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

export function drawKLine(canvas: HTMLCanvasElement, data: KlinePoint[], theme: string, chips?: ChipDistribution, hoverIndex?: number, showMACD = true) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !data.length) return;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 316;
  const height = canvas.clientHeight || 190;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const style = getComputedStyle(document.documentElement);
  const gridColor = style.getPropertyValue('--kline-grid').trim();
  const volUpColor = style.getPropertyValue('--kline-vol-up').trim();
  const volDownColor = style.getPropertyValue('--kline-vol-down').trim();
  const labelColor = style.getPropertyValue('--kline-label').trim();
  const success = theme === 'light' ? '#16A34A' : '#22C55E';
  const danger = theme === 'light' ? '#DC2626' : '#EF4444';
  const chartTop = 8;
  const chartBottom = height - (showMACD ? 78 : 42);
  const chartLeft = 60;
  const chipWidth = chips?.points.length ? CHIP_WIDTH : 0;
  const chartRight = width - 8 - chipWidth;
  const chartHeight = chartBottom - chartTop;
  const volTop = chartBottom + 2;
  const volHeight = 28;
  const macdTop = volTop + volHeight + 6;
  const macdHeight = 34;
  const high = Math.max(...data.map((d) => d.high)) * 1.02;
  const low = Math.min(...data.map((d) => d.low)) * 0.98;
  const range = high - low || 1;
  const maxVol = Math.max(...data.map((d) => d.volume));

  drawChips(ctx, chips, chartRight + 8, width - 8, chartTop, chartBottom, low, high, theme);
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i += 1) {
    const y = chartTop + (chartHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(chartLeft, y);
    ctx.lineTo(chartRight, y);
    ctx.stroke();
    ctx.fillStyle = labelColor;
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText((high - (range / 4) * i).toFixed(2), chartLeft - 4, y + 3);
  }

  const gap = (chartRight - chartLeft) / data.length;
  const candleWidth = Math.min(gap * 0.7, 5);
  data.forEach((d, index) => {
    const x = chartLeft + index * gap + gap / 2;
    const openY = chartTop + ((high - d.open) / range) * chartHeight;
    const closeY = chartTop + ((high - d.close) / range) * chartHeight;
    const highY = chartTop + ((high - d.high) / range) * chartHeight;
    const lowY = chartTop + ((high - d.low) / range) * chartHeight;
    const color = d.close >= d.open ? success : danger;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, highY);
    ctx.lineTo(x, lowY);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(x - candleWidth / 2, Math.min(openY, closeY), candleWidth, Math.max(Math.abs(closeY - openY), 1));
    ctx.fillStyle = d.close >= d.open ? volUpColor : volDownColor;
    ctx.fillRect(x - candleWidth / 2, volTop + volHeight - (d.volume / maxVol) * volHeight, candleWidth, (d.volume / maxVol) * volHeight);
  });

  drawMA(ctx, data, 5, gap, chartLeft, chartTop, high, range, chartHeight, theme === 'light' ? '#2563EB' : '#60A5FA');
  drawMA(ctx, data, 20, gap, chartLeft, chartTop, high, range, chartHeight, theme === 'light' ? '#D97706' : '#FBBF24');
  if (showMACD) drawMACD(ctx, data, gap, chartLeft, chartRight, macdTop, macdHeight, theme);
  if (hoverIndex !== undefined) drawKlineCrosshair(ctx, hoverIndex, data, gap, chartLeft, chartTop, chartBottom, chartRight, theme);
}

function drawMACD(ctx: CanvasRenderingContext2D, data: KlinePoint[], gap: number, chartLeft: number, chartRight: number, top: number, height: number, theme: string) {
  const ema12 = ema(data.map((item) => item.close), 12);
  const ema26 = ema(data.map((item) => item.close), 26);
  const dif = ema12.map((value, index) => value - ema26[index]);
  const dea = ema(dif, 9);
  const bars = dif.map((value, index) => (value - dea[index]) * 2);
  const max = Math.max(...dif.map(Math.abs), ...dea.map(Math.abs), ...bars.map(Math.abs), 1);
  const mid = top + height / 2;
  const up = theme === 'light' ? '#16A34A' : '#22C55E';
  const down = theme === 'light' ? '#DC2626' : '#EF4444';
  ctx.save();
  ctx.strokeStyle = theme === 'light' ? 'rgba(148,163,184,.55)' : 'rgba(71,85,105,.7)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(chartLeft, mid);
  ctx.lineTo(chartRight, mid);
  ctx.stroke();
  ctx.font = '9px monospace';
  ctx.fillStyle = theme === 'light' ? '#64748B' : '#94A3B8';
  ctx.fillText('MACD', chartLeft - 4, top + 9);
  const barWidth = Math.min(gap * 0.6, 4);
  bars.forEach((bar, index) => {
    const x = chartLeft + index * gap + gap / 2;
    const y = mid - (bar / max) * (height / 2);
    ctx.fillStyle = bar >= 0 ? up : down;
    ctx.fillRect(x - barWidth / 2, Math.min(mid, y), barWidth, Math.max(Math.abs(y - mid), 1));
  });
  drawLine(ctx, dif, gap, chartLeft, top, height, max, '#60A5FA');
  drawLine(ctx, dea, gap, chartLeft, top, height, max, '#FBBF24');
  ctx.restore();
}

function ema(values: number[], period: number) {
  const k = 2 / (period + 1);
  let prev = values[0] ?? 0;
  return values.map((value, index) => {
    prev = index === 0 ? value : value * k + prev * (1 - k);
    return prev;
  });
}

function drawLine(ctx: CanvasRenderingContext2D, values: number[], gap: number, left: number, top: number, height: number, max: number, color: string) {
  const mid = top + height / 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  values.forEach((value, index) => {
    const x = left + index * gap + gap / 2;
    const y = mid - (value / max) * (height / 2);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function drawKlineCrosshair(ctx: CanvasRenderingContext2D, index: number, data: KlinePoint[], gap: number, chartLeft: number, chartTop: number, chartBottom: number, chartRight: number, theme: string) {
  const x = chartLeft + index * gap + gap / 2;
  const color = theme === 'light' ? 'rgba(37,99,235,.8)' : 'rgba(96,165,250,.9)';
  void data;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x, chartTop);
  ctx.lineTo(x, chartBottom);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(Math.max(chartLeft, Math.min(chartRight, x)), chartTop + 5, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMA(ctx: CanvasRenderingContext2D, data: KlinePoint[], period: number, gap: number, chartLeft: number, chartTop: number, high: number, range: number, chartHeight: number, color: string) {
  if (data.length < period) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  let started = false;
  data.forEach((_, index) => {
    if (index < period - 1) return;
    const avg = data.slice(index - period + 1, index + 1).reduce((sum, item) => sum + item.close, 0) / period;
    const x = chartLeft + index * gap + gap / 2;
    const y = chartTop + ((high - avg) / range) * chartHeight;
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
}

function makeKData(basePrice: number, days: number, period = '1d'): KlinePoint[] {
  const step = ({ '15m': 1, '1h': 2, '4h': 3, '1d': 4, '1w': 9, '1mo': 18 } as Record<string, number>)[period] ?? 4;
  let price = basePrice;
  return Array.from({ length: days }, (_, index) => {
    const wave = Math.sin((index * step) / 4) * basePrice * 0.008 * Math.sqrt(step);
    const drift = (index - days / 2) * basePrice * 0.0002 * step;
    const open = price;
    const close = Math.max(1, open + wave + drift);
    const high = Math.max(open, close) * 1.006;
    const low = Math.min(open, close) * 0.994;
    const volume = 10000 + Math.abs(wave) * 2000 + (index % 7) * 1600 * step;
    price = close;
    return { time: String(index + 1), open, close, high, low, volume };
  });
}

function estimateChips(data: KlinePoint[], hoverIndex?: number): ChipDistribution {
  const end = hoverIndex === undefined ? data.length : hoverIndex + 1;
  const recent = data.slice(Math.max(0, end - 90), end);
  const high = Math.max(...recent.map((d) => d.high));
  const low = Math.min(...recent.map((d) => d.low));
  const levels = 42;
  const step = (high - low || 1) / levels;
  const weights = Array.from({ length: levels }, () => 0);
  recent.forEach((item, index) => {
    const price = (item.open + item.close + item.high + item.low) / 4;
    const bucket = Math.max(0, Math.min(levels - 1, Math.floor((price - low) / step)));
    weights[bucket] += Math.max(item.volume, 1) * (0.4 + (index + 1) / recent.length * 0.6);
  });
  const close = recent[recent.length - 1]?.close ?? 0;
  return {
    date: recent[recent.length - 1]?.time ?? '--',
    points: weights.map((weight, index) => {
      const price = low + step * (index + 0.5);
      return { price, weight, profit: close >= price ? 0.7 : 0.3 };
    }).filter((point) => point.weight > 0),
  };
}

function drawChips(ctx: CanvasRenderingContext2D, chips: ChipDistribution | undefined, left: number, right: number, top: number, bottom: number, low: number, high: number, theme: string) {
  if (!chips?.points.length || right <= left) return;
  const range = high - low || 1;
  const maxWeight = Math.max(...chips.points.map((point) => point.weight), 1);
  const chipUp = getComputedStyle(document.documentElement).getPropertyValue('--chip-up').trim() || (theme === 'light' ? 'rgba(22,163,74,0.2)' : 'rgba(34,197,94,0.25)');
  const chipDown = getComputedStyle(document.documentElement).getPropertyValue('--chip-down').trim() || (theme === 'light' ? 'rgba(220,38,38,0.12)' : 'rgba(239,68,68,0.15)');
  const barHeight = Math.max((bottom - top) / Math.min(chips.points.length, 90) * 0.8, 2);

  ctx.save();
  ctx.globalAlpha = 0.95;
  chips.points.forEach((point) => {
    if (!point.price) return;
    const y = top + ((high - point.price) / range) * (bottom - top);
    if (y < top || y > bottom) return;
    const width = ((right - left) * Math.min(point.weight / maxWeight, 1));
    ctx.fillStyle = (point.profit ?? 0) >= 0.5 ? chipUp : chipDown;
    ctx.fillRect(left, y - barHeight / 2, Math.max(width, 1), barHeight);
  });
  ctx.restore();
}
