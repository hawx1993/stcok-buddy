import { create } from 'zustand';
import type {
  AgentResultCard,
  AgentRunEvent,
  AppConfig,
  BoardDetail,
  ChatMessage,
  ConversationSummary,
  FavoriteStock,
  StockDetail,
  ThemeMode,
  TMonitorCategory,
  TMonitorMode,
} from '../shared/types';
import { useAppUiStore } from './app-ui-store';
import type { RightPanelTab } from './app-ui-store';

export interface SurgeStock extends StockDetail {
  type: 'surge' | 'plummet' | 'volume';
  reason: string;
}

export interface IAiMonitorReturnState {
  activeTab: Exclude<TMonitorCategory, 'dragon-tiger'> | 'all';
  currentPage: number;
  selectedDate: string;
  mode: TMonitorMode;
}

export interface IStockReturnContext {
  tab: RightPanelTab;
  code: string;
  aiMonitor?: IAiMonitorReturnState;
}

interface IAppDataState {
  config?: AppConfig;
  conversations: ConversationSummary[];
  activeConversationId?: string;
  respondingConversationId?: string;
  messages: ChatMessage[];
  conversationMessages: Record<string, ChatMessage[]>;
  isMessagesLoading: boolean;
  messagesLoadingConversationId?: string;
  messageDrafts: Record<string, ChatMessage[]>;
  favoriteStocks: FavoriteStock[];
  stockKlines: Record<string, NonNullable<AgentResultCard['chart']>['data']>;
  selectedStock?: StockDetail;
  stockReturnContext?: IStockReturnContext;
  aiMonitorState?: IAiMonitorReturnState;
  selectedBoard?: BoardDetail;
  isSending: boolean;
  surgeStocks: SurgeStock[];
  setConfig(config: AppConfig): void;
  setTheme(theme: ThemeMode): void;
  setConversations(conversations: ConversationSummary[]): void;
  setActiveConversation(id?: string): void;
  setActiveConversationWithMessages(id: string, messages: ChatMessage[]): void;
  setMessagesLoading(conversationId: string, loading: boolean): void;
  addMessage(message: ChatMessage): void;
  setFavoriteStocks(favoriteStocks: FavoriteStock[]): void;
  rememberStockKline(code: string, data?: NonNullable<AgentResultCard['chart']>['data']): void;
  setMessages(messages: ChatMessage[]): void;
  prependMessages(conversationId: string, messages: ChatMessage[]): void;
  replaceLastAssistant(message: ChatMessage, conversationId?: string): void;
  stopLastAssistant(conversationId?: string): void;
  finalizeLastAssistant(message: ChatMessage, conversationId?: string): void;
  appendToLastAssistant(token: string, conversationId?: string): void;
  applyRunEventToLastAssistant(event: AgentRunEvent, conversationId?: string): void;
  clearMessages(): void;
  setSelectedStock(stock?: StockDetail): void;
  setStockReturnContext(context?: IStockReturnContext): void;
  setAiMonitorState(state: IAiMonitorReturnState): void;
  setSelectedBoard(board?: BoardDetail): void;
  setSending(isSending: boolean, conversationId?: string): void;
}

export const useAppDataStore = create<IAppDataState>((set, get) => ({
  conversations: [],
  activeConversationId: undefined,
  respondingConversationId: undefined,
  messages: [],
  conversationMessages: {},
  isMessagesLoading: false,
  messagesLoadingConversationId: undefined,
  messageDrafts: {},
  favoriteStocks: [],
  stockKlines: {},
  selectedStock: undefined,
  stockReturnContext: undefined,
  aiMonitorState: undefined,
  selectedBoard: undefined,
  isSending: false,
  surgeStocks: [],
  setConfig: (config) => set({ config }),
  setTheme: (theme) => set((state) => (state.config ? { config: { ...state.config, theme } } : state)),
  setConversations: (conversations) =>
    set((state) => {
      const activeConversationId = state.activeConversationId ?? conversations[0]?.id;
      const cachedMessages = activeConversationId ? state.conversationMessages[activeConversationId] : undefined;
      const shouldLoadMessages = shouldLoadConversationMessages(
        conversations,
        activeConversationId,
        activeConversationId ? state.messageDrafts[activeConversationId] : undefined,
        cachedMessages ?? state.messages,
      );
      return {
        conversations,
        activeConversationId,
        isMessagesLoading: state.activeConversationId ? state.isMessagesLoading : shouldLoadMessages,
        messagesLoadingConversationId: state.activeConversationId
          ? state.messagesLoadingConversationId
          : shouldLoadMessages
            ? activeConversationId
            : undefined,
      };
    }),
  setActiveConversation: (id) => {
    useAppUiStore.getState().setMainView('chat');
    set((state) => {
      if (state.activeConversationId === id) return { activeConversationId: id };
      const messageDrafts = { ...state.messageDrafts };
      const shouldKeepCurrentDraft = shouldKeepCurrentConversationDraft(state, id);
      if (shouldKeepCurrentDraft && state.activeConversationId) messageDrafts[state.activeConversationId] = state.messages;
      const draft = id ? messageDrafts[id] : undefined;
      const cachedMessages = id ? state.conversationMessages[id] : undefined;
      const readyMessages = draft ?? cachedMessages;
      const shouldLoadMessages = shouldLoadConversationMessages(state.conversations, id, readyMessages, readyMessages ?? []);
      return {
        activeConversationId: id,
        messages: readyMessages ?? [],
        messageDrafts,
        isMessagesLoading: shouldLoadMessages,
        messagesLoadingConversationId: shouldLoadMessages ? id : undefined,
      };
    });
  },
  setActiveConversationWithMessages: (id, messages) => {
    useAppUiStore.getState().setMainView('chat');
    set((state) => {
      const messageDrafts = { ...state.messageDrafts };
      const shouldKeepCurrentDraft = shouldKeepCurrentConversationDraft(state, id);
      if (shouldKeepCurrentDraft && state.activeConversationId) messageDrafts[state.activeConversationId] = state.messages;
      return {
        activeConversationId: id,
        messages,
        conversationMessages: { ...state.conversationMessages, [id]: messages },
        messageDrafts,
        isMessagesLoading: false,
        messagesLoadingConversationId: undefined,
        stockKlines: { ...state.stockKlines, ...collectStockKlines(messages) },
      };
    });
  },
  setMessagesLoading: (conversationId, loading) =>
    set((state) => {
      if (state.activeConversationId !== conversationId) return state;
      const readyMessages = state.messageDrafts[conversationId] ?? state.conversationMessages[conversationId];
      const shouldLoadMessages =
        loading &&
        (state.messagesLoadingConversationId === conversationId ||
          shouldLoadConversationMessages(state.conversations, conversationId, readyMessages, readyMessages ?? state.messages));
      return {
        isMessagesLoading: shouldLoadMessages,
        messagesLoadingConversationId: shouldLoadMessages ? conversationId : undefined,
      };
    }),
  rememberStockKline: (code, data) => {
    if (data?.length) set((state) => ({ stockKlines: { ...state.stockKlines, [code]: data } }));
  },
  setMessages: (messages) =>
    set((state) => {
      const messageDrafts = { ...state.messageDrafts };
      if (state.activeConversationId) delete messageDrafts[state.activeConversationId];
      return {
        messages,
        conversationMessages: state.activeConversationId
          ? { ...state.conversationMessages, [state.activeConversationId]: messages }
          : state.conversationMessages,
        messageDrafts,
        isMessagesLoading: false,
        messagesLoadingConversationId: undefined,
        stockKlines: { ...state.stockKlines, ...collectStockKlines(messages) },
      };
    }),
  prependMessages: (conversationId, olderMessages) =>
    set((state) => {
      if (!olderMessages.length || state.activeConversationId !== conversationId) return state;
      const existingIds = new Set(state.messages.map((message) => message.id));
      const messages = [...olderMessages.filter((message) => !existingIds.has(message.id)), ...state.messages];
      return {
        messages,
        conversationMessages: { ...state.conversationMessages, [conversationId]: messages },
        stockKlines: { ...state.stockKlines, ...collectStockKlines(olderMessages) },
      };
    }),
  addMessage: (message) =>
    set((state) => {
      const messages = [...state.messages, message];
      return {
        messages,
        conversationMessages: state.activeConversationId
          ? { ...state.conversationMessages, [state.activeConversationId]: messages }
          : state.conversationMessages,
        isMessagesLoading: false,
        messagesLoadingConversationId: undefined,
      };
    }),
  setFavoriteStocks: (favoriteStocks) => set({ favoriteStocks }),
  replaceLastAssistant: (message, conversationId) =>
    set((state) =>
      updateConversationMessages(state, conversationId, (currentMessages) => {
        const messages = [...currentMessages];
        const index = findLastAssistantIndex(messages);
        if (index >= 0) messages[index] = message;
        else messages.push(message);
        return messages;
      }),
    ),
  stopLastAssistant: (conversationId) =>
    set((state) =>
      updateConversationMessages(state, conversationId, (currentMessages) => {
        const messages = [...currentMessages];
        const index = findLastAssistantIndex(messages);
        if (index < 0) {
          messages.push(createStoppedAssistantMessage());
          return messages;
        }
        const current = messages[index];
        messages[index] = {
          ...current,
          content: appendStoppedNotice(current.content),
          thinking: undefined,
          runEvents: appendStoppedFinalEvent(current.runEvents),
        };
        return messages;
      }),
    ),
  finalizeLastAssistant: (message, conversationId) =>
    set((state) =>
      updateConversationMessages(state, conversationId, (currentMessages) => {
        const messages = [...currentMessages];
        const index = findLastAssistantIndex(messages);
        const previous = index >= 0 ? messages[index] : undefined;
        const startedAt = previous?.thinking?.startedAt;
        const processedSeconds = startedAt
          ? Math.max(0.1, (Date.now() - new Date(startedAt).getTime()) / 1000)
          : undefined;
        const runEvents = previous?.runEvents?.length ? previous.runEvents : message.runEvents;
        const next = { ...message, thinking: undefined, runEvents, processedSeconds };
        if (index >= 0) messages[index] = next;
        else messages.push(next);
        return messages;
      }),
    ),
  appendToLastAssistant: (token, conversationId) =>
    set((state) =>
      updateConversationMessages(state, conversationId, (currentMessages) => {
        const messages = [...currentMessages];
        const index = findLastAssistantIndex(messages);
        if (index >= 0) messages[index] = { ...messages[index], content: `${messages[index].content}${token}` };
        return messages;
      }),
    ),
  applyRunEventToLastAssistant: (event, conversationId) =>
    set((state) =>
      updateConversationMessages(state, conversationId, (currentMessages) => {
        const messages = [...currentMessages];
        const index = findLastAssistantIndex(messages);
        if (index < 0) return messages;
        const current = messages[index];
        const steps = event.step
          ? [...(current.steps ?? []).filter((step) => step.id !== event.step!.id), event.step]
          : current.steps;
        const toolCalls =
          event.toolCall && !event.toolCall.id.startsWith('tool-pending-')
            ? [...(current.toolCalls ?? []).filter((tool) => tool.id !== event.toolCall!.id), event.toolCall]
            : current.toolCalls;
        const runEvents = [...(current.runEvents ?? []).filter((item) => item.type !== 'final_answer'), event];
        messages[index] = {
          ...current,
          runEvents,
          steps,
          thinking: current.thinking ? { ...current.thinking, steps: steps ?? current.thinking.steps } : current.thinking,
          toolCalls,
        };
        return messages;
      }),
    ),
  clearMessages: () =>
    set((state) => ({
      messages: [],
      conversationMessages: state.activeConversationId
        ? { ...state.conversationMessages, [state.activeConversationId]: [] }
        : state.conversationMessages,
      isMessagesLoading: false,
      messagesLoadingConversationId: undefined,
    })),
  setSelectedStock: (stock) =>
    set((state) => ({
      selectedStock: stock ? { ...stock, kline: stock.kline ?? state.stockKlines[stock.code] } : undefined,
      stockReturnContext: stock ? state.stockReturnContext : undefined,
    })),
  setStockReturnContext: (context) => set({ stockReturnContext: context }),
  setAiMonitorState: (aiMonitorState) => set({ aiMonitorState }),
  setSelectedBoard: (board) => set({ selectedBoard: board, selectedStock: undefined, stockReturnContext: undefined }),
  setSending: (isSending, conversationId) =>
    set((state) => {
      if (isSending) return { isSending: true, respondingConversationId: conversationId ?? state.activeConversationId };
      if (conversationId && state.respondingConversationId && state.respondingConversationId !== conversationId)
        return { isSending: state.isSending };
      return { isSending: false, respondingConversationId: undefined };
    }),
}));

const STOPPED_ASSISTANT_TEXT = '已暂停思考。';

function createStoppedAssistantMessage(): ChatMessage {
  return {
    id: `assistant-stopped-${Date.now()}`,
    role: 'assistant',
    content: STOPPED_ASSISTANT_TEXT,
    createdAt: new Date().toISOString(),
  };
}

function appendStoppedNotice(content: string): string {
  if (content.includes(STOPPED_ASSISTANT_TEXT)) return content || STOPPED_ASSISTANT_TEXT;
  const trimmedEnd = content.trimEnd();
  if (!trimmedEnd) return STOPPED_ASSISTANT_TEXT;
  return `${trimmedEnd}\n\n> ${STOPPED_ASSISTANT_TEXT}`;
}

function appendStoppedFinalEvent(runEvents: AgentRunEvent[] | undefined): AgentRunEvent[] | undefined {
  if (!runEvents?.length || runEvents.some((event) => event.type === 'final_answer')) return runEvents;
  return [...runEvents, { type: 'final_answer', title: '已暂停思考', message: STOPPED_ASSISTANT_TEXT }];
}

export function hasLocalAssistantDraft(messages: ChatMessage[]): boolean {
  return messages.some(
    (message) =>
      message.role === 'assistant' &&
      (Boolean(message.thinking) ||
        message.content.includes(STOPPED_ASSISTANT_TEXT) ||
        Boolean(message.runEvents?.some((event) => event.type === 'final_answer' && event.title === '已暂停思考'))),
  );
}

function findLastAssistantIndex(messages: ChatMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'assistant') return i;
  }
  return -1;
}

function shouldLoadConversationMessages(
  conversations: ConversationSummary[],
  conversationId: string | undefined,
  draft: ChatMessage[] | undefined,
  messages: ChatMessage[],
) {
  if (!conversationId || draft?.length || messages.length) return false;
  return (conversations.find((conversation) => conversation.id === conversationId)?.count ?? 0) > 0;
}

function shouldKeepCurrentConversationDraft(state: IAppDataState, nextConversationId: string | undefined) {
  if (!state.activeConversationId || state.activeConversationId === nextConversationId) return false;
  if (state.respondingConversationId === state.activeConversationId) return true;
  const lastAssistantIndex = findLastAssistantIndex(state.messages);
  return lastAssistantIndex >= 0 && Boolean(state.messages[lastAssistantIndex].thinking);
}

function updateConversationMessages(
  state: IAppDataState,
  conversationId: string | undefined,
  updater: (messages: ChatMessage[]) => ChatMessage[],
) {
  const targetConversationId = conversationId ?? state.activeConversationId;
  const isActiveConversation = !targetConversationId || targetConversationId === state.activeConversationId;
  const currentMessages = isActiveConversation
    ? state.messages
    : (state.messageDrafts[targetConversationId] ?? state.conversationMessages[targetConversationId] ?? []);
  const messages = updater(currentMessages);
  const stockKlines = { ...state.stockKlines, ...collectStockKlines(messages) };

  if (isActiveConversation)
    return {
      messages,
      conversationMessages: targetConversationId
        ? { ...state.conversationMessages, [targetConversationId]: messages }
        : state.conversationMessages,
      isMessagesLoading: false,
      messagesLoadingConversationId: undefined,
      stockKlines,
    };
  return {
    messageDrafts: { ...state.messageDrafts, [targetConversationId]: messages },
    conversationMessages: { ...state.conversationMessages, [targetConversationId]: messages },
    stockKlines,
  };
}

function collectStockKlines(messages: ChatMessage[]) {
  const result: Record<string, NonNullable<AgentResultCard['chart']>['data']> = {};
  for (const message of messages) {
    const card = message.result;
    if (card?.chart?.type !== 'kline') continue;
    for (const stock of card.stocks ?? []) result[stock.code] = card.chart.data;
  }
  return result;
}
