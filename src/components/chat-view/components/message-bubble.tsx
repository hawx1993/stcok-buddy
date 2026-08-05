import { message as antdMessage } from 'antd';
import { memo, useMemo } from 'react';
import type { BoardDetail, ChatMessage, StockDetail } from '../../../shared/types';
import cx from '../../../shared/cx';
import { AnalysisProgress } from './analysis-progress';
import { WhaleLogo } from './whale-logo';
import { ThinkingBanner, AnalysisThinkingBanner, ProcessedBanner } from './thinking-components';
import { formatMessageTime } from './message-utils';
import { renderCommandInText, renderMarkdownContent } from './markdown';
import { ResultCard } from './result-card';
import { MarketReviewCard } from './market-review-card';
import { highlightSearchTermInHtml } from './search-highlight';
import styles from '../index.module.scss';

export type TStockLinkTarget = { code?: string; name: string };

interface IMessageBubbleProps {
  message: ChatMessage;
  now: number;
  slashItems: Array<{ command: string; description: string }>;
  searchQuery?: string;
  onStockClick(stock: TStockLinkTarget): void;
  onBoardClick(board: Pick<BoardDetail, 'code' | 'name'>): void;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  now,
  slashItems,
  searchQuery,
  onStockClick,
  onBoardClick,
}: IMessageBubbleProps) {
  const copySelectedMessage = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (message.role !== 'user') return;
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!text || !selection?.anchorNode || !event.currentTarget.contains(selection.anchorNode)) return;
    await navigator.clipboard.writeText(text);
    antdMessage.success('复制成功');
  };

  const renderedMessageHtml = useMemo(
    () =>
      message.content.trim()
        ? renderMarkdownContent(renderCommandInText(message.content, slashItems), {
            disclaimer:
              message.role === 'assistant' &&
              Boolean(message.result || message.evidence?.length || message.findings?.length || message.toolCalls?.length),
            stocks: message.result?.stocks,
          })
        : '',
    [message.content, message.evidence?.length, message.findings?.length, message.result, message.role, message.toolCalls?.length, slashItems],
  );
  const highlightedMessageHtml = useMemo(
    () => (searchQuery ? highlightSearchTermInHtml(renderedMessageHtml, searchQuery) : renderedMessageHtml),
    [renderedMessageHtml, searchQuery],
  );

  const openLinkedStock = (event: React.MouseEvent<HTMLDivElement>) => {
    const boardLink = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-board-code]');
    if (boardLink) {
      event.preventDefault();
      onBoardClick({
        code: boardLink.dataset.boardCode!,
        name: boardLink.dataset.boardName ?? boardLink.textContent ?? boardLink.dataset.boardCode!,
      });
      return;
    }
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-stock-code], a[data-stock-name]');
    if (!link) return;
    const name = link.dataset.stockName ?? link.textContent?.trim() ?? link.dataset.stockCode;
    if (!name) return;
    event.preventDefault();
    onStockClick({
      code: link.dataset.stockCode,
      name,
    });
  };

  return (
    <div
      className={cx(
        styles.msg,
        'msg',
        message.role === 'user' ? styles.user : styles.agent,
        message.role === 'user' ? 'user' : 'agent',
      )}
      data-msg
      data-message-id={message.id}
    >
      <div className={styles['msg-avatar']} data-avatar>
        {message.role === 'user' ? (
          '我'
        ) : (
          <span className={cx(styles.whale, message.thinking && styles.busy)} aria-label='AI 鲸鱼头像' role='img'>
            <WhaleLogo />
            <span className={styles['whale-splash']}>
              <span />
              <span />
              <span />
              <span />
              <span />
            </span>
          </span>
        )}
      </div>
      <div className={styles['msg-body']} data-msgbody>
        {message.thinking ? (
          message.runEvents?.length ? <AnalysisThinkingBanner /> : <ThinkingBanner />
        ) : message.processedSeconds ? (
          <ProcessedBanner seconds={message.processedSeconds} />
        ) : null}
        {message.runEvents?.length || message.thinking ? (
          <AnalysisProgress events={message.runEvents ?? []} toolCalls={message.toolCalls} />
        ) : null}
        {highlightedMessageHtml ? (
          <div
            className='msg-text'
            onClick={openLinkedStock}
            onMouseUp={copySelectedMessage}
            dangerouslySetInnerHTML={{ __html: highlightedMessageHtml }}
          />
        ) : null}
        {message.marketReview ? <MarketReviewCard report={message.marketReview} onBoardClick={onBoardClick} /> : null}
        {message.result ? (
          <ResultCard result={message.result} onStockClick={onStockClick} onBoardClick={onBoardClick} />
        ) : null}
        <div className={styles['msg-time']}>{formatMessageTime(message.createdAt, now)}</div>
      </div>
    </div>
  );
});
