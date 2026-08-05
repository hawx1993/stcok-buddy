import { message as antdMessage, Switch } from 'antd';
import { Pin, PinOff, Star, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import cx from '../../../shared/cx';
import { isChinaMarketOpen } from '../../../shared/market-time';
import type { IStockTimelineSnapshot, StockDetail } from '../../../shared/types';
import { useAppDataStore, useAppUiStore } from '../../../store/app-store';
import { MarketPhasePill } from '../../market-phase-pill';
import { Empty } from '../../empty';
import { FavoriteTimelineBg } from './favorite-timeline-bg';
import { readFavoriteTimelineSwitchCache, writeFavoriteTimelineSwitchCache } from './favorite-timeline-switch-cache';
import styles from '../index.module.scss';

interface IFavoritesPanelProps {
  isActive: boolean;
}

const FAVORITE_QUOTE_REFRESH_INTERVAL_MS = 15_000;
const FAVORITE_TIMELINE_REFRESH_INTERVAL_MS = 60_000;
export function FavoritesPanel({ isActive }: IFavoritesPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver>();
  const quoteTimerRef = useRef<number>();
  const timelineTimerRef = useRef<number>();
  const [quotes, setQuotes] = useState<Record<string, StockDetail>>({});
  const [timelines, setTimelines] = useState<Record<string, IStockTimelineSnapshot>>({});
  const [showTimeline, setShowTimeline] = useState(readFavoriteTimelineSwitchCache);
  const [visibleCodes, setVisibleCodes] = useState<string[]>([]);
  const favoriteStocks = useAppDataStore((state) => state.favoriteStocks);
  const setFavoriteStocks = useAppDataStore((state) => state.setFavoriteStocks);
  const setSelectedStock = useAppDataStore((state) => state.setSelectedStock);
  const setStockReturnContext = useAppDataStore((state) => state.setStockReturnContext);
  const setRightPanelTab = useAppUiStore((state) => state.setRightPanelTab);
  const openRightPanel = useAppUiStore((state) => state.openRightPanel);
  const favoriteCodes = useMemo(() => favoriteStocks.map((item) => item.code), [favoriteStocks]);
  const visibleTimelineCodes = useMemo(
    () => visibleCodes.filter((code) => favoriteCodes.includes(code)),
    [favoriteCodes, visibleCodes],
  );
  const visibleTimelineCodeSet = useMemo(() => new Set(visibleTimelineCodes), [visibleTimelineCodes]);

  const handleFavoriteVisibilityChange = useCallback((code: string, visible: boolean) => {
    setVisibleCodes((current) => {
      const hasCode = current.includes(code);
      if (visible) return hasCode ? current : [...current, code];
      if (!hasCode) return current;
      return current.filter((item) => item !== code);
    });
  }, []);

  const handleTimelineSwitchChange = useCallback((checked: boolean) => {
    writeFavoriteTimelineSwitchCache(checked);
    setShowTimeline(checked);
  }, []);

  useEffect(() => {
    setVisibleCodes((current) => current.filter((code) => favoriteCodes.includes(code)));
    setTimelines((current) => {
      const next: Record<string, IStockTimelineSnapshot> = {};
      Object.entries(current).forEach(([code, timeline]) => {
        if (favoriteCodes.includes(code)) next[code] = timeline;
      });
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [favoriteCodes]);

  useEffect(() => {
    if (!showTimeline) {
      setTimelines({});
      setVisibleCodes([]);
    }
  }, [showTimeline]);

  useEffect(() => {
    if (!showTimeline || !listRef.current) {
      observerRef.current?.disconnect();
      observerRef.current = undefined;
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const code = (entry.target as HTMLElement).dataset.favoriteCode;
          if (code) handleFavoriteVisibilityChange(code, entry.isIntersecting);
        });
      },
      { root: listRef.current, rootMargin: '48px 0px', threshold: 0.01 },
    );
    observerRef.current = observer;
    listRef.current.querySelectorAll<HTMLElement>('[data-favorite-code]').forEach((element) => observer.observe(element));

    return () => {
      observer.disconnect();
      if (observerRef.current === observer) observerRef.current = undefined;
    };
  }, [handleFavoriteVisibilityChange, showTimeline]);

  const observeFavoriteItem = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element || !showTimeline) return;
      observerRef.current?.observe(element);
    },
    [showTimeline],
  );

  useEffect(() => {
    if (!isActive || !favoriteCodes.length) return;
    let alive = true;

    const refreshQuotes = () => {
      getStocksenseApi()
        .getBatchQuotes(favoriteCodes)
        .then((rows) => {
          if (alive) setQuotes(Object.fromEntries(rows.map((quote) => [quote.code, quote])));
        })
        .catch((error: unknown) => {
          if (alive) console.error(error);
        });
    };

    void refreshQuotes();
    window.clearInterval(quoteTimerRef.current);
    if (isChinaMarketOpen()) {
      quoteTimerRef.current = window.setInterval(refreshQuotes, FAVORITE_QUOTE_REFRESH_INTERVAL_MS);
    }

    return () => {
      alive = false;
      window.clearInterval(quoteTimerRef.current);
    };
  }, [favoriteCodes, isActive]);

  useEffect(() => {
    if (!isActive || !showTimeline || !visibleTimelineCodes.length) return;
    let alive = true;

    const refreshTimelines = () => {
      getStocksenseApi()
        .getStockTimelines(visibleTimelineCodes)
        .then((rows) => {
          if (alive) setTimelines((current) => ({ ...current, ...rows }));
        })
        .catch((error: unknown) => {
          if (alive) console.error(error);
        });
    };

    void refreshTimelines();
    window.clearInterval(timelineTimerRef.current);
    if (isChinaMarketOpen()) {
      timelineTimerRef.current = window.setInterval(refreshTimelines, FAVORITE_TIMELINE_REFRESH_INTERVAL_MS);
    }

    return () => {
      alive = false;
      window.clearInterval(timelineTimerRef.current);
    };
  }, [isActive, showTimeline, visibleTimelineCodes]);

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
          <Switch size='small' checked={showTimeline} onChange={handleTimelineSwitchChange} />
        </span>
      </div>
      <div className={cx(styles['right-panel-body'], styles['news-panel-body'])} ref={listRef}>
        {favoriteStocks.length ? (
          favoriteStocks.map((item) => {
            const quote = quotes[item.code] ?? item;
            const stock: StockDetail = { ...quote, code: item.code, name: quote.name ?? item.name };
            return (
              <FavoriteStockItem
                key={item.code}
                stock={stock}
                timeline={showTimeline && visibleTimelineCodeSet.has(item.code) ? timelines[item.code] : undefined}
                pinned={Boolean(item.pinned)}
                observeItem={observeFavoriteItem}
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
  observeItem(element: HTMLDivElement | null): void;
  onOpen(): void;
  onRemove(): void;
  onTogglePin(): void;
}

function FavoriteStockItem({ stock, timeline, pinned, observeItem, onOpen, onRemove, onTogglePin }: IFavoriteStockItemProps) {
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
      data-favorite-code={stock.code}
      ref={observeItem}
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
