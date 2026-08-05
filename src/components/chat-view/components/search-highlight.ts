import type { ChatMessage } from '../../../shared/types';

interface ISearchTargetRequest {
  messageId?: string;
  query: string;
}

export function findSearchTargetMessageId(messages: ChatMessage[], request: ISearchTargetRequest) {
  if (request.messageId && messages.some((message) => message.id === request.messageId)) return request.messageId;
  const query = request.query.trim().toLowerCase();
  if (!query) return undefined;
  return messages.find((message) => message.content.toLowerCase().includes(query))?.id;
}

export function highlightSearchTermInHtml(html: string, query: string) {
  const keyword = query.trim();
  if (!keyword) return html;
  const pattern = new RegExp(escapeRegExp(keyword), 'gi');
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => {
      if (part.startsWith('<')) return part;
      return part.replace(pattern, '<mark class="chat-search-hit">$&</mark>');
    })
    .join('');
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
