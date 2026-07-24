import { message as antdMessage } from 'antd';
import { Pin, PinOff, Star, Trash2 } from 'lucide-react';
import { useEffect, useState, type MouseEvent } from 'react';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import cx from '../../../shared/cx';
import type { StockDetail } from '../../../shared/types';
import { useAppStore } from '../../../store/app-store';
import { Empty } from '../../empty';
import styles from '../index.module.scss';

interface IFavoritesPanelProps {
  isActive: boolean;
}

export function FavoritesPanel({ isActive }: IFavoritesPanelProps) {
  const [quotes, setQuotes] = useState<Record<string, StockDetail>>({});
  const favoriteStocks = useAppStore((state) => state.favoriteStocks);
  const setFavoriteStocks = useAppStore((state) => state.setFavoriteStocks);
  const setSelectedStock = useAppStore((state) => state.setSelectedStock);
  const setRightPanelTab = useAppStore((state) => state.setRightPanelTab);
  const openRightPanel = useAppStore((state) => state.openRightPanel);

  useEffect(() => {
    if (!isActive || !favoriteStocks.length) return;
    let alive = true;
    const refreshQuotes = async () => {
      try {
        const rows = await getStocksenseApi().getBatchQuotes(favoriteStocks.map((item) => item.code));
        if (alive) setQuotes(Object.fromEntries(rows.map((quote) => [quote.code, quote])));
      } catch (error: unknown) {
        if (alive) console.error(error);
      }
    };
    void refreshQuotes();
    const id = window.setInterval(refreshQuotes, 30_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [favoriteStocks, isActive]);

  const openStock = async (stock: StockDetail) => {
    setRightPanelTab('stock');
    openRightPanel();
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
      <div className={styles['right-panel-header']}>
        <span className={styles.title}><Star className={styles['panel-title-icon']} size={16} />收藏个股</span>
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
  pinned: boolean;
  onOpen(): void;
  onRemove(): void;
  onTogglePin(): void;
}

function FavoriteStockItem({ stock, pinned, onOpen, onRemove, onTogglePin }: IFavoriteStockItemProps) {
  const stop = (event: MouseEvent, action: () => void) => {
    event.stopPropagation();
    action();
  };
  const isUp = !String(stock.changePercent ?? '--').startsWith('-');
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
      <span className={styles['favorite-main']}>
        <b>
          {stock.name}
          <em>{stock.code}</em>
          {pinned ? <small>置顶</small> : null}
        </b>
        <span>{stock.turnover ? `成交额 ${stock.turnover}` : (stock.summary ?? '实时行情')}</span>
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
