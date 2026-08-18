import { formatMarketCap, formatPercent } from '../../market-view/market-format';
import type { MarketSearchResult } from '../../../shared/types';
import {
  formatSearchChangePercent,
  formatSearchQuoteValue,
  getSearchChangeTone,
} from '../utils';
import styles from './market-search-suggestion-list.module.scss';

interface IMarketSearchSuggestionListProps {
  onSelect(item: MarketSearchResult): void;
  suggestions: MarketSearchResult[];
}

export function MarketSearchSuggestionList({ onSelect, suggestions }: IMarketSearchSuggestionListProps) {
  return (
    <>
      {suggestions.map((item) => {
        const changeTone = getSearchChangeTone(item.changePercent);
        const changeClassName =
          changeTone === 'up' ? styles.up : changeTone === 'down' ? styles.down : styles.flat;
        const isBoard = item.kind === 'board';

        return (
          <button
            key={`${item.kind ?? 'stock'}-${item.code}`}
            className={styles.item}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(item);
            }}
            type='button'
          >
            <span className={styles.identity}>
              <span className={styles.name}>
                {item.name}
                <em>{isBoard ? '板块' : '股票'}</em>
              </span>
              <code>{item.code}</code>
            </span>
            {isBoard ? null : (
              <span className={styles.metrics}>
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
      })}
    </>
  );
}
