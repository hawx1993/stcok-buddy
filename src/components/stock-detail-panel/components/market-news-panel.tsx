import { Skeleton } from 'antd';
import { useEffect, useState } from 'react';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import cx from '../../../shared/cx';
import type { MarketNewsItem } from '../../../shared/types';
import styles from '../index.module.scss';

const NEWS_PAGE_SIZE = 30;

interface IMarketNewsPanelProps {
  isActive: boolean;
}

export function MarketNewsPanel({ isActive }: IMarketNewsPanelProps) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<MarketNewsItem[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!isActive) return;
    let alive = true;
    setLoading(true);
    setError(undefined);
    getStocksenseApi()
      .listMarketNews(query, page, NEWS_PAGE_SIZE)
      .then((result) => {
        if (!alive) return;
        setItems(result.items);
        setTotal(result.total);
      })
      .catch((loadError: unknown) => {
        if (!alive) return;
        console.error(loadError);
        setError(loadError instanceof Error ? loadError.message : '新闻加载失败，请稍后再试');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [isActive, page, query, refresh]);

  const totalPages = Math.max(1, Math.ceil(total / NEWS_PAGE_SIZE));
  return (
    <>
      <div className={styles['right-panel-header']}>
        <span className={styles.title}>📰 市场热点</span>
        <div className={styles['news-search-row']}>
          <div className={styles['rp-search-row']}>
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder='搜索新闻…'
            />
          </div>
          <button
            className={styles['news-refresh']}
            onClick={() => setRefresh((value) => value + 1)}
            disabled={loading}
            type='button'
          >
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>
      </div>
      <div className={cx(styles['right-panel-body'], styles['news-panel-body'])}>
        <div className={styles['news-section-title']}>
          📌 热门新闻 <span>{total} 条</span>
        </div>
        <div className={styles['right-news-list']}>
          {loading ? (
            <NewsSkeleton rows={10} />
          ) : error ? (
            <div className={styles['empty-list']}>{error}</div>
          ) : items.length ? (
            items.map((item) => <NewsItem key={item.id} item={item} />)
          ) : (
            <div className={styles['empty-list']}>无匹配新闻</div>
          )}
        </div>
        <div className={styles['news-pager']}>
          <button
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1 || loading}
            type='button'
          >
            上一页
          </button>
          <span>
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            disabled={page >= totalPages || loading}
            type='button'
          >
            下一页
          </button>
        </div>
      </div>
    </>
  );
}

interface INewsSkeletonProps {
  rows: number;
}

function NewsSkeleton({ rows }: INewsSkeletonProps) {
  return (
    <div className={styles['news-skeleton']}>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton
          key={index}
          active
          paragraph={{ rows: 1 }}
          title={{ width: '72%' }}
          className={styles['news-skeleton-row']}
        />
      ))}
    </div>
  );
}

interface INewsItemProps {
  item: MarketNewsItem;
}

function NewsItem({ item }: INewsItemProps) {
  const content = (
    <>
      <div className={styles['news-time']}>
        {item.time}
        {item.source ? ` · ${item.source}` : ''}
      </div>
      <div className={styles['news-title']}>{item.title}</div>
      <div className={styles['news-tags']}>
        {item.tags.map((tag) => (
          <span className={cx(styles.nt, item.tagType ? styles[item.tagType] : undefined)} key={tag}>
            {tag}
          </span>
        ))}
      </div>
    </>
  );
  if (!item.url) return <div className={styles['news-item']}>{content}</div>;
  return (
    <button
      className={styles['news-item']}
      onClick={() => window.open(item.url, '_blank', 'noopener,noreferrer')}
      type='button'
    >
      {content}
    </button>
  );
}
