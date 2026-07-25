import { message as antdMessage } from 'antd';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { StockDetail } from '../../shared/types';
import { getStocksenseApi } from '../../shared/stocksense-api';
import { useAppStore } from '../../store/app-store';
import styles from './index.module.scss';

type TNewsContentBlock = { type: 'paragraph'; content: string } | { type: 'table'; rows: IArticleTableCell[][] };

interface IArticleTableCell {
  content: string;
  header: boolean;
  colSpan?: number;
  rowSpan?: number;
}

const TABLE_MARKER = /\[\[STOCK_BUDDY_TABLE:(.*?)\]\]/gs;
const STOCK_CODE_PATTERN = /(?<![\w/.-])((?:sh|sz|bj)?\d{6})(?![\w/.-])/gi;

function parseNewsContent(content: string): TNewsContentBlock[] {
  const blocks: TNewsContentBlock[] = [];
  let cursor = 0;
  for (const match of content.matchAll(TABLE_MARKER)) {
    appendParagraphBlocks(blocks, content.slice(cursor, match.index));
    const table = parseArticleTable(match[1]);
    if (table.length) blocks.push({ type: 'table', rows: table });
    else appendParagraphBlocks(blocks, match[0]);
    cursor = (match.index ?? 0) + match[0].length;
  }
  appendParagraphBlocks(blocks, content.slice(cursor));
  return blocks;
}

function appendParagraphBlocks(blocks: TNewsContentBlock[], content: string) {
  for (const paragraph of content
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean))
    blocks.push({ type: 'paragraph', content: paragraph });
}

function parseArticleTable(value: string | undefined): IArticleTableCell[][] {
  if (!value) return [];
  try {
    const table: unknown = JSON.parse(decodeURIComponent(value));
    return Array.isArray(table) && table.every((row) => Array.isArray(row) && row.every(isArticleTableCell))
      ? table
      : [];
  } catch {
    return [];
  }
}

function isArticleTableCell(value: unknown): value is IArticleTableCell {
  if (!value || typeof value !== 'object') return false;
  const cell = value as Record<string, unknown>;
  return (
    typeof cell.content === 'string' &&
    typeof cell.header === 'boolean' &&
    (cell.colSpan === undefined || (typeof cell.colSpan === 'number' && Number.isInteger(cell.colSpan) && cell.colSpan > 1)) &&
    (cell.rowSpan === undefined || (typeof cell.rowSpan === 'number' && Number.isInteger(cell.rowSpan) && cell.rowSpan > 1))
  );
}

function normalizeStockCode(value: string) {
  const code = value.trim().toLowerCase();
  return /^(?:sh|sz|bj)?\d{6}$/.test(code) ? code : undefined;
}

function getTableStock(rows: IArticleTableCell[][], row: IArticleTableCell[]) {
  const headers = rows.find((item) => item.every((cell) => cell.header));
  if (!headers) return undefined;
  const codeIndex = headers.findIndex((cell) => /^(代码|证券代码|股票代码)$/.test(cell.content.trim()));
  if (codeIndex < 0) return undefined;
  const code = normalizeStockCode(row[codeIndex]?.content ?? '');
  if (!code) return undefined;
  const nameIndex = headers.findIndex((cell) => /^(简称|名称|证券简称|股票简称)$/.test(cell.content.trim()));
  return { code, name: row[nameIndex]?.content.trim() || code, codeIndex, nameIndex };
}

export function NewsReader() {
  const [progress, setProgress] = useState(0);
  const reader = useAppStore((state) => state.newsReader);
  const closeNewsReader = useAppStore((state) => state.closeNewsReader);
  const openRightPanel = useAppStore((state) => state.openRightPanel);
  const setSelectedStock = useAppStore((state) => state.setSelectedStock);
  const latestStockRequestId = useRef(0);

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

  const openStockDetail = async (stock: Pick<StockDetail, 'code' | 'name'>) => {
    const requestId = latestStockRequestId.current + 1;
    latestStockRequestId.current = requestId;
    openRightPanel();
    setSelectedStock(stock);
    try {
      const detail = await getStocksenseApi().getStockDetail(stock.code);
      if (latestStockRequestId.current !== requestId) return;
      setSelectedStock({ ...detail, name: detail.name === detail.code ? stock.name : detail.name });
    } catch (error: unknown) {
      if (latestStockRequestId.current !== requestId) return;
      const message = error instanceof Error ? error.message : '个股详情加载失败，请稍后重试';
      antdMessage.error(message);
    }
  };

  const content = reader.item?.content?.trim();
  const blocks = content ? parseNewsContent(content) : [];

  return (
    <section className={styles.reader} aria-label='新闻详情'>
      <header className={styles.toolbar}>
        <button
          aria-label='返回'
          className={styles['toolbar-button']}
          onClick={closeNewsReader}
          title='返回'
          type='button'
        >
          <ArrowLeft aria-hidden='true' size={18} />
        </button>
        <div className={styles['toolbar-title']}>{reader.item?.title ?? '正在加载新闻'}</div>
        <button
          aria-label={reader.loading ? `新闻加载进度 ${progress}%` : '刷新新闻'}
          className={styles['toolbar-button']}
          disabled={reader.loading}
          onClick={reload}
          title={reader.loading ? `加载中 ${progress}%` : '刷新'}
          type='button'
        >
          {reader.loading ? (
            <span aria-hidden='true' className={styles['loading-progress']}>
              {progress}%
            </span>
          ) : (
            <RefreshCw aria-hidden='true' size={17} />
          )}
        </button>
      </header>
      {reader.loading ? (
        <div
          aria-label={`新闻加载进度 ${progress}%`}
          className={styles.progress}
          role='progressbar'
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={progress}
        >
          <div style={{ width: `${progress}%` }} />
        </div>
      ) : null}
      <div className={styles.content}>
        {reader.loading && !reader.item ? <NewsArticleSkeleton /> : null}
        {reader.error ? (
          <div className={styles.error} role='alert'>
            <p>{reader.error}</p>
            <button onClick={reload} type='button'>
              重新加载
            </button>
          </div>
        ) : null}
        {reader.item && !reader.error ? (
          <article className={styles.article}>
            <h1>{reader.item.title}</h1>
            <div className={styles.meta}>
              {reader.item.time}
              {reader.item.source ? ` · ${reader.item.source}` : ''}
            </div>
            {blocks.length ? (
              <div className={styles.body}>
                {blocks.map((block, index) =>
                  block.type === 'paragraph' ? (
                    <ArticleParagraph key={`${block.content}-${index}`} content={block.content} onOpenStock={openStockDetail} />
                  ) : (
                    <ArticleTable key={`table-${index}`} rows={block.rows} onOpenStock={openStockDetail} />
                  ),
                )}
              </div>
            ) : (
              <div className={styles.empty}>当前数据源仅提供新闻标题和摘要，暂无可展示的原文正文。</div>
            )}
            {reader.item.tags.length ? (
              <div className={styles.tags}>
                {reader.item.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            ) : null}
          </article>
        ) : null}
      </div>
    </section>
  );
}

function ArticleParagraph({ content, onOpenStock }: { content: string; onOpenStock(stock: Pick<StockDetail, 'code' | 'name'>): void }) {
  const parts = content.split(STOCK_CODE_PATTERN);
  return (
    <p>
      {parts.map((part, index) => {
        const code = index % 2 === 1 ? normalizeStockCode(part) : undefined;
        return code ? (
          <StockLink key={`${code}-${index}`} stock={{ code, name: code }} onOpenStock={onOpenStock} />
        ) : (
          part
        );
      })}
    </p>
  );
}

function ArticleTable({ rows, onOpenStock }: { rows: IArticleTableCell[][]; onOpenStock(stock: Pick<StockDetail, 'code' | 'name'>): void }) {
  const headerRows = rows.filter((row) => row.every((cell) => cell.header));
  const bodyRows = rows.slice(headerRows.length);
  return (
    <div className={styles['table-wrap']}>
      <table>
        {headerRows.length ? (
          <thead>
            {headerRows.map((row, rowIndex) => (
              <tr key={`header-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <th colSpan={cell.colSpan} key={`header-${rowIndex}-${cellIndex}`} rowSpan={cell.rowSpan}>
                    {cell.content}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
        ) : null}
        <tbody>
          {bodyRows.map((row, rowIndex) => {
            const stock = getTableStock(rows, row);
            return (
              <tr key={`body-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td colSpan={cell.colSpan} key={`body-${rowIndex}-${cellIndex}`} rowSpan={cell.rowSpan}>
                    {stock && (cellIndex === stock.codeIndex || cellIndex === stock.nameIndex) ? (
                      <StockLink stock={stock} onOpenStock={onOpenStock}>
                        {cell.content}
                      </StockLink>
                    ) : (
                      cell.content
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StockLink({ stock, onOpenStock, children }: { stock: Pick<StockDetail, 'code' | 'name'>; onOpenStock(stock: Pick<StockDetail, 'code' | 'name'>): void; children?: string }) {
  return (
    <button className={styles['stock-link']} onClick={() => onOpenStock(stock)} type='button'>
      {children ?? stock.name}
    </button>
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
        {Array.from({ length: 7 }, (_, index) => (
          <span className={index === 6 ? styles['skeleton-body-short'] : undefined} key={index} />
        ))}
      </div>
      <div aria-hidden='true' className={styles['skeleton-footer']}>
        <span />
        <span />
        <span />
      </div>
    </article>
  );
}
