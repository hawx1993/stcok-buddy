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
import { MarketPhasePill } from '../market-phase-pill';
import { useAppUiStore } from '../../store/app-store';
import cx from '../../shared/cx';
import { HeroGauge } from './components/hero-gauge';
import { MarketSummary } from './components/market-summary';
import { MonitoringCenter } from './components/monitoring-center';
import { OpportunityRadar } from './components/opportunity-radar';
import { SentimentIndex } from './components/sentiment-index';
import { DragonTiger } from './components/dragon-tiger';
import { HotRotation } from './components/hot-rotation';
import { LimitUpReview } from './components/limit-up-review';
import { TomorrowPreview } from './components/tomorrow-preview';
import { TradingAdvice } from './components/trading-advice';
import { SubscribeFooter } from './components/subscribe-footer';
import styles from './index.module.scss';

type TStockItem = {
  code: string;
  name: string;
  price?: string;
  changePercent?: string;
  amount?: string;
  industry?: string;
};
type TDragonTigerRow = { code: string; name: string; changePercent?: number; netBuy: number; reason: string };
type TDragonTigerDay = {
  date: string;
  weekday: string;
  inst: TDragonTigerRow[];
  hot: TDragonTigerRow[];
  first: TDragonTigerRow[];
};

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

interface IOpportunityRadarData {
  boards: IOpportunityRadarItem[];
  stocks: Array<{
    code: string;
    name: string;
    reason: string;
    changePercent?: number | null;
    amount?: number | null;
    score: number;
  }>;
}

interface IMonthlyThemeItem {
  week: string;
  theme: string;
  leader: { code: string; name: string } | null;
}

interface INextWeekSector {
  code?: string;
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
  opportunityRadar?: IOpportunityRadarData;
  marketSummary?: IMarketSummary;
  sentimentScore?: number | null;
  sentimentFactors?: Array<{ label: string; value: string | number }>;
  sentimentStocks?: { zt: TStockItem[]; dt: TStockItem[]; zb: TStockItem[] };
  consecutiveStocks?: TStockItem[];
  yesterdayZt?: TStockItem[];
  yesterdayLb?: TStockItem[];
  leaders?: Array<{
    code: string;
    name: string;
    height?: number | null;
    amount?: number | null;
    concepts?: string[];
    changePercent?: number | null;
  }>;
  hotThemes?: Array<{
    name: string;
    score?: number | null;
    changePercent?: number | null;
    limitUpCount?: number | null;
    reason?: string | null;
    leaderName?: string | null;
    leaderCode?: string | null;
    leaders?: Array<{ code: string; name: string; height?: number | null }>;
  }>;
  limitUps?: Array<{ code: string; name: string; height: string; reason: string }>;
  dragonTiger?: {
    inst: TDragonTigerRow[];
    hot: TDragonTigerRow[];
    first: TDragonTigerRow[];
  };
  dragonTigerHistory?: TDragonTigerDay[];
  tradeDates?: Array<{ date: string; weekday: string }>;
  nextDayFocus?: Array<{ category: string; condition: string; baseline?: number | null }>;
  watchlistQuotes?: Array<{ code: string; name: string; price?: number | string; changePercent?: number | string }>;
  unavailableReason?: string;
}

const PILLS = [
  { id: 'hero', label: '机会分' },
  { id: 'sec-summary', label: '市场总结' },
  { id: 'sec-opportunity-radar', label: '机会雷达' },
  { id: 'sec-watchlist', label: '监控中心' },
  { id: 'sec-sentiment', label: '情绪指数' },
  { id: 'sec-dragontiger', label: '龙虎榜' },
  { id: 'sec-hotrotation', label: '热点轮动' },
  { id: 'sec-limitup', label: '涨停复盘' },
  { id: 'sec-tomorrow', label: '明日预判' },
  { id: 'sec-trading-advice', label: '交易建议' },
];

function formatDate(date: Date) {
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d} ${weekdays[date.getDay()]}`;
}

function formatTradeDateLabel(date: string) {
  if (!date) return '数据交易日：--';
  const parsed = new Date(`${date}T00:00:00+08:00`);
  const weekday = Number.isNaN(parsed.getTime())
    ? ''
    : ` ${['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][parsed.getDay()]}`;
  return `数据交易日：${date}${weekday}`;
}

function formatTradeDateTab(date: string, weekday?: string) {
  const parts = date.split('-');
  const parsed = new Date(`${date}T00:00:00+08:00`);
  const week =
    weekday?.replace('星期', '周') ||
    (Number.isNaN(parsed.getTime())
      ? '交易日'
      : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][parsed.getDay()]);
  return {
    weekday: week,
    date: parts.length === 3 ? `${parts[1]}-${parts[2]}` : date,
  };
}

function getTradeDateOptions(snapshot?: IDiscoverySnapshot) {
  const seen = new Set<string>();
  const options: Array<{ date: string; weekday?: string }> = [];
  const add = (date?: string, weekday?: string) => {
    if (!date || seen.has(date)) return;
    seen.add(date);
    options.push({ date, weekday });
  };
  snapshot?.tradeDates?.forEach((day) => add(day.date, day.weekday));
  snapshot?.dragonTigerHistory?.forEach((day) => add(day.date, day.weekday));
  add(snapshot?.tradeDate);
  return options.sort((left, right) => left.date.localeCompare(right.date));
}

const SECTION_ICONS: Record<string, typeof Newspaper> = {
  'sec-summary': Newspaper,
  'sec-opportunity-radar': Target,
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
    <div className='hero-gauge-wrap hero-gauge-skeleton' aria-label='机会评分加载中'>
      <div className='hero-gauge-skeleton-arc' />
      <div className='hero-gauge-skeleton-body'>
        <div className='hero-gauge-skeleton-line short' />
        <div className='hero-gauge-skeleton-line' />
        <div className='hero-gauge-skeleton-line' />
        <div className='hero-gauge-skeleton-trend' />
      </div>
    </div>
  );
}

function DiscoveryWaitingState({ message }: { message: string }) {
  return <div className='empty-block'>{message}</div>;
}

export function DiscoveryView() {
  const setMainView = useAppUiStore((state) => state.setMainView);
  const isLeftSidebarCollapsed = useAppUiStore((state) => state.isLeftSidebarCollapsed);
  const [snapshot, setSnapshot] = useState<IDiscoverySnapshot | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activePill, setActivePill] = useState('hero');
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedTradeDate, setSelectedTradeDate] = useState('');
  const [hasScrolled, setHasScrolled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tradeDateNavRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (tradeDate = '') => {
    setLoading(true);
    setError('');
    try {
      const api = getStocksenseApi();
      const data = await api.getDiscoverySnapshot(tradeDate ? { tradeDate } : undefined);
      const nextSnapshot = toDiscoverySnapshot(data);
      setSnapshot(nextSnapshot);
      setSelectedTradeDate(tradeDate || nextSnapshot.tradeDate);
    } catch (err) {
      setError(err instanceof Error ? err.message : '数据加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load('');
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentDate(new Date());
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;

    const syncScrolledState = () => {
      setHasScrolled(scroll.scrollTop > 0);
    };

    syncScrolledState();
    scroll.addEventListener('scroll', syncScrolledState, { passive: true });
    return () => scroll.removeEventListener('scroll', syncScrolledState);
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

  const dateStr = useMemo(() => formatDate(currentDate), [currentDate]);
  const tradeDateLabel = useMemo(
    () => formatTradeDateLabel(selectedTradeDate || snapshot?.tradeDate || ''),
    [snapshot?.tradeDate, selectedTradeDate],
  );
  const tradeDateOptions = useMemo(() => getTradeDateOptions(snapshot), [snapshot]);
  const displayedTradeDate = selectedTradeDate || snapshot?.tradeDate || '';
  const unavailableReason = snapshot?.unavailableReason;

  useEffect(() => {
    const nav = tradeDateNavRef.current;
    if (!nav || !displayedTradeDate) return;
    const activeButton = nav.querySelector<HTMLElement>(`[data-trade-date="${displayedTradeDate}"]`);
    activeButton?.scrollIntoView({ block: 'nearest', inline: 'end' });
  }, [displayedTradeDate, tradeDateOptions]);

  const handleSelectTradeDate = (tradeDate: string) => {
    setSelectedTradeDate(tradeDate);
    void load(tradeDate);
  };

  return (
    <section className={cx(styles.wrap, tradeDateOptions.length > 0 && styles.wrapWithTradeDate)}>
      {/* ── Topbar ── */}
      <div
        className={cx(
          styles.topbar,
          hasScrolled && styles.topbarScrolled,
          isLeftSidebarCollapsed && styles.topbarCollapsed,
        )}
      >
        <button className={styles.backBtn} onClick={() => setMainView('chat')} type='button'>
          <ArrowLeft size={15} />
          返回
        </button>
        <h1 className={styles.title}>
          <Compass size={18} />
          今日机会
        </h1>
        <span className={styles.date}>{tradeDateLabel}</span>
        <span className={styles.currentDate}>当前日期：{dateStr}</span>
        <div className={styles.topbarRight}>
          <MarketPhasePill />
        </div>
      </div>

      {/* ── Trade Date Selector ── */}
      {tradeDateOptions.length ? (
        <div
          className={cx(styles.tradeDateNav, hasScrolled && styles.tradeDateNavScrolled)}
          ref={tradeDateNavRef}
          aria-label='选择探索页交易日'
        >
          {tradeDateOptions.map((item) => {
            const label = formatTradeDateTab(item.date, item.weekday);
            return (
              <button
                key={item.date}
                className={cx(styles.tradeDateButton, displayedTradeDate === item.date && styles.tradeDateButtonActive)}
                data-trade-date={item.date}
                onClick={() => handleSelectTradeDate(item.date)}
                type='button'
              >
                <span>{label.weekday}</span>
                <strong>{label.date}</strong>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* ── Pill Nav ── */}
      <div className={styles.pillNav}>
        {PILLS.map((pill) => (
          <button
            key={pill.id}
            className={cx(styles.pill, activePill === pill.id && styles.pillActive)}
            onClick={() => scrollTo(pill.id)}
            type='button'
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
              <button className={styles.retryBtn} onClick={() => load()} type='button'>
                重试
              </button>
            </div>
          ) : null}

          {/* Hero Gauge */}
          <div data-discovery-section='hero' id='hero' className={styles.section}>
            <div className={styles.heroCard}>
              {loading && !snapshot ? (
                <HeroGaugeSkeleton />
              ) : unavailableReason ? (
                <DiscoveryWaitingState message={unavailableReason} />
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
          <div data-discovery-section='sec-summary' id='sec-summary' className={styles.section}>
            <SectionTitle id='sec-summary' title={`AI 市场总结 · ${displayedTradeDate || '--'}`} />
            <div className={styles.card}>
              {loading && !snapshot ? (
                <SectionSkeleton />
              ) : unavailableReason ? (
                <DiscoveryWaitingState message={unavailableReason} />
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

          {/* Opportunity Radar */}
          <div data-discovery-section='sec-opportunity-radar' id='sec-opportunity-radar' className={styles.section}>
            <SectionTitle
              id='sec-opportunity-radar'
              title={`机会雷达 · 资金抢跑但涨幅未跟上 · ${displayedTradeDate || '--'}`}
            />
            <div className={styles.card}>
              {loading && !snapshot ? (
                <SectionSkeleton />
              ) : unavailableReason ? (
                <DiscoveryWaitingState message={unavailableReason} />
              ) : (
                <OpportunityRadar data={snapshot?.opportunityRadar} />
              )}
            </div>
          </div>

          {/* AI Monitor Center */}
          <div data-discovery-section='sec-watchlist' id='sec-watchlist' className={styles.section}>
            <SectionTitle id='sec-watchlist' title='AI 监控中心' />
            <div className={styles.card}>
              {unavailableReason ? <DiscoveryWaitingState message={unavailableReason} /> : <MonitoringCenter />}
            </div>
          </div>

          {/* Sentiment Index */}
          <div data-discovery-section='sec-sentiment' id='sec-sentiment' className={styles.section}>
            <SectionTitle id='sec-sentiment' title='AI 情绪指数' />
            <div className={styles.card}>
              {loading && !snapshot ? (
                <SectionSkeleton />
              ) : unavailableReason ? (
                <DiscoveryWaitingState message={unavailableReason} />
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
          <div data-discovery-section='sec-dragontiger' id='sec-dragontiger' className={styles.section}>
            <SectionTitle id='sec-dragontiger' title={`AI 龙虎榜 · ${displayedTradeDate || '--'}`} />
            <div className={styles.card}>
              {loading && !snapshot ? (
                <SectionSkeleton />
              ) : unavailableReason ? (
                <DiscoveryWaitingState message={unavailableReason} />
              ) : (
                <DragonTiger
                  inst={snapshot?.dragonTiger?.inst ?? []}
                  hot={snapshot?.dragonTiger?.hot ?? []}
                  first={snapshot?.dragonTiger?.first ?? []}
                  history={snapshot?.dragonTigerHistory}
                  selectedDate={displayedTradeDate}
                />
              )}
            </div>
          </div>

          {/* Hot Rotation */}
          <div data-discovery-section='sec-hotrotation' id='sec-hotrotation' className={styles.section}>
            <SectionTitle id='sec-hotrotation' title='AI 热点轮动' />
            <div className={styles.card}>
              {loading && !snapshot ? (
                <SectionSkeleton />
              ) : unavailableReason ? (
                <DiscoveryWaitingState message={unavailableReason} />
              ) : (
                <HotRotation themes={snapshot?.hotThemes} />
              )}
            </div>
          </div>

          {/* Limit Up Review */}
          <div data-discovery-section='sec-limitup' id='sec-limitup' className={styles.section}>
            <SectionTitle id='sec-limitup' title='AI 涨停复盘' />
            <div className={styles.card}>
              {loading && !snapshot ? (
                <SectionSkeleton />
              ) : unavailableReason ? (
                <DiscoveryWaitingState message={unavailableReason} />
              ) : (
                <LimitUpReview items={snapshot?.limitUps} />
              )}
            </div>
          </div>

          {/* Tomorrow Preview */}
          <div data-discovery-section='sec-tomorrow' id='sec-tomorrow' className={styles.section}>
            <SectionTitle id='sec-tomorrow' title='AI 明日预判' />
            <div className={styles.card}>
              {loading && !snapshot ? (
                <SectionSkeleton />
              ) : unavailableReason ? (
                <DiscoveryWaitingState message={unavailableReason} />
              ) : (
                <TomorrowPreview items={snapshot?.nextDayFocus} />
              )}
            </div>
          </div>

          {/* Trading Advice */}
          <div data-discovery-section='sec-trading-advice' id='sec-trading-advice' className={styles.section}>
            <SectionTitle id='sec-trading-advice' title='AI 交易建议' />
            <div className={styles.card}>
              {unavailableReason ? (
                <DiscoveryWaitingState message={unavailableReason} />
              ) : (
                <TradingAdvice tradeDate={displayedTradeDate} />
              )}
            </div>
          </div>
          <SubscribeFooter />
        </div>
      </div>
    </section>
  );
}
