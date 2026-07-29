import { ArrowLeft, Compass } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getStocksenseApi } from '../../shared/stocksense-api';
import { useAppStore } from '../../store/app-store';
import cx from '../../shared/cx';
import { HeroGauge } from './components/hero-gauge';
import { MarketSummary } from './components/market-summary';
import { MonitoringCenter } from './components/monitoring-center';
import { SentimentIndex } from './components/sentiment-index';
import { DragonTiger } from './components/dragon-tiger';
import { HotRotation } from './components/hot-rotation';
import { LimitUpReview } from './components/limit-up-review';
import { TomorrowPreview } from './components/tomorrow-preview';
import { SubscribeFooter } from './components/subscribe-footer';
import styles from './index.module.scss';

interface IDiscoverySnapshot {
  tradeDate: string;
  generatedAt: string;
  score?: number;
  scoreLabel?: string;
  scoreVerdict?: string;
  scoreTrend?: number[];
  indices?: Array<{ code: string; name: string; price?: number | string; changePercent?: number | string }>;
  bullets?: string[];
  wealthMetrics?: Array<{ label: string; value: number | null; unit: string }>;
  sentimentScore?: number | null;
  sentimentFactors?: Array<{ label: string; value: string | number }>;
  sentimentStocks?: { zt: TStockItem[]; dt: TStockItem[]; zb: TStockItem[] };
  consecutiveStocks?: TStockItem[];
  yesterdayZt?: TStockItem[];
  yesterdayLb?: TStockItem[];
  leaders?: Array<{ code: string; name: string; height?: number | null; amount?: number | null; concepts?: string[]; changePercent?: number | null }>;
  hotThemes?: Array<{ name: string; score?: number | null; changePercent?: number | null; limitUpCount?: number | null; reason?: string | null; leaderName?: string | null; leaderCode?: string | null }>;
  limitUps?: Array<{ code: string; name: string; height: string; reason: string }>;
  dragonTiger?: {
    inst: Array<{ code: string; name: string; changePercent?: number; netBuy: number; reason: string }>;
    hot: Array<{ code: string; name: string; changePercent?: number; netBuy: number; reason: string }>;
    north: Array<{ code: string; name: string; changePercent?: number; netBuy: number; reason: string }>;
  };
  nextDayFocus?: Array<{ category: string; condition: string; baseline?: number | null }>;
  watchlistQuotes?: Array<{ code: string; name: string; price?: number | string; changePercent?: number | string }>;
}

type TStockItem = { code: string; name: string; price?: string; changePercent?: string; amount?: string };

const PILLS = [
  { id: 'hero', label: '机会分' },
  { id: 'sec-summary', label: '市场总结' },
  { id: 'sec-watchlist', label: '监控中心' },
  { id: 'sec-sentiment', label: '情绪指数' },
  { id: 'sec-dragontiger', label: '龙虎榜' },
  { id: 'sec-hotrotation', label: '热点轮动' },
  { id: 'sec-limitup', label: '涨停复盘' },
  { id: 'sec-tomorrow', label: '明日预判' },
];

function formatDate(date: Date) {
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d} ${weekdays[date.getDay()]}`;
}

export function DiscoveryView() {
  const setMainView = useAppStore((state) => state.setMainView);
  const [snapshot, setSnapshot] = useState<IDiscoverySnapshot | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activePill, setActivePill] = useState('hero');
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const api = getStocksenseApi();
      const data = await api.getDiscoverySnapshot();
      setSnapshot(data as unknown as IDiscoverySnapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : '数据加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // IntersectionObserver for pill active state
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const sections = scroll.querySelectorAll<HTMLElement>('[data-discovery-section]');
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length) {
          const target = visible[0].target as HTMLElement;
      setActivePill(target.dataset.discoverySection ?? 'hero');
        }
      },
      { root: scroll, rootMargin: '-10% 0px -70% 0px', threshold: 0 },
    );
    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [snapshot]);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const dateStr = useMemo(() => formatDate(new Date()), []);

  return (
    <section className={styles.wrap}>
      {/* ── Topbar ── */}
      <div className={styles.topbar}>
        <button className={styles.backBtn} onClick={() => setMainView('chat')} type="button">
          <ArrowLeft size={15} />
          返回
        </button>
        <h1 className={styles.title}>
          <Compass size={18} />
          今日机会
        </h1>
        <span className={styles.date}>{snapshot?.tradeDate ? `${snapshot.tradeDate} ${dateStr.slice(11)}` : dateStr}</span>
        <div className={styles.topbarRight}>
          <span className={styles.phasePill}>
            <span className={styles.liveDot} />
            盘中
          </span>
        </div>
      </div>

      {/* ── Pill Nav ── */}
      <div className={styles.pillNav}>
        {PILLS.map((pill) => (
          <button
            key={pill.id}
            className={cx(styles.pill, activePill === pill.id && styles.pillActive)}
            onClick={() => scrollTo(pill.id)}
            type="button"
          >
            {pill.label}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div className={styles.scroll} ref={scrollRef}>
        <div className={styles.inner}>
          {loading ? (
            <div className={styles.loadingState}>
              <div className={styles.skeletonHero} />
              <div className={styles.skeletonLine} />
              <div className={styles.skeletonLine} />
              <div className={styles.skeletonLine} />
            </div>
          ) : error ? (
            <div className={styles.errorState}>
              <span className={styles.errorIcon}>⚠️</span>
              <p>{error}</p>
              <button className={styles.retryBtn} onClick={load} type="button">重试</button>
            </div>
          ) : !snapshot ? (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}>📊</span>
              <p>暂无今日机会数据</p>
            </div>
          ) : (
            <>
              {/* Hero Gauge */}
              <div data-discovery-section="hero" id="hero" className={styles.section}>
                <div className={styles.heroCard}>
                  <HeroGauge
                    score={snapshot.score}
                    scoreLabel={snapshot.scoreLabel}
                    scoreVerdict={snapshot.scoreVerdict}
                    scoreTrend={snapshot.scoreTrend}
                  />
                </div>
              </div>

              {/* Market Summary */}
              <div data-discovery-section="sec-summary" id="sec-summary" className={styles.section}>
                <div className={styles.sectionHead}>
                  <span className={styles.sectionIcon}>📰</span>
                  <h2 className={styles.sectionTitle}>AI 今日市场总结</h2>
                </div>
                <div className={styles.card}>
                  <MarketSummary indices={snapshot.indices} bullets={snapshot.bullets} wealthMetrics={snapshot.wealthMetrics} />
                </div>
              </div>

              {/* AI Monitor Center */}
              <div data-discovery-section="sec-watchlist" id="sec-watchlist" className={styles.section}>
                <div className={styles.sectionHead}>
                  <span className={styles.sectionIcon}>👁️</span>
                  <h2 className={styles.sectionTitle}>AI 监控中心</h2>
                </div>
                <div className={styles.card}>
                  <MonitoringCenter />
                </div>
              </div>

              {/* Sentiment Index */}
              <div data-discovery-section="sec-sentiment" id="sec-sentiment" className={styles.section}>
                <div className={styles.sectionHead}>
                  <span className={styles.sectionIcon}>🌡️</span>
                  <h2 className={styles.sectionTitle}>AI 情绪指数</h2>
                </div>
                <div className={styles.card}>
                  <SentimentIndex
                    score={snapshot.sentimentScore}
                    factors={snapshot.sentimentFactors}
                    stocks={snapshot.sentimentStocks}
                    consecutiveStocks={snapshot.consecutiveStocks}
                    yesterdayZt={snapshot.yesterdayZt}
                    yesterdayLb={snapshot.yesterdayLb}
                    leaders={snapshot.leaders}
                  />
                </div>
              </div>

              {/* Dragon Tiger */}
              <div data-discovery-section="sec-dragontiger" id="sec-dragontiger" className={styles.section}>
                <div className={styles.sectionHead}>
                  <span className={styles.sectionIcon}>🐉</span>
                  <h2 className={styles.sectionTitle}>AI 今日龙虎榜</h2>
                </div>
                <div className={styles.card}>
                  <DragonTiger
                    inst={snapshot.dragonTiger?.inst ?? []}
                    hot={snapshot.dragonTiger?.hot ?? []}
                    north={snapshot.dragonTiger?.north ?? []}
                  />
                </div>
              </div>

              {/* Hot Rotation */}
              <div data-discovery-section="sec-hotrotation" id="sec-hotrotation" className={styles.section}>
                <div className={styles.sectionHead}>
                  <span className={styles.sectionIcon}>🔥</span>
                  <h2 className={styles.sectionTitle}>AI 热点轮动</h2>
                </div>
                <div className={styles.card}>
                  <HotRotation themes={snapshot.hotThemes} />
                </div>
              </div>

              {/* Limit Up Review */}
              <div data-discovery-section="sec-limitup" id="sec-limitup" className={styles.section}>
                <div className={styles.sectionHead}>
                  <span className={styles.sectionIcon}>📈</span>
                  <h2 className={styles.sectionTitle}>AI 涨停复盘</h2>
                </div>
                <div className={styles.card}>
                  <LimitUpReview items={snapshot.limitUps} />
                </div>
              </div>

              {/* Tomorrow Preview */}
              <div data-discovery-section="sec-tomorrow" id="sec-tomorrow" className={styles.section}>
                <div className={styles.sectionHead}>
                  <span className={styles.sectionIcon}>🔮</span>
                  <h2 className={styles.sectionTitle}>AI 明日预判</h2>
                </div>
                <div className={styles.card}>
                  <TomorrowPreview items={snapshot.nextDayFocus} />
                </div>
              </div>
            </>
          )}
          <SubscribeFooter />
        </div>
      </div>
    </section>
  );
}
