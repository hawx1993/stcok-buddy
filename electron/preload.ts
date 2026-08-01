import { contextBridge, ipcRenderer } from 'electron';
import type {
  AnalyticsProperties,
  AppConfig,
  ChatMessage,
  ChatRequest,
  ChatStreamEvent,
  FavoriteStock,
  HotFocusTab,
  IAppUpdateSettings,
  IAppUpdateState,
  IDataSyncTaskProgress,
  IStorageClearProgress,
  MarketDataSyncStatus,
  MarketIndexPeriod,
  MarketPageSnapshot,
  MarketTab,
  StocksenseApi,
  TDragonTigerRange,
} from '../src/shared/types.js';

const api: StocksenseApi = {
  captureAnalytics: (event: string, properties?: AnalyticsProperties) =>
    ipcRenderer.invoke('analytics:capture', event, properties),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config: AppConfig) => ipcRenderer.invoke('config:set', config),
  getAppRuntimeInfo: () => ipcRenderer.invoke('app:getRuntimeInfo'),
  openFeedbackEmail: () => ipcRenderer.invoke('app:openFeedbackEmail'),
  testModelConfig: (config) => ipcRenderer.invoke('config:testModel', config),
  testAiResponseNotification: () => ipcRenderer.invoke('notification:testAiResponse'),
  openSystemNotificationSettings: () => ipcRenderer.invoke('notification:openSettings'),
  listFavoriteStocks: () => ipcRenderer.invoke('favorite:list'),
  upsertFavoriteStock: (stock: Pick<FavoriteStock, 'code' | 'name'>) => ipcRenderer.invoke('favorite:upsert', stock),
  removeFavoriteStock: (code: string) => ipcRenderer.invoke('favorite:remove', code),
  toggleFavoriteStockPin: (code: string) => ipcRenderer.invoke('favorite:togglePin', code),
  onFavoritesCleared: (handler: () => void) => {
    const listener = () => handler();
    ipcRenderer.on('favorite:cleared', listener);
    return () => ipcRenderer.removeListener('favorite:cleared', listener);
  },
  listConversations: () => ipcRenderer.invoke('conversation:list'),
  createConversation: () => ipcRenderer.invoke('conversation:create'),
  deleteConversation: (id: string) => ipcRenderer.invoke('conversation:delete', id),
  renameConversation: (id: string, title: string) => ipcRenderer.invoke('conversation:rename', id, title),
  listMessages: (conversationId: string) => ipcRenderer.invoke('message:list', conversationId),
  saveMessage: (conversationId: string, message: ChatMessage) =>
    ipcRenderer.invoke('message:save', conversationId, message),
  sendChat: (request: ChatRequest) => ipcRenderer.invoke('chat:send', request),
  onChatToken: (handler: (event: ChatStreamEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ChatStreamEvent) => handler(payload);
    ipcRenderer.on('chat:token', listener);
    return () => ipcRenderer.removeListener('chat:token', listener);
  },
  onAiResponseNotification: (handler: (payload: { title: string; body: string; source: 'system' | 'in-app' }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { title: string; body: string; source: 'system' | 'in-app' }) => handler(payload);
    ipcRenderer.on('notification:aiResponse', listener);
    return () => ipcRenderer.removeListener('notification:aiResponse', listener);
  },
  getStockDetail: (symbol: string) => ipcRenderer.invoke('stock:getDetail', symbol),
  searchStocks: (query: string) => ipcRenderer.invoke('stock:search', query),
  getBoardDetail: (symbol: string, forceRefresh?: boolean, boardName?: string) =>
    ipcRenderer.invoke('board:getDetail', symbol, forceRefresh, boardName),
  getBoardDashboard: (range, forceRefresh) => ipcRenderer.invoke('board:getDashboard', range, forceRefresh),
  getKline: (symbol: string, limit?: number, period?: string, beforeTimestamp?: number) =>
    ipcRenderer.invoke('stock:getKline', symbol, limit, period, beforeTimestamp),
  getChipDistribution: (symbol: string) => ipcRenderer.invoke('stock:getChipDistribution', symbol),
  getBatchQuotes: (codes: string[]) => ipcRenderer.invoke('stock:getBatchQuotes', codes),
  getStockTimelines: (codes: string[]) => ipcRenderer.invoke('stock:getTimelines', codes),
  listMarketNews: (query?: string, page?: number, pageSize?: number) =>
    ipcRenderer.invoke('news:list', query, page, pageSize),
  listStockNews: (code: string, limit?: number) => ipcRenderer.invoke('news:stockList', code, limit),
  listStockNewsFeed: () => ipcRenderer.invoke('news:stockFeed'),
  getStockNewsPreferences: () => ipcRenderer.invoke('news:stockPreferences'),
  setStockNewsFavoritesOnly: (favoritesOnly: boolean) => ipcRenderer.invoke('news:setFavoritesOnly', favoritesOnly),
  addStockNewsSubscription: (stock: Pick<FavoriteStock, 'code' | 'name'>) =>
    ipcRenderer.invoke('news:addStockSubscription', stock),
  removeStockNewsSubscription: (code: string) => ipcRenderer.invoke('news:removeStockSubscription', code),
  getMarketNewsSummaryState: () => ipcRenderer.invoke('news:getSummary'),
  getMarketNewsItem: (item) => ipcRenderer.invoke('news:getDetail', item),
  listHotFocus: (tab: HotFocusTab) => ipcRenderer.invoke('hot:list', tab),
  getHotStockHintSource: () => ipcRenderer.invoke('hot:hintSource'),
  listSurgeHistoryDates: () => ipcRenderer.invoke('hot:historyDates'),
  listSurgeHistory: (date: string, offset?: number, limit?: number) =>
    ipcRenderer.invoke('hot:history', date, offset, limit),
  listStockSurgeEvents: (code: string) => ipcRenderer.invoke('stock:surgeEvents', code),
  getMarketDataSyncStatus: () => ipcRenderer.invoke('marketData:getStatus'),
  startMarketDataSync: () => ipcRenderer.invoke('marketData:startSync'),
  retryMarketDataFailures: () => ipcRenderer.invoke('marketData:retryFailures'),
  cancelMarketDataSync: () => ipcRenderer.invoke('marketData:cancelSync'),
  getMarketDataStats: () => ipcRenderer.invoke('marketData:getStats'),
  getMarketPageSnapshot: (tab: MarketTab, period?: MarketIndexPeriod) =>
    ipcRenderer.invoke('market:getPageSnapshot', tab, period),
  getDragonTigerSnapshot: (range?: TDragonTigerRange) => ipcRenderer.invoke('dragonTiger:getSnapshot', range),
  getDiscoverySnapshot: (options?: Parameters<StocksenseApi['getDiscoverySnapshot']>[0]) =>
    ipcRenderer.invoke('discovery:getSnapshot', options),
  getMonitorFeed: (options?: Parameters<StocksenseApi['getMonitorFeed']>[0]) => ipcRenderer.invoke('monitor:getFeed', options),
  getTradingAdvice: (options?: Parameters<StocksenseApi['getTradingAdvice']>[0]) => ipcRenderer.invoke('trading-advice:get', options),
  onMarketPageSnapshotUpdated: (handler: (snapshot: MarketPageSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: MarketPageSnapshot) => handler(snapshot);
    ipcRenderer.on('market:pageSnapshotUpdated', listener);
    return () => ipcRenderer.removeListener('market:pageSnapshotUpdated', listener);
  },
  onMarketDataProgress: (handler: (status: MarketDataSyncStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: MarketDataSyncStatus) => handler(status);
    ipcRenderer.on('marketData:progress', listener);
    return () => ipcRenderer.removeListener('marketData:progress', listener);
  },
  listStoreItems: () => ipcRenderer.invoke('store:list'),
  listInstalledStoreItems: () => ipcRenderer.invoke('store:installed'),
  installStoreItem: (id: string) => ipcRenderer.invoke('store:install', id),
  uninstallStoreItem: (id: string) => ipcRenderer.invoke('store:uninstall', id),
  getAppUpdateState: () => ipcRenderer.invoke('appUpdate:getState'),
  checkAppUpdate: (settings?: IAppUpdateSettings) => ipcRenderer.invoke('appUpdate:check', settings),
  downloadAppUpdate: (settings?: IAppUpdateSettings) => ipcRenderer.invoke('appUpdate:download', settings),
  installAppUpdate: () => ipcRenderer.invoke('appUpdate:install'),
  openAppReleaseNotes: () => ipcRenderer.invoke('appUpdate:openReleaseNotes'),
  selectAppUpdateDownloadDirectory: () => ipcRenderer.invoke('appUpdate:selectDownloadDirectory'),
  getStorageStats: () => ipcRenderer.invoke('storage:getStats'),
  clearStorage: (keys: string[]) => ipcRenderer.invoke('storage:clear', keys),
  onStorageClearProgress: (handler: (progress: IStorageClearProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: IStorageClearProgress) => handler(progress);
    ipcRenderer.on('storage:clearProgress', listener);
    return () => ipcRenderer.removeListener('storage:clearProgress', listener);
  },
  getDiskInfo: () => ipcRenderer.invoke('system:getDiskInfo'),
  onAppUpdateStateChanged: (handler: (state: IAppUpdateState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: IAppUpdateState) => handler(state);
    ipcRenderer.on('appUpdate:stateChanged', listener);
    return () => ipcRenderer.removeListener('appUpdate:stateChanged', listener);
  },
  syncKlines: () => ipcRenderer.invoke('dataSync:syncKlines'),
  syncSurgeHistory: () => ipcRenderer.invoke('dataSync:syncSurgeHistory'),
  syncStockDetails: () => ipcRenderer.invoke('dataSync:syncStockDetails'),
  syncMarketSnapshot: () => ipcRenderer.invoke('dataSync:syncSnapshot'),
  onDataSyncProgress: (handler: (progress: IDataSyncTaskProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: IDataSyncTaskProgress) => handler(progress);
    ipcRenderer.on('dataSync:taskProgress', listener);
    return () => ipcRenderer.removeListener('dataSync:taskProgress', listener);
  },
};

contextBridge.exposeInMainWorld('stocksense', api);
