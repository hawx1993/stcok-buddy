import { Switch, message as antdMessage } from 'antd';
import { ChevronLeft, ChevronRight, RefreshCw, Search, SquareArrowOutUpRight, X } from 'lucide-react';
import { useEffect, useState, type KeyboardEvent } from 'react';
import cx from '../../../shared/cx';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { IStockNewsFeed, IStockNewsPreferences, MarketNewsItem, MarketSearchResult } from '../../../shared/types';
import { useAppStore } from '../../../store/app-store';
import { NewsLinkCopyButton } from './news-link-copy-button';
import { NewsSkeleton } from './news-skeleton';
import styles from '../index.module.scss';

const SEARCH_DELAY = 250;
const STOCK_NEWS_PAGE_SIZE = 50;

interface IStockNewsPanelProps {
  isActive: boolean;
}

export function StockNewsPanel({ isActive }: IStockNewsPanelProps) {
  const favoriteStocks = useAppStore((state) => state.favoriteStocks);
  const [feed, setFeed] = useState<IStockNewsFeed>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<MarketSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [page, setPage] = useState(1);

  const preferences = feed?.preferences ?? { favoritesOnly: false, manualStocks: [] };
  const refresh = async () => {
    setPage(1);
    setLoading(true);
    setError(undefined);
    try {
      setFeed(await getStocksenseApi().listStockNewsFeed());
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : '个股新闻加载失败，请稍后再试');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isActive) void refresh();
  }, [isActive, favoriteStocks]);

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      getStocksenseApi()
        .searchStocks(normalized)
        .then((results) => {
          if (alive) setSuggestions(results.filter((item) => item.kind !== 'board'));
        })
        .catch((searchError: unknown) => {
          console.error(searchError);
          if (alive) setSuggestions([]);
        })
        .finally(() => {
          if (alive) setSearching(false);
        });
    }, SEARCH_DELAY);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const updatePreferences = (next: IStockNewsPreferences) => {
    setFeed((current) => ({ preferences: next, items: current?.items ?? [] }));
  };

  const toggleFavoritesOnly = async (favoritesOnly: boolean) => {
    try {
      updatePreferences(await getStocksenseApi().setStockNewsFavoritesOnly(favoritesOnly));
      await refresh();
    } catch (updateError: unknown) {
      antdMessage.error(updateError instanceof Error ? updateError.message : '关注范围更新失败');
    }
  };

  const addStock = async (stock: MarketSearchResult) => {
    try {
      updatePreferences(await getStocksenseApi().addStockNewsSubscription({ code: stock.code, name: stock.name }));
      setQuery('');
      setSuggestions([]);
      await refresh();
    } catch (addError: unknown) {
      antdMessage.error(addError instanceof Error ? addError.message : '添加关注失败');
    }
  };

  const removeStock = async (code: string) => {
    try {
      updatePreferences(await getStocksenseApi().removeStockNewsSubscription(code));
      await refresh();
    } catch (removeError: unknown) {
      antdMessage.error(removeError instanceof Error ? removeError.message : '移除关注失败');
    }
  };

  const total = feed?.items.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / STOCK_NEWS_PAGE_SIZE));
  const pageItems = feed?.items.slice((page - 1) * STOCK_NEWS_PAGE_SIZE, page * STOCK_NEWS_PAGE_SIZE) ?? [];

  return (
    <>
      <div className={styles['stock-news-controls']}>
        <div className={styles['stock-news-mode']}>
          <span>仅关注收藏个股</span>
          <Switch checked={preferences.favoritesOnly} onChange={(checked) => void toggleFavoritesOnly(checked)} size='small' />
        </div>
        <div className={styles['stock-news-subscriptions']}>
          {favoriteStocks.map((stock) => <span className={styles['stock-news-chip']} key={stock.code}>{stock.name}<small>{stock.code}</small></span>)}
          {!preferences.favoritesOnly ? preferences.manualStocks.map((stock) => (
            <span className={cx(styles['stock-news-chip'], styles['stock-news-chip-manual'])} key={stock.code}>
              {stock.name}<small>{stock.code}</small>
              <button aria-label={`移除 ${stock.name}`} onClick={() => void removeStock(stock.code)} type='button'><X aria-hidden='true' size={12} /></button>
            </span>
          )) : null}
        </div>
        {!preferences.favoritesOnly ? (
          <div className={styles['stock-news-search-wrap']}>
            <label className={styles['rp-search-row']}>
              <Search aria-hidden='true' size={14} />
              <input aria-label='搜索股票添加个股新闻' onChange={(event) => setQuery(event.target.value)} placeholder='搜索股票代码 / 名称' value={query} />
            </label>
            {query ? (
              <div className={styles['stock-news-suggestions']}>
                {searching ? <div>搜索中…</div> : suggestions.length ? suggestions.map((stock) => {
                  const isFavorite = favoriteStocks.some((item) => item.code === stock.code);
                  const isSubscribed = preferences.manualStocks.some((item) => item.code === stock.code);
                  const unavailable = isFavorite || isSubscribed || preferences.manualStocks.length >= 12;
                  const reason = isFavorite ? '已收藏' : isSubscribed ? '已关注' : preferences.manualStocks.length >= 12 ? '已达上限' : '';
                  return <button disabled={unavailable} key={stock.code} onClick={() => void addStock(stock)} type='button'><span>{stock.name}<small>{stock.code}</small></span><em>{reason || '添加'}</em></button>;
                }) : <div>未找到可添加的股票</div>}
              </div>
            ) : null}
          </div>
        ) : null}
        {!preferences.favoritesOnly ? <div className={styles['stock-news-limit']}>手动关注 {preferences.manualStocks.length} / 12</div> : null}
      </div>
      <div className={styles['stock-news-heading']}>
        <span>个股资讯 · {total} 条 · 第 {page} / {totalPages} 页</span>
        <button aria-label={loading ? '正在刷新个股新闻' : '刷新个股新闻'} className={styles['news-refresh']} disabled={loading} onClick={() => void refresh()} type='button'>
          <RefreshCw aria-hidden='true' className={loading ? styles['refreshing-icon'] : undefined} size={14} /><span>刷新</span>
        </button>
      </div>
      <div className={styles['right-news-list']}>
        {loading ? <NewsSkeleton rows={10} /> : error ? <div className={styles['empty-list']}>{error}</div> : !pageItems.length ? <div className={styles['empty-list']}>{favoriteStocks.length || preferences.manualStocks.length ? '暂无个股新闻' : '请先收藏股票或添加手动关注股票'}</div> : pageItems.map((item) => <StockNewsItem item={item} key={`${item.stockCode ?? ''}-${item.id}`} />)}
      </div>
      <div className={styles['news-pager']}>
        <button aria-label='上一页' disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))} title='上一页' type='button'><ChevronLeft aria-hidden='true' size={15} /></button>
        <span>{page} / {totalPages}</span>
        <button aria-label='下一页' disabled={page >= totalPages || loading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} title='下一页' type='button'><ChevronRight aria-hidden='true' size={15} /></button>
      </div>
    </>
  );
}

function StockNewsItem({ item }: { item: MarketNewsItem }) {
  const openNewsDetail = () => {
    const requestId = useAppStore.getState().openNewsReader(item);
    void getStocksenseApi().getMarketNewsItem(item)
      .then((detail) => useAppStore.getState().setNewsReaderItem(requestId, detail))
      .catch((loadError: unknown) => useAppStore.getState().setNewsReaderError(requestId, loadError instanceof Error ? loadError.message : '新闻详情加载失败，请稍后重试'));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openNewsDetail();
    }
  };
  return <div aria-label={`打开新闻：${item.title}`} className={styles['news-item']} onClick={openNewsDetail} onKeyDown={onKeyDown} role='button' tabIndex={0}>
    <div className={styles['news-meta']}><span className={styles['news-time']}>{item.time || '--:--'}</span>{item.stockName ? <span className={styles['stock-news-stock']}>{item.stockName} {item.stockCode}</span> : null}{item.source ? <span className={styles['news-source']}>{item.source}</span> : null}</div>
    <div className={styles['news-title-row']}><div className={styles['news-title']}>{item.title}</div><span className={styles['news-item-actions']}><NewsLinkCopyButton url={item.url} /><SquareArrowOutUpRight aria-hidden='true' className={styles['news-open-icon']} size={13} /></span></div>
  </div>;
}
