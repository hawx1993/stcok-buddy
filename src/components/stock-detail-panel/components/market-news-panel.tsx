import { Skeleton } from 'antd';
import { ChevronLeft, ChevronRight, Newspaper, RefreshCw, Search, SquareArrowOutUpRight } from 'lucide-react';
import { marked, Renderer } from 'marked';
import { useEffect, useState } from 'react';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import cx from '../../../shared/cx';
import type { IMarketNewsSummaryState, MarketNewsItem } from '../../../shared/types';
import styles from '../index.module.scss';

const NEWS_PAGE_SIZE = 30;
type TNewsTab = 'hot' | 'summary';

interface IMarketNewsPanelProps {
  isActive: boolean;
}

export function MarketNewsPanel({ isActive }: IMarketNewsPanelProps) {
  const [activeTab, setActiveTab] = useState<TNewsTab>('hot');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<MarketNewsItem[]>([]);
  const [summaryState, setSummaryState] = useState<IMarketNewsSummaryState>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!isActive || activeTab !== 'hot') return;
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
  }, [activeTab, isActive, page, query, refresh]);

  useEffect(() => {
    if (!isActive || activeTab !== 'summary') return;
    let alive = true;
    setLoading(true);
    setError(undefined);
    getStocksenseApi()
      .getMarketNewsSummaryState()
      .then((state) => {
        if (alive) setSummaryState(state);
      })
      .catch((loadError: unknown) => {
        if (!alive) return;
        console.error(loadError);
        setError(loadError instanceof Error ? loadError.message : 'AI 新闻总结加载失败，请稍后再试');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeTab, isActive, refresh]);

  const totalPages = Math.max(1, Math.ceil(total / NEWS_PAGE_SIZE));
  return (
    <>
      <div className={styles['right-panel-header']}>
        <div className={styles['news-title-row']}>
          <span className={styles.title}><Newspaper className={styles['panel-title-icon']} size={16} />市场热点</span>
          {activeTab === 'hot' ? <span className={styles['news-count']}>{total} 条</span> : null}
        </div>
        <div className={styles['news-tabs']} aria-label='新闻内容分类'>
          <button aria-pressed={activeTab === 'hot'} className={activeTab === 'hot' ? styles.active : ''} onClick={() => setActiveTab('hot')} type='button'>热门新闻</button>
          <button aria-pressed={activeTab === 'summary'} className={activeTab === 'summary' ? styles.active : ''} onClick={() => setActiveTab('summary')} type='button'>AI 总结</button>
        </div>
        <div className={styles['news-search-row']}>
          {activeTab === 'hot' ? (
            <label className={styles['rp-search-row']}>
              <Search aria-hidden='true' size={14} />
              <input aria-label='搜索新闻' value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder='搜索新闻' />
            </label>
          ) : null}
          <button aria-label={loading ? '正在刷新新闻' : '刷新新闻'} className={styles['news-refresh']} disabled={loading} onClick={() => setRefresh((value) => value + 1)} title={loading ? '正在刷新' : '刷新'} type='button'>
            <RefreshCw aria-hidden='true' className={loading ? styles['refreshing-icon'] : undefined} size={14} />
            <span>{loading ? '刷新中' : '刷新'}</span>
          </button>
        </div>
      </div>
      <div className={cx(styles['right-panel-body'], styles['news-panel-body'])}>
        {activeTab === 'hot' ? (
          <>
            <div className={styles['news-section-title']}>
              <span>实时资讯</span>
              <span>第 {page} / {totalPages} 页</span>
            </div>
            <div className={styles['right-news-list']}>
              {loading ? <NewsSkeleton rows={10} /> : error ? <div className={styles['empty-list']}>{error}</div> : items.length ? items.map((item) => <NewsItem key={item.id} item={item} />) : <div className={styles['empty-list']}>无匹配新闻</div>}
            </div>
            <div className={styles['news-pager']}>
              <button aria-label='上一页' disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))} title='上一页' type='button'>
                <ChevronLeft aria-hidden='true' size={15} />
              </button>
              <span>{page} / {totalPages}</span>
              <button aria-label='下一页' disabled={page >= totalPages || loading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} title='下一页' type='button'>
                <ChevronRight aria-hidden='true' size={15} />
              </button>
            </div>
          </>
        ) : <NewsSummary state={summaryState} loading={loading} error={error} />}
      </div>
    </>
  );
}

function renderNewsSummaryMarkdown(content: string): string {
  const renderer = new Renderer();
  renderer.html = ({ text }) => escapeHtml(text);
  renderer.link = ({ href, title, tokens }) => {
    const text = renderer.parser.parseInline(tokens);
    if (!isSafeNewsSummaryUrl(href)) return text;
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : '';
    return `<a href="${escapeHtml(href)}"${titleAttribute} target="_blank" rel="noopener noreferrer">${text}</a>`;
  };
  return marked.parse(content, { async: false, breaks: true, renderer }) as string;
}

function isSafeNewsSummaryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character] ?? character);
}

function openNewsDetail(id: string) {
  void getStocksenseApi().openMarketNews(id).catch(console.error);
}

function NewsSummary({ state, loading, error }: { state?: IMarketNewsSummaryState; loading: boolean; error?: string }) {
  if (loading) return <NewsSkeleton rows={6} />;
  if (error) return <div className={styles['empty-list']}>{error}</div>;
  if (state?.error) return <div className={styles['empty-list']}>AI 总结暂不可用：{state.error}</div>;
  if (!state?.summary) return <div className={styles['empty-list']}>今日 AI 新闻总结正在后台生成，请稍后刷新。</div>;
  return (
    <article className={styles['news-summary']}>
      <div className={styles['news-summary-time']}>生成于 {new Date(state.summary.generatedAt).toLocaleString('zh-CN')}</div>
      <div
        className={styles['news-summary-content']}
        dangerouslySetInnerHTML={{ __html: renderNewsSummaryMarkdown(state.summary.content) }}
      />
      <div className={styles['news-summary-sources']}>
        引用新闻：{state.summary.sourceNews.map((item) => (
          <button key={item.id} onClick={() => openNewsDetail(item.id)} type='button'>
            {item.title}
          </button>
        ))}
      </div>
    </article>
  );
}

function NewsSkeleton({ rows }: { rows: number }) {
  return <div className={styles['news-skeleton']}>{Array.from({ length: rows }, (_, index) => <Skeleton key={index} active paragraph={{ rows: 1 }} title={{ width: '72%' }} className={styles['news-skeleton-row']} />)}</div>;
}

function NewsItem({ item }: { item: MarketNewsItem }) {
  return (
    <button aria-label={`打开新闻：${item.title}`} className={styles['news-item']} onClick={() => void getStocksenseApi().openMarketNews(item.id).catch(console.error)} type='button'>
      <div className={styles['news-meta']}>
        <span className={styles['news-time']}>{item.time || '--:--'}</span>
        {item.source ? <span className={styles['news-source']}>{item.source}</span> : null}
      </div>
      <div className={styles['news-title-row']}>
        <div className={styles['news-title']}>{item.title}</div>
        <SquareArrowOutUpRight aria-hidden='true' className={styles['news-open-icon']} size={13} />
      </div>
      {item.tags.length ? <div className={styles['news-tags']}>{item.tags.map((tag) => <span className={cx(styles.nt, item.tagType ? styles[item.tagType] : undefined)} key={tag}>{tag}</span>)}</div> : null}
    </button>
  );
}
