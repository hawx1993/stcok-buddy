import { app } from '../electron-runtime.js';
import Database from 'better-sqlite3';
import path from 'node:path';
import type {
  ChatMessage,
  ConversationSummary,
  IConversationMessagesOptions,
  IConversationSearchResult,
} from '../../src/shared/types.js';

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
  updatedAt: string;
  tab: ConversationSummary['tab'];
  count: number;
}

interface MessageRow {
  payload: string;
}

interface ConversationSearchRow extends ConversationRow {
  messageId?: string;
  messageCreatedAt?: string;
  payload?: string;
}

const SEARCH_LIMIT = 30;
const SNIPPET_RADIUS = 32;

function nowLabel() {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date());
}

export function listConversations(): ConversationSummary[] {
  return getDb()
    .prepare(
      `
    SELECT id, title, preview, date, updated_at AS updatedAt, tab, count
    FROM conversations
    ORDER BY updated_at DESC
  `,
    )
    .all() as ConversationSummary[];
}

export function createConversation(): ConversationSummary {
  const createdAt = new Date().toISOString();
  const conversation: ConversationSummary = {
    id: `conv-${Date.now()}`,
    title: '新建对话',
    preview: '开始新的投研分析',
    date: '刚刚',
    updatedAt: createdAt,
    tab: 'stock',
    count: 0,
  };
  getDb()
    .prepare(
      `
    INSERT INTO conversations (id, title, preview, date, tab, count, created_at, updated_at)
    VALUES (@id, @title, @preview, @date, @tab, @count, @createdAt, @createdAt)
  `,
    )
    .run({ ...conversation, createdAt });
  return conversation;
}

export function deleteConversation(id: string): ConversationSummary[] {
  getDb().prepare('DELETE FROM conversations WHERE id = ?').run(id);
  return listConversations();
}

export function renameConversation(id: string, title: string): ConversationSummary[] {
  const nextTitle = title.trim();
  if (nextTitle)
    getDb()
      .prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
      .run(nextTitle, new Date().toISOString(), id);
  return listConversations();
}

export function listMessages(conversationId: string, options: IConversationMessagesOptions = {}): ChatMessage[] {
  const limit = normalizeMessageLimit(options.limit);
  const rows = options.beforeCreatedAt
    ? listMessagesBeforeCursor(conversationId, options.beforeCreatedAt, options.beforeId ?? '', limit)
    : listLatestMessages(conversationId, limit);
  return rows.map((row) => JSON.parse(row.payload) as ChatMessage);
}

function listLatestMessages(conversationId: string, limit: number | undefined): MessageRow[] {
  if (!limit) {
    return getDb()
      .prepare('SELECT payload FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC')
      .all(conversationId) as MessageRow[];
  }
  return getDb()
    .prepare(
      `
        SELECT payload
        FROM (
          SELECT id, payload, created_at
          FROM messages
          WHERE conversation_id = @conversationId
          ORDER BY created_at DESC, id DESC
          LIMIT @limit
        )
        ORDER BY created_at ASC, id ASC
      `,
    )
    .all({ conversationId, limit }) as MessageRow[];
}

function listMessagesBeforeCursor(
  conversationId: string,
  beforeCreatedAt: string,
  beforeId: string,
  limit: number | undefined,
): MessageRow[] {
  if (!limit) {
    return getDb()
      .prepare(
        `
          SELECT payload
          FROM messages
          WHERE conversation_id = @conversationId
            AND (created_at < @beforeCreatedAt OR (created_at = @beforeCreatedAt AND id < @beforeId))
          ORDER BY created_at ASC, id ASC
        `,
      )
      .all({ conversationId, beforeCreatedAt, beforeId }) as MessageRow[];
  }
  return getDb()
    .prepare(
      `
        SELECT payload
        FROM (
          SELECT id, payload, created_at
          FROM messages
          WHERE conversation_id = @conversationId
            AND (created_at < @beforeCreatedAt OR (created_at = @beforeCreatedAt AND id < @beforeId))
          ORDER BY created_at DESC, id DESC
          LIMIT @limit
        )
        ORDER BY created_at ASC, id ASC
      `,
    )
    .all({ conversationId, beforeCreatedAt, beforeId, limit }) as MessageRow[];
}

export function searchConversations(query: string): IConversationSearchResult[] {
  const keyword = query.trim();
  if (!keyword) return [];
  const like = `%${escapeLikeKeyword(keyword)}%`;
  const conversationRows = getDb()
    .prepare(
      `
      SELECT id, title, preview, date, updated_at AS updatedAt, tab, count
      FROM conversations
      WHERE title LIKE @like ESCAPE '\\' OR preview LIKE @like ESCAPE '\\'
      ORDER BY updated_at DESC
      LIMIT @limit
    `,
    )
    .all({ like, limit: SEARCH_LIMIT }) as ConversationSearchRow[];

  const results: IConversationSearchResult[] = conversationRows.map((row) => ({
    kind: 'conversation',
    conversationId: row.id,
    title: row.title,
    preview: row.preview,
    updatedAt: row.updatedAt,
    snippet: createSnippet(`${row.title} ${row.preview}`, keyword),
  }));

  if (results.length >= SEARCH_LIMIT) return results;

  const messageRows = getDb()
    .prepare(
      `
      SELECT
        c.id, c.title, c.preview, c.date, c.updated_at AS updatedAt, c.tab, c.count,
        m.id AS messageId, m.created_at AS messageCreatedAt, m.payload
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.payload LIKE @like ESCAPE '\\'
      ORDER BY m.created_at DESC
      LIMIT @limit
    `,
    )
    .all({ like, limit: SEARCH_LIMIT }) as ConversationSearchRow[];

  for (const row of messageRows) {
    if (results.length >= SEARCH_LIMIT) break;
    const message = parseMessagePayload(row.payload);
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) continue;
    if (!message.content.toLowerCase().includes(keyword.toLowerCase())) continue;
    results.push({
      kind: 'message',
      conversationId: row.id,
      title: row.title,
      preview: row.preview,
      updatedAt: row.updatedAt,
      messageId: row.messageId ?? message.id,
      role: message.role,
      createdAt: row.messageCreatedAt ?? message.createdAt,
      snippet: createSnippet(message.content, keyword),
    });
  }

  return results;
}

export function saveMessage(conversationId: string, message: ChatMessage) {
  ensureConversation(conversationId);
  getDb()
    .prepare(
      `
    INSERT OR REPLACE INTO messages (id, conversation_id, payload, created_at)
    VALUES (?, ?, ?, ?)
  `,
    )
    .run(message.id, conversationId, JSON.stringify(message), message.createdAt);
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

function normalizeMessageLimit(limit: number | undefined) {
  if (limit === undefined || !Number.isFinite(limit)) return undefined;
  return Math.max(1, Math.min(50, Math.trunc(limit)));
}

function escapeLikeKeyword(keyword: string) {
  return keyword.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function parseMessagePayload(payload: string | undefined): ChatMessage | undefined {
  if (!payload) return undefined;
  try {
    return JSON.parse(payload) as ChatMessage;
  } catch {
    return undefined;
  }
}

function createSnippet(content: string, keyword: string) {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  const index = normalized.toLowerCase().indexOf(keyword.toLowerCase());
  const start = index >= 0 ? Math.max(0, index - SNIPPET_RADIUS) : 0;
  const end = index >= 0 ? Math.min(normalized.length, index + keyword.length + SNIPPET_RADIUS) : Math.min(normalized.length, SNIPPET_RADIUS * 2);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < normalized.length ? '…' : '';
  return `${prefix}${normalized.slice(start, end)}${suffix}`;
}

function ensureConversation(conversationId: string) {
  const exists = getDb().prepare('SELECT id FROM conversations WHERE id = ?').get(conversationId);
  if (exists) return;
  const createdAt = new Date().toISOString();
  getDb()
    .prepare(
      `
    INSERT INTO conversations (id, title, preview, date, tab, count, created_at, updated_at)
    VALUES (?, '新建对话', '开始新的投研分析', '刚刚', 'stock', 0, ?, ?)
  `,
    )
    .run(conversationId, createdAt, createdAt);
}

function updateConversation(conversationId: string, preview: string) {
  const store = getDb();
  const conversation = store.prepare('SELECT id, title FROM conversations WHERE id = ?').get(conversationId) as
    | Pick<ConversationRow, 'id' | 'title'>
    | undefined;
  if (!conversation) return;
  const count = (
    store.prepare('SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?').get(conversationId) as {
      count: number;
    }
  ).count;
  store
    .prepare(
      `
    UPDATE conversations
    SET title = ?, preview = ?, date = ?, tab = ?, count = ?, updated_at = ?
    WHERE id = ?
  `,
    )
    .run(
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
