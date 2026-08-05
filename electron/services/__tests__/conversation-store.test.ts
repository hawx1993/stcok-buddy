import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ConversationSummary } from '../../../src/shared/types.js';

interface IConversationRow extends ConversationSummary {
  createdAt: string;
}

interface IMessageRow {
  id: string;
  conversationId: string;
  payload: string;
  createdAt: string;
}

const dbState = vi.hoisted(() => ({
  conversations: [] as IConversationRow[],
  messages: [] as IMessageRow[],
}));

function normalizeLike(value: string) {
  return value.replace(/^%|%$/g, '').replace(/\\([\\%_])/g, '$1').toLowerCase();
}

function matchesLike(text: string, like: string) {
  return text.toLowerCase().includes(normalizeLike(like));
}

vi.mock('../../electron-runtime.js', () => ({
  app: {
    getPath: () => '/tmp',
    isPackaged: false,
  },
}));

vi.mock('better-sqlite3', () => ({
  default: class FakeDatabase {
    open = true;

    pragma() {}

    exec() {}

    close() {
      this.open = false;
    }

    prepare(sql: string) {
      return {
        all: (params?: unknown) => runAll(sql, params),
        get: (param?: unknown) => runGet(sql, param),
        run: (...params: unknown[]) => runStatement(sql, params),
      };
    }
  },
}));

type TConversationStore = typeof import('../conversation-store.js');

let store: TConversationStore | undefined;

function message(id: string, role: ChatMessage['role'], content: string): ChatMessage {
  return {
    id,
    role,
    content,
    createdAt: `2026-08-05T00:00:0${id.slice(-1)}.000Z`,
  };
}

function resetDbState() {
  dbState.conversations = [];
  dbState.messages = [];
}

async function loadStore() {
  vi.resetModules();
  resetDbState();
  store = await import('../conversation-store.js');
}

function runAll(sql: string, params?: unknown) {
  if (sql.includes('FROM conversations') && sql.includes('ORDER BY updated_at DESC') && !sql.includes('WHERE')) {
    return [...dbState.conversations].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
  if (sql.includes('SELECT payload FROM messages WHERE conversation_id = ?')) {
    const conversationId = String(params);
    return dbState.messages
      .filter((row) => row.conversationId === conversationId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .map((row) => ({ payload: row.payload }));
  }
  if (sql.includes('FROM messages') && sql.includes('conversation_id = @conversationId') && !sql.includes('JOIN conversations')) {
    const input = params as { conversationId: string; beforeCreatedAt?: string; beforeId?: string; limit?: number };
    const rows = dbState.messages
      .filter((row) => row.conversationId === input.conversationId)
      .filter(
        (row) =>
          !input.beforeCreatedAt ||
          row.createdAt < input.beforeCreatedAt ||
          (row.createdAt === input.beforeCreatedAt && row.id < (input.beforeId ?? '')),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
    const limitedRows = input.limit ? rows.slice(0, input.limit) : rows;
    limitedRows.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    return limitedRows.map((row) => ({ payload: row.payload }));
  }
  if (sql.includes('FROM conversations') && sql.includes('WHERE title LIKE')) {
    const input = params as { like: string; limit: number };
    return dbState.conversations
      .filter((row) => matchesLike(`${row.title} ${row.preview}`, input.like))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, input.limit);
  }
  if (sql.includes('FROM messages m') && sql.includes('JOIN conversations')) {
    const input = params as { like: string; limit: number };
    return dbState.messages
      .filter((row) => matchesLike(row.payload, input.like))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, input.limit)
      .flatMap((messageRow) => {
        const conversation = dbState.conversations.find((item) => item.id === messageRow.conversationId);
        return conversation
          ? [{
              ...conversation,
              messageId: messageRow.id,
              messageCreatedAt: messageRow.createdAt,
              payload: messageRow.payload,
            }]
          : [];
      });
  }
  return [];
}

function runGet(sql: string, param?: unknown) {
  if (sql.includes('SELECT id FROM conversations WHERE id')) {
    return dbState.conversations.find((row) => row.id === param);
  }
  if (sql.includes('SELECT id, title FROM conversations WHERE id')) {
    const conversation = dbState.conversations.find((row) => row.id === param);
    return conversation ? { id: conversation.id, title: conversation.title } : undefined;
  }
  if (sql.includes('SELECT COUNT(*) AS count FROM messages WHERE conversation_id')) {
    return { count: dbState.messages.filter((row) => row.conversationId === param).length };
  }
  return undefined;
}

function runStatement(sql: string, params: unknown[]) {
  if (sql.includes('INSERT INTO conversations') && params.length === 1) {
    const input = params[0] as ConversationSummary & { createdAt: string };
    dbState.conversations.push({ ...input, createdAt: input.createdAt });
    return;
  }
  if (sql.includes('INSERT INTO conversations')) {
    const [id, createdAt] = params as [string, string, string];
    dbState.conversations.push({
      id,
      title: '新建对话',
      preview: '开始新的投研分析',
      date: '刚刚',
      tab: 'stock',
      count: 0,
      createdAt,
      updatedAt: createdAt,
    });
    return;
  }
  if (sql.includes('DELETE FROM conversations WHERE id')) {
    const [id] = params as [string];
    dbState.conversations = dbState.conversations.filter((row) => row.id !== id);
    dbState.messages = dbState.messages.filter((row) => row.conversationId !== id);
    return;
  }
  if (sql.includes('UPDATE conversations SET title = ?, updated_at = ? WHERE id')) {
    const [title, updatedAt, id] = params as [string, string, string];
    dbState.conversations = dbState.conversations.map((row) => row.id === id ? { ...row, title, updatedAt } : row);
    return;
  }
  if (sql.includes('INSERT OR REPLACE INTO messages')) {
    const [id, conversationId, payload, createdAt] = params as [string, string, string, string];
    dbState.messages = dbState.messages.filter((row) => row.id !== id);
    dbState.messages.push({ id, conversationId, payload, createdAt });
    return;
  }
  if (sql.includes('UPDATE conversations') && sql.includes('SET title = ?, preview = ?')) {
    const [title, preview, date, tab, count, updatedAt, id] = params as [string, string, string, ConversationSummary['tab'], number, string, string];
    dbState.conversations = dbState.conversations.map((row) =>
      row.id === id ? { ...row, title, preview, date, tab, count, updatedAt } : row,
    );
  }
}

describe('会话消息分页', () => {
  it('默认按创建时间正序返回全部消息', async () => {
    await loadStore();
    const conversation = store!.createConversation();
    store!.saveMessage(conversation.id, message('msg-1', 'user', '第一条'));
    store!.saveMessage(conversation.id, message('msg-2', 'assistant', '第二条'));
    store!.saveMessage(conversation.id, message('msg-3', 'user', '第三条'));

    expect(store!.listMessages(conversation.id).map((item) => item.id)).toEqual(['msg-1', 'msg-2', 'msg-3']);
  });

  it('支持只返回最新 N 条并用首条消息向上分页', async () => {
    await loadStore();
    const conversation = store!.createConversation();
    for (let index = 1; index <= 7; index += 1) {
      store!.saveMessage(conversation.id, message(`msg-${index}`, index % 2 ? 'user' : 'assistant', `第 ${index} 条`));
    }

    const latest = store!.listMessages(conversation.id, { limit: 5 });
    const earlier = store!.listMessages(conversation.id, {
      limit: 5,
      beforeCreatedAt: latest[0].createdAt,
      beforeId: latest[0].id,
    });

    expect(latest.map((item) => item.id)).toEqual(['msg-3', 'msg-4', 'msg-5', 'msg-6', 'msg-7']);
    expect(earlier.map((item) => item.id)).toEqual(['msg-1', 'msg-2']);
  });
});

describe('会话内容搜索', () => {
  it('支持搜索会话标题和预览', async () => {
    await loadStore();
    const conversation = store!.createConversation();
    store!.renameConversation(conversation.id, '贵州茅台复盘');
    store!.saveMessage(conversation.id, message('msg-1', 'user', '分析白酒板块资金变化'));

    const results = store!.searchConversations('茅台');

    expect(results[0]).toEqual(expect.objectContaining({
      kind: 'conversation',
      conversationId: conversation.id,
      title: '贵州茅台复盘',
    }));
  });

  it('支持搜索用户和 AI 消息正文', async () => {
    await loadStore();
    const conversation = store!.createConversation();
    store!.saveMessage(conversation.id, message('msg-1', 'user', '帮我分析低空经济题材'));
    store!.saveMessage(conversation.id, message('msg-2', 'assistant', 'AI 结论：低空经济需要结合资金流验证'));

    const results = store!.searchConversations('低空经济');

    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'message', role: 'user', messageId: 'msg-1' }),
      expect.objectContaining({ kind: 'message', role: 'assistant', messageId: 'msg-2' }),
    ]));
  });

  it('空关键词返回空数组且消息片段不暴露 payload 内部字段', async () => {
    await loadStore();
    const conversation = store!.createConversation();
    store!.saveMessage(conversation.id, {
      ...message('msg-1', 'assistant', '这里只应该命中正文关键词'),
      toolCalls: [{ id: 'tool-1', toolName: 'secretTool', input: {}, startedAt: '2026-08-05T00:00:00.000Z' }],
    });

    expect(store!.searchConversations('')).toEqual([]);
    const [result] = store!.searchConversations('正文关键词');

    expect(result.snippet).toContain('正文关键词');
    expect(result.snippet).not.toContain('secretTool');
  });
});
