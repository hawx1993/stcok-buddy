import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { useAppStore } from '../store/appStore';
import { getStocksenseApi } from '../shared/stocksenseApi';
import type { ChipDistribution, KlinePoint, MarketNewsItem } from '../shared/types';

const NEWS_PAGE_SIZE = 30;

const timeframes = [
  { id: '15m', label: '15分钟', days: 48 },
  { id: '1h', label: '1小时', days: 72 },
  { id: '4h', label: '4小时', days: 90 },
  { id: '1d', label: '天', days: 120 },
  { id: '1w', label: '周', days: 104 },
  { id: '1mo', label: '月', days: 60 },
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
  const [chipsOpen, setChipsOpen] = useState(true);
  const selectedStock = useAppStore((state) => state.selectedStock);
  const theme = useAppStore((state) => state.config?.theme ?? 'dark');

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
    const days = timeframes.find((item) => item.id === tf)?.days ?? 120;
    const api = getStocksenseApi();
    api.getKline(selectedStock.code, days).then((data) => {
      if (alive) setKline(data);
    }).catch(() => {
      if (alive) setKline([]);
    });
    return () => { alive = false; };
  }, [selectedStock?.code, tf]);

  useEffect(() => {
    if (!selectedStock || !canvasRef.current) return;
    const days = timeframes.find((item) => item.id === tf)?.days ?? 21;
    const data = kline.length ? kline : makeKData(Number(selectedStock.price) || 100, days);
    const chips = tf === '1d' && chipsOpen ? estimateChips(data) : undefined;
    drawKLine(canvasRef.current, data, theme, chips);
  }, [selectedStock, tf, theme, kline, chipsOpen]);

  useEffect(() => {
    if (selectedStock) return;
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
  }, [selectedStock, newsQuery, newsPage, newsRefresh]);

  const totalPages = Math.max(1, Math.ceil(newsTotal / NEWS_PAGE_SIZE));

  return (
    <aside className="right-panel">
      {!selectedStock ? (
        <>
          <div className="right-panel-header">
            <span className="title">📰 市场热点</span>
            <div className="rp-search-row"><input value={newsQuery} onChange={(event) => { setNewsQuery(event.target.value); setNewsPage(1); }} placeholder="搜索新闻…" /></div>
            <button className="news-refresh" onClick={() => setNewsRefresh((value) => value + 1)} disabled={newsLoading} type="button">{newsLoading ? '刷新中…' : '刷新'}</button>
          </div>
          <div className="right-panel-body">
            <div className="news-section-title">📌 热门新闻 <span>{newsTotal} 条</span></div>
            <div className="right-news-list">
              {newsLoading ? <div className="empty-list">加载中…</div> : news.length ? news.map((item) => <NewsItem key={item.id} item={item} />) : <div className="empty-list">无匹配新闻</div>}
            </div>
            <div className="news-pager">
              <button onClick={() => setNewsPage((value) => Math.max(1, value - 1))} disabled={newsPage <= 1 || newsLoading} type="button">上一页</button>
              <span>{newsPage} / {totalPages}</span>
              <button onClick={() => setNewsPage((value) => Math.min(totalPages, value + 1))} disabled={newsPage >= totalPages || newsLoading} type="button">下一页</button>
            </div>
          </div>
        </>
      ) : (
        <div className="stock-detail" ref={detailRef}>
          <div className="stock-header" data-stockheader>
            <div className="stock-name">{selectedStock.name}<span className="code">{selectedStock.code} · {selectedStock.exchange ?? 'A股'}</span></div>
            <div className="stock-price"><div className="price">{selectedStock.price ?? '--'}</div><div className={`chg ${String(selectedStock.changePercent).startsWith('-') ? 'down' : 'up'}`}>{selectedStock.changePercent ?? '--'} ({selectedStock.change ?? '--'})</div></div>
          </div>
          <div className="kline-box" data-klinebox>
            <canvas ref={canvasRef} />
            {tf === '1d' && (
              <div className="chip-label">
                <span><span className="bar up" />获利 <span className="bar down" />亏损 <span className="chip-note">估算</span></span>
                <button className="chip-toggle" onClick={() => setChipsOpen((value) => !value)} type="button">筹码峰{chipsOpen ? '收起' : '展开'}</button>
              </div>
            )}
            <div className="kline-tf">
              {timeframes.map((item) => <button key={item.id} className={`tf-btn ${tf === item.id ? 'active' : ''}`} onClick={() => setTf(item.id)} type="button">{item.label}</button>)}
            </div>
          </div>
          <div className="stock-grid" data-stockgrid>
            <Metric label="PE(TTM)" value={selectedStock.pe ?? '--'} />
            <Metric label="PB" value={selectedStock.pb ?? '--'} />
            <Metric label="ROE" value={selectedStock.roe ?? '--'} />
            <Metric label="市值" value={selectedStock.marketCap ?? '--'} />
            <Metric label="成交量" value={selectedStock.volume ?? '--'} />
            <Metric label="成交额" value={selectedStock.turnover ?? '--'} />
          </div>
          <div className="divider" />
          <div className="section-title">综合评级</div>
          <div className="rating-grid" data-rating>
            <Rating label="基本面" score={selectedStock.rating?.fundamental ?? '待评估'} tone="up" />
            <Rating label="估值" score={selectedStock.rating?.valuation ?? '待评估'} tone="warn" />
            <Rating label="技术面" score={selectedStock.rating?.tech ?? '待分析'} tone="warn" />
            <Rating label="风险" score={selectedStock.rating?.risk ?? '中性'} tone="up" />
          </div>
          <div className="divider" />
          <div className="section-title">快评</div>
          <div className="summary-box" data-summary>{selectedStock.summary ?? '暂无摘要。'}</div>
        </div>
      )}
    </aside>
  );
}

function NewsItem({ item }: { item: MarketNewsItem }) {
  const content = (
    <>
      <div className="news-time">{item.time}{item.source ? ` · ${item.source}` : ''}</div>
      <div className="news-title">{item.title}</div>
      <div className="news-tags">{item.tags.map((tag) => <span className={`nt ${item.tagType ?? ''}`} key={tag}>{tag}</span>)}</div>
    </>
  );
  if (!item.url) return <div className="news-item">{content}</div>;
  return <button className="news-item" onClick={() => window.open(item.url, '_blank', 'noopener,noreferrer')} type="button">{content}</button>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="si"><div className="lbl">{label}</div><div className="v">{value}</div></div>;
}

function Rating({ label, score, tone }: { label: string; score: string; tone: 'up' | 'warn' }) {
  return <div className="r"><div className={`s ${tone}`}>{score}</div><div className="l">{label}</div></div>;
}

function drawKLine(canvas: HTMLCanvasElement, data: KlinePoint[], theme: string, chips?: ChipDistribution) {
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
  const maColor = style.getPropertyValue('--kline-ma').trim();
  const volUpColor = style.getPropertyValue('--kline-vol-up').trim();
  const volDownColor = style.getPropertyValue('--kline-vol-down').trim();
  const labelColor = style.getPropertyValue('--kline-label').trim();
  const success = theme === 'light' ? '#16A34A' : '#22C55E';
  const danger = theme === 'light' ? '#DC2626' : '#EF4444';
  const chartTop = 8;
  const chartBottom = height - 42;
  const chartLeft = 60;
  const chipWidth = chips?.points.length ? 58 : 0;
  const chartRight = width - 8 - chipWidth;
  const chartHeight = chartBottom - chartTop;
  const volTop = chartBottom + 2;
  const volHeight = 28;
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

  ctx.strokeStyle = maColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  data.forEach((d, index) => {
    const x = chartLeft + index * gap + gap / 2;
    const y = chartTop + ((high - d.close) / range) * chartHeight;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function makeKData(basePrice: number, days: number): KlinePoint[] {
  let price = basePrice;
  return Array.from({ length: days }, (_, index) => {
    const wave = Math.sin(index / 4) * basePrice * 0.008;
    const drift = (index - days / 2) * basePrice * 0.0002;
    const open = price;
    const close = Math.max(1, open + wave + drift);
    const high = Math.max(open, close) * 1.006;
    const low = Math.min(open, close) * 0.994;
    const volume = 10000 + Math.abs(wave) * 2000 + (index % 7) * 1600;
    price = close;
    return { time: String(index + 1), open, close, high, low, volume };
  });
}

function estimateChips(data: KlinePoint[]): ChipDistribution {
  const recent = data.slice(-90);
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
