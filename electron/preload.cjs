const { contextBridge, ipcRenderer } = require('electron');

const api = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config) => ipcRenderer.invoke('config:set', config),
  testModelConfig: (config) => ipcRenderer.invoke('config:testModel', config),
  listFavoriteStocks: () => ipcRenderer.invoke('favorite:list'),
  upsertFavoriteStock: (stock) => ipcRenderer.invoke('favorite:upsert', stock),
  removeFavoriteStock: (code) => ipcRenderer.invoke('favorite:remove', code),
  toggleFavoriteStockPin: (code) => ipcRenderer.invoke('favorite:togglePin', code),
  listConversations: () => ipcRenderer.invoke('conversation:list'),
  createConversation: () => ipcRenderer.invoke('conversation:create'),
  deleteConversation: (id) => ipcRenderer.invoke('conversation:delete', id),
  renameConversation: (id, title) => ipcRenderer.invoke('conversation:rename', id, title),
  listMessages: (conversationId) => ipcRenderer.invoke('message:list', conversationId),
  saveMessage: (conversationId, message) => ipcRenderer.invoke('message:save', conversationId, message),
  sendChat: (request) => ipcRenderer.invoke('chat:send', request),
  onChatToken: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('chat:token', listener);
    return () => ipcRenderer.removeListener('chat:token', listener);
  },
  getStockDetail: (symbol) => ipcRenderer.invoke('stock:getDetail', symbol),
  searchStocks: (query) => ipcRenderer.invoke('stock:search', query),
  getBoardDetail: (symbol, forceRefresh, boardName) => ipcRenderer.invoke('board:getDetail', symbol, forceRefresh, boardName),
  getKline: (symbol, limit, period, beforeTimestamp) => ipcRenderer.invoke('stock:getKline', symbol, limit, period, beforeTimestamp),
  listMarketNews: (query, page, pageSize) => ipcRenderer.invoke('news:list', query, page, pageSize),
  listHotFocus: (tab) => ipcRenderer.invoke('hot:list', tab),
  listSurgeHistoryDates: () => ipcRenderer.invoke('hot:historyDates'),
  listSurgeHistory: (date, offset, limit) => ipcRenderer.invoke('hot:history', date, offset, limit),
  getMarketDataSyncStatus: () => ipcRenderer.invoke('marketData:getStatus'),
  startMarketDataSync: () => ipcRenderer.invoke('marketData:startSync'),
  retryMarketDataFailures: () => ipcRenderer.invoke('marketData:retryFailures'),
  cancelMarketDataSync: () => ipcRenderer.invoke('marketData:cancelSync'),
  getMarketDataStats: () => ipcRenderer.invoke('marketData:getStats'),
  getMarketPageSnapshot: (tab, period) => ipcRenderer.invoke('market:getPageSnapshot', tab, period),
  onMarketPageSnapshotUpdated: (handler) => {
    const listener = (_event, snapshot) => handler(snapshot);
    ipcRenderer.on('market:pageSnapshotUpdated', listener);
    return () => ipcRenderer.removeListener('market:pageSnapshotUpdated', listener);
  },
  onMarketDataProgress: (handler) => {
    const listener = (_event, status) => handler(status);
    ipcRenderer.on('marketData:progress', listener);
    return () => ipcRenderer.removeListener('marketData:progress', listener);
  },
  listStoreItems: () => ipcRenderer.invoke('store:list'),
  listInstalledStoreItems: () => ipcRenderer.invoke('store:installed'),
  installStoreItem: (id) => ipcRenderer.invoke('store:install', id),
  uninstallStoreItem: (id) => ipcRenderer.invoke('store:uninstall', id),
  getAppUpdateState: () => ipcRenderer.invoke('appUpdate:getState'),
  checkAppUpdate: (settings) => ipcRenderer.invoke('appUpdate:check', settings),
  downloadAppUpdate: (settings) => ipcRenderer.invoke('appUpdate:download', settings),
  installAppUpdate: () => ipcRenderer.invoke('appUpdate:install'),
  openAppReleaseNotes: () => ipcRenderer.invoke('appUpdate:openReleaseNotes'),
  selectAppUpdateDownloadDirectory: () => ipcRenderer.invoke('appUpdate:selectDownloadDirectory'),
  onAppUpdateStateChanged: (handler) => {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on('appUpdate:stateChanged', listener);
    return () => ipcRenderer.removeListener('appUpdate:stateChanged', listener);
  },
};

contextBridge.exposeInMainWorld('stocksense', api);
