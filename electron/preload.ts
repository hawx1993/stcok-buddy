import { contextBridge, ipcRenderer } from 'electron';
import type { AppConfig, ChatMessage, ChatRequest, ChatStreamEvent, FavoriteStock, HotFocusTab, StocksenseApi } from '../src/shared/types.js';

const api: StocksenseApi = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config: AppConfig) => ipcRenderer.invoke('config:set', config),
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
  getBoardDetail: (symbol: string) => ipcRenderer.invoke('board:getDetail', symbol),
  getKline: (symbol: string, limit?: number, period?: string) => ipcRenderer.invoke('stock:getKline', symbol, limit, period),
  listMarketNews: (query?: string, page?: number, pageSize?: number) => ipcRenderer.invoke('news:list', query, page, pageSize),
  listHotFocus: (tab: HotFocusTab) => ipcRenderer.invoke('hot:list', tab),
};

contextBridge.exposeInMainWorld('stocksense', api);
