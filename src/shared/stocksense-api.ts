import type {
  AppConfig,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ConversationSummary,
  FavoriteStock,
  BoardDetail,
  IBoardDashboardSnapshot,
  StocksenseApi,
  HotFocusTab,
  HotFocusItem,
  MarketNewsItem,
  MarketTab,
  PagedMarketNews,
  StoreItem,
  IHotStockHintSource,
  IAppUpdateState,
  IStockNewsPreferences,
  IConversationMessagesOptions,
  IConversationSearchResult,
} from './types.js';
import StockSDK from 'stock-sdk';
import { listHotStockHintSource, type IHotStockHintLoaders } from './hot-stock-hints-service.js';

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
  notifyOnAiResponse: true,
};

const feedbackEmailRecipient = 'trigkit@163.com';
const feedbackEmailSubject = 'StockBuddy 问题反馈';
const feedbackEmailBody = `请填写以下信息，方便我们定位问题：

1. 问题描述：
2. 复现步骤：
3. 预期结果：
4. 实际结果：
5. 操作系统：
6. StockBuddy 版本：

请尽量附上截图/录屏或相关图片附件，帮助我们更快定位问题。`;

function getFeedbackEmailUrl() {
  const subject = encodeURIComponent(feedbackEmailSubject);
  const body = encodeURIComponent(feedbackEmailBody);
  return `mailto:${feedbackEmailRecipient}?subject=${subject}&body=${body}`;
}

const defaultConversations: ConversationSummary[] = [
  {
    id: 'web-conv-1',
    title: '浏览器预览会话',
    preview: 'PWA / Browser preview',
    date: '刚刚',
    updatedAt: new Date().toISOString(),
    tab: 'stock',
    count: 0,
  },
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
    searchConversations: (query) => {
      if (typeof window.stocksense!.searchConversations === 'function') return window.stocksense!.searchConversations(query);
      return Promise.reject(new Error('会话搜索功能不可用，请重启客户端'));
    },
    toggleFavoriteStockPin: (code) =>
      window
        .stocksense!.toggleFavoriteStockPin(code)
        .catch(fallbackFavoriteError(() => webFallbackApi.toggleFavoriteStockPin(code))),
    listStockNews: (code, limit) => {
      if (typeof window.stocksense!.listStockNews === 'function')
        return window.stocksense!.listStockNews(code, limit).catch(fallbackFavoriteError(() => webFallbackApi.listStockNews(code, limit)));
      return Promise.reject(new Error('个股快讯功能不可用，请重启客户端'));
    },
    getDiscoverySnapshot: (options) => {
      if (typeof window.stocksense!.getDiscoverySnapshot === 'function')
        return window.stocksense!.getDiscoverySnapshot(options);
      return Promise.reject(new Error('探索功能不可用，请重启客户端'));
    },
    getMonitorFeed: (options) => {
      if (typeof window.stocksense!.getMonitorFeed === 'function')
        return window.stocksense!.getMonitorFeed(options);
      return Promise.reject(new Error('AI 监控中心不可用，请重启客户端'));
    },
    getTradingAdvice: (options) => {
      if (typeof window.stocksense!.getTradingAdvice === 'function')
        return window.stocksense!.getTradingAdvice(options);
      return Promise.reject(new Error('AI 交易建议不可用，请重启客户端'));
    },
    getDragonTigerSnapshot: (range) => {
      if (typeof window.stocksense!.getDragonTigerSnapshot === 'function')
        return window.stocksense!.getDragonTigerSnapshot(range);
      return webFallbackApi.getDragonTigerSnapshot(range);
    },
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
  const conversations = saved ? (JSON.parse(saved) as ConversationSummary[]) : defaultConversations;
  return conversations.map((conversation) => ({
    ...conversation,
    updatedAt: conversation.updatedAt || new Date(0).toISOString(),
  }));
}

function sortConversations(conversations: ConversationSummary[]) {
  return [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function writeConversations(conversations: ConversationSummary[]) {
  const next = sortConversations(conversations);
  localStorage.setItem('stocksense-conversations', JSON.stringify(next));
  return next;
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

function readStockNewsPreferences(): IStockNewsPreferences {
  const saved = localStorage.getItem('stocksense-stock-news-preferences');
  if (!saved) return { favoritesOnly: false, manualStocks: [] };
  const preferences = JSON.parse(saved) as IStockNewsPreferences;
  return { favoritesOnly: Boolean(preferences.favoritesOnly), manualStocks: preferences.manualStocks ?? [] };
}

function writeStockNewsPreferences(preferences: IStockNewsPreferences): IStockNewsPreferences {
  localStorage.setItem('stocksense-stock-news-preferences', JSON.stringify(preferences));
  return preferences;
}

function readMessages(conversationId: string): ChatMessage[] {
  const saved = localStorage.getItem(`stocksense-messages:${conversationId}`);
  return saved ? JSON.parse(saved) : [];
}

function normalizeMessageLimit(limit: number | undefined) {
  if (limit === undefined || !Number.isFinite(limit)) return undefined;
  return Math.max(1, Math.min(50, Math.trunc(limit)));
}

function listLocalMessages(conversationId: string, options: IConversationMessagesOptions = {}): ChatMessage[] {
  const messages = [...readMessages(conversationId)].sort(
    (left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
  const beforeIndex = options.beforeCreatedAt
    ? messages.findIndex(
        (message) =>
          message.createdAt > options.beforeCreatedAt! ||
          (message.createdAt === options.beforeCreatedAt && Boolean(options.beforeId) && message.id >= options.beforeId!),
      )
    : messages.length;
  const end = beforeIndex >= 0 ? beforeIndex : messages.length;
  const limit = normalizeMessageLimit(options.limit);
  return messages.slice(limit ? Math.max(0, end - limit) : 0, end);
}

function saveLocalMessage(conversationId: string, message: ChatMessage) {
  localStorage.setItem(
    `stocksense-messages:${conversationId}`,
    JSON.stringify([...readMessages(conversationId), message]),
  );
  const updatedAt = message.createdAt;
  const conversations = readConversations().map((conversation) =>
    conversation.id === conversationId
      ? {
          ...conversation,
          preview: message.content.slice(0, 80),
          date: new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(updatedAt)),
          title: conversation.title === '新建会话' ? message.content.slice(0, 18) : conversation.title,
          count: conversation.count + 1,
          updatedAt,
        }
      : conversation,
  );
  writeConversations(conversations);
}

function createConversationSnippet(content: string, keyword: string) {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  const index = normalized.toLowerCase().indexOf(keyword.toLowerCase());
  const radius = 32;
  const start = index >= 0 ? Math.max(0, index - radius) : 0;
  const end = index >= 0 ? Math.min(normalized.length, index + keyword.length + radius) : Math.min(normalized.length, radius * 2);
  return `${start > 0 ? '…' : ''}${normalized.slice(start, end)}${end < normalized.length ? '…' : ''}`;
}

function searchLocalConversations(query: string): IConversationSearchResult[] {
  const keyword = query.trim();
  if (!keyword) return [];
  const lowerKeyword = keyword.toLowerCase();
  const results: IConversationSearchResult[] = [];
  for (const conversation of readConversations()) {
    const headerText = `${conversation.title} ${conversation.preview}`;
    if (headerText.toLowerCase().includes(lowerKeyword)) {
      results.push({
        kind: 'conversation',
        conversationId: conversation.id,
        title: conversation.title,
        preview: conversation.preview,
        updatedAt: conversation.updatedAt,
        snippet: createConversationSnippet(headerText, keyword),
      });
    }
    for (const message of readMessages(conversation.id)) {
      if (results.length >= 30) return results;
      if ((message.role !== 'user' && message.role !== 'assistant') || !message.content.toLowerCase().includes(lowerKeyword)) continue;
      results.push({
        kind: 'message',
        conversationId: conversation.id,
        title: conversation.title,
        preview: conversation.preview,
        updatedAt: conversation.updatedAt,
        messageId: message.id,
        role: message.role,
        createdAt: message.createdAt,
        snippet: createConversationSnippet(message.content, keyword),
      });
    }
    if (results.length >= 30) return results;
  }
  return results;
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

let browserStockSdk: StockSDK | undefined;

function getBrowserStockSdk(): StockSDK {
  if (!browserStockSdk) {
    browserStockSdk = new StockSDK({ timeout: 12_000 });
  }
  return browserStockSdk;
}

function browserHotStockLoaders(): IHotStockHintLoaders {
  const sdk = getBrowserStockSdk();
  return {
    isTradingDay: (date) => sdk.calendar.isTradingDay(date),
    previousTradingDay: (date) => sdk.calendar.prevTradingDay(date),
    listCurrentHotFocus: async () => {
      const [changes, ztPool, sector] = await Promise.allSettled([
        sdk.marketEvent.stockChanges('all'),
        sdk.marketEvent.ztPool('zt'),
        sdk.fundFlow.sectorRank({ indicator: 'today' }),
      ]);
      const items: HotFocusItem[] = [];
      if (changes.status === 'fulfilled') {
        for (const item of changes.value) {
          if (item.code && item.name) {
            items.push({
              id: `browser-change-${item.code}-${item.time ?? 'latest'}`,
              title: `${item.name} ${item.code}`,
              code: item.code,
              name: item.name,
              description: item.changeTypeLabel,
              tag: item.changeTypeLabel,
              type: item.changeTypeLabel?.includes('卖') || item.changeTypeLabel?.includes('跌') ? 'plummet' : 'surge',
            });
          }
        }
      }
      if (ztPool.status === 'fulfilled') {
        for (const item of ztPool.value) {
          if (item.code && item.name && !items.some((existing) => existing.code === item.code)) {
            items.push({
              id: `browser-zt-${item.code}`,
              title: `${item.name} ${item.code}`,
              code: item.code,
              name: item.name,
              description: item.ztStatistics ?? '涨停',
              tag: '封涨停板',
              type: 'surge',
            });
          }
        }
      }
      if (sector.status === 'fulfilled' && sector.value.length) {
        for (const item of sector.value.slice(0, 10)) {
          if (item.topStockCode && item.topStockName && !items.some((existing) => existing.code === item.topStockCode)) {
            items.push({
              id: `browser-sector-${item.code}-${item.topStockCode}`,
              title: `${item.topStockName} ${item.topStockCode}`,
              code: item.topStockCode,
              name: item.topStockName,
              description: `领涨板块：${item.name}`,
              tag: item.name,
              type: 'surge',
            });
          }
        }
      }
      return items;
    },
    listPreviousSurge: async (date) => {
      const [ztPool, sector] = await Promise.allSettled([
        sdk.marketEvent.ztPool('zt', date),
        sdk.fundFlow.sectorRank({ indicator: 'today' }),
      ]);
      const items: HotFocusItem[] = [];
      if (ztPool.status === 'fulfilled') {
        for (const item of ztPool.value) {
          if (item.code && item.name) {
            items.push({
              id: `browser-prev-zt-${date}-${item.code}`,
              title: `${item.name} ${item.code}`,
              code: item.code,
              name: item.name,
              description: item.ztStatistics ?? '涨停',
              tag: '封涨停板',
              type: 'surge',
            });
          }
        }
      }
      if (sector.status === 'fulfilled' && sector.value.length) {
        for (const item of sector.value.slice(0, 10)) {
          if (item.topStockCode && item.topStockName && !items.some((existing) => existing.code === item.topStockCode)) {
            items.push({
              id: `browser-prev-sector-${date}-${item.code}-${item.topStockCode}`,
              title: `${item.topStockName} ${item.topStockCode}`,
              code: item.topStockCode,
              name: item.topStockName,
              description: `领涨板块：${item.name}`,
              tag: item.name,
              type: 'surge',
            });
          }
        }
      }
      return items;
    },
  };
}

const webFallbackApi: StocksenseApi = {
  async getConfig() {
    return readConfig();
  },
  async setConfig(config: AppConfig) {
    localStorage.setItem('stocksense-config', JSON.stringify(config));
    return config;
  },
  async getAppRuntimeInfo() {
    return {
      version: 'browser',
      electronVersion: '--',
      chromeVersion: '--',
      nodeVersion: '--',
    };
  },
  async openFeedbackEmail() {
    window.open(getFeedbackEmailUrl(), '_blank', 'noopener,noreferrer');
  },
  async testModelConfig() {
    throw new Error('浏览器预览模式不会连接本地大模型配置，请运行 Electron 桌面端后再测试。');
  },
  async testAiResponseNotification() {
    throw new Error('系统通知仅在 Electron 桌面端可用。');
  },
  async openSystemNotificationSettings() {
    throw new Error('系统通知设置仅在 Electron 桌面端可用。');
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
    return sortConversations(readConversations());
  },
  async createConversation() {
    const updatedAt = new Date().toISOString();
    const conversation: ConversationSummary = {
      id: `web-conv-${Date.now()}`,
      title: '新建会话',
      preview: '浏览器预览',
      date: '刚刚',
      updatedAt,
      tab: 'stock',
      count: 0,
    };
    writeConversations([conversation, ...readConversations()]);
    return conversation;
  },
  async deleteConversation(id: string) {
    const next = writeConversations(readConversations().filter((item) => item.id !== id));
    localStorage.removeItem(`stocksense-messages:${id}`);
    return next;
  },
  async renameConversation(id: string, title: string) {
    return writeConversations(
      readConversations().map((item) =>
        item.id === id ? { ...item, title: title.trim() || item.title, updatedAt: new Date().toISOString() } : item,
      ),
    );
  },
  async searchConversations(query: string) {
    return searchLocalConversations(query);
  },
  async listMessages(conversationId: string, options?: IConversationMessagesOptions) {
    return listLocalMessages(conversationId, options);
  },
  async saveMessage(conversationId: string, message: ChatMessage) {
    saveLocalMessage(conversationId, message);
  },
  async sendChat(request: ChatRequest): Promise<ChatResponse> {
    const command = request.message
      .trim()
      .match(/^\/(综合投研报告|新闻公告|技术面分析|基本面分析|资金面分析|消息面分析|筹码分布|筹码分析)\s*(.*)$/);
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
  async getBoardDashboard(range = 'today'): Promise<IBoardDashboardSnapshot> {
    const updatedAt = new Date().toISOString();
    return {
      range,
      tradeDate: updatedAt.slice(0, 10),
      updatedAt,
      summary: {},
      rankings: [],
      potential: [],
      hot: [],
      avoid: [],
      leaders: [],
      warnings: ['板块 Dashboard 仅在 Electron 桌面端可用'],
    };
  },
  async getKline(_symbol: string, _limit = 120, _period = '1d', _beforeTimestamp?: number) {
    return [];
  },
  async getChipDistribution(_symbol: string) {
    throw new Error('筹码分布仅在 Electron 桌面端可用。');
  },
  async getBatchQuotes(_codes: string[]) {
    return [];
  },
  async getStockTimelines(_codes: string[]) {
    return {};
  },
  async listMarketNews(_query = '', page = 1, pageSize = 30) {
    return pageItems([], page, pageSize);
  },
  async listStockNews() {
    throw new Error('个股快讯仅在 Electron 桌面端可用。');
  },
  async listStockNewsFeed() {
    throw new Error('个股新闻仅在 Electron 桌面端可用。');
  },
  async getStockNewsPreferences() {
    return readStockNewsPreferences();
  },
  async setStockNewsFavoritesOnly(favoritesOnly: boolean) {
    return writeStockNewsPreferences({ ...readStockNewsPreferences(), favoritesOnly });
  },
  async addStockNewsSubscription(stock) {
    const preferences = readStockNewsPreferences();
    if (readFavorites().some((item) => item.code === stock.code)) throw new Error('该股票已在收藏列表中，无需重复关注');
    if (preferences.manualStocks.some((item) => item.code === stock.code)) return preferences;
    if (preferences.manualStocks.length >= 12) throw new Error('手动关注的股票最多 12 只');
    return writeStockNewsPreferences({
      ...preferences,
      manualStocks: [{ code: stock.code, name: stock.name, createdAt: new Date().toISOString() }, ...preferences.manualStocks],
    });
  },
  async removeStockNewsSubscription(code: string) {
    const preferences = readStockNewsPreferences();
    return writeStockNewsPreferences({ ...preferences, manualStocks: preferences.manualStocks.filter((item) => item.code !== code) });
  },
  async getMarketNewsSummaryState() {
    throw new Error('AI 新闻总结仅在 Electron 桌面端可用。');
  },
  async getMarketNewsItem() {
    throw new Error('新闻详情仅在 Electron 桌面端可用。');
  },
  async listHotFocus(_tab: HotFocusTab) {
    return [];
  },
  async getHotStockHintSource(): Promise<IHotStockHintSource> {
    try {
      const loaders = browserHotStockLoaders();
      return await listHotStockHintSource(new Date(), loaders);
    } catch (error: unknown) {
      console.error('获取热点推荐失败', error);
      return { items: [], isPreviousTradeDay: false };
    }
  },
  async listSurgeHistoryDates() {
    return [];
  },
  async listSurgeHistory(_date: string, _offset = 0, _limit = 20) {
    return [];
  },
  async listStockSurgeEvents(_code: string) {
    return [];
  },
  async ensureMarketDataReady() {
    return;
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
  async getDragonTigerSnapshot(range = 'today') {
    const today = new Date().toISOString().slice(0, 10);
    return {
      range,
      summary: {
        tradeDate: today,
        startDate: today,
        endDate: today,
        totalCount: 0,
        netBuyAmount: 0,
        buyAmount: 0,
        sellAmount: 0,
        netBuyCount: 0,
        netSellCount: 0,
        dataSource: 'stock-sdk' as const,
        updatedAt: new Date().toISOString(),
      },
      topNetBuy: [],
      topNetSell: [],
      activeReasons: [],
      institutionTop: [],
      branchTop: [],
      rows: [],
      warnings: ['龙虎榜数据仅在 Electron 桌面端可用'],
    };
  },
  async getDiscoverySnapshot() {
    throw new Error('探索功能仅在 Electron 桌面端可用');
  },
  async getMonitorFeed() {
    throw new Error('AI 监控中心仅在 Electron 桌面端可用');
  },
  async getTradingAdvice() {
    throw new Error('AI 交易建议仅在 Electron 桌面端可用');
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
  onStorageClearProgress: undefined,
  async getStorageStats() {
    return { chat: { label: '聊天记录', bytes: 0 }, config: { label: '应用配置和收藏', bytes: 0 }, market: { label: '本地行情数据库', bytes: 0 }, surge: { label: '异动/热点历史', bytes: 0 }, monitor: { label: 'AI监控历史', bytes: 0 } };
  },
  async clearStorage(_keys: string[]) {
    throw new Error('存储空间管理仅在 Electron 桌面端可用');
  },
  async getDiskInfo() {
    return { totalBytes: 0, freeBytes: 0, usedByAppBytes: 0 };
  },
  async syncKlines() {
    return this.getMarketDataSyncStatus();
  },
  async syncSurgeHistory() {
    return;
  },
  async syncStockDetails() {
    return;
  },
  async syncMarketSnapshot() {
    return;
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
