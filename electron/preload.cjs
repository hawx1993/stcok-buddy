const { contextBridge, ipcRenderer } = require('electron');

const api = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config) => ipcRenderer.invoke('config:set', config),
  listConversations: () => ipcRenderer.invoke('conversation:list'),
  createConversation: () => ipcRenderer.invoke('conversation:create'),
  deleteConversation: (id) => ipcRenderer.invoke('conversation:delete', id),
  sendChat: (request) => ipcRenderer.invoke('chat:send', request),
  getStockDetail: (symbol) => ipcRenderer.invoke('stock:getDetail', symbol),
  listMarketNews: (query) => ipcRenderer.invoke('news:list', query),
};

contextBridge.exposeInMainWorld('stocksense', api);
