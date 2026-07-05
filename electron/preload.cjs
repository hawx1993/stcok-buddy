const { contextBridge, ipcRenderer } = require('electron');

const api = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config) => ipcRenderer.invoke('config:set', config),
  listConversations: () => ipcRenderer.invoke('conversation:list'),
  createConversation: () => ipcRenderer.invoke('conversation:create'),
  deleteConversation: (id) => ipcRenderer.invoke('conversation:delete', id),
  listMessages: (conversationId) => ipcRenderer.invoke('message:list', conversationId),
  saveMessage: (conversationId, message) => ipcRenderer.invoke('message:save', conversationId, message),
  sendChat: (request) => ipcRenderer.invoke('chat:send', request),
  getStockDetail: (symbol) => ipcRenderer.invoke('stock:getDetail', symbol),
  getBoardDetail: (symbol) => ipcRenderer.invoke('board:getDetail', symbol),
  getKline: (symbol, limit) => ipcRenderer.invoke('stock:getKline', symbol, limit),
  listMarketNews: (query, page, pageSize) => ipcRenderer.invoke('news:list', query, page, pageSize),
  listHotFocus: (tab) => ipcRenderer.invoke('hot:list', tab),
};

contextBridge.exposeInMainWorld('stocksense', api);
