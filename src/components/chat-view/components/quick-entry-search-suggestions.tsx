import type { RefObject } from 'react';
import { formatMarketCap, formatPercent } from '../../market-view/market-format';
import {
  formatSearchChangePercent,
  formatSearchQuoteValue,
  getSearchChangeTone,
} from '../../global-stock-search/utils';
import type { MarketSearchResult } from '../../../shared/types';
import { useQuickEntrySuggestionPosition } from './use-quick-entry-suggestion-position';
import styles from '../index.module.scss';

interface IQuickEntrySearchSuggestionsProps {
  anchorRef: RefObject<HTMLDivElement | null>;
  debouncedSearch: string;
  error?: string;
  isOpen: boolean;
  onSelect(item: MarketSearchResult): void;
  searching: boolean;
  suggestions: MarketSearchResult[];
}

export function QuickEntrySearchSuggestions({
  anchorRef,
  debouncedSearch,
  error,
  isOpen,
  onSelect,
  searching,
  suggestions,
}: IQuickEntrySearchSuggestionsProps) {
  const { maxHeight, placement } = useQuickEntrySuggestionPosition(anchorRef, isOpen);
  if (!isOpen) return null;

  const panelClassName = placement === 'above'
    ? `${styles['qe-suggestions']} ${styles['qe-suggestions-above']}`
    : styles['qe-suggestions'];

  return (
    <div className={panelClassName} style={{ maxHeight }}>
      {searching ? (
        <div className={styles['qe-suggestion-empty']}>搜索中…</div>
      ) : error ? (
        <div className={styles['qe-suggestion-empty']}>搜索暂不可用</div>
      ) : suggestions.length ? (
        suggestions.map((item) => {
          const changeTone = getSearchChangeTone(item.changePercent);
          const changeClassName =
            changeTone === 'up'
              ? styles['qe-suggestion-up']
              : changeTone === 'down'
                ? styles['qe-suggestion-down']
                : styles['qe-suggestion-flat'];
          const isBoard = item.kind === 'board';

          return (
            <button
              key={`${item.kind ?? 'stock'}-${item.code}`}
              className={styles['qe-suggestion-item']}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(item);
              }}
              type='button'
            >
              <span className={styles['qe-suggestion-identity']}>
                <span className={styles['qe-suggestion-name']}>
                  {item.name}
                  <em>{isBoard ? '板块' : '股票'}</em>
                </span>
                <code>{item.code}</code>
              </span>
              {isBoard ? null : (
                <span className={styles['qe-suggestion-metrics']}>
                  <span>
                    <small>现价</small>
                    <strong>{formatSearchQuoteValue(item.price)}</strong>
                  </span>
                  <span>
                    <small>市值</small>
                    <strong>{formatMarketCap(item.marketCap)}</strong>
                  </span>
                  <span>
                    <small>换手率</small>
                    <strong>{formatPercent(item.turnoverRate)}</strong>
                  </span>
                  <span>
                    <small>涨跌幅</small>
                    <strong className={changeClassName}>{formatSearchChangePercent(item.changePercent)}</strong>
                  </span>
                </span>
              )}
            </button>
          );
        })
      ) : debouncedSearch ? (
        <div className={styles['qe-suggestion-empty']}>无匹配结果</div>
      ) : null}
    </div>
  );
}
