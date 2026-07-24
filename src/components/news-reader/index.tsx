import { useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { getStocksenseApi } from '../../shared/stocksense-api';
import { useAppStore } from '../../store/app-store';
import styles from './index.module.scss';

export function NewsReader() {
  const [progress, setProgress] = useState(0);
  const reader = useAppStore((state) => state.newsReader);
  const closeNewsReader = useAppStore((state) => state.closeNewsReader);

  useEffect(() => {
    if (!reader?.loading) {
      setProgress(0);
      return;
    }
    setProgress(12);
    const timer = window.setInterval(() => {
      setProgress((value) => Math.min(88, value + Math.max(2, Math.round((90 - value) / 6))));
    }, 260);
    return () => window.clearInterval(timer);
  }, [reader?.loading, reader?.requestId]);

  if (!reader) return null;

  const reload = () => {
    const requestId = useAppStore.getState().openNewsReader(reader.source);
    void getStocksenseApi()
      .getMarketNewsItem(reader.source)
      .then((item) => useAppStore.getState().setNewsReaderItem(requestId, item))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '新闻详情加载失败，请稍后重试';
        useAppStore.getState().setNewsReaderError(requestId, message);
      });
  };

  const content = reader.item?.content?.trim();
  const paragraphs = content?.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean) ?? [];

  return (
    <section className={styles.reader} aria-label='新闻详情'>
      <header className={styles.toolbar}>
        <button aria-label='返回' className={styles['toolbar-button']} onClick={closeNewsReader} title='返回' type='button'>
          <ArrowLeft aria-hidden='true' size={18} />
        </button>
        <div className={styles['toolbar-title']}>{reader.item?.title ?? '正在加载新闻'}</div>
        <button aria-label={reader.loading ? `新闻加载进度 ${progress}%` : '刷新新闻'} className={styles['toolbar-button']} disabled={reader.loading} onClick={reload} title={reader.loading ? `加载中 ${progress}%` : '刷新'} type='button'>
          {reader.loading ? <span aria-hidden='true' className={styles['loading-progress']}>{progress}%</span> : <RefreshCw aria-hidden='true' size={17} />}
        </button>
      </header>
      {reader.loading ? (
        <div aria-label={`新闻加载进度 ${progress}%`} className={styles.progress} role='progressbar' aria-valuemax={100} aria-valuemin={0} aria-valuenow={progress}>
          <div style={{ width: `${progress}%` }} />
        </div>
      ) : null}
      <div className={styles.content}>
        {reader.loading && !reader.item ? <NewsArticleSkeleton /> : null}
        {reader.error ? (
          <div className={styles.error} role='alert'>
            <p>{reader.error}</p>
            <button onClick={reload} type='button'>重新加载</button>
          </div>
        ) : null}
        {reader.item && !reader.error ? (
          <article className={styles.article}>
            <h1>{reader.item.title}</h1>
            <div className={styles.meta}>{reader.item.time}{reader.item.source ? ` · ${reader.item.source}` : ''}</div>
            {paragraphs.length ? <div className={styles.body}>{paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div> : <div className={styles.empty}>当前数据源仅提供新闻标题和摘要，暂无可展示的原文正文。</div>}
            {reader.item.tags.length ? <div className={styles.tags}>{reader.item.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
          </article>
        ) : null}
      </div>
    </section>
  );
}

function NewsArticleSkeleton() {
  return (
    <article aria-busy='true' aria-label='正在加载新闻正文' className={styles['article-skeleton']}>
      <div aria-hidden='true' className={styles['skeleton-title']}>
        <span />
        <span />
      </div>
      <div aria-hidden='true' className={styles['skeleton-meta']} />
      <div aria-hidden='true' className={styles['skeleton-body']}>
        {Array.from({ length: 7 }, (_, index) => <span className={index === 6 ? styles['skeleton-body-short'] : undefined} key={index} />)}
      </div>
      <div aria-hidden='true' className={styles['skeleton-footer']}>
        <span />
        <span />
        <span />
      </div>
    </article>
  );
}
