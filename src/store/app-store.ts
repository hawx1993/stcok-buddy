import { create } from 'zustand';
import type {
  AgentResultCard,
  AppConfig,
  ChatMessage,
  ConversationSummary,
  FavoriteStock,
  StockDetail,
  BoardDetail,
  ThemeMode,
  AgentRunEvent,
} from '../shared/types';

export type SidebarTab = 'all' | 'surge' | 'stock' | 'diagnosis' | 'market';
export type SidebarMainTab = 'session' | 'hot';
export type HotSubTab = 'sector' | 'market' | 'surge' | 'strategy' | 'diagnosis' | 'flow';
export type RightPanelTab = 'favorites' | 'stock' | 'board' | 'surge' | 'news';
export type MainView = 'chat' | 'market';

export interface SurgeStock extends StockDetail {
  type: 'surge' | 'plummet' | 'volume';
  reason: string;
}

interface AppState {
  config?: AppConfig;
  conversations: ConversationSummary[];
  activeConversationId?: string;
  sidebarTab: SidebarTab;
  sidebarMainTab: SidebarMainTab;
  hotSubTab: HotSubTab;
  rightPanelTab: RightPanelTab;
  mainView: MainView;
  isLeftSidebarCollapsed: boolean;
  isRightPanelCollapsed: boolean;
  search: string;
  messages: ChatMessage[];
  favoriteStocks: FavoriteStock[];
  stockKlines: Record<string, NonNullable<AgentResultCard['chart']>['data']>;
  selectedStock?: StockDetail;
  selectedBoard?: BoardDetail;
  isSettingsOpen: boolean;
  isSending: boolean;
  surgeStocks: SurgeStock[];
  setConfig(config: AppConfig): void;
  setTheme(theme: ThemeMode): void;
  setConversations(conversations: ConversationSummary[]): void;
  setActiveConversation(id?: string): void;
  setSidebarTab(tab: SidebarTab): void;
  setSidebarMainTab(tab: SidebarMainTab): void;
  setHotSubTab(tab: HotSubTab): void;
  setRightPanelTab(tab: RightPanelTab): void;
  setMainView(view: MainView): void;
  toggleLeftSidebar(): void;
  toggleRightPanel(): void;
  openRightPanel(): void;
  openBoardPanel(): void;
  setSearch(search: string): void;
  addMessage(message: ChatMessage): void;
  setFavoriteStocks(favoriteStocks: FavoriteStock[]): void;
  rememberStockKline(code: string, data?: NonNullable<AgentResultCard['chart']>['data']): void;
  setMessages(messages: ChatMessage[]): void;
  replaceLastAssistant(message: ChatMessage): void;
  finalizeLastAssistant(message: ChatMessage): void;
  appendToLastAssistant(token: string): void;
  applyRunEventToLastAssistant(event: AgentRunEvent): void;
  clearMessages(): void;
  setSelectedStock(stock?: StockDetail): void;
  setSelectedBoard(board?: BoardDetail): void;
  setSettingsOpen(open: boolean): void;
  setSending(isSending: boolean): void;
}

export const useAppStore = create<AppState>((set, get) => ({
  conversations: [],
  activeConversationId: undefined,
  sidebarTab: 'all',
  sidebarMainTab: 'session',
  hotSubTab: 'sector',
  rightPanelTab: 'stock',
  mainView: 'chat',
  isLeftSidebarCollapsed: false,
  isRightPanelCollapsed: true,
  search: '',
  messages: [],
  favoriteStocks: [],
  stockKlines: {},
  selectedStock: undefined,
  selectedBoard: undefined,
  isSettingsOpen: false,
  isSending: false,
  surgeStocks: [],
  setConfig: (config) => set({ config }),
  setTheme: (theme) => set((state) => (state.config ? { config: { ...state.config, theme } } : state)),
  setConversations: (conversations) =>
    set({ conversations, activeConversationId: get().activeConversationId ?? conversations[0]?.id }),
  setActiveConversation: (id) => set({ activeConversationId: id, mainView: 'chat' }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setSidebarMainTab: (tab) => set({ sidebarMainTab: tab, search: '' }),
  setHotSubTab: (tab) => set({ hotSubTab: tab }),
  setRightPanelTab: (tab) =>
    set((state) => ({
      rightPanelTab: tab,
      isRightPanelCollapsed: state.rightPanelTab === tab ? !state.isRightPanelCollapsed : false,
    })),
  setMainView: (view) => set({ mainView: view }),
  toggleLeftSidebar: () => set((state) => ({ isLeftSidebarCollapsed: !state.isLeftSidebarCollapsed })),
  toggleRightPanel: () => set((state) => ({ isRightPanelCollapsed: !state.isRightPanelCollapsed })),
  openRightPanel: () => set({ isRightPanelCollapsed: false, rightPanelTab: 'stock' }),
  openBoardPanel: () => set({ isRightPanelCollapsed: false, rightPanelTab: 'board' }),
  setSearch: (search) => set({ search }),
  rememberStockKline: (code, data) => {
    if (data?.length) set((state) => ({ stockKlines: { ...state.stockKlines, [code]: data } }));
  },
  setMessages: (messages) =>
    set((state) => ({ messages, stockKlines: { ...state.stockKlines, ...collectStockKlines(messages) } })),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  setFavoriteStocks: (favoriteStocks) => set({ favoriteStocks }),
  replaceLastAssistant: (message) =>
    set((state) => {
      const messages = [...state.messages];
      let index = -1;
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].role === 'assistant') {
          index = i;
          break;
        }
      }
      if (index >= 0) messages[index] = message;
      else messages.push(message);
      return { messages };
    }),
  finalizeLastAssistant: (message) =>
    set((state) => {
      const messages = [...state.messages];
      let index = -1;
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].role === 'assistant') {
          index = i;
          break;
        }
      }
      const previous = index >= 0 ? messages[index] : undefined;
      const startedAt = previous?.thinking?.startedAt;
      const processedSeconds = startedAt
        ? Math.max(0.1, (Date.now() - new Date(startedAt).getTime()) / 1000)
        : undefined;
      const runEvents = previous?.runEvents?.length ? previous.runEvents : message.runEvents;
      const next = { ...message, thinking: undefined, runEvents, processedSeconds };
      if (index >= 0) messages[index] = next;
      else messages.push(next);
      return { messages };
    }),
  appendToLastAssistant: (token) =>
    set((state) => {
      const messages = [...state.messages];
      let index = -1;
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].role === 'assistant') {
          index = i;
          break;
        }
      }
      if (index >= 0) messages[index] = { ...messages[index], content: `${messages[index].content}${token}` };
      return { messages };
    }),
  applyRunEventToLastAssistant: (event) =>
    set((state) => {
      const messages = [...state.messages];
      let index = -1;
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].role === 'assistant') {
          index = i;
          break;
        }
      }
      if (index < 0) return { messages };
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
      return { messages };
    }),
  clearMessages: () => set({ messages: [] }),
  setSelectedStock: (stock) =>
    set((state) => ({
      selectedStock: stock ? { ...stock, kline: stock.kline ?? state.stockKlines[stock.code] } : undefined,
    })),
  setSelectedBoard: (board) => set({ selectedBoard: board, selectedStock: undefined }),
  setSettingsOpen: (open) => set({ isSettingsOpen: open }),
  setSending: (isSending) => set({ isSending }),
}));

function collectStockKlines(messages: ChatMessage[]) {
  const result: Record<string, NonNullable<AgentResultCard['chart']>['data']> = {};
  for (const message of messages) {
    const card = message.result;
    if (card?.chart?.type !== 'kline') continue;
    for (const stock of card.stocks ?? []) result[stock.code] = card.chart.data;
  }
  return result;
}
