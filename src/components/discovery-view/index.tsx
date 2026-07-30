import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CalendarClock,
  Compass,
  Eye,
  Flame,
  Newspaper,
  Target,
  Thermometer,
  TrendingUp,
  Trophy,
} from 'lucide-react';
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
import { TradingAdvice } from './components/trading-advice';
import { SubscribeFooter } from './components/subscribe-footer';
import styles from './index.module.scss';

type TStockItem = { code: string; name: string; price?: string; changePercent?: string; amount?: string };

type TAshareMarketPhase = { label: string; isTrading: boolean };

interface ISectorSummary {
  code: string;
  name: string;
  changePercent: number;
  mainNetInflow: number;
  amount?: number;
}

interface IOpportunityRadarItem {
  code: string;
  name: string;
  ratio: number;
  changePercent: number;
  mainNetInflow: number;
}

interface IMonthlyThemeItem {
  week: string;
  theme: string;
  leader: { code: string; name: string } | null;
}

interface INextWeekSector {
  name: string;
  score: number;
  reasoning: {
    fundFlow: string;
    news: string;
    policy: string;
    technical: string;
    rotation: string;
  };
}

interface IMarketSummary {
  indices: Array<{ code: string; name: string; price: number; changePercent: number }>;
  mainFundFlow: number | null;
  northFundFlow: number | null;
  limitUp: number;
  limitDown: number;
  sentimentBar: number;
  sectors: ISectorSummary[];
  opportunityRadar: IOpportunityRadarItem[];
  monthlyThemes: IMonthlyThemeItem[];
  nextWeekSectors: INextWeekSector[];
}

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
  marketSummary?: IMarketSummary;
  sentimentScore?: number | null;
  sentimentFactors?: Array<{ label: string; value: string | number }>;
  sentimentStocks?: { zt: TStockItem[]; dt: TStockItem[]; zb: TStockItem[] };
  consecutiveStocks?: TStockItem[];
  yesterdayZt?: TStockItem[];
  yesterdayLb?: TStockItem[];
  leaders?: Array<{ code: string; name: string; height?: number | null; amount?: number | null; concepts?: string[]; changePercent?: number | null }>;
  hotThemes?: Array<{ name: string; score?: number | null; changePercent?: number | null; limitUpCount?: number | null; reason?: string | null; leaderName?: string | null; leaderCode?: string | null; leaders?: Array<{ code: string; name: string; height?: number | null }> }>;
  limitUps?: Array<{ code: string; name: string; height: string; reason: string }>;
  dragonTiger?: {
    inst: Array<{ code: string; name: string; changePercent?: number; netBuy: number; reason: string }>;
    hot: Array<{ code: string; name: string; changePercent?: number; netBuy: number; reason: string }>;
    north: Array<{ code: string; name: string; changePercent?: number; netBuy: number; reason: string }>;
  };
  nextDayFocus?: Array<{ category: string; condition: string; baseline?: number | null }>;
  watchlistQuotes?: Array<{ code: string; name: string; price?: number | string; changePercent?: number | string }>;
}

const PILLS = [
  { id: 'hero', label: '机会分' },
  { id: 'sec-summary', label: '市场总结' },
  { id: 'sec-watchlist', label: '监控中心' },
  { id: 'sec-sentiment', label: '情绪指数' },
  { id: 'sec-dragontiger', label: '龙虎榜' },
  { id: 'sec-hotrotation', label: '热点轮动' },
  { id: 'sec-limitup', label: '涨停复盘' },
  { id: 'sec-tomorrow', label: '明日预判' },
  { id: 'sec-trading-advice', label: '交易建议' },
];

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

function formatDate(date: Date) {
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d} ${weekdays[date.getDay()]}`;
}

const SECTION_ICONS: Record<string, typeof Newspaper> = {
  'sec-summary': Newspaper,
  'sec-watchlist': Eye,
  'sec-sentiment': Thermometer,
  'sec-dragontiger': Trophy,
  'sec-hotrotation': Flame,
  'sec-limitup': TrendingUp,
  'sec-tomorrow': CalendarClock,
  'sec-trading-advice': Target,
};

function toDiscoverySnapshot(input: Record<string, unknown>): IDiscoverySnapshot {
  return {
    ...input,
    tradeDate: typeof input.tradeDate === 'string' ? input.tradeDate : '',
    generatedAt: typeof input.generatedAt === 'string' ? input.generatedAt : new Date().toISOString(),
  } as IDiscoverySnapshot;
}

function SectionTitle({ id, title }: { id: string; title: string }) {
  const Icon = SECTION_ICONS[id] ?? BarChart3;
  return (
    <div className={styles.sectionHead}>
      <Icon className={styles.sectionIcon} size={16} />
      <h2 className={styles.sectionTitle}>{title}</h2>
    </div>
  );
}

function SectionSkeleton() {
  return (
    <div className={styles.localSkeleton}>
      <div className={styles.skeletonLine} />
      <div className={styles.skeletonLine} />
      <div className={styles.skeletonLine} />
    </div>
  );
}

function HeroGaugeSkeleton() {
  return (
    <div className="hero-gauge-wrap hero-gauge-skeleton" aria-label="机会评分加载中">
      <div className="hero-gauge-skeleton-arc" />
      <div className="hero-gauge-skeleton-body">
        <div className="hero-gauge-skeleton-line short" />
        <div className="hero-gauge-skeleton-line" />
        <div className="hero-gauge-skeleton-line" />
        <div className="hero-gauge-skeleton-trend" />
      </div>
    </div>
  );
}

export function DiscoveryView() {
  const setMainView = useAppStore((state) => state.setMainView);
  const isLeftSidebarCollapsed = useAppStore((state) => state.isLeftSidebarCollapsed);
  const [snapshot, setSnapshot] = useState<IDiscoverySnapshot | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activePill, setActivePill] = useState('hero');
  const [marketPhase, setMarketPhase] = useState(() => getAshareMarketPhase(new Date()));
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const api = getStocksenseApi();
      const data = await api.getDiscoverySnapshot();
      setSnapshot(toDiscoverySnapshot(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : '数据加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setMarketPhase(getAshareMarketPhase(new Date()));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

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
      <div className={cx(styles.topbar, isLeftSidebarCollapsed && styles.topbarCollapsed)}>
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
          <span className={cx(styles.phasePill, !marketPhase.isTrading && styles.phasePillInactive)}>
            <span className={cx(styles.liveDot, !marketPhase.isTrading && styles.liveDotInactive)} />
            {marketPhase.label}
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
          {error && !snapshot ? (
            <div className={styles.inlineErrorState}>
              <AlertTriangle size={16} />
              <p>{error}</p>
              <button className={styles.retryBtn} onClick={load} type="button">重试</button>
            </div>
          ) : null}

          {/* Hero Gauge */}
          <div data-discovery-section="hero" id="hero" className={styles.section}>
            <div className={styles.heroCard}>
              {loading && !snapshot ? (
                <HeroGaugeSkeleton />
              ) : (
                <HeroGauge
                  score={snapshot?.score}
                  scoreLabel={snapshot?.scoreLabel}
                  scoreVerdict={snapshot?.scoreVerdict}
                  scoreTrend={snapshot?.scoreTrend}
                />
              )}
            </div>
          </div>

          {/* Market Summary */}
          <div data-discovery-section="sec-summary" id="sec-summary" className={styles.section}>
            <SectionTitle id="sec-summary" title="AI 今日市场总结" />
            <div className={styles.card}>
              {loading && !snapshot ? (
                <SectionSkeleton />
              ) : (
                <MarketSummary
                  indices={snapshot?.indices}
                  bullets={snapshot?.bullets}
                  wealthMetrics={snapshot?.wealthMetrics}
                  marketSummary={snapshot?.marketSummary}
                />
              )}
            </div>
          </div>

          {/* AI Monitor Center */}
          <div data-discovery-section="sec-watchlist" id="sec-watchlist" className={styles.section}>
            <SectionTitle id="sec-watchlist" title="AI 监控中心" />
            <div className={styles.card}>
              <MonitoringCenter />
            </div>
          </div>

          {/* Sentiment Index */}
          <div data-discovery-section="sec-sentiment" id="sec-sentiment" className={styles.section}>
            <SectionTitle id="sec-sentiment" title="AI 情绪指数" />
            <div className={styles.card}>
              {loading && !snapshot ? (
                <SectionSkeleton />
              ) : (
                <SentimentIndex
                  score={snapshot?.sentimentScore}
                  factors={snapshot?.sentimentFactors}
                  stocks={snapshot?.sentimentStocks}
                  consecutiveStocks={snapshot?.consecutiveStocks}
                  yesterdayZt={snapshot?.yesterdayZt}
                  yesterdayLb={snapshot?.yesterdayLb}
                  leaders={snapshot?.leaders}
                />
              )}
            </div>
          </div>

          {/* Dragon Tiger */}
          <div data-discovery-section="sec-dragontiger" id="sec-dragontiger" className={styles.section}>
            <SectionTitle id="sec-dragontiger" title="AI 今日龙虎榜" />
            <div className={styles.card}>
              {loading && !snapshot ? (
                <SectionSkeleton />
              ) : (
                <DragonTiger
                  inst={snapshot?.dragonTiger?.inst ?? []}
                  hot={snapshot?.dragonTiger?.hot ?? []}
                  north={snapshot?.dragonTiger?.north ?? []}
                />
              )}
            </div>
          </div>

          {/* Hot Rotation */}
          <div data-discovery-section="sec-hotrotation" id="sec-hotrotation" className={styles.section}>
            <SectionTitle id="sec-hotrotation" title="AI 热点轮动" />
            <div className={styles.card}>
              {loading && !snapshot ? <SectionSkeleton /> : <HotRotation themes={snapshot?.hotThemes} />}
            </div>
          </div>

          {/* Limit Up Review */}
          <div data-discovery-section="sec-limitup" id="sec-limitup" className={styles.section}>
            <SectionTitle id="sec-limitup" title="AI 涨停复盘" />
            <div className={styles.card}>
              {loading && !snapshot ? <SectionSkeleton /> : <LimitUpReview items={snapshot?.limitUps} />}
            </div>
          </div>

          {/* Tomorrow Preview */}
          <div data-discovery-section="sec-tomorrow" id="sec-tomorrow" className={styles.section}>
            <SectionTitle id="sec-tomorrow" title="AI 明日预判" />
            <div className={styles.card}>
              {loading && !snapshot ? <SectionSkeleton /> : <TomorrowPreview items={snapshot?.nextDayFocus} />}
            </div>
          </div>

          {/* Trading Advice */}
          <div data-discovery-section="sec-trading-advice" id="sec-trading-advice" className={styles.section}>
            <SectionTitle id="sec-trading-advice" title="AI 交易建议" />
            <div className={styles.card}>
              <TradingAdvice />
            </div>
          </div>
          <SubscribeFooter />
        </div>
      </div>
    </section>
  );
}
