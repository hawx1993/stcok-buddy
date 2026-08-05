import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getStocksenseApi } from '../../shared/stocksense-api';
import type { IConversationSearchResult, MarketSearchResult } from '../../shared/types';
import { useOpenMarketSearchResult } from '../../hooks/use-open-market-search-result';
import {
  formatSearchChangePercent,
  formatSearchQuoteValue,
  getConversationRoleLabel,
  getGlobalSearchResultKey,
  getSearchChangeTone,
} from './utils';
import { useAppDataStore, useAppUiStore } from '../../store/app-store';
import { getGlobalSearchShortcutLabel } from './shortcut';
import styles from './index.module.scss';

interface IGlobalStockSearchProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function GlobalStockSearch({ open, onOpenChange }: IGlobalStockSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [marketResults, setMarketResults] = useState<MarketSearchResult[]>([]);
  const [conversationResults, setConversationResults] = useState<IConversationSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const { openSearchResult } = useOpenMarketSearchResult();
  const activeConversationId = useAppDataStore((state) => state.activeConversationId);
  const setActiveConversation = useAppDataStore((state) => state.setActiveConversation);
  const requestChatSearchHighlight = useAppUiStore((state) => state.requestChatSearchHighlight);
  const setMainView = useAppUiStore((state) => state.setMainView);
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
      setMarketResults([]);
      setConversationResults([]);
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
      setMarketResults([]);
      setConversationResults([]);
      setSearching(false);
      setSearchError('');
      return () => {
        alive = false;
      };
    }
    setSearching(true);
    setSearchError('');
    const api = getStocksenseApi();
    Promise.allSettled([api.searchStocks(debouncedSearch), api.searchConversations(debouncedSearch)])
      .then(([marketSearch, conversationSearch]) => {
        if (!alive) return;
        const markets = marketSearch.status === 'fulfilled' ? marketSearch.value : [];
        const conversations = conversationSearch.status === 'fulfilled' ? conversationSearch.value : [];
        setMarketResults(markets);
        setConversationResults(conversations);
        if (marketSearch.status === 'rejected' && conversationSearch.status === 'rejected') {
          const reason = marketSearch.reason;
          setSearchError(reason instanceof Error ? reason.message : '搜索失败，请稍后重试');
        }
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
  const selectMarketResult = (row: MarketSearchResult) => {
    close();
    void openSearchResult(row);
  };
  const selectConversationResult = (row: IConversationSearchResult) => {
    close();
    requestChatSearchHighlight({
      conversationId: row.conversationId,
      messageId: row.messageId,
      query: debouncedSearch || searchText.trim() || row.snippet,
    });
    if (row.conversationId === activeConversationId) setMainView('chat');
    else setActiveConversation(row.conversationId);
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
            placeholder='搜索代码 / 股票名称 / 板块 / 会话内容'
            aria-label='全局搜索'
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
          ) : marketResults.length || conversationResults.length ? (
            <>
              {marketResults.length ? (
                <section className={styles.group}>
                  <h3>行情 / 板块</h3>
                  {marketResults.map((row) => {
                    const tone = getSearchChangeTone(row.changePercent);
                    const changeClassName = tone === 'up' ? styles.up : tone === 'down' ? styles.down : styles.flat;
                    return (
                      <button
                        key={getGlobalSearchResultKey(row)}
                        className={styles.resultItem}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          selectMarketResult(row);
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
                  })}
                </section>
              ) : null}
              {conversationResults.length ? (
                <section className={styles.group}>
                  <h3>会话 / 消息</h3>
                  {conversationResults.map((row) => (
                    <button
                      key={getGlobalSearchResultKey(row)}
                      className={styles.conversationItem}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        selectConversationResult(row);
                      }}
                      type='button'
                    >
                      <span className={styles.resultName}>
                        {row.title}
                        <em>{getConversationRoleLabel(row.role)}</em>
                      </span>
                      <span className={styles.conversationSnippet}>{row.snippet || row.preview}</span>
                    </button>
                  ))}
                </section>
              ) : null}
            </>
          ) : debouncedSearch ? (
            <div className={styles.empty}>无匹配结果</div>
          ) : (
            <div className={styles.empty}>输入股票代码、名称、板块或会话内容开始搜索</div>
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
