const { contextBridge, ipcRenderer } = require('electron');

const api = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config) => ipcRenderer.invoke('config:set', config),
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
  getBoardDetail: (symbol) => ipcRenderer.invoke('board:getDetail', symbol),
  getKline: (symbol, limit, period) => ipcRenderer.invoke('stock:getKline', symbol, limit, period),
  listMarketNews: (query, page, pageSize) => ipcRenderer.invoke('news:list', query, page, pageSize),
  listHotFocus: (tab) => ipcRenderer.invoke('hot:list', tab),
  listStoreItems: () => ipcRenderer.invoke('store:list'),
  listInstalledStoreItems: () => ipcRenderer.invoke('store:installed'),
  installStoreItem: (id) => ipcRenderer.invoke('store:install', id),
  uninstallStoreItem: (id) => ipcRenderer.invoke('store:uninstall', id),
};

contextBridge.exposeInMainWorld('stocksense', api);
