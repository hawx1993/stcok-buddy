import { app } from '../electron-runtime.js';
import Database from 'better-sqlite3';
import path from 'node:path';
import type {
  ChatMessage,
  ConversationSummary,
  IConversationMessagesOptions,
  IConversationSearchResult,
} from '../../src/shared/types.js';
import { toChatMessagePresentation } from './conversation-message-presentation.js';

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

  CREATE INDEX IF NOT EXISTS idx_messages_created_at
    ON messages(created_at DESC, id DESC);
`;

getDb();

// 后台预热 FTS 搜索索引（分块、不阻塞启动），让首次搜索即可毫秒级返回。
setImmediate(() => {
  void ensureSearchIndexReady().catch(() => {});
});

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
  return rows.map((row) => toChatMessagePresentation(JSON.parse(row.payload) as ChatMessage));
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

// ── 会话内容搜索：FTS5 全文索引 + 非阻塞分块兜底 ─────────────────────────
// 旧实现直接在 IPC 主进程里对 messages.payload 做全表 LIKE '%kw%' 扫描，
// 而每条 payload 是包含大量数据的 JSON（平均 1.7MB），一次搜索会阻塞主进程
// 2~4 秒：用户打字时全局搜索输入框随之卡死、鼠标一直转圈。这里改为：
//   1. 用 FTS5(trigram) 全文索引消息正文（content），命中后毫秒级返回；
//   2. 索引尚未建好或不可用时，退化为「按时间倒序分页 + 每页让出事件循环」
//      的非阻塞扫描，保证任何情况下主进程都不会长时间阻塞。

const FTS_SCHEMA_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    conversation_id UNINDEXED,
    created_at UNINDEXED,
    message_id UNINDEXED,
    role UNINDEXED,
    content,
    tokenize = 'trigram'
  );
  CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, conversation_id, created_at, message_id, role, content)
    VALUES (
      new.rowid,
      new.conversation_id,
      new.created_at,
      new.id,
      COALESCE(json_extract(new.payload, '$.role'), ''),
      COALESCE(json_extract(new.payload, '$.content'), '')
    );
  END;
  CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
    DELETE FROM messages_fts WHERE rowid = old.rowid;
  END;
  CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
    DELETE FROM messages_fts WHERE rowid = old.rowid;
    INSERT INTO messages_fts(rowid, conversation_id, created_at, message_id, role, content)
    VALUES (
      new.rowid,
      new.conversation_id,
      new.created_at,
      new.id,
      COALESCE(json_extract(new.payload, '$.role'), ''),
      COALESCE(json_extract(new.payload, '$.content'), '')
    );
  END;
`;

const FTS_BACKFILL_SQL = `
  INSERT OR REPLACE INTO messages_fts(rowid, conversation_id, created_at, message_id, role, content)
  SELECT rowid, conversation_id, created_at, id,
         COALESCE(json_extract(payload, '$.role'), ''),
         COALESCE(json_extract(payload, '$.content'), '')
  FROM messages
  ORDER BY rowid
  LIMIT @limit OFFSET @offset;
`;

let searchIndexReady = false;
let searchIndexFailed = false;
let searchIndexPromise: Promise<void> | undefined;

function yieldToEventLoop() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function ensureSearchIndexReady(): Promise<void> {
  if (searchIndexReady || searchIndexFailed) return Promise.resolve();
  if (searchIndexPromise) return searchIndexPromise;
  searchIndexPromise = (async () => {
    const database = getDb();
    database.exec(FTS_SCHEMA_SQL);
    const hasMessages =
      (database.prepare('SELECT EXISTS(SELECT 1 FROM messages) AS has').get() as { has: number } | undefined)?.has ===
      1;
    const ftsCount =
      (database.prepare('SELECT COUNT(*) AS c FROM messages_fts').get() as { c: number } | undefined)?.c ?? 0;
    if (hasMessages && ftsCount === 0) {
      const total = (database.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number } | undefined)?.c ?? 0;
      // 分块回填历史消息，每块之间让出事件循环，避免启动期阻塞主进程
      const pageSize = 80;
      for (let offset = 0; offset < total; offset += pageSize) {
        database.prepare(FTS_BACKFILL_SQL).run({ limit: pageSize, offset });
        await yieldToEventLoop();
      }
    }
    searchIndexReady = true;
  })().catch((error) => {
    console.warn('[conversation-store] FTS 搜索索引初始化失败，将使用分块扫描兜底', error);
    searchIndexFailed = true;
    searchIndexPromise = undefined;
  });
  return searchIndexPromise;
}

interface FtsMessageRow {
  conversationId: string;
  messageCreatedAt: string;
  messageId: string;
  role: string;
  content: string;
}

async function searchMessageRowsFts(like: string): Promise<FtsMessageRow[]> {
  return getDb()
    .prepare(
      `
      SELECT
        f.conversation_id AS conversationId,
        f.created_at AS messageCreatedAt,
        f.message_id AS messageId,
        f.role AS role,
        f.content AS content
      FROM messages_fts f
      WHERE f.content LIKE @like ESCAPE '\\'
      ORDER BY f.created_at DESC, f.message_id DESC
      LIMIT @limit
    `,
    )
    .all({ like, limit: SEARCH_LIMIT }) as FtsMessageRow[];
}

interface ScanMessageRow {
  conversationId: string;
  messageCreatedAt: string;
  messageId: string;
  payload: string;
}

async function searchMessageRowsByScan(like: string, lowerKeyword: string): Promise<FtsMessageRow[]> {
  const database = getDb();
  const results: FtsMessageRow[] = [];
  const pageSize = 200;
  let cursor: { createdAt: string; id: string } | undefined;
  for (;;) {
    const page = (
      cursor
        ? database
            .prepare(
              `
              SELECT m.conversation_id AS conversationId, m.created_at AS messageCreatedAt, m.id AS messageId, m.payload AS payload
              FROM messages m
              WHERE m.payload LIKE @like ESCAPE '\\'
                AND (m.created_at < @createdAt OR (m.created_at = @createdAt AND m.id < @id))
              ORDER BY m.created_at DESC, m.id DESC
              LIMIT @pageSize
            `,
            )
            .all({ like, createdAt: cursor.createdAt, id: cursor.id, pageSize })
        : database
            .prepare(
              `
              SELECT m.conversation_id AS conversationId, m.created_at AS messageCreatedAt, m.id AS messageId, m.payload AS payload
              FROM messages m
              WHERE m.payload LIKE @like ESCAPE '\\'
              ORDER BY m.created_at DESC, m.id DESC
              LIMIT @pageSize
            `,
            )
            .all({ like, pageSize })
    ) as ScanMessageRow[];
    for (const row of page) {
      if (results.length >= SEARCH_LIMIT) return results;
      const message = parseMessagePayload(row.payload);
      if (!message || (message.role !== 'user' && message.role !== 'assistant')) continue;
      if (!message.content.toLowerCase().includes(lowerKeyword)) continue;
      results.push({
        conversationId: row.conversationId,
        messageCreatedAt: row.messageCreatedAt,
        messageId: row.messageId,
        role: message.role,
        content: message.content,
      });
    }
    if (page.length < pageSize) return results;
    const last = page[page.length - 1];
    cursor = { createdAt: last.messageCreatedAt, id: last.messageId };
    await yieldToEventLoop();
  }
}

export async function searchConversations(query: string): Promise<IConversationSearchResult[]> {
  const keyword = query.trim();
  if (!keyword) return [];
  const like = `%${escapeLikeKeyword(keyword)}%`;
  const lowerKeyword = keyword.toLowerCase();

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

  await ensureSearchIndexReady();

  const messageRows = searchIndexReady
    ? await searchMessageRowsFts(like).catch(() => searchMessageRowsByScan(like, lowerKeyword))
    : await searchMessageRowsByScan(like, lowerKeyword);

  const conversationById = new Map(listConversations().map((conversation) => [conversation.id, conversation]));
  for (const row of messageRows) {
    if (results.length >= SEARCH_LIMIT) break;
    const conversation = conversationById.get(row.conversationId);
    if (!conversation) continue;
    if (row.role !== 'user' && row.role !== 'assistant') continue;
    if (!row.content.toLowerCase().includes(lowerKeyword)) continue;
    results.push({
      kind: 'message',
      conversationId: row.conversationId,
      title: conversation.title,
      preview: conversation.preview,
      updatedAt: conversation.updatedAt,
      messageId: row.messageId,
      role: row.role,
      createdAt: row.messageCreatedAt,
      snippet: createSnippet(row.content, keyword),
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
    .run(message.id, conversationId, JSON.stringify(toChatMessagePresentation(message)), message.createdAt);
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
  const end =
    index >= 0
      ? Math.min(normalized.length, index + keyword.length + SNIPPET_RADIUS)
      : Math.min(normalized.length, SNIPPET_RADIUS * 2);
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
