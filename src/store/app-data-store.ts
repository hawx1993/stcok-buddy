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
  addMessage(message: ChatMessage): void;
  setFavoriteStocks(favoriteStocks: FavoriteStock[]): void;
  rememberStockKline(code: string, data?: NonNullable<AgentResultCard['chart']>['data']): void;
  setMessages(messages: ChatMessage[]): void;
  replaceLastAssistant(message: ChatMessage, conversationId?: string): void;
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
    set({ conversations, activeConversationId: get().activeConversationId ?? conversations[0]?.id }),
  setActiveConversation: (id) => {
    useAppUiStore.getState().setMainView('chat');
    set((state) => {
      const messageDrafts = { ...state.messageDrafts };
      const shouldKeepCurrentDraft =
        state.activeConversationId &&
        state.activeConversationId !== id &&
        (state.respondingConversationId === state.activeConversationId || state.messages.some((message) => message.thinking));
      if (shouldKeepCurrentDraft && state.activeConversationId) messageDrafts[state.activeConversationId] = state.messages;
      const draft = id ? messageDrafts[id] : undefined;
      return draft
        ? { activeConversationId: id, messages: draft, messageDrafts }
        : { activeConversationId: id, messages: [], messageDrafts };
    });
  },
  rememberStockKline: (code, data) => {
    if (data?.length) set((state) => ({ stockKlines: { ...state.stockKlines, [code]: data } }));
  },
  setMessages: (messages) =>
    set((state) => {
      const messageDrafts = { ...state.messageDrafts };
      if (state.activeConversationId) delete messageDrafts[state.activeConversationId];
      return {
        messages,
        messageDrafts,
        stockKlines: { ...state.stockKlines, ...collectStockKlines(messages) },
      };
    }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
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
  clearMessages: () => set({ messages: [] }),
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

function findLastAssistantIndex(messages: ChatMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'assistant') return i;
  }
  return -1;
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
    : (state.messageDrafts[targetConversationId] ?? []);
  const messages = updater(currentMessages);
  const stockKlines = { ...state.stockKlines, ...collectStockKlines(messages) };

  if (isActiveConversation) return { messages, stockKlines };
  return {
    messageDrafts: { ...state.messageDrafts, [targetConversationId]: messages },
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
