import type { ConversationSummary } from '../../../shared/types';

export interface IConversationGroup {
  label: string;
  conversations: ConversationSummary[];
}

function calendarDateKey(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function getConversationUpdatedTime(conversation: ConversationSummary) {
  const rawUpdatedAt = String(conversation.updatedAt || conversation.date || '');
  const updatedTime = new Date(rawUpdatedAt).getTime();
  return Number.isNaN(updatedTime) ? 0 : updatedTime;
}

export function groupConversations(conversations: ConversationSummary[], now = new Date()): IConversationGroup[] {
  const today = calendarDateKey(now);
  const dateFormatter = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' });
  const groups = new Map<string, ConversationSummary[]>();
  const sortedConversations = [...conversations].sort(
    (a, b) => getConversationUpdatedTime(b) - getConversationUpdatedTime(a),
  );

  for (const conversation of sortedConversations) {
    const updatedTime = getConversationUpdatedTime(conversation);
    const date = updatedTime > 0 ? new Date(updatedTime) : new Date(0);
    const dateKey = calendarDateKey(date);
    const label = dateKey === today ? '最新' : dateFormatter.format(date);
    const group = groups.get(label);
    if (group) group.push(conversation);
    else groups.set(label, [conversation]);
  }

  return [...groups.entries()].map(([label, group]) => ({ label, conversations: group }));
}
