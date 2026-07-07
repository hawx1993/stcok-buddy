import { create } from 'zustand';
import type {
  AgentResultCard,
  AppConfig,
  ChatMessage,
  ConversationSummary,
  StockDetail,
  BoardDetail,
  ThemeMode,
} from '../shared/types';

export type SidebarTab = 'all' | 'surge' | 'stock' | 'diagnosis' | 'market';
export type SidebarMainTab = 'session' | 'hot';
export type HotSubTab = 'sector' | 'market' | 'surge' | 'strategy' | 'diagnosis' | 'flow';

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
  isLeftSidebarCollapsed: boolean;
  isRightPanelCollapsed: boolean;
  search: string;
  messages: ChatMessage[];
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
  toggleLeftSidebar(): void;
  toggleRightPanel(): void;
  openRightPanel(): void;
  setSearch(search: string): void;
  addMessage(message: ChatMessage): void;
  rememberStockKline(code: string, data?: NonNullable<AgentResultCard['chart']>['data']): void;
  setMessages(messages: ChatMessage[]): void;
  replaceLastAssistant(message: ChatMessage): void;
  finalizeLastAssistant(message: ChatMessage): void;
  appendToLastAssistant(token: string): void;
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
  isLeftSidebarCollapsed: false,
  isRightPanelCollapsed: false,
  search: '',
  messages: [],
  stockKlines: {},
  selectedStock: undefined,
  selectedBoard: undefined,
  isSettingsOpen: false,
  isSending: false,
  surgeStocks: [],
  setConfig: (config) => set({ config }),
  setTheme: (theme) =>
    set((state) => (state.config ? { config: { ...state.config, theme } } : state)),
  setConversations: (conversations) =>
    set({ conversations, activeConversationId: get().activeConversationId ?? conversations[0]?.id }),
  setActiveConversation: (id) => set({ activeConversationId: id }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setSidebarMainTab: (tab) => set({ sidebarMainTab: tab, search: '' }),
  setHotSubTab: (tab) => set({ hotSubTab: tab }),
  toggleLeftSidebar: () => set((state) => ({ isLeftSidebarCollapsed: !state.isLeftSidebarCollapsed })),
  toggleRightPanel: () => set((state) => ({ isRightPanelCollapsed: !state.isRightPanelCollapsed })),
  openRightPanel: () => set({ isRightPanelCollapsed: false }),
  setSearch: (search) => set({ search }),
  rememberStockKline: (code, data) => {
    if (data?.length) set((state) => ({ stockKlines: { ...state.stockKlines, [code]: data } }));
  },
  setMessages: (messages) => set((state) => ({ messages, stockKlines: { ...state.stockKlines, ...collectStockKlines(messages) } })),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
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
      const processedSeconds = startedAt ? Math.max(0.1, (Date.now() - new Date(startedAt).getTime()) / 1000) : undefined;
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
  clearMessages: () => set({ messages: [] }),
  setSelectedStock: (stock) => set((state) => ({ selectedStock: stock ? { ...stock, kline: stock.kline ?? state.stockKlines[stock.code] } : undefined, selectedBoard: undefined })),
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
    { id: 'board', agent: '板块雷达', description: '申万白酒指数今日 +1.72%，成交额 285 亿，主力净流入 3.2 亿', status: 'completed' as const },
    { id: 'news', agent: '舆情摘要', description: '中秋国庆动销预期升温；茅台批价企稳；五粮液新管理层提价信号', status: 'completed' as const },
    { id: 'factor', agent: '因子筛选', description: '近3年 ROE > 20%、PEG < 2、股息率 > 1.5% → 6 只', status: 'completed' as const },
    { id: 'valuation', agent: '估值比较', description: '当前板块 PE(TTM) 24.5x，低于近5年中位数 28.3x', status: 'completed' as const },
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
        { id: 'finance', agent: '财务数据', description: '营收 506 亿（+11.3%），归母净利 190 亿（+11.8%），毛利率 76.2%', status: 'completed' },
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
        narrative: '核心逻辑：浓香白酒龙头，品牌力稳固。关注点：行业库存去化节奏、中秋国庆动销数据、消费税改革落地进展。',
      },
    },
  ];
}

function createSurgeStocks(): SurgeStock[] {
  return [
    { code: '300502', name: '新易盛', type: 'surge', changePercent: '+12.35%', price: 86.5, turnover: '28.3亿', reason: 'CPO 光模块订单超预期，机构上调目标价' },
    { code: '600519', name: '贵州茅台', type: 'surge', changePercent: '+3.86%', price: 1548, turnover: '95.2亿', reason: '中秋国庆动销数据超预期，北向资金大幅买入' },
    { code: '002371', name: '北方华创', type: 'surge', changePercent: '+8.72%', price: 328.6, turnover: '42.1亿', reason: '半导体设备国产替代加速，大基金三期布局' },
    { code: '300750', name: '宁德时代', type: 'plummet', changePercent: '-5.68%', price: 222, turnover: '68.5亿', reason: '欧盟电动车关税落地，短期情绪承压' },
    { code: '601127', name: '赛力斯', type: 'surge', changePercent: '+7.23%', price: 92.8, turnover: '35.6亿', reason: '问界 M9 大定突破 10 万台，Q3 盈利超预期' },
    { code: '000858', name: '五粮液', type: 'surge', changePercent: '+2.13%', price: 140.2, turnover: '28.6亿', reason: '新管理层提价信号，经销商大会催化' },
    { code: '688256', name: '寒武纪', type: 'plummet', changePercent: '-4.35%', price: 138.2, turnover: '22.3亿', reason: '美国新一轮芯片出口限制传闻' },
    { code: '002594', name: '比亚迪', type: 'volume', changePercent: '+2.85%', price: 268.5, turnover: '56.8亿', reason: '单月销量创新高，海外扩张加速' },
  ];
}
