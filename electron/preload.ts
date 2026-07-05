import { contextBridge, ipcRenderer } from 'electron';
import type { AppConfig, ChatRequest, StocksenseApi } from '../src/shared/types.js';

const api: StocksenseApi = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config: AppConfig) => ipcRenderer.invoke('config:set', config),
  listConversations: () => ipcRenderer.invoke('conversation:list'),
  createConversation: () => ipcRenderer.invoke('conversation:create'),
  deleteConversation: (id: string) => ipcRenderer.invoke('conversation:delete', id),
  sendChat: (request: ChatRequest) => ipcRenderer.invoke('chat:send', request),
  getStockDetail: (symbol: string) => ipcRenderer.invoke('stock:getDetail', symbol),
};

contextBridge.exposeInMainWorld('stocksense', api);
