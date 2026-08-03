import { SquareArrowOutUpRight } from 'lucide-react';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { MarketNewsItem } from '../../../shared/types';
import { useAppUiStore } from '../../../store/app-store';
import { NewsSkeleton } from './news-skeleton';
import styles from '../index.module.scss';

const QUICK_NEWS_LIMIT = 10;

interface IStockQuickNewsProps {
  code: string;
  limit?: number;
}

export function StockQuickNews({ code, limit = QUICK_NEWS_LIMIT }: IStockQuickNewsProps) {
  const [items, setItems] = useState<MarketNewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let alive = true;
    setItems([]);
    setLoading(true);
    setError(undefined);
    getStocksenseApi()
      .listStockNews(code, limit)
      .then((news) => {
        if (alive) setItems(news.slice(0, limit));
      })
      .catch((loadError: unknown) => {
        if (!alive) return;
        setError(loadError instanceof Error ? loadError.message : '个股快讯加载失败，请稍后再试');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [code, limit]);

  if (loading) {
    return (
      <div className={styles['stock-quick-news']}>
        <NewsSkeleton rows={3} />
      </div>
    );
  }

  if (error) return <div className={styles['stock-quick-news-state']}>{error}</div>;
  if (!items.length) return <div className={styles['stock-quick-news-state']}>暂无相关快讯</div>;

  return (
    <div className={styles['stock-quick-news']}>
      {items.map((item) => (
        <StockQuickNewsItem item={item} key={`${code}-${item.id}`} />
      ))}
    </div>
  );
}

interface IStockQuickNewsItemProps {
  item: MarketNewsItem;
}

function StockQuickNewsItem({ item }: IStockQuickNewsItemProps) {
  const openNewsDetail = () => {
    const requestId = useAppUiStore.getState().openNewsReader(item);
    void getStocksenseApi()
      .getMarketNewsItem(item)
      .then((detail) => useAppUiStore.getState().setNewsReaderItem(requestId, detail))
      .catch((loadError: unknown) =>
        useAppUiStore
          .getState()
          .setNewsReaderError(
            requestId,
            loadError instanceof Error ? loadError.message : '新闻详情加载失败，请稍后重试',
          ),
      );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openNewsDetail();
    }
  };

  return (
    <div
      aria-label={`打开快讯：${item.title}`}
      className={styles['news-item']}
      onClick={openNewsDetail}
      onKeyDown={onKeyDown}
      role='button'
      tabIndex={0}
    >
      <div className={styles['news-meta']}>
        <span className={styles['news-time']}>{item.time || '--:--'}</span>
        {item.source ? <span className={styles['news-source']}>{item.source}</span> : null}
      </div>
      <div className={styles['news-title-row']}>
        <div className={styles['news-title']}>{item.title}</div>
        <SquareArrowOutUpRight aria-hidden='true' className={styles['news-open-icon']} size={13} />
      </div>
    </div>
  );
}
