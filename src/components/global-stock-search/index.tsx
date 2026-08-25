import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getStocksenseApi } from '../../shared/stocksense-api';
import type { IConversationSearchResult, IMonitorEvent, MarketNewsItem, MarketSearchResult } from '../../shared/types';
import { useOpenMarketSearchResult } from '../../hooks/use-open-market-search-result';
import { appendSearchHistoryItem, getConversationRoleLabel, getGlobalSearchResultKey, normalizeSearchHistory } from './utils';
import { MarketSearchSuggestionList } from './components/market-search-suggestion-list';
import { useAppDataStore, useAppUiStore } from '../../store/app-store';
import { getGlobalSearchShortcutLabel } from './shortcut';
import styles from './index.module.scss';

const NEWS_SEARCH_PAGE_SIZE = 20;
const MONITOR_SEARCH_PAGE_SIZE = 50;
const SEARCH_HISTORY_STORAGE_KEY = 'stocksense:global-search-history';

export type TGlobalSearchMode = 'global' | 'news' | 'ai-monitor';

export interface IGlobalSearchOpenOptions {
  placeholder?: string;
  aiMonitorDate?: string;
  onSelectAiMonitorEvent?(event: IMonitorEvent): void;
}

interface IGlobalStockSearchProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  mode?: TGlobalSearchMode;
  placeholder?: string;
  aiMonitorDate?: string;
  onSelectAiMonitorEvent?(event: IMonitorEvent): void;
}

function readSearchHistory() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY);
    return raw ? normalizeSearchHistory(JSON.parse(raw)) : [];
  } catch (error) {
    console.warn('读取搜索历史失败', error);
    return [];
  }
}

function writeSearchHistory(history: string[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch (error) {
    console.warn('保存搜索历史失败', error);
  }
}

function removeSearchHistory() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(SEARCH_HISTORY_STORAGE_KEY);
  } catch (error) {
    console.warn('清空搜索历史失败', error);
  }
}

const MONITOR_CATEGORY_LABELS: Record<IMonitorEvent['category'], string> = {
  'large-order': '大单异动',
  chip: '筹码变化',
  technical: '技术信号',
  'dragon-tiger': '龙虎榜',
  news: '新闻公告',
  risk: '风险预警',
  'ai-opportunity': 'AI机会',
  'ai-warning': 'AI预警',
};

export function GlobalStockSearch({
  open,
  onOpenChange,
  mode = 'global',
  placeholder,
  aiMonitorDate,
  onSelectAiMonitorEvent,
}: IGlobalStockSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRequestRef = useRef(0);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [marketResults, setMarketResults] = useState<MarketSearchResult[]>([]);
  const [conversationResults, setConversationResults] = useState<IConversationSearchResult[]>([]);
  const [newsResults, setNewsResults] = useState<MarketNewsItem[]>([]);
  const [aiMonitorResults, setAiMonitorResults] = useState<IMonitorEvent[]>([]);
  const [searchHistory, setSearchHistory] = useState<string[]>(readSearchHistory);
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
      setNewsResults([]);
      setAiMonitorResults([]);
      setSearching(false);
      setSearchError('');
    }
  }, [open]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(open ? searchText.trim() : ''), 300);
    return () => window.clearTimeout(timer);
  }, [open, searchText]);

  useEffect(() => {
    const requestId = ++searchRequestRef.current;
    let alive = true;
    if (!debouncedSearch) {
      setMarketResults([]);
      setConversationResults([]);
      setNewsResults([]);
      setAiMonitorResults([]);
      setSearching(false);
      setSearchError('');
      return () => {
        alive = false;
      };
    }
    setSearching(true);
    setSearchError('');
    const api = getStocksenseApi();
    if (mode === 'ai-monitor') {
      setMarketResults([]);
      setConversationResults([]);
      setNewsResults([]);
      setAiMonitorResults([]);
      api
        .getMonitorFeed({
          date: aiMonitorDate,
          limit: MONITOR_SEARCH_PAGE_SIZE,
          mode: 'history',
          query: debouncedSearch,
        })
        .then((result) => {
          // 丢弃过期请求的响应：用户快速连续输入时，只采纳最后一次输入的结果
          if (!alive || requestId !== searchRequestRef.current) return;
          setAiMonitorResults(result.events);
        })
        .catch((error: unknown) => {
          if (!alive || requestId !== searchRequestRef.current) return;
          setAiMonitorResults([]);
          setSearchError(error instanceof Error ? error.message : 'AI监控搜索失败，请稍后重试');
        })
        .finally(() => {
          if (alive && requestId === searchRequestRef.current) setSearching(false);
        });
      return () => {
        alive = false;
      };
    }
    if (mode === 'news') {
      setMarketResults([]);
      setConversationResults([]);
      setAiMonitorResults([]);
      api
        .listMarketNews(debouncedSearch, 1, NEWS_SEARCH_PAGE_SIZE)
        .then((result) => {
          // 丢弃过期请求的响应：用户快速连续输入时，只采纳最后一次输入的结果
          if (!alive || requestId !== searchRequestRef.current) return;
          setNewsResults(result.items);
        })
        .catch((error: unknown) => {
          if (!alive || requestId !== searchRequestRef.current) return;
          setNewsResults([]);
          setSearchError(error instanceof Error ? error.message : '新闻搜索失败，请稍后重试');
        })
        .finally(() => {
          if (alive && requestId === searchRequestRef.current) setSearching(false);
        });
      return () => {
        alive = false;
      };
    }
    setNewsResults([]);
    setAiMonitorResults([]);
    Promise.allSettled([api.searchStocks(debouncedSearch), api.searchConversations(debouncedSearch)])
      .then(([marketSearch, conversationSearch]) => {
        // 丢弃过期请求的响应：用户快速连续输入时，只采纳最后一次输入的结果
        if (!alive || requestId !== searchRequestRef.current) return;
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
        if (alive && requestId === searchRequestRef.current) setSearching(false);
      });
    return () => {
      alive = false;
    };
  }, [aiMonitorDate, debouncedSearch, mode]);

  const isNewsMode = mode === 'news';
  const isAiMonitorMode = mode === 'ai-monitor';

  if (!open) return null;

  const close = () => onOpenChange(false);
  const currentSearchKeyword = () => debouncedSearch || searchText.trim();
  const recordSelectedSearch = () => {
    const keyword = currentSearchKeyword();
    if (!keyword) return;
    setSearchHistory((current) => {
      const next = appendSearchHistoryItem(current, keyword);
      if (next.length === current.length && next.every((item, index) => item === current[index])) return current;
      writeSearchHistory(next);
      return next;
    });
  };
  const clearSearchHistory = () => {
    setSearchHistory([]);
    removeSearchHistory();
    inputRef.current?.focus();
  };
  const selectSearchHistory = (keyword: string) => {
    setSearchText(keyword);
    setDebouncedSearch(keyword);
    inputRef.current?.focus();
  };
  const searchPlaceholder = placeholder ?? (isNewsMode ? '搜索新闻标题 / 来源 / 标签' : isAiMonitorMode ? '搜索代码 / 名称 / 事件' : '搜索代码 / 股票名称 / 板块 / 会话内容');
  const emptyHint = isNewsMode
    ? '输入关键词搜索新闻'
    : isAiMonitorMode
      ? '输入代码、名称、事件标题或AI分析开始搜索'
      : '输入股票代码、名称、板块或会话内容开始搜索';
  const dialogLabel = isNewsMode ? '新闻搜索' : isAiMonitorMode ? 'AI监控搜索' : '全局搜索';
  const selectNewsResult = (row: MarketNewsItem) => {
    recordSelectedSearch();
    close();
    const requestId = useAppUiStore.getState().openNewsReader(row);
    void getStocksenseApi()
      .getMarketNewsItem(row)
      .then((item) => useAppUiStore.getState().setNewsReaderItem(requestId, item))
      .catch((error: unknown) => {
        console.error(error);
        const message = error instanceof Error ? error.message : '新闻详情加载失败，请稍后重试';
        useAppUiStore.getState().setNewsReaderError(requestId, message);
      });
  };
  const selectMarketResult = (row: MarketSearchResult) => {
    recordSelectedSearch();
    close();
    void openSearchResult(row);
  };
  const selectAiMonitorResult = (row: IMonitorEvent) => {
    recordSelectedSearch();
    close();
    onSelectAiMonitorEvent?.(row);
  };
  const selectConversationResult = (row: IConversationSearchResult) => {
    recordSelectedSearch();
    close();
    requestChatSearchHighlight({
      conversationId: row.conversationId,
      messageId: row.messageId,
      query: currentSearchKeyword() || row.snippet,
    });
    if (row.conversationId === activeConversationId) setMainView('chat');
    else setActiveConversation(row.conversationId);
  };

  return (
    <div className={styles.overlay} onMouseDown={close} role='presentation'>
      <section
        aria-label={dialogLabel}
        aria-modal='true'
        className={styles.panel}
        onMouseDown={(event) => event.stopPropagation()}
        role='dialog'
      >
        <div className={styles.searchRow}>
          <Search aria-hidden='true' size={18} />
          <input
            ref={inputRef}
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') close();
            }}
            placeholder={searchPlaceholder}
            aria-label={dialogLabel}
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
          ) : isAiMonitorMode && aiMonitorResults.length ? (
            <section className={styles.group}>
              <h3>AI监控列表</h3>
              {aiMonitorResults.map((row) => (
                <button
                  key={row.id}
                  className={styles.newsItem}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectAiMonitorResult(row);
                  }}
                  type='button'
                >
                  <span className={styles.newsMeta}>
                    <span>{MONITOR_CATEGORY_LABELS[row.category]}</span>
                    <span>{row.timestamp ? new Date(row.timestamp).toLocaleTimeString('zh-CN', { hour12: false }) : '--:--'}</span>
                  </span>
                  <span className={styles.resultName}>{`${row.name} ${row.code}${row.badge ? ` · ${row.badge}` : ''}`}</span>
                  <span className={styles.newsTitle}>{row.title}</span>
                  {row.details[0] || row.aiAnalysis ? (
                    <span className={styles.conversationSnippet}>{row.details[0] || row.aiAnalysis}</span>
                  ) : null}
                </button>
              ))}
            </section>
          ) : isNewsMode && newsResults.length ? (
            <section className={styles.group}>
              <h3>新闻</h3>
              {newsResults.map((row) => (
                <button
                  key={row.id}
                  className={styles.newsItem}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectNewsResult(row);
                  }}
                  type='button'
                >
                  <span className={styles.newsMeta}>
                    <span>{row.time || '--:--'}</span>
                    {row.source ? <span>{row.source}</span> : null}
                  </span>
                  <span className={styles.newsTitle}>{row.title}</span>
                  {row.tags.length ? <span className={styles.newsTags}>{row.tags.slice(0, 3).join(' / ')}</span> : null}
                </button>
              ))}
            </section>
          ) : !isNewsMode && !isAiMonitorMode && (marketResults.length || conversationResults.length) ? (
            <>
              {marketResults.length ? (
                <section className={styles.group}>
                  <h3>行情 / 板块</h3>
                  <MarketSearchSuggestionList onSelect={selectMarketResult} suggestions={marketResults} />
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
            <div className={styles.empty}>{isAiMonitorMode ? '无匹配监控事件' : '无匹配结果'}</div>
          ) : searchHistory.length ? (
            <section className={styles.group}>
              <div className={styles.groupHeader}>
                <h3>搜索历史</h3>
                <button className={styles.clearHistoryButton} onClick={clearSearchHistory} type='button'>
                  清空
                </button>
              </div>
              {searchHistory.map((keyword) => (
                <button
                  key={keyword}
                  className={styles.historyItem}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectSearchHistory(keyword);
                  }}
                  type='button'
                >
                  {keyword}
                </button>
              ))}
            </section>
          ) : (
            <div className={styles.empty}>{emptyHint}</div>
          )}
        </div>
        <footer className={styles.footer}>
          <span>按 Esc 关闭</span>
          <span>{isNewsMode ? '新闻搜索' : isAiMonitorMode ? '仅搜索AI监控列表' : `${shortcutLabel} 呼出搜索`}</span>
        </footer>
      </section>
    </div>
  );
}
