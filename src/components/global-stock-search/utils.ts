import type { IConversationSearchResult, MarketSearchResult, TGlobalSearchResult } from '../../shared/types';

export const GLOBAL_SEARCH_HISTORY_LIMIT = 10;

export function normalizeSearchHistory(value: unknown) {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const keyword = item.trim();
    if (!keyword || result.includes(keyword)) continue;
    result.push(keyword);
    if (result.length >= GLOBAL_SEARCH_HISTORY_LIMIT) break;
  }
  return result;
}

export function appendSearchHistoryItem(history: string[], query: string) {
  const keyword = query.trim();
  if (!keyword) return history;
  return [keyword, ...history.filter((item) => item !== keyword)].slice(0, GLOBAL_SEARCH_HISTORY_LIMIT);
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

export function isConversationSearchResult(row: TGlobalSearchResult): row is IConversationSearchResult {
  return row.kind === 'conversation' || row.kind === 'message';
}

export function getGlobalSearchResultKey(row: TGlobalSearchResult) {
  if (isConversationSearchResult(row)) return `${row.kind}-${row.conversationId}-${row.messageId ?? row.updatedAt}`;
  return `${row.kind ?? 'stock'}-${row.code}`;
}

export function getConversationRoleLabel(role?: IConversationSearchResult['role']) {
  if (role === 'user') return '用户';
  if (role === 'assistant') return 'AI';
  return '会话';
}
