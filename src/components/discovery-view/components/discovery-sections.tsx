import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  Eye,
  Flame,
  Newspaper,
  Target,
  Thermometer,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import type { TDiscoverySnapshotSection } from '../../../shared/types';
import type { TDiscoverySectionStatus } from '../hooks/use-discovery-sections';
import type { IDiscoverySnapshot } from '../types';
import { DeferredDiscoverySection } from './deferred-discovery-section';
import { DragonTiger } from './dragon-tiger';
import { HeroGauge } from './hero-gauge';
import { HotRotation } from './hot-rotation';
import { LimitUpReview } from './limit-up-review';
import { MarketSummary } from './market-summary';
import { MonitoringCenter } from './monitoring-center';
import { OpportunityRadar } from './opportunity-radar';
import { SentimentIndex } from './sentiment-index';
import { TomorrowPreview } from './tomorrow-preview';
import { TradingAdvice } from './trading-advice';
import styles from '../index.module.scss';

interface IDiscoverySectionState {
  status: TDiscoverySectionStatus;
  error?: string;
}

interface IDiscoverySectionsProps {
  snapshot?: IDiscoverySnapshot;
  displayedTradeDate: string;
  unavailableReason?: string;
  activeSections: Set<TDiscoverySnapshotSection>;
  mountedStandaloneSections: Set<string>;
  scrollRef: RefObject<HTMLElement>;
  getSectionState(section: TDiscoverySnapshotSection): IDiscoverySectionState;
  activateSection(section: TDiscoverySnapshotSection): void;
  retrySection(section: TDiscoverySnapshotSection): void;
  mountStandaloneSection(id: string): void;
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

function SectionLoadError({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <div className={styles.inlineErrorState}>
      <AlertTriangle size={16} />
      <p>{message}</p>
      <button className={styles.retryBtn} onClick={onRetry} type='button'>
        重试
      </button>
    </div>
  );
}

function SectionDataContent({
  status,
  error,
  unavailableReason,
  onRetry,
  children,
}: {
  status: TDiscoverySectionStatus;
  error?: string;
  unavailableReason?: string;
  onRetry(): void;
  children: ReactNode;
}) {
  if (status === 'idle' || status === 'loading') return <SectionSkeleton />;
  if (status === 'error') return <SectionLoadError message={error ?? '数据加载失败'} onRetry={onRetry} />;
  if (unavailableReason) return <DiscoveryWaitingState message={unavailableReason} />;
  return children;
}

export function DiscoverySections({
  snapshot,
  displayedTradeDate,
  unavailableReason,
  activeSections,
  mountedStandaloneSections,
  scrollRef,
  getSectionState,
  activateSection,
  retrySection,
  mountStandaloneSection,
}: IDiscoverySectionsProps) {
  const heroState = getSectionState('hero');
  const deferredProps = {
    activationKey: displayedTradeDate,
    rootRef: scrollRef,
    className: styles.deferredSection,
    placeholder: <SectionSkeleton />,
  };

  return (
    <>
      <div data-discovery-section='hero' id='hero' className={styles.section}>
        <div className={styles.heroCard}>
          {heroState.status === 'idle' || heroState.status === 'loading' ? (
            <HeroGaugeSkeleton />
          ) : heroState.status === 'error' ? (
            <SectionLoadError message={heroState.error ?? '数据加载失败'} onRetry={() => retrySection('hero')} />
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

      <div data-discovery-section='sec-summary' id='sec-summary' className={styles.section}>
        <SectionTitle id='sec-summary' title={`AI 市场总结 · ${displayedTradeDate || '--'}`} />
        <div className={styles.card}>
          <DeferredDiscoverySection
            {...deferredProps}
            active={activeSections.has('market-summary')}
            onVisible={() => activateSection('market-summary')}
          >
            <SectionDataContent
              {...getSectionState('market-summary')}
              unavailableReason={unavailableReason}
              onRetry={() => retrySection('market-summary')}
            >
              <MarketSummary
                indices={snapshot?.indices}
                bullets={snapshot?.bullets}
                wealthMetrics={snapshot?.wealthMetrics}
                marketSummary={snapshot?.marketSummary}
              />
            </SectionDataContent>
          </DeferredDiscoverySection>
        </div>
      </div>

      <div data-discovery-section='sec-opportunity-radar' id='sec-opportunity-radar' className={styles.section}>
        <SectionTitle
          id='sec-opportunity-radar'
          title={`机会雷达 · 资金抢跑但涨幅未跟上 · ${displayedTradeDate || '--'}`}
        />
        <div className={styles.card}>
          <DeferredDiscoverySection
            {...deferredProps}
            active={activeSections.has('opportunity-radar')}
            onVisible={() => activateSection('opportunity-radar')}
          >
            <SectionDataContent
              {...getSectionState('opportunity-radar')}
              unavailableReason={unavailableReason}
              onRetry={() => retrySection('opportunity-radar')}
            >
              <OpportunityRadar data={snapshot?.opportunityRadar} />
            </SectionDataContent>
          </DeferredDiscoverySection>
        </div>
      </div>

      <div data-discovery-section='sec-watchlist' id='sec-watchlist' className={styles.section}>
        <SectionTitle id='sec-watchlist' title='AI 监控中心' />
        <div className={styles.card}>
          <DeferredDiscoverySection
            {...deferredProps}
            active={mountedStandaloneSections.has('sec-watchlist')}
            unmountWhenHidden
            onVisible={() => mountStandaloneSection('sec-watchlist')}
          >
            {unavailableReason ? <DiscoveryWaitingState message={unavailableReason} /> : <MonitoringCenter />}
          </DeferredDiscoverySection>
        </div>
      </div>

      <div data-discovery-section='sec-sentiment' id='sec-sentiment' className={styles.section}>
        <SectionTitle id='sec-sentiment' title='AI 情绪指数' />
        <div className={styles.card}>
          <DeferredDiscoverySection
            {...deferredProps}
            active={activeSections.has('sentiment')}
            onVisible={() => activateSection('sentiment')}
          >
            <SectionDataContent
              {...getSectionState('sentiment')}
              unavailableReason={unavailableReason}
              onRetry={() => retrySection('sentiment')}
            >
              <SentimentIndex
                score={snapshot?.sentimentScore}
                factors={snapshot?.sentimentFactors}
                stocks={snapshot?.sentimentStocks}
                consecutiveStocks={snapshot?.consecutiveStocks}
                yesterdayZt={snapshot?.yesterdayZt}
                yesterdayLb={snapshot?.yesterdayLb}
                leaders={snapshot?.leaders}
              />
            </SectionDataContent>
          </DeferredDiscoverySection>
        </div>
      </div>

      <div data-discovery-section='sec-dragontiger' id='sec-dragontiger' className={styles.section}>
        <SectionTitle id='sec-dragontiger' title={`AI 龙虎榜 · ${displayedTradeDate || '--'}`} />
        <div className={styles.card}>
          <DeferredDiscoverySection
            {...deferredProps}
            active={activeSections.has('dragon-tiger')}
            onVisible={() => activateSection('dragon-tiger')}
          >
            <SectionDataContent
              {...getSectionState('dragon-tiger')}
              unavailableReason={unavailableReason}
              onRetry={() => retrySection('dragon-tiger')}
            >
              <DragonTiger
                inst={snapshot?.dragonTiger?.inst ?? []}
                hot={snapshot?.dragonTiger?.hot ?? []}
                first={snapshot?.dragonTiger?.first ?? []}
                history={snapshot?.dragonTigerHistory}
                selectedDate={displayedTradeDate}
              />
            </SectionDataContent>
          </DeferredDiscoverySection>
        </div>
      </div>

      <div data-discovery-section='sec-hotrotation' id='sec-hotrotation' className={styles.section}>
        <SectionTitle id='sec-hotrotation' title='AI 热点轮动' />
        <div className={styles.card}>
          <DeferredDiscoverySection
            {...deferredProps}
            active={activeSections.has('hot-rotation')}
            onVisible={() => activateSection('hot-rotation')}
          >
            <SectionDataContent
              {...getSectionState('hot-rotation')}
              unavailableReason={unavailableReason}
              onRetry={() => retrySection('hot-rotation')}
            >
              <HotRotation themes={snapshot?.hotThemes} />
            </SectionDataContent>
          </DeferredDiscoverySection>
        </div>
      </div>

      <div data-discovery-section='sec-limitup' id='sec-limitup' className={styles.section}>
        <SectionTitle id='sec-limitup' title='AI 涨停复盘' />
        <div className={styles.card}>
          <DeferredDiscoverySection
            {...deferredProps}
            active={activeSections.has('limit-up')}
            onVisible={() => activateSection('limit-up')}
          >
            <SectionDataContent
              {...getSectionState('limit-up')}
              unavailableReason={unavailableReason}
              onRetry={() => retrySection('limit-up')}
            >
              <LimitUpReview items={snapshot?.limitUps} />
            </SectionDataContent>
          </DeferredDiscoverySection>
        </div>
      </div>

      <div data-discovery-section='sec-tomorrow' id='sec-tomorrow' className={styles.section}>
        <SectionTitle id='sec-tomorrow' title='AI 明日预判' />
        <div className={styles.card}>
          <DeferredDiscoverySection
            {...deferredProps}
            active={activeSections.has('tomorrow')}
            onVisible={() => activateSection('tomorrow')}
          >
            <SectionDataContent
              {...getSectionState('tomorrow')}
              unavailableReason={unavailableReason}
              onRetry={() => retrySection('tomorrow')}
            >
              <TomorrowPreview items={snapshot?.nextDayFocus} />
            </SectionDataContent>
          </DeferredDiscoverySection>
        </div>
      </div>

      <div data-discovery-section='sec-trading-advice' id='sec-trading-advice' className={styles.section}>
        <SectionTitle id='sec-trading-advice' title='AI 交易建议' />
        <div className={styles.card}>
          <DeferredDiscoverySection
            {...deferredProps}
            active={mountedStandaloneSections.has('sec-trading-advice')}
            unmountWhenHidden
            onVisible={() => mountStandaloneSection('sec-trading-advice')}
          >
            {unavailableReason ? (
              <DiscoveryWaitingState message={unavailableReason} />
            ) : (
              <TradingAdvice tradeDate={displayedTradeDate} />
            )}
          </DeferredDiscoverySection>
        </div>
      </div>
    </>
  );
}
