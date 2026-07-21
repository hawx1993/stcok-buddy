import { contextBridge, ipcRenderer } from 'electron';
import type { AnalyticsProperties, AppConfig, ChatMessage, ChatRequest, ChatStreamEvent, FavoriteStock, HotFocusTab, IAppUpdateSettings, IAppUpdateState, MarketDataSyncStatus, MarketIndexPeriod, MarketPageSnapshot, MarketTab, StocksenseApi } from '../src/shared/types.js';

const api: StocksenseApi = {
  captureAnalytics: (event: string, properties?: AnalyticsProperties) => ipcRenderer.invoke('analytics:capture', event, properties),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config: AppConfig) => ipcRenderer.invoke('config:set', config),
  testModelConfig: (config) => ipcRenderer.invoke('config:testModel', config),
  listFavoriteStocks: () => ipcRenderer.invoke('favorite:list'),
  upsertFavoriteStock: (stock: Pick<FavoriteStock, 'code' | 'name'>) => ipcRenderer.invoke('favorite:upsert', stock),
  removeFavoriteStock: (code: string) => ipcRenderer.invoke('favorite:remove', code),
  toggleFavoriteStockPin: (code: string) => ipcRenderer.invoke('favorite:togglePin', code),
  listConversations: () => ipcRenderer.invoke('conversation:list'),
  createConversation: () => ipcRenderer.invoke('conversation:create'),
  deleteConversation: (id: string) => ipcRenderer.invoke('conversation:delete', id),
  renameConversation: (id: string, title: string) => ipcRenderer.invoke('conversation:rename', id, title),
  listMessages: (conversationId: string) => ipcRenderer.invoke('message:list', conversationId),
  saveMessage: (conversationId: string, message: ChatMessage) => ipcRenderer.invoke('message:save', conversationId, message),
  sendChat: (request: ChatRequest) => ipcRenderer.invoke('chat:send', request),
  onChatToken: (handler: (event: ChatStreamEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ChatStreamEvent) => handler(payload);
    ipcRenderer.on('chat:token', listener);
    return () => ipcRenderer.removeListener('chat:token', listener);
  },
  getStockDetail: (symbol: string) => ipcRenderer.invoke('stock:getDetail', symbol),
  searchStocks: (query: string) => ipcRenderer.invoke('stock:search', query),
  getBoardDetail: (symbol: string, forceRefresh?: boolean, boardName?: string) => ipcRenderer.invoke('board:getDetail', symbol, forceRefresh, boardName),
  getKline: (symbol: string, limit?: number, period?: string, beforeTimestamp?: number) => ipcRenderer.invoke('stock:getKline', symbol, limit, period, beforeTimestamp),
  getBatchQuotes: (codes: string[]) => ipcRenderer.invoke('stock:getBatchQuotes', codes),
  listMarketNews: (query?: string, page?: number, pageSize?: number) => ipcRenderer.invoke('news:list', query, page, pageSize),
  listHotFocus: (tab: HotFocusTab) => ipcRenderer.invoke('hot:list', tab),
  listSurgeHistoryDates: () => ipcRenderer.invoke('hot:historyDates'),
  listSurgeHistory: (date: string, offset?: number, limit?: number) => ipcRenderer.invoke('hot:history', date, offset, limit),
  listStockSurgeEvents: (code: string) => ipcRenderer.invoke('stock:surgeEvents', code),
  getMarketDataSyncStatus: () => ipcRenderer.invoke('marketData:getStatus'),
  startMarketDataSync: () => ipcRenderer.invoke('marketData:startSync'),
  retryMarketDataFailures: () => ipcRenderer.invoke('marketData:retryFailures'),
  cancelMarketDataSync: () => ipcRenderer.invoke('marketData:cancelSync'),
  getMarketDataStats: () => ipcRenderer.invoke('marketData:getStats'),
  getMarketPageSnapshot: (tab: MarketTab, period?: MarketIndexPeriod) => ipcRenderer.invoke('market:getPageSnapshot', tab, period),
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
  onAppUpdateStateChanged: (handler: (state: IAppUpdateState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: IAppUpdateState) => handler(state);
    ipcRenderer.on('appUpdate:stateChanged', listener);
    return () => ipcRenderer.removeListener('appUpdate:stateChanged', listener);
  },
};

contextBridge.exposeInMainWorld('stocksense', api);
