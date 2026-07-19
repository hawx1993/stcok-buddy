import type {
  AppConfig,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ConversationSummary,
  FavoriteStock,
  BoardDetail,
  StocksenseApi,
  HotFocusTab,
  MarketNewsItem,
  MarketTab,
  PagedMarketNews,
  StoreItem,
  IAppUpdateState,
} from './types.js';

const defaultConfig: AppConfig = {
  theme: 'dark',
  marketColorMode: 'red-up-green-down',
  model: {
    provider: 'deepseek',
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    customModel: '',
  },
  tradeStyle: 'value',
  riskProfile: 'moderate',
  holdingPeriod: 'medium',
};

const defaultConversations: ConversationSummary[] = [
  { id: 'web-conv-1', title: '浏览器预览会话', preview: 'PWA / Browser preview', date: '刚刚', tab: 'stock', count: 0 },
];

export function getStocksenseApi(): StocksenseApi {
  if (!window.stocksense) return webFallbackApi;
  return {
    ...webFallbackApi,
    ...window.stocksense,
    listFavoriteStocks: () =>
      window.stocksense!.listFavoriteStocks().catch(fallbackFavoriteError(() => webFallbackApi.listFavoriteStocks())),
    upsertFavoriteStock: (stock) =>
      window
        .stocksense!.upsertFavoriteStock(stock)
        .catch(fallbackFavoriteError(() => webFallbackApi.upsertFavoriteStock(stock))),
    removeFavoriteStock: (code) =>
      window
        .stocksense!.removeFavoriteStock(code)
        .catch(fallbackFavoriteError(() => webFallbackApi.removeFavoriteStock(code))),
    toggleFavoriteStockPin: (code) =>
      window
        .stocksense!.toggleFavoriteStockPin(code)
        .catch(fallbackFavoriteError(() => webFallbackApi.toggleFavoriteStockPin(code))),
  };
}

function fallbackFavoriteError<T>(fallback: () => Promise<T>) {
  return (error: unknown) => {
    if (error instanceof Error && error.message.includes('No handler registered')) return fallback();
    throw error;
  };
}

function readInstalledStoreItems(): string[] {
  const saved = localStorage.getItem('stocksense-installed-store-items');
  return saved ? JSON.parse(saved) : [];
}

function writeInstalledStoreItems(items: string[]) {
  localStorage.setItem('stocksense-installed-store-items', JSON.stringify(items));
  return items;
}

async function readStoreItems(): Promise<StoreItem[]> {
  const paths = [
    '/store/commands/dragon-tiger/index.json',
    '/store/commands/industry-rotation/index.json',
    '/store/commands/web-page-summary/index.json',
  ];
  const items = await Promise.all(
    paths.map(async (path) => {
      const response = await fetch(path).catch(() => undefined);
      return response?.ok ? ((await response.json()) as StoreItem) : undefined;
    }),
  );
  return items.filter((item): item is StoreItem => Boolean(item));
}

function readConfig(): AppConfig {
  const saved = localStorage.getItem('stocksense-config');
  return saved ? { ...defaultConfig, ...JSON.parse(saved) } : defaultConfig;
}

function readConversations(): ConversationSummary[] {
  const saved = localStorage.getItem('stocksense-conversations');
  return saved ? JSON.parse(saved) : defaultConversations;
}

function sortFavorites(items: FavoriteStock[]) {
  return [...items].sort(
    (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.createdAt.localeCompare(a.createdAt),
  );
}

function readFavorites(): FavoriteStock[] {
  const saved = localStorage.getItem('stocksense-favorites');
  return saved ? sortFavorites(JSON.parse(saved)) : [];
}

function writeFavorites(items: FavoriteStock[]) {
  const next = sortFavorites(items);
  localStorage.setItem('stocksense-favorites', JSON.stringify(next));
  return next;
}

function readMessages(conversationId: string): ChatMessage[] {
  const saved = localStorage.getItem(`stocksense-messages:${conversationId}`);
  return saved ? JSON.parse(saved) : [];
}

function saveLocalMessage(conversationId: string, message: ChatMessage) {
  localStorage.setItem(
    `stocksense-messages:${conversationId}`,
    JSON.stringify([...readMessages(conversationId), message]),
  );
}

function pageItems(items: MarketNewsItem[], page = 1, pageSize = 30): PagedMarketNews {
  const start = (Math.max(1, page) - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total: items.length, page, pageSize };
}

const browserUpdateState: IAppUpdateState = {
  status: 'idle',
  currentVersion: 'browser',
  message: '自动升级仅在 Electron 桌面端可用',
};

const webFallbackApi: StocksenseApi = {
  async getConfig() {
    return readConfig();
  },
  async setConfig(config: AppConfig) {
    localStorage.setItem('stocksense-config', JSON.stringify(config));
    return config;
  },
  async testModelConfig() {
    throw new Error('浏览器预览模式不会连接本地大模型配置，请运行 Electron 桌面端后再测试。');
  },
  async listFavoriteStocks() {
    return readFavorites();
  },
  async upsertFavoriteStock(stock: Pick<FavoriteStock, 'code' | 'name'>) {
    const favorites = readFavorites();
    const existing = favorites.find((item) => item.code === stock.code);
    return writeFavorites(
      existing
        ? favorites.map((item) => (item.code === stock.code ? { ...item, name: stock.name || item.name } : item))
        : [{ ...stock, pinned: false, createdAt: new Date().toISOString() }, ...favorites],
    );
  },
  async removeFavoriteStock(code: string) {
    return writeFavorites(readFavorites().filter((item) => item.code !== code));
  },
  async toggleFavoriteStockPin(code: string) {
    return writeFavorites(
      readFavorites().map((item) => (item.code === code ? { ...item, pinned: !item.pinned } : item)),
    );
  },
  async listConversations() {
    return readConversations();
  },
  async createConversation() {
    const conversation: ConversationSummary = {
      id: `web-conv-${Date.now()}`,
      title: '新建会话',
      preview: '浏览器预览',
      date: '刚刚',
      tab: 'stock',
      count: 0,
    };
    localStorage.setItem('stocksense-conversations', JSON.stringify([conversation, ...readConversations()]));
    return conversation;
  },
  async deleteConversation(id: string) {
    const next = readConversations().filter((item) => item.id !== id);
    localStorage.setItem('stocksense-conversations', JSON.stringify(next));
    localStorage.removeItem(`stocksense-messages:${id}`);
    return next;
  },
  async renameConversation(id: string, title: string) {
    const next = readConversations().map((item) =>
      item.id === id ? { ...item, title: title.trim() || item.title } : item,
    );
    localStorage.setItem('stocksense-conversations', JSON.stringify(next));
    return next;
  },
  async listMessages(conversationId: string) {
    return readMessages(conversationId);
  },
  async saveMessage(conversationId: string, message: ChatMessage) {
    saveLocalMessage(conversationId, message);
  },
  async sendChat(request: ChatRequest): Promise<ChatResponse> {
    const command = request.message
      .trim()
      .match(/^\/(综合投研报告|新闻公告|技术面分析|基本面分析|资金面分析|情绪面分析|筹码分布|筹码分析)\s*(.*)$/);
    if (command && command[2].trim() === '')
      return webMessage(request, `请输入股票代码或股票名称，例如：/${command[1]} 中公教育`);
    return webMessage(
      request,
      '浏览器/PWA 模式仅支持 UI、主题和本地配置预览。实时行情、新闻、K线与投研报告请在 Electron 桌面端查看。',
    );
  },
  async getStockDetail(symbol: string) {
    return { code: symbol, name: symbol, summary: '请在 Electron 桌面端查看实时行情。' };
  },
  async searchStocks(_query: string) {
    return [];
  },
  async getBoardDetail(symbol: string, _forceRefresh?: boolean, _boardName?: string): Promise<BoardDetail> {
    return { code: symbol, name: symbol, kline: [], constituents: [] };
  },
  async getKline(_symbol: string, _limit = 120, _period = '1d', _beforeTimestamp?: number) {
    return [];
  },
  async listMarketNews(_query = '', page = 1, pageSize = 30) {
    return pageItems([], page, pageSize);
  },
  async listHotFocus(_tab: HotFocusTab) {
    return [];
  },
  async listSurgeHistoryDates() {
    return [];
  },
  async listSurgeHistory(_date: string, _offset = 0, _limit = 20) {
    return [];
  },
  async getMarketDataSyncStatus() {
    return {
      state: 'idle' as const,
      processedSymbols: 0,
      totalSymbols: 0,
      succeededSymbols: 0,
      failedSymbols: 0,
      message: '本地市场数据库仅在 Electron 桌面端可用',
    };
  },
  async startMarketDataSync() {
    return this.getMarketDataSyncStatus();
  },
  async retryMarketDataFailures() {
    return this.getMarketDataSyncStatus();
  },
  async cancelMarketDataSync() {
    return {
      state: 'idle' as const,
      processedSymbols: 0,
      totalSymbols: 0,
      succeededSymbols: 0,
      failedSymbols: 0,
      message: '本地市场数据库仅在 Electron 桌面端可用',
    };
  },
  async getMarketDataStats() {
    return { securityCount: 0, dailyBarCount: 0, databaseBytes: 0, failedSymbols: 0 };
  },
  async getMarketPageSnapshot(tab: MarketTab, period = '1d') {
    return { tab, period, updatedAt: new Date().toISOString(), indices: [], rows: [], boards: [] };
  },
  async listStoreItems() {
    return readStoreItems();
  },
  async listInstalledStoreItems() {
    return readInstalledStoreItems();
  },
  async installStoreItem(id: string) {
    const installed = readInstalledStoreItems();
    return installed.includes(id) ? installed : writeInstalledStoreItems([...installed, id]);
  },
  async uninstallStoreItem(id: string) {
    return writeInstalledStoreItems(readInstalledStoreItems().filter((item) => item !== id));
  },
  async getAppUpdateState() {
    return browserUpdateState;
  },
  async checkAppUpdate() {
    return browserUpdateState;
  },
  async downloadAppUpdate() {
    throw new Error('自动升级仅在 Electron 桌面端可用');
  },
  async installAppUpdate() {
    throw new Error('自动升级仅在 Electron 桌面端可用');
  },
  async openAppReleaseNotes() {
    window.open('https://github.com/hawx1993/stcok-buddy/releases', '_blank', 'noopener,noreferrer');
  },
  async selectAppUpdateDownloadDirectory() {
    throw new Error('更新下载目录仅在 Electron 桌面端可配置');
  },
};

function webMessage(request: ChatRequest, content: string): ChatResponse {
  const message: ChatMessage = {
    id: `web-assistant-${Date.now()}`,
    role: 'assistant',
    content,
    createdAt: new Date().toISOString(),
  };
  saveLocalMessage(request.conversationId, {
    id: `web-user-${Date.now()}`,
    role: 'user',
    content: request.message,
    createdAt: new Date().toISOString(),
  });
  saveLocalMessage(request.conversationId, message);
  return { message, events: [{ type: 'final_answer', message: content }] };
}
