import { contextBridge, ipcRenderer } from 'electron';
import type { AppConfig, ChatMessage, ChatRequest, HotFocusTab, StocksenseApi } from '../src/shared/types.js';

const api: StocksenseApi = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config: AppConfig) => ipcRenderer.invoke('config:set', config),
  listConversations: () => ipcRenderer.invoke('conversation:list'),
  createConversation: () => ipcRenderer.invoke('conversation:create'),
  deleteConversation: (id: string) => ipcRenderer.invoke('conversation:delete', id),
  listMessages: (conversationId: string) => ipcRenderer.invoke('message:list', conversationId),
  saveMessage: (conversationId: string, message: ChatMessage) => ipcRenderer.invoke('message:save', conversationId, message),
  sendChat: (request: ChatRequest) => ipcRenderer.invoke('chat:send', request),
  getStockDetail: (symbol: string) => ipcRenderer.invoke('stock:getDetail', symbol),
  getKline: (symbol: string, limit?: number) => ipcRenderer.invoke('stock:getKline', symbol, limit),
  listMarketNews: (query?: string, page?: number, pageSize?: number) => ipcRenderer.invoke('news:list', query, page, pageSize),
  listHotFocus: (tab: HotFocusTab) => ipcRenderer.invoke('hot:list', tab),
};

contextBridge.exposeInMainWorld('stocksense', api);
