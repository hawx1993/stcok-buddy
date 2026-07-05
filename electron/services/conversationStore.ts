import type { ChatMessage, ConversationSummary } from '../../src/shared/types.js';
import { store } from './configStore.js';

function nowLabel() {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date());
}

export function listConversations(): ConversationSummary[] {
  return store.get('conversations', []);
}

export function createConversation(): ConversationSummary {
  const conversation: ConversationSummary = {
    id: `conv-${Date.now()}`,
    title: '新建对话',
    preview: '开始新的投研分析',
    date: '刚刚',
    tab: 'stock',
    count: 0,
  };
  store.set('conversations', [conversation, ...listConversations()]);
  return conversation;
}

export function deleteConversation(id: string): ConversationSummary[] {
  const next = listConversations().filter((item) => item.id !== id);
  const messages = store.get('messages', {});
  delete messages[id];
  store.set('messages', messages);
  store.set('conversations', next);
  return next;
}

export function saveUserMessage(conversationId: string, content: string) {
  const messages = store.get('messages', {});
  const item: ChatMessage = {
    id: `msg-${Date.now()}`,
    role: 'user',
    content,
    createdAt: new Date().toISOString(),
  };
  messages[conversationId] = [...(messages[conversationId] ?? []), item];
  store.set('messages', messages);
  updateConversation(conversationId, content);
}

export function saveAssistantMessage(conversationId: string, message: ChatMessage) {
  const messages = store.get('messages', {});
  messages[conversationId] = [...(messages[conversationId] ?? []), message];
  store.set('messages', messages);
  updateConversation(conversationId, message.content.slice(0, 32));
}

function updateConversation(conversationId: string, preview: string) {
  const conversations = listConversations();
  const next = conversations.map((item) => {
    if (item.id !== conversationId) return item;
    const count = store.get('messages', {})[conversationId]?.length ?? 0;
    return {
      ...item,
      title: item.title === '新建对话' ? preview.slice(0, 18) : item.title,
      preview,
      date: nowLabel(),
      count,
      tab: inferTab(preview),
    };
  });
  store.set('conversations', next);
}

function inferTab(text: string): ConversationSummary['tab'] {
  if (/诊股|分析|K线|金叉|MACD/i.test(text)) return 'diagnosis';
  if (/盯盘|资金|北向|大盘|异动/i.test(text)) return 'market';
  return 'stock';
}
