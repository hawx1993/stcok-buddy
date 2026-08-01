import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getStocksenseApi } from '../../shared/stocksense-api';
import type { MarketSearchResult } from '../../shared/types';
import { useOpenMarketSearchResult } from '../../hooks/use-open-market-search-result';
import { getGlobalSearchShortcutLabel } from './shortcut';
import styles from './index.module.scss';

interface IGlobalStockSearchProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function formatSearchQuoteValue(value: MarketSearchResult['price']) {
  if (value === undefined || value === null || value === '') return '--';
  return String(value);
}

export function formatSearchChangePercent(value: MarketSearchResult['changePercent']) {
  if (value === undefined || value === null || value === '') return '--';
  const text = String(value);
  const numeric = Number.parseFloat(text.replace('%', ''));
  if (!Number.isFinite(numeric)) return text;
  return `${numeric > 0 ? '+' : ''}${numeric.toFixed(2)}%`;
}

export function getSearchChangeTone(value: MarketSearchResult['changePercent']) {
  const numeric = Number.parseFloat(String(value ?? '').replace('%', ''));
  if (!Number.isFinite(numeric) || numeric === 0) return 'flat';
  return numeric > 0 ? 'up' : 'down';
}

export function GlobalStockSearch({ open, onOpenChange }: IGlobalStockSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [suggestions, setSuggestions] = useState<MarketSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const { openSearchResult } = useOpenMarketSearchResult();
  const shortcutLabel = getGlobalSearchShortcutLabel();

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setSearchText('');
      setDebouncedSearch('');
      setSuggestions([]);
      setSearching(false);
      setSearchError('');
    }
  }, [open]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(open ? searchText.trim() : ''), 250);
    return () => window.clearTimeout(timer);
  }, [open, searchText]);

  useEffect(() => {
    let alive = true;
    if (!debouncedSearch) {
      setSuggestions([]);
      setSearching(false);
      setSearchError('');
      return () => {
        alive = false;
      };
    }
    setSearching(true);
    setSearchError('');
    getStocksenseApi()
      .searchStocks(debouncedSearch)
      .then((items) => {
        if (alive) setSuggestions(items);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setSuggestions([]);
        setSearchError(error instanceof Error ? error.message : '搜索失败，请稍后重试');
      })
      .finally(() => {
        if (alive) setSearching(false);
      });
    return () => {
      alive = false;
    };
  }, [debouncedSearch]);

  if (!open) return null;

  const close = () => onOpenChange(false);
  const selectResult = (row: MarketSearchResult) => {
    close();
    void openSearchResult(row);
  };

  return (
    <div className={styles.overlay} onMouseDown={close} role='presentation'>
      <section className={styles.panel} onMouseDown={(event) => event.stopPropagation()} role='dialog' aria-modal='true'>
        <div className={styles.searchRow}>
          <Search aria-hidden='true' size={18} />
          <input
            ref={inputRef}
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') close();
            }}
            placeholder='搜索代码 / 股票名称 / 板块'
            aria-label='全局行情搜索'
          />
          <kbd>{shortcutLabel}</kbd>
          <button onClick={close} type='button' aria-label='关闭全局搜索'>
            <X size={16} />
          </button>
        </div>
        <div className={styles.results}>
          {searching ? (
            <div className={styles.empty}>搜索中…</div>
          ) : searchError ? (
            <div className={styles.empty}>{searchError}</div>
          ) : suggestions.length ? (
            suggestions.map((row) => {
              const tone = getSearchChangeTone(row.changePercent);
              const changeClassName = tone === 'up' ? styles.up : tone === 'down' ? styles.down : styles.flat;
              return (
                <button
                  key={`${row.kind ?? 'stock'}-${row.code}`}
                  className={styles.resultItem}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectResult(row);
                  }}
                  type='button'
                >
                  <span className={styles.resultName}>
                    {row.name}
                    <em>{row.kind === 'board' ? '板块' : '股票'}</em>
                  </span>
                  <span className={styles.resultMeta}>
                    <code>{row.code}</code>
                    <span>{formatSearchQuoteValue(row.price)}</span>
                    <span className={changeClassName}>{formatSearchChangePercent(row.changePercent)}</span>
                  </span>
                </button>
              );
            })
          ) : debouncedSearch ? (
            <div className={styles.empty}>无匹配结果</div>
          ) : (
            <div className={styles.empty}>输入股票代码、名称或板块名称开始搜索</div>
          )}
        </div>
        <footer className={styles.footer}>
          <span>按 Esc 关闭</span>
          <span>{shortcutLabel} 呼出搜索</span>
        </footer>
      </section>
    </div>
  );
}
