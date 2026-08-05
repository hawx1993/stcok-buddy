import { ArrowLeft, Compass } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TDiscoverySnapshotSection } from '../../shared/types';
import { MarketPhasePill } from '../market-phase-pill';
import { useAppUiStore } from '../../store/app-store';
import cx from '../../shared/cx';
import { DiscoverySections } from './components/discovery-sections';
import { SubscribeFooter } from './components/subscribe-footer';
import { useDiscoverySections } from './hooks/use-discovery-sections';
import { shouldAutoRefreshDiscoverySnapshot, shouldRefreshActiveDiscoverySections } from './auto-refresh';
import type { IDiscoverySnapshot } from './types';
import styles from './index.module.scss';

const DISCOVERY_VIEW_AUTO_REFRESH_INTERVAL_MS = 60_000;

const PILLS: Array<{ id: string; label: string; section?: TDiscoverySnapshotSection }> = [
  { id: 'hero', label: '机会分', section: 'hero' },
  { id: 'sec-summary', label: '市场总结', section: 'market-summary' },
  { id: 'sec-opportunity-radar', label: '机会雷达', section: 'opportunity-radar' },
  { id: 'sec-watchlist', label: '监控中心' },
  { id: 'sec-sentiment', label: '情绪指数', section: 'sentiment' },
  { id: 'sec-dragontiger', label: '龙虎榜', section: 'dragon-tiger' },
  { id: 'sec-hotrotation', label: '热点轮动', section: 'hot-rotation' },
  { id: 'sec-limitup', label: '涨停复盘', section: 'limit-up' },
  { id: 'sec-tomorrow', label: '明日预判', section: 'tomorrow' },
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

export function DiscoveryView() {
  const setMainView = useAppUiStore((state) => state.setMainView);
  const isLeftSidebarCollapsed = useAppUiStore((state) => state.isLeftSidebarCollapsed);
  const {
    snapshot,
    selectedTradeDate,
    activeSections,
    activateSection,
    retrySection,
    selectTradeDate,
    refreshActiveSections,
    getSectionState,
  } = useDiscoverySections();
  const [activePill, setActivePill] = useState('hero');
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [hasScrolled, setHasScrolled] = useState(false);
  const [mountedStandaloneSections, setMountedStandaloneSections] = useState<Set<string>>(() => new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const tradeDateNavRef = useRef<HTMLDivElement>(null);

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
  }, []);

  const mountStandaloneSection = (id: string) => {
    setMountedStandaloneSections((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  };

  const scrollTo = (id: string, section?: TDiscoverySnapshotSection) => {
    if (section) activateSection(section);
    else mountStandaloneSection(id);
    window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const dateStr = useMemo(() => formatDate(currentDate), [currentDate]);
  const tradeDateLabel = useMemo(
    () => formatTradeDateLabel(selectedTradeDate || snapshot?.tradeDate || ''),
    [snapshot?.tradeDate, selectedTradeDate],
  );
  const tradeDateOptions = useMemo(() => getTradeDateOptions(snapshot), [snapshot]);
  const displayedTradeDate = selectedTradeDate || snapshot?.tradeDate || '';
  const shouldAutoRefreshSnapshot = shouldAutoRefreshDiscoverySnapshot(displayedTradeDate, tradeDateOptions);
  const unavailableReason = snapshot?.unavailableReason;

  useEffect(() => {
    if (!shouldAutoRefreshSnapshot) return;
    const timer = window.setInterval(() => {
      if (
        shouldRefreshActiveDiscoverySections(
          shouldAutoRefreshSnapshot,
          document.visibilityState === 'visible',
          activeSections.size,
        )
      ) {
        refreshActiveSections(true);
      }
    }, DISCOVERY_VIEW_AUTO_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [activeSections.size, refreshActiveSections, shouldAutoRefreshSnapshot]);

  useEffect(() => {
    const nav = tradeDateNavRef.current;
    if (!nav || !displayedTradeDate) return;
    const activeButton = nav.querySelector<HTMLElement>(`[data-trade-date="${displayedTradeDate}"]`);
    activeButton?.scrollIntoView({ block: 'nearest', inline: 'end' });
  }, [displayedTradeDate, tradeDateOptions]);

  const handleSelectTradeDate = (tradeDate: string) => {
    setMountedStandaloneSections(new Set());
    scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    selectTradeDate(tradeDate);
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
            onClick={() => scrollTo(pill.id, pill.section)}
            type='button'
          >
            {pill.label}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div className={styles.scroll} ref={scrollRef}>
        <div className={styles.inner}>
          <DiscoverySections
            snapshot={snapshot}
            displayedTradeDate={displayedTradeDate}
            unavailableReason={unavailableReason}
            activeSections={activeSections}
            mountedStandaloneSections={mountedStandaloneSections}
            scrollRef={scrollRef}
            getSectionState={getSectionState}
            activateSection={activateSection}
            retrySection={(section) => void retrySection(section)}
            mountStandaloneSection={mountStandaloneSection}
          />
          <SubscribeFooter />
        </div>
      </div>
    </section>
  );
}
