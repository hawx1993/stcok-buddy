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
      const next = { ...message, processedSeconds };
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

function createSeedMessages(): ChatMessage[] {
  const steps = [
    {
      id: 'board',
      agent: '板块雷达',
      description: '申万白酒指数今日 +1.72%，成交额 285 亿，主力净流入 3.2 亿',
      status: 'completed' as const,
    },
    {
      id: 'news',
      agent: '舆情摘要',
      description: '中秋国庆动销预期升温；茅台批价企稳；五粮液新管理层提价信号',
      status: 'completed' as const,
    },
    {
      id: 'factor',
      agent: '因子筛选',
      description: '近3年 ROE > 20%、PEG < 2、股息率 > 1.5% → 6 只',
      status: 'completed' as const,
    },
    {
      id: 'valuation',
      agent: '估值比较',
      description: '当前板块 PE(TTM) 24.5x，低于近5年中位数 28.3x',
      status: 'completed' as const,
    },
  ];
  const card: AgentResultCard = {
    title: '白酒板块速览',
    subtitle: '2024年9月10日 · 盘中',
    metrics: [
      { label: '板块涨幅', value: '+1.72%', tone: 'up' },
      { label: '成交额', value: '285 亿' },
      { label: '主力净流入', value: '+3.2 亿', tone: 'up' },
    ],
    rows: [
      { 代码: '600519', 名称: '贵州茅台', 涨幅: '+0.86%', PE: '27.8', 评级: '持有' },
      { 代码: '000858', 名称: '五粮液', 涨幅: '+2.13%', PE: '21.4', 评级: '关注' },
      { 代码: '000568', 名称: '泸州老窖', 涨幅: '+2.45%', PE: '18.9', 评级: '关注' },
      { 代码: '002304', 名称: '洋河股份', 涨幅: '-0.32%', PE: '14.2', 评级: '持有' },
    ],
  };

  return [
    {
      id: 'seed-user-1',
      role: 'user',
      content: '帮我看看白酒板块今天怎么样，有没有值得关注的龙头？',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'seed-agent-1',
      role: 'assistant',
      content: '好的，我来分析白酒板块。',
      createdAt: new Date().toISOString(),
      steps,
      result: card,
    },
    {
      id: 'seed-user-2',
      role: 'user',
      content: '我持有五粮液，帮我诊诊股',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'seed-agent-2',
      role: 'assistant',
      content: '正在对五粮液（000858）进行全面诊断。',
      createdAt: new Date().toISOString(),
      steps: [
        {
          id: 'finance',
          agent: '财务数据',
          description: '营收 506 亿（+11.3%），归母净利 190 亿（+11.8%），毛利率 76.2%',
          status: 'completed',
        },
        { id: 'tech', agent: '技术面', description: '股价站上 60 日均线，MACD 金叉，量能萎缩', status: 'completed' },
        { id: 'risk', agent: '风险核查', description: '北向近5日净买入 2.3 亿，无重大负面舆情', status: 'completed' },
      ],
      result: {
        title: '五粮液（000858）诊股报告',
        subtitle: '综合评分 7.8 / 10',
        metrics: [
          { label: '基本面', value: '优质', tone: 'up' },
          { label: '估值', value: '偏低', tone: 'up' },
          { label: '技术', value: '中性偏多', tone: 'warn' },
          { label: '风险', value: '低', tone: 'up' },
        ],
        narrative:
          '核心逻辑：浓香白酒龙头，品牌力稳固。关注点：行业库存去化节奏、中秋国庆动销数据、消费税改革落地进展。',
      },
    },
  ];
}
