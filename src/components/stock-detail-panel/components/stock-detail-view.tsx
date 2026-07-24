import { message as antdMessage } from 'antd';
import { Bot, LineChart, Star } from 'lucide-react';
import gsap from 'gsap';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import cx from '../../../shared/cx';
import type { StockSurgeEvent } from '../../../shared/types';
import { useAppStore } from '../../../store/app-store';
import { Empty } from '../../empty';
import { KlineModal, StockKlineChart } from '../../kline-chart';
import styles from '../index.module.scss';

interface IStockDetailViewProps {
  returnToSurge: boolean;
  onReturnToSurge(): void;
}

export function StockDetailView({ returnToSurge, onReturnToSurge }: IStockDetailViewProps) {
  const detailRef = useRef<HTMLDivElement>(null);
  const [isKlineModalOpen, setKlineModalOpen] = useState(false);
  const [chipsOpen, setChipsOpen] = useState(true);
  const [stockSurgeEvents, setStockSurgeEvents] = useState<StockSurgeEvent[]>([]);
  const [stockSurgeLoading, setStockSurgeLoading] = useState(false);
  const [stockSurgeError, setStockSurgeError] = useState<string>();
  const selectedStock = useAppStore((state) => state.selectedStock);
  const favoriteStocks = useAppStore((state) => state.favoriteStocks);
  const setFavoriteStocks = useAppStore((state) => state.setFavoriteStocks);
  const setConversations = useAppStore((state) => state.setConversations);
  const setActiveConversation = useAppStore((state) => state.setActiveConversation);
  const clearMessages = useAppStore((state) => state.clearMessages);
  const setMainView = useAppStore((state) => state.setMainView);
  const selectedIsFavorite = Boolean(selectedStock && favoriteStocks.some((item) => item.code === selectedStock.code));

  useLayoutEffect(() => {
    if (!selectedStock || !detailRef.current) return;
    const context = gsap.context(() => {
      const timeline = gsap.timeline({ defaults: { ease: 'power2.out', duration: 0.25 } });
      timeline.from('[data-stockheader]', { opacity: 0, y: -6 });
      timeline.from('[data-klinebox]', { opacity: 0, y: 6 }, '-=0.1');
      timeline.from('[data-stockgrid] .si', { opacity: 0, y: 8, stagger: 0.03 }, '-=0.05');
      timeline.from('[data-rating] .r', { opacity: 0, y: 6, stagger: 0.02 }, '-=0.05');
      timeline.from('[data-summary]', { opacity: 0, y: 6 }, '-=0.05');
    }, detailRef);
    return () => context.revert();
  }, [selectedStock?.code]);

  useEffect(() => {
    if (!selectedStock?.code || selectedStock.kline?.length) return;
    let alive = true;
    getStocksenseApi()
      .getKline(selectedStock.code, 120, '1d')
      .then((kline) => {
        if (alive && kline.length) useAppStore.getState().setSelectedStock({ ...selectedStock, kline });
      })
      .catch((error: unknown) => console.error(error));
    return () => {
      alive = false;
    };
  }, [selectedStock]);

  useEffect(() => {
    if (!selectedStock?.code) {
      setStockSurgeEvents([]);
      setStockSurgeLoading(false);
      setStockSurgeError(undefined);
      return;
    }
    let alive = true;
    setStockSurgeEvents([]);
    setStockSurgeLoading(true);
    setStockSurgeError(undefined);
    getStocksenseApi()
      .listStockSurgeEvents(selectedStock.code)
      .then((items) => {
        if (alive) setStockSurgeEvents(items);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setStockSurgeError(error instanceof Error ? error.message : '异动记录加载失败');
      })
      .finally(() => {
        if (alive) setStockSurgeLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [selectedStock?.code]);

  const sendStockReport = async (code: string) => {
    const api = getStocksenseApi();
    const conversation = await api.createConversation();
    setConversations([conversation, ...useAppStore.getState().conversations]);
    setActiveConversation(conversation.id);
    clearMessages();
    setMainView('chat');
    (window as typeof window & { __stocksensePendingReport?: string }).__stocksensePendingReport = code;
  };

  const toggleSelectedFavorite = async () => {
    if (!selectedStock) return;
    const nextFavorite = !selectedIsFavorite;
    const stock = { code: selectedStock.code, name: selectedStock.name };
    const next = nextFavorite
      ? [{ ...stock, pinned: false, createdAt: new Date().toISOString() }, ...favoriteStocks]
      : favoriteStocks.filter((item) => item.code !== stock.code);
    setFavoriteStocks(next);
    try {
      const saved = nextFavorite
        ? await getStocksenseApi().upsertFavoriteStock(stock)
        : await getStocksenseApi().removeFavoriteStock(stock.code);
      setFavoriteStocks(saved);
      antdMessage.success(nextFavorite ? '收藏成功' : '取消收藏成功');
    } catch (error: unknown) {
      setFavoriteStocks(favoriteStocks);
      antdMessage.error(error instanceof Error ? error.message : '收藏操作失败');
    }
  };

  return (
    <>
      <div className={cx(styles['right-panel-header'], styles['stock-panel-header'])}>
        <span className={styles.title}>
          {returnToSurge ? (
            <button className={styles['back-to-surge']} onClick={onReturnToSurge} type='button'>
              ← 异动
            </button>
          ) : null}
          <LineChart className={styles['panel-title-icon']} size={16} />
          个股详情
        </span>
        {selectedStock ? (
          <div className={styles['stock-price']}>
            <div className={styles.price}>{selectedStock.price ?? '--'}</div>
            <div className={cx(styles.chg, String(selectedStock.changePercent).startsWith('-') ? 'down' : 'up')}>
              {selectedStock.changePercent ?? '--'}
            </div>
          </div>
        ) : null}
      </div>
      {selectedStock ? (
        <div className={styles['stock-detail']} ref={detailRef}>
          <div className={cx(styles['stock-header'], styles['sticky-stock-header'])} data-stockheader>
            <div className={styles['stock-name']}>
              {selectedStock.name}
              <span className={styles.code}>
                {selectedStock.code} · {selectedStock.exchange ?? 'A股'}
              </span>
            </div>
            <div className={styles['stock-side']}>
              <div className={styles['stock-actions']}>
                <button
                  className={styles['robot-btn']}
                  onClick={() => void sendStockReport(selectedStock.code)}
                  title='诊股'
                  aria-label='诊股'
                  type='button'
                >
                  <Bot size={15} />
                </button>
                <button
                  className={cx(styles['robot-btn'], styles['favorite-btn'], selectedIsFavorite && styles.active)}
                  onClick={() => void toggleSelectedFavorite()}
                  title={selectedIsFavorite ? '取消收藏' : '收藏'}
                  aria-label={selectedIsFavorite ? '取消收藏' : '收藏'}
                  type='button'
                >
                  <Star size={15} fill={selectedIsFavorite ? 'currentColor' : 'none'} />
                </button>
              </div>
            </div>
          </div>
          <div className={styles['kline-box']} data-klinebox>
            <button
              className={styles['kline-expand']}
              onClick={() => setKlineModalOpen(true)}
              title='放大K线图'
              type='button'
            >
              ⛶
            </button>
            <StockKlineChart
              stock={selectedStock}
              data={selectedStock.kline}
              showSwitcher
              showChips
              chipsOpen={chipsOpen}
              showLegend={false}
            />
            <div className={styles['chip-label']}>
              <span>
                <span className={cx(styles.bar, styles.up)} />
                获利 <span className={cx(styles.bar, styles.down)} />
                亏损 <span className={styles['chip-note']}>估算</span>
              </span>
              <button className={styles['chip-toggle']} onClick={() => setChipsOpen((value) => !value)} type='button'>
                筹码峰{chipsOpen ? '收起' : '展开'}
              </button>
            </div>
          </div>
          <div className={styles['stock-grid']} data-stockgrid>
            <Metric label='今开' value={selectedStock.open ?? '--'} />
            <Metric label='最高' value={selectedStock.high ?? '--'} />
            <Metric label='最低' value={selectedStock.low ?? '--'} />
            <Metric label='昨收' value={selectedStock.prevClose ?? '--'} />
            <Metric label='成交量' value={selectedStock.volume ?? '--'} />
            <Metric label='成交额' value={selectedStock.turnover ?? '--'} />
            <Metric label='换手率' value={selectedStock.turnoverRate ?? '--'} />
            <Metric label='市值' value={selectedStock.marketCap ?? '--'} />
          </div>
          <div className={styles.divider} />
          <div className={styles['section-title']}>综合评级</div>
          <div className={styles['rating-grid']} data-rating>
            <Rating label='基本面' score={selectedStock.rating?.fundamental ?? '待评估'} tone='up' />
            <Rating label='估值' score={selectedStock.rating?.valuation ?? '待评估'} tone='warn' />
            <Rating label='技术面' score={selectedStock.rating?.tech ?? '待分析'} tone='warn' />
            <Rating label='风险' score={selectedStock.rating?.risk ?? '中性'} tone='up' />
          </div>
          <div className={styles.divider} />
          <div className={styles['section-title']}>快评</div>
          <div className={styles['summary-box']} data-summary>
            {selectedStock.summary ?? '暂无摘要。'}
          </div>
          <div className={styles.divider} />
          <div className={styles['section-title']}>最近一周异动</div>
          <StockSurgeEvents events={stockSurgeEvents} loading={stockSurgeLoading} error={stockSurgeError} />
        </div>
      ) : (
        <Empty
          text={
            <>
              点击聊天中的<span className={styles.hl}>股票</span>或左侧热点列表，查看个股详情。
            </>
          }
        />
      )}
      {isKlineModalOpen && selectedStock ? (
        <KlineModal
          stock={selectedStock}
          data={selectedStock.kline}
          onClose={() => setKlineModalOpen(false)}
          chipsOpen={chipsOpen}
        />
      ) : null}
    </>
  );
}

interface IStockSurgeEventsProps {
  events: StockSurgeEvent[];
  loading: boolean;
  error?: string;
}

function StockSurgeEvents({ events, loading, error }: IStockSurgeEventsProps) {
  if (loading) return <StockSurgeSkeleton />;
  if (error) return <div className={styles['stock-surge-error']}>{error}</div>;
  if (!events.length) return <Empty text='最近一周暂无异动记录' />;
  const today = new Date().toLocaleDateString('en-CA');
  const groups = Object.entries(
    events.reduce<Record<string, StockSurgeEvent[]>>((result, item) => {
      (result[item.tradeDate] ??= []).push(item);
      return result;
    }, {}),
  ).sort(([first], [second]) => second.localeCompare(first));
  return (
    <div className={styles['stock-surge-events']}>
      {groups.map(([date, items]) => (
        <div className={styles['stock-surge-group']} key={date}>
          <div className={styles['stock-surge-date-header']}>
            <span>{date.slice(5)}</span>
            {date === today ? <em>今日</em> : null}
          </div>
          <div className={styles['stock-surge-date-body']}>
            {items.map((item, index) => (
              <StockSurgeEventItem
                key={`${item.tradeDate}-${item.id}`}
                item={item}
                isLastInGroup={index === items.length - 1}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

interface IStockSurgeEventItemProps {
  item: StockSurgeEvent;
  isLastInGroup: boolean;
}

function StockSurgeEventItem({ item, isLastInGroup }: IStockSurgeEventItemProps) {
  const isDown = String(item.changePercent).startsWith('-');
  return (
    <div className={cx(styles['stock-surge-event'], isLastInGroup && styles['stock-surge-event-last'])}>
      <span className={styles['stock-surge-event-time']}>
        <small>{item.time ?? '--'}</small>
      </span>
      <span className={styles['stock-surge-event-card']}>
        <span className={styles['stock-surge-event-main']}>
          <b>
            {item.name ?? item.title}
            <em>{item.code}</em>
          </b>
          <small>
            当前 <span>{item.price ?? '--'}</span>
            <span className={isDown ? 'down' : 'up'}>{item.changePercent ?? '--'}</span>
          </small>
        </span>
        <span className={styles['stock-surge-event-action']}>
          <span>{getSurgeReason(item)}</span>
          {hasSurgeAmount(item.amount) ? <small>{item.amount}</small> : null}
        </span>
      </span>
    </div>
  );
}

function StockSurgeSkeleton() {
  return (
    <div className={styles['stock-surge-skeleton']}>
      {Array.from({ length: 3 }, (_, index) => (
        <div className={styles['stock-surge-skeleton-item']} key={index}>
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

interface IMetricProps {
  label: string;
  value: string | number;
}

function Metric({ label, value }: IMetricProps) {
  return (
    <div className={styles.si}>
      <div className={styles.lbl}>{label}</div>
      <div className={styles.v}>{value}</div>
    </div>
  );
}

interface IRatingProps {
  label: string;
  score: string;
  tone: 'up' | 'warn';
}

function Rating({ label, score, tone }: IRatingProps) {
  return (
    <div className={styles.r}>
      <div className={cx(styles.s, tone === 'warn' ? styles.warn : 'up')}>{score}</div>
      <div className={styles.l}>{label}</div>
    </div>
  );
}

function getSurgeReason(event: StockSurgeEvent) {
  const reason = event.tag ?? event.description?.split(' · ')[0] ?? '--';
  const labels: Record<string, string> = { 涨停池: '封涨停板', 炸板池: '涨停开板', 跌停池: '封跌停板' };
  return labels[reason] ?? reason;
}

function hasSurgeAmount(amount?: string) {
  return Boolean(amount && !/^(?:封单|成交额)?[+-]?0(?:\.00)?(?:手|万|亿)?$/.test(amount));
}
