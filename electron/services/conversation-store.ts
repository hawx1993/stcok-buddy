import { app } from 'electron';
import Database from 'better-sqlite3';
import path from 'node:path';
import type { ChatMessage, ConversationSummary } from '../../src/shared/types.js';

let db: Database.Database | undefined;

function getDb() {
  if (db?.open) return db;
  db = new Database(path.join(app.getPath('userData'), 'stocksense-chat.sqlite'));
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql);
  return db;
}

export function closeConversationStore() {
  if (db?.open) db.close();
}

const schemaSql = `
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    preview TEXT NOT NULL,
    date TEXT NOT NULL,
    tab TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
    ON messages(conversation_id, created_at);
`;

getDb();

interface ConversationRow {
  id: string;
  title: string;
  preview: string;
  date: string;
  tab: ConversationSummary['tab'];
  count: number;
}

interface MessageRow {
  payload: string;
}

function nowLabel() {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date());
}

export function listConversations(): ConversationSummary[] {
  return getDb().prepare('SELECT id, title, preview, date, tab, count FROM conversations ORDER BY updated_at DESC').all() as ConversationSummary[];
}

export function createConversation(): ConversationSummary {
  const createdAt = new Date().toISOString();
  const conversation: ConversationSummary = {
    id: `conv-${Date.now()}`,
    title: '新建对话',
    preview: '开始新的投研分析',
    date: '刚刚',
    tab: 'stock',
    count: 0,
  };
  getDb().prepare(`
    INSERT INTO conversations (id, title, preview, date, tab, count, created_at, updated_at)
    VALUES (@id, @title, @preview, @date, @tab, @count, @createdAt, @createdAt)
  `).run({ ...conversation, createdAt });
  return conversation;
}

export function deleteConversation(id: string): ConversationSummary[] {
  getDb().prepare('DELETE FROM conversations WHERE id = ?').run(id);
  return listConversations();
}

export function renameConversation(id: string, title: string): ConversationSummary[] {
  const nextTitle = title.trim();
  if (nextTitle) getDb().prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(nextTitle, new Date().toISOString(), id);
  return listConversations();
}

export function listMessages(conversationId: string): ChatMessage[] {
  return (getDb().prepare('SELECT payload FROM messages WHERE conversation_id = ? ORDER BY created_at ASC').all(conversationId) as MessageRow[])
    .map((row) => JSON.parse(row.payload) as ChatMessage);
}

export function saveMessage(conversationId: string, message: ChatMessage) {
  ensureConversation(conversationId);
  getDb().prepare(`
    INSERT OR REPLACE INTO messages (id, conversation_id, payload, created_at)
    VALUES (?, ?, ?, ?)
  `).run(message.id, conversationId, JSON.stringify(message), message.createdAt);
  updateConversation(conversationId, message.content.slice(0, 80));
}

export function saveUserMessage(conversationId: string, content: string) {
  saveMessage(conversationId, {
    id: `msg-${Date.now()}`,
    role: 'user',
    content,
    createdAt: new Date().toISOString(),
  });
}

export function saveAssistantMessage(conversationId: string, message: ChatMessage) {
  saveMessage(conversationId, message);
}

function ensureConversation(conversationId: string) {
  const exists = getDb().prepare('SELECT id FROM conversations WHERE id = ?').get(conversationId);
  if (exists) return;
  const createdAt = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO conversations (id, title, preview, date, tab, count, created_at, updated_at)
    VALUES (?, '新建对话', '开始新的投研分析', '刚刚', 'stock', 0, ?, ?)
  `).run(conversationId, createdAt, createdAt);
}

function updateConversation(conversationId: string, preview: string) {
  const store = getDb();
  const conversation = store.prepare('SELECT id, title FROM conversations WHERE id = ?').get(conversationId) as Pick<ConversationRow, 'id' | 'title'> | undefined;
  if (!conversation) return;
  const count = (store.prepare('SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?').get(conversationId) as { count: number }).count;
  store.prepare(`
    UPDATE conversations
    SET title = ?, preview = ?, date = ?, tab = ?, count = ?, updated_at = ?
    WHERE id = ?
  `).run(
    conversation.title === '新建对话' ? preview.slice(0, 18) : conversation.title,
    preview,
    nowLabel(),
    inferTab(preview),
    count,
    new Date().toISOString(),
    conversationId,
  );
}

function inferTab(text: string): ConversationSummary['tab'] {
  if (/诊股|分析|K线|金叉|MACD/i.test(text)) return 'diagnosis';
  if (/盯盘|资金|北向|大盘|异动/i.test(text)) return 'market';
  return 'stock';
}
