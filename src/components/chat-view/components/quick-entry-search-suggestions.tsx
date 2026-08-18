import type { RefObject } from 'react';
import { MarketSearchSuggestionList } from '../../global-stock-search/components/market-search-suggestion-list';
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
        <MarketSearchSuggestionList onSelect={onSelect} suggestions={suggestions} />
      ) : debouncedSearch ? (
        <div className={styles['qe-suggestion-empty']}>无匹配结果</div>
      ) : null}
    </div>
  );
}
