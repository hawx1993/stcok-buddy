import type {
  AppConfig,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ConversationSummary,
  FavoriteStock,
  StockDetail,
  BoardDetail,
  StocksenseApi,
  HotFocusItem,
  HotFocusTab,
  MarketNewsItem,
  PagedMarketNews,
  StoreItem,
} from './types.js';

const defaultConfig: AppConfig = {
  theme: 'dark',
  marketColorMode: 'red-up-green-down',
  model: {
    provider: 'deepseek',
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    customModel: '',
  },
  tradeStyle: 'value',
  riskProfile: 'moderate',
  holdingPeriod: 'medium',
};

const defaultConversations: ConversationSummary[] = [
  { id: 'web-conv-1', title: '浏览器预览会话', preview: 'PWA / Browser preview', date: '刚刚', tab: 'stock', count: 0 },
];

const fallbackNews: MarketNewsItem[] = [
  { id: 'fallback-1', time: '10:45', title: '白酒板块持续走强，茅台五粮液领涨，中秋动销数据超预期', tags: ['白酒', '消费'], tagType: 'positive' },
  { id: 'fallback-2', time: '10:32', title: '央行宣布降准0.25个百分点，释放长期资金约5000亿元', tags: ['宏观', '政策'], tagType: 'impact' },
  { id: 'fallback-3', time: '10:18', title: '半导体板块拉升，北方华创涨超8%，大基金三期布局加速', tags: ['半导体', '科技'], tagType: 'positive' },
  { id: 'fallback-4', time: '09:56', title: '宁德时代跌超5%，欧盟电动车关税落地短期承压', tags: ['新能源', '利空'], tagType: 'impact' },
  { id: 'fallback-5', time: '09:42', title: '北向资金半日净买入20.9亿，重点加仓白酒和银行板块', tags: ['资金', '北向'], tagType: 'positive' },
];

const stockMap: Record<string, StockDetail> = {
  '600519': { code: '600519', name: '贵州茅台', exchange: '沪市', price: 1548, change: '+13.20', changePercent: '+0.86%', pe: 27.8, pb: 8.6, marketCap: '1.94万亿', turnover: '95.2亿', rating: { fundamental: '优质', valuation: '中性', tech: '中性偏多', risk: '低' }, summary: '高端白酒龙头。浏览器/PWA 预览模式使用本地示例数据；Electron 模式会通过 stock-sdk 获取实时数据。' },
  '000858': { code: '000858', name: '五粮液', exchange: '深市', price: 140.2, change: '+2.93', changePercent: '+2.13%', pe: 21.4, pb: 5.2, marketCap: '5440亿', turnover: '28.6亿', rating: { fundamental: '优质', valuation: '偏低', tech: '中性偏多', risk: '低' }, summary: '浓香白酒龙头。浏览器/PWA 预览模式使用本地示例数据；Electron 模式会通过 stock-sdk 获取实时数据。' },
  '300750': { code: '300750', name: '宁德时代', exchange: '深市', price: 222, change: '-13.37', changePercent: '-5.68%', pe: 18.5, pb: 4.2, marketCap: '9760亿', turnover: '68.5亿', rating: { fundamental: '优质', valuation: '合理', tech: '偏空', risk: '中等' }, summary: '动力电池龙头。浏览器/PWA 预览模式使用本地示例数据；Electron 模式会通过 stock-sdk 获取实时数据。' },
  '600036': { code: '600036', name: '招商银行', exchange: '沪市', price: 32.45, change: '+0.23', changePercent: '+0.72%', pe: 5.6, pb: 0.72, marketCap: '8180亿', turnover: '18.2亿', rating: { fundamental: '良好', valuation: '偏低', tech: '中性', risk: '低' }, summary: '零售银行标杆。浏览器/PWA 预览模式使用本地示例数据；Electron 模式会通过 stock-sdk 获取实时数据。' },
};

export function getStocksenseApi(): StocksenseApi {
  if (!window.stocksense) return webFallbackApi;
  return {
    ...webFallbackApi,
    ...window.stocksense,
    listFavoriteStocks: () => window.stocksense!.listFavoriteStocks().catch(fallbackFavoriteError(() => webFallbackApi.listFavoriteStocks())),
    upsertFavoriteStock: (stock) => window.stocksense!.upsertFavoriteStock(stock).catch(fallbackFavoriteError(() => webFallbackApi.upsertFavoriteStock(stock))),
    removeFavoriteStock: (code) => window.stocksense!.removeFavoriteStock(code).catch(fallbackFavoriteError(() => webFallbackApi.removeFavoriteStock(code))),
    toggleFavoriteStockPin: (code) => window.stocksense!.toggleFavoriteStockPin(code).catch(fallbackFavoriteError(() => webFallbackApi.toggleFavoriteStockPin(code))),
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
  const paths = ['/store/commands/dragon-tiger/index.json', '/store/commands/industry-rotation/index.json'];
  const items = await Promise.all(paths.map(async (path) => {
    const response = await fetch(path).catch(() => undefined);
    return response?.ok ? await response.json() as StoreItem : undefined;
  }));
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
  return [...items].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.createdAt.localeCompare(a.createdAt));
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
  localStorage.setItem(`stocksense-messages:${conversationId}`, JSON.stringify([...readMessages(conversationId), message]));
}

function pageItems<T>(items: T[], page = 1, pageSize = 30): PagedMarketNews {
  const start = (Math.max(1, page) - 1) * pageSize;
  return { items: items.slice(start, start + pageSize) as MarketNewsItem[], total: items.length, page, pageSize };
}

const fallbackHot: HotFocusItem[] = [
  { id: 'preview-hot-1', title: '浏览器预览数据', description: 'Electron 桌面端会通过 stock-sdk 拉取实时热点。', tag: 'Preview', type: 'neutral' },
];

const webFallbackApi: StocksenseApi = {
  async getConfig() {
    return readConfig();
  },
  async setConfig(config: AppConfig) {
    localStorage.setItem('stocksense-config', JSON.stringify(config));
    return config;
  },
  async listFavoriteStocks() {
    return readFavorites();
  },
  async upsertFavoriteStock(stock: Pick<FavoriteStock, 'code' | 'name'>) {
    const favorites = readFavorites();
    const existing = favorites.find((item) => item.code === stock.code);
    return writeFavorites(existing
      ? favorites.map((item) => (item.code === stock.code ? { ...item, name: stock.name || item.name } : item))
      : [{ ...stock, pinned: false, createdAt: new Date().toISOString() }, ...favorites]);
  },
  async removeFavoriteStock(code: string) {
    return writeFavorites(readFavorites().filter((item) => item.code !== code));
  },
  async toggleFavoriteStockPin(code: string) {
    return writeFavorites(readFavorites().map((item) => (item.code === code ? { ...item, pinned: !item.pinned } : item)));
  },
  async listConversations() {
    return readConversations();
  },
  async createConversation() {
    const conversation: ConversationSummary = { id: `web-conv-${Date.now()}`, title: '新建会话', preview: '浏览器预览', date: '刚刚', tab: 'stock', count: 0 };
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
    const next = readConversations().map((item) => (item.id === id ? { ...item, title: title.trim() || item.title } : item));
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
    const command = request.message.trim().match(/^\/(综合投研报告|新闻公告|技术面分析|基本面分析|资金面分析|情绪面分析|龙虎榜分析)\s*(.*)$/);
    const reportTarget = command?.[2].trim();
    if (command && reportTarget === '') return webMessage(request, `请输入股票代码或股票名称，例如：/${command[1]} 中公教育`);
    const stock = findStock(reportTarget ?? request.message);
    const content = stock
      ? `浏览器/PWA 预览模式已识别 ${stock.name}（${stock.code}），将按「${command?.[1] ?? '综合投研'}」生成预览报告。若要使用 stock-sdk 实时数据与本地安全 API Key，请运行 Electron 桌面端。\n\n以上内容基于公开数据自动生成，仅供研究参考，不构成投资建议。`
      : '浏览器/PWA 预览模式可体验 UI、主题、动效和本地配置。实时 stock-sdk 数据与本机 API Key 存储在 Electron 桌面端中启用。';
    const message: ChatMessage = {
      id: `web-assistant-${Date.now()}`,
      role: 'assistant',
      content,
      createdAt: new Date().toISOString(),
      steps: [
        { id: 'web-mode', agent: 'PWA', description: '浏览器环境未检测到 Electron preload，启用 Web fallback API', status: 'completed' },
        { id: 'local-preview', agent: 'PreviewAgent', description: stock ? `匹配本地示例股票 ${stock.name}` : '返回本地预览说明', status: 'completed' },
      ],
      result: stock
        ? {
            title: `${stock.name}（${stock.code}）预览行情`,
            subtitle: `${stock.exchange ?? 'A股'} · ${stock.changePercent ?? '--'}`,
            metrics: [
              { label: '现价', value: String(stock.price ?? '--') },
              { label: '涨跌幅', value: stock.changePercent ?? '--', tone: stock.changePercent?.startsWith('-') ? 'down' : 'up' },
              { label: 'PE', value: String(stock.pe ?? '--') },
              { label: '成交额', value: stock.turnover ?? '--' },
            ],
            narrative: stock.summary,
            chart: { type: 'kline', data: makePreviewKline(stock.code, 60) },
            stocks: [stock],
          }
        : undefined,
    };
    saveLocalMessage(request.conversationId, { id: `web-user-${Date.now()}`, role: 'user', content: request.message, createdAt: new Date().toISOString() });
    saveLocalMessage(request.conversationId, message);
    return { message, events: [{ type: 'final_answer', message: content, stock }] };
  },
  async getStockDetail(symbol: string) {
    return findStock(symbol) ?? { code: symbol, name: symbol, summary: '浏览器/PWA 预览模式暂无该股票示例数据。' };
  },
  async getBoardDetail(symbol: string): Promise<BoardDetail> {
    return {
      code: symbol,
      name: symbol,
      constituents: [stockMap['600519'], stockMap['000858'], stockMap['600036']].map((stock) => ({
        code: stock.code,
        name: stock.name,
        price: stock.price,
        changePercent: stock.changePercent,
        turnover: stock.turnover,
      })),
    };
  },
  async getKline(symbol: string, limit = 120, period = '1d') {
    return makePreviewKline(symbol, limit, period);
  },
  async listMarketNews(query = '', page = 1, pageSize = 30) {
    const q = query.trim();
    const items = q ? fallbackNews.filter((item) => item.title.includes(q) || item.tags.some((tag) => tag.includes(q))) : fallbackNews;
    return pageItems(items, page, pageSize);
  },
  async listHotFocus(_tab: HotFocusTab) {
    return fallbackHot;
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
};

function webMessage(request: ChatRequest, content: string): ChatResponse {
  const message: ChatMessage = { id: `web-assistant-${Date.now()}`, role: 'assistant', content, createdAt: new Date().toISOString() };
  saveLocalMessage(request.conversationId, { id: `web-user-${Date.now()}`, role: 'user', content: request.message, createdAt: new Date().toISOString() });
  saveLocalMessage(request.conversationId, message);
  return { message, events: [{ type: 'final_answer', message: content }] };
}

function makePreviewKline(symbol: string, limit = 120, period = '1d') {
  const base = Number(findStock(symbol)?.price) || 100;
  const step = ({ '15m': 1, '1h': 2, '4h': 3, '1d': 4, '1w': 9, '1mo': 18 } as Record<string, number>)[period] ?? 4;
  let price = base;
  return Array.from({ length: limit }, (_, index) => {
    const wave = Math.sin((index * step) / 4) * base * 0.008 * Math.sqrt(step);
    const open = price;
    const close = Math.max(1, open + wave);
    price = close;
    return { timestamp: Date.now() + (index - limit) * 86_400_000, time: String(index + 1), open, close, high: Math.max(open, close) * 1.006, low: Math.min(open, close) * 0.994, volume: 10000 + index * 100 * step };
  });
}

function findStock(input: string): StockDetail | undefined {
  const code = input.match(/\b\d{6}\b/)?.[0];
  if (code && stockMap[code]) return stockMap[code];
  return Object.values(stockMap).find((stock) => input.includes(stock.name));
}
