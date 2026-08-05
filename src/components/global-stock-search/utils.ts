import type { IConversationSearchResult, MarketSearchResult, TGlobalSearchResult } from '../../shared/types';

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
