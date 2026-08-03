import { message as antdMessage, Switch } from 'antd';
import { Pin, PinOff, Star, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import cx from '../../../shared/cx';
import { isChinaMarketOpen } from '../../../shared/market-time';
import type { IStockTimelineSnapshot, StockDetail } from '../../../shared/types';
import { useAppDataStore, useAppUiStore } from '../../../store/app-store';
import { MarketPhasePill } from '../../market-phase-pill';
import { Empty } from '../../empty';
import { FavoriteTimelineBg } from './favorite-timeline-bg';
import styles from '../index.module.scss';

interface IFavoritesPanelProps {
  isActive: boolean;
}

export function FavoritesPanel({ isActive }: IFavoritesPanelProps) {
  const [quotes, setQuotes] = useState<Record<string, StockDetail>>({});
  const [timelines, setTimelines] = useState<Record<string, IStockTimelineSnapshot>>({});
  const [showTimeline, setShowTimeline] = useState(true);
  const quoteTimerRef = useRef<number>();
  const favoriteStocks = useAppDataStore((state) => state.favoriteStocks);
  const setFavoriteStocks = useAppDataStore((state) => state.setFavoriteStocks);
  const setSelectedStock = useAppDataStore((state) => state.setSelectedStock);
  const setStockReturnContext = useAppDataStore((state) => state.setStockReturnContext);
  const setRightPanelTab = useAppUiStore((state) => state.setRightPanelTab);
  const openRightPanel = useAppUiStore((state) => state.openRightPanel);

  useEffect(() => {
    if (!isActive || !favoriteStocks.length) return;
    let alive = true;

    const refreshQuotes = () => {
      getStocksenseApi()
        .getBatchQuotes(favoriteStocks.map((item) => item.code))
        .then((rows) => {
          if (alive) setQuotes(Object.fromEntries(rows.map((quote) => [quote.code, quote])));
        })
        .catch((error: unknown) => {
          if (alive) console.error(error);
        });
    };

    const refreshTimelines = () => {
      if (!showTimeline) return;
      getStocksenseApi()
        .getStockTimelines(favoriteStocks.map((item) => item.code))
        .then((rows) => {
          if (alive) setTimelines(rows);
        })
        .catch((error: unknown) => {
          if (alive) console.error(error);
        });
    };

    void refreshQuotes();
    if (showTimeline) void refreshTimelines();
    else setTimelines({});
    window.clearInterval(quoteTimerRef.current);
    if (isChinaMarketOpen()) {
      quoteTimerRef.current = window.setInterval(() => {
        refreshQuotes();
        refreshTimelines();
      }, 15_000);
    }

    return () => {
      alive = false;
      window.clearInterval(quoteTimerRef.current);
    };
  }, [favoriteStocks, isActive, showTimeline]);

  const openStock = async (stock: StockDetail) => {
    setRightPanelTab('stock');
    openRightPanel();
    setStockReturnContext({ tab: 'favorites', code: stock.code });
    setSelectedStock(stock);
    try {
      setSelectedStock(await getStocksenseApi().getStockDetail(stock.code));
    } catch (error: unknown) {
      console.error(error);
    }
  };

  const remove = async (code: string) => {
    const previous = favoriteStocks;
    setFavoriteStocks(previous.filter((stock) => stock.code !== code));
    setQuotes((current) => {
      const next = { ...current };
      delete next[code];
      return next;
    });
    setTimelines((current) => {
      const next = { ...current };
      delete next[code];
      return next;
    });
    try {
      setFavoriteStocks(await getStocksenseApi().removeFavoriteStock(code));
      antdMessage.success('取消收藏成功');
    } catch (error: unknown) {
      setFavoriteStocks(previous);
      antdMessage.error(error instanceof Error ? error.message : '取消收藏失败');
    }
  };

  const togglePin = async (code: string) => {
    try {
      setFavoriteStocks(await getStocksenseApi().toggleFavoriteStockPin(code));
    } catch (error: unknown) {
      antdMessage.error(error instanceof Error ? error.message : '置顶操作失败');
    }
  };

  return (
    <>
      <div className={cx(styles['right-panel-header'], styles['favorite-panel-header'])}>
        <span className={styles.title}>
          <Star className={styles['panel-title-icon']} size={16} />
          收藏个股
          {favoriteStocks.length ? <MarketPhasePill /> : null}
        </span>
        <span className={styles['favorite-timeline-switch']}>
          <small>分时图</small>
          <Switch size='small' checked={showTimeline} onChange={setShowTimeline} />
        </span>
      </div>
      <div className={cx(styles['right-panel-body'], styles['news-panel-body'])}>
        {favoriteStocks.length ? (
          favoriteStocks.map((item) => {
            const quote = quotes[item.code] ?? item;
            const stock: StockDetail = { ...quote, code: item.code, name: quote.name ?? item.name };
            return (
              <FavoriteStockItem
                key={item.code}
                stock={stock}
                timeline={showTimeline ? timelines[item.code] : undefined}
                pinned={Boolean(item.pinned)}
                onOpen={() => void openStock(stock)}
                onRemove={() => void remove(item.code)}
                onTogglePin={() => void togglePin(item.code)}
              />
            );
          })
        ) : (
          <Empty
            text={
              <>
                暂无收藏个股。打开个股详情后点击<span className={styles.hl}>星标</span>收藏。
              </>
            }
          />
        )}
      </div>
    </>
  );
}

interface IFavoriteStockItemProps {
  stock: StockDetail;
  timeline: IStockTimelineSnapshot | undefined;
  pinned: boolean;
  onOpen(): void;
  onRemove(): void;
  onTogglePin(): void;
}

function FavoriteStockItem({ stock, timeline, pinned, onOpen, onRemove, onTogglePin }: IFavoriteStockItemProps) {
  const stop = (event: MouseEvent, action: () => void) => {
    event.stopPropagation();
    action();
  };
  const isUp = !String(stock.changePercent ?? '--').startsWith('-');
  const marketSummary = [
    hasQuoteMetric(stock.turnover) ? `成交额 ${stock.turnover}` : undefined,
    hasQuoteMetric(stock.turnoverRate) ? `换手率 ${formatTurnoverRate(stock.turnoverRate)}` : undefined,
  ].filter((value): value is string => Boolean(value)).join(' · ');
  return (
    <div
      className={styles['favorite-item']}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpen();
      }}
      role='button'
      tabIndex={0}
    >
      <FavoriteTimelineBg points={timeline?.points} isUp={isUp} />
      <span className={styles['favorite-main']}>
        <b>
          {stock.name}
          <em>{stock.code}</em>
          {pinned ? <small>置顶</small> : null}
        </b>
        <span>{marketSummary || stock.summary || '实时行情'}</span>
      </span>
      <span className={styles['favorite-side']}>
        <strong>{stock.price ?? '--'}</strong>
        <span className={isUp ? 'up' : 'down'}>{stock.changePercent ?? '--'}</span>
        <span className={styles['favorite-actions']}>
          <button onClick={(event) => stop(event, onTogglePin)} title={pinned ? '取消置顶' : '置顶'} type='button'>
            {pinned ? <PinOff size={13} /> : <Pin size={13} />}
          </button>
          <button onClick={(event) => stop(event, onRemove)} title='取消收藏' type='button'>
            <Trash2 size={13} />
          </button>
        </span>
      </span>
    </div>
  );
}

function hasQuoteMetric(value: string | number | undefined): value is string | number {
  return value !== undefined && value !== '' && value !== '--';
}

function formatTurnoverRate(value: string | number) {
  const text = String(value);
  return text.endsWith('%') ? text : `${text}%`;
}
