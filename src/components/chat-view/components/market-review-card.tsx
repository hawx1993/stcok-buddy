import { useState, type ReactNode } from 'react';
import type { BoardDetail, IMarketReviewMetric, TMarketReviewRating, TMarketReviewReport } from '../../../shared/types';
import styles from '../index.module.scss';

export function MarketReviewCard({ report, onBoardClick }: {
  report: TMarketReviewReport;
  onBoardClick(board: Pick<BoardDetail, 'code' | 'name'>): void;
}) {
  const dataSources = asArray(report.dataSources);
  const sentiment = asArray(report.sentiment);
  const wealthEffect = asArray(report.wealthEffect);
  const profitDirections = asArray(report.profitDirections);
  const lossDirections = asArray(report.lossDirections);
  const hotThemes = asArray(report.hotThemes);
  const leaders = asArray(report.leaders);
  const nextDayFocus = asArray(report.nextDayFocus);
  const [expandedTheme, setExpandedTheme] = useState<string>();
  return (
    <section className={styles['market-review-card']} data-card>
      <header className={styles['market-review-header']}>
        <div>
          <strong>今日行情复盘</strong>
          <span>{report.tradeDate ?? '暂无数据'} · {dataSources.length ? dataSources.join(' / ') : '暂无数据'}</span>
        </div>
        <div className={styles['sentiment-score']}>{report.sentimentScore === null || report.sentimentScore === undefined ? '暂不评分' : `${report.sentimentScore}分`}</div>
      </header>
      <ReviewSection title='📈 市场情绪'><MetricGrid metrics={sentiment} /></ReviewSection>
      <ReviewSection title='💰 赚钱效应'>
        <MetricGrid metrics={wealthEffect} />
        <Direction label='赚钱方向' values={profitDirections} tone='profit' />
        <Direction label='亏钱方向' values={lossDirections} tone='loss' />
      </ReviewSection>
      <ReviewSection title='🌐 热点轮动'>
        {hotThemes.length ? hotThemes.map((theme) => {
          const expanded = expandedTheme === theme.id;
          const limitUpStocks = asArray(theme.limitUpStocks);
          const coreStocks = asArray(theme.coreStocks);
          return (
            <article className={styles['review-theme']} key={theme.id}>
              <div className={styles['review-theme-heading']}>
                <button
                  className={styles['review-theme-board-link']}
                  disabled={!theme.boardCode}
                  onClick={() => {
                    if (theme.boardCode) onBoardClick({ code: theme.boardCode, name: theme.name });
                  }}
                  type='button'
                >
                  {theme.name} {stars(theme.score)}
                </button>
                <button className={styles['review-theme-expand']} onClick={() => setExpandedTheme(expanded ? undefined : theme.id)} type='button'>
                  {expanded ? '收起' : '展开'}
                </button>
              </div>
              <div className={styles['review-theme-facts']}>
                <span className={styles['review-tone-up']}>涨停 {formatValue(theme.limitUpCount, '家')}</span><span>龙头 {theme.leaderName ?? '暂无数据'}</span><span className={styles['review-tone-neutral']}>高度 {formatValue(theme.leaderHeight, '板')}</span>
              </div>
              {expanded ? <div className={styles['review-theme-detail']}>
                <p>上涨原因：{theme.reason ?? '暂无数据'}</p><p>资金流向：{formatMoney(theme.mainNetInflow)}</p><p>板块成交额：{formatMoney(theme.amount)}</p>
                <p>今日涨停名单：{limitUpStocks.length ? limitUpStocks.map((stock) => `${stock.name}${stock.height ? ` ${stock.height}板` : ''}`).join('、') : '暂无数据'}</p>
                <p>核心股：{coreStocks.length ? coreStocks.map((stock) => `${stock.name} ${formatPercent(stock.changePercent)}`).join('、') : '暂无数据'}</p>
                <p>AI跟踪：{theme.trackingNote ?? '暂无数据'}</p>
              </div> : null}
            </article>
          );
        }) : <EmptyState />}
      </ReviewSection>
      <ReviewSection title='🏢 龙头股复盘'>
        {leaders.length ? leaders.map((leader) => <article className={styles['review-leader']} key={leader.code}>
          <strong>{leader.name} {leader.height ? `${leader.height}连板` : ''}</strong>
          <span>所属概念：{leader.concepts.length ? leader.concepts.join('、') : '暂无数据'}</span>
          <span className={styles['review-tone-neutral']}>成交额：{formatMoney(leader.amount)}</span><span className={styles['review-tone-neutral']}>换手：{formatPercent(leader.turnoverRate)}</span><span className={styles['review-tone-up']}>封单：{formatMoney(leader.sealAmount)}</span>
        </article>) : <EmptyState />}
      </ReviewSection>
      <ReviewSection title='📅 明日重点关注'>
        <p className={styles['review-focus-lead']}>明天开盘以后，请优先观察：</p>
        <ol className={styles['review-focus-list']}>
          {nextDayFocus.length ? nextDayFocus.map((item) => <li className={styles[`review-tone-${item.tone}`]} key={item.id}>{item.condition}</li>) : <li>暂无数据</li>}
        </ol>
        <p className={styles['review-focus-summary']}>
          <span>明日重点关注：</span>{nextDayFocus.slice(0, 2).map((item) => item.condition).join('；') || '暂无数据'}
        </p>
      </ReviewSection>
      {asArray(report.dataGaps).length ? <div className={styles['review-gaps']}>⚠️ 数据缺口：{asArray(report.dataGaps).join('、')}</div> : null}
    </section>
  );
}

function asArray<T>(value: T[] | undefined): T[] { return Array.isArray(value) ? value : []; }
function ReviewSection({ children, title }: { children: ReactNode; title: string }) { return <section className={styles['review-section']}><h4>{title}</h4>{children}</section>; }
function MetricGrid({ metrics }: { metrics: IMarketReviewMetric[] }) {
  return <div className={styles['review-metric-grid']}>{metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><strong className={styles[metricTone(metric)]}>{formatValue(metric.value, metric.unit)}</strong></div>)}</div>;
}
function Direction({ label, tone, values }: { label: string; tone: 'profit' | 'loss'; values: string[] }) {
  return <p className={styles['review-directions']}><span>{label}：</span><strong className={styles[`review-direction-${tone}`]}>{values.length ? values.join('、') : '暂无数据'}</strong></p>;
}
function metricTone(metric: IMarketReviewMetric) {
  if (metric.value === null) return 'review-tone-neutral';
  if (/跌停|炸板|下跌|跌幅/.test(metric.label)) return 'review-tone-down';
  if (/涨停|上涨|涨幅|最高板|连板/.test(metric.label)) return 'review-tone-up';
  return 'review-tone-neutral';
}
function EmptyState() { return <p className={styles['review-empty']}>暂无数据</p>; }
function stars(score: TMarketReviewRating | null) { return score === null ? '暂不评分' : '★'.repeat(score) + '☆'.repeat(5 - score); }
function formatValue(value: number | null, unit?: string) { return value === null ? '暂无数据' : `${unit === '%' && value > 0 ? '+' : ''}${value.toFixed(unit === '%' ? 2 : 0)}${unit ?? ''}`; }
function formatPercent(value: number | null) { return formatValue(value, '%'); }
function formatMoney(value: number | null) { return value === null ? '暂无数据' : `${value.toFixed(2)}亿`; }
