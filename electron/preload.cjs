"use strict";

// electron/preload.ts
var import_electron = require("electron");
var api = {
  captureAnalytics: (event, properties) => import_electron.ipcRenderer.invoke("analytics:capture", event, properties),
  getConfig: () => import_electron.ipcRenderer.invoke("config:get"),
  setConfig: (config) => import_electron.ipcRenderer.invoke("config:set", config),
  getAppRuntimeInfo: () => import_electron.ipcRenderer.invoke("app:getRuntimeInfo"),
  openFeedbackEmail: () => import_electron.ipcRenderer.invoke("app:openFeedbackEmail"),
  testModelConfig: (config) => import_electron.ipcRenderer.invoke("config:testModel", config),
  testAiResponseNotification: () => import_electron.ipcRenderer.invoke("notification:testAiResponse"),
  openSystemNotificationSettings: () => import_electron.ipcRenderer.invoke("notification:openSettings"),
  listFavoriteStocks: () => import_electron.ipcRenderer.invoke("favorite:list"),
  upsertFavoriteStock: (stock) => import_electron.ipcRenderer.invoke("favorite:upsert", stock),
  removeFavoriteStock: (code) => import_electron.ipcRenderer.invoke("favorite:remove", code),
  toggleFavoriteStockPin: (code) => import_electron.ipcRenderer.invoke("favorite:togglePin", code),
  onFavoritesCleared: (handler) => {
    const listener = () => handler();
    import_electron.ipcRenderer.on("favorite:cleared", listener);
    return () => import_electron.ipcRenderer.removeListener("favorite:cleared", listener);
  },
  listConversations: () => import_electron.ipcRenderer.invoke("conversation:list"),
  createConversation: () => import_electron.ipcRenderer.invoke("conversation:create"),
  deleteConversation: (id) => import_electron.ipcRenderer.invoke("conversation:delete", id),
  renameConversation: (id, title) => import_electron.ipcRenderer.invoke("conversation:rename", id, title),
  listMessages: (conversationId) => import_electron.ipcRenderer.invoke("message:list", conversationId),
  saveMessage: (conversationId, message) => import_electron.ipcRenderer.invoke("message:save", conversationId, message),
  sendChat: (request) => import_electron.ipcRenderer.invoke("chat:send", request),
  onChatToken: (handler) => {
    const listener = (_event, payload) => handler(payload);
    import_electron.ipcRenderer.on("chat:token", listener);
    return () => import_electron.ipcRenderer.removeListener("chat:token", listener);
  },
  onAiResponseNotification: (handler) => {
    const listener = (_event, payload) => handler(payload);
    import_electron.ipcRenderer.on("notification:aiResponse", listener);
    return () => import_electron.ipcRenderer.removeListener("notification:aiResponse", listener);
  },
  getStockDetail: (symbol) => import_electron.ipcRenderer.invoke("stock:getDetail", symbol),
  searchStocks: (query) => import_electron.ipcRenderer.invoke("stock:search", query),
  getBoardDetail: (symbol, forceRefresh, boardName) => import_electron.ipcRenderer.invoke("board:getDetail", symbol, forceRefresh, boardName),
  getKline: (symbol, limit, period, beforeTimestamp) => import_electron.ipcRenderer.invoke("stock:getKline", symbol, limit, period, beforeTimestamp),
  getChipDistribution: (symbol) => import_electron.ipcRenderer.invoke("stock:getChipDistribution", symbol),
  getBatchQuotes: (codes) => import_electron.ipcRenderer.invoke("stock:getBatchQuotes", codes),
  listMarketNews: (query, page, pageSize) => import_electron.ipcRenderer.invoke("news:list", query, page, pageSize),
  listStockNews: (code, limit) => import_electron.ipcRenderer.invoke("news:stockList", code, limit),
  listStockNewsFeed: () => import_electron.ipcRenderer.invoke("news:stockFeed"),
  getStockNewsPreferences: () => import_electron.ipcRenderer.invoke("news:stockPreferences"),
  setStockNewsFavoritesOnly: (favoritesOnly) => import_electron.ipcRenderer.invoke("news:setFavoritesOnly", favoritesOnly),
  addStockNewsSubscription: (stock) => import_electron.ipcRenderer.invoke("news:addStockSubscription", stock),
  removeStockNewsSubscription: (code) => import_electron.ipcRenderer.invoke("news:removeStockSubscription", code),
  getMarketNewsSummaryState: () => import_electron.ipcRenderer.invoke("news:getSummary"),
  getMarketNewsItem: (item) => import_electron.ipcRenderer.invoke("news:getDetail", item),
  listHotFocus: (tab) => import_electron.ipcRenderer.invoke("hot:list", tab),
  getHotStockHintSource: () => import_electron.ipcRenderer.invoke("hot:hintSource"),
  listSurgeHistoryDates: () => import_electron.ipcRenderer.invoke("hot:historyDates"),
  listSurgeHistory: (date, offset, limit) => import_electron.ipcRenderer.invoke("hot:history", date, offset, limit),
  listStockSurgeEvents: (code) => import_electron.ipcRenderer.invoke("stock:surgeEvents", code),
  getMarketDataSyncStatus: () => import_electron.ipcRenderer.invoke("marketData:getStatus"),
  startMarketDataSync: () => import_electron.ipcRenderer.invoke("marketData:startSync"),
  retryMarketDataFailures: () => import_electron.ipcRenderer.invoke("marketData:retryFailures"),
  cancelMarketDataSync: () => import_electron.ipcRenderer.invoke("marketData:cancelSync"),
  getMarketDataStats: () => import_electron.ipcRenderer.invoke("marketData:getStats"),
  getMarketPageSnapshot: (tab, period) => import_electron.ipcRenderer.invoke("market:getPageSnapshot", tab, period),
  getDiscoverySnapshot: () => import_electron.ipcRenderer.invoke("discovery:getSnapshot"),
  getMonitorFeed: (options) => import_electron.ipcRenderer.invoke("monitor:getFeed", options),
  onMarketPageSnapshotUpdated: (handler) => {
    const listener = (_event, snapshot) => handler(snapshot);
    import_electron.ipcRenderer.on("market:pageSnapshotUpdated", listener);
    return () => import_electron.ipcRenderer.removeListener("market:pageSnapshotUpdated", listener);
  },
  onMarketDataProgress: (handler) => {
    const listener = (_event, status) => handler(status);
    import_electron.ipcRenderer.on("marketData:progress", listener);
    return () => import_electron.ipcRenderer.removeListener("marketData:progress", listener);
  },
  listStoreItems: () => import_electron.ipcRenderer.invoke("store:list"),
  listInstalledStoreItems: () => import_electron.ipcRenderer.invoke("store:installed"),
  installStoreItem: (id) => import_electron.ipcRenderer.invoke("store:install", id),
  uninstallStoreItem: (id) => import_electron.ipcRenderer.invoke("store:uninstall", id),
  getAppUpdateState: () => import_electron.ipcRenderer.invoke("appUpdate:getState"),
  checkAppUpdate: (settings) => import_electron.ipcRenderer.invoke("appUpdate:check", settings),
  downloadAppUpdate: (settings) => import_electron.ipcRenderer.invoke("appUpdate:download", settings),
  installAppUpdate: () => import_electron.ipcRenderer.invoke("appUpdate:install"),
  openAppReleaseNotes: () => import_electron.ipcRenderer.invoke("appUpdate:openReleaseNotes"),
  selectAppUpdateDownloadDirectory: () => import_electron.ipcRenderer.invoke("appUpdate:selectDownloadDirectory"),
  getStorageStats: () => import_electron.ipcRenderer.invoke("storage:getStats"),
  clearStorage: (keys) => import_electron.ipcRenderer.invoke("storage:clear", keys),
  onStorageClearProgress: (handler) => {
    const listener = (_event, progress) => handler(progress);
    import_electron.ipcRenderer.on("storage:clearProgress", listener);
    return () => import_electron.ipcRenderer.removeListener("storage:clearProgress", listener);
  },
  getDiskInfo: () => import_electron.ipcRenderer.invoke("system:getDiskInfo"),
  onAppUpdateStateChanged: (handler) => {
    const listener = (_event, state) => handler(state);
    import_electron.ipcRenderer.on("appUpdate:stateChanged", listener);
    return () => import_electron.ipcRenderer.removeListener("appUpdate:stateChanged", listener);
  },
  syncKlines: () => import_electron.ipcRenderer.invoke("dataSync:syncKlines"),
  syncSurgeHistory: () => import_electron.ipcRenderer.invoke("dataSync:syncSurgeHistory"),
  syncStockDetails: () => import_electron.ipcRenderer.invoke("dataSync:syncStockDetails"),
  syncMarketSnapshot: () => import_electron.ipcRenderer.invoke("dataSync:syncSnapshot"),
  onDataSyncProgress: (handler) => {
    const listener = (_event, progress) => handler(progress);
    import_electron.ipcRenderer.on("dataSync:taskProgress", listener);
    return () => import_electron.ipcRenderer.removeListener("dataSync:taskProgress", listener);
  }
};
import_electron.contextBridge.exposeInMainWorld("stocksense", api);
