import { ipcMain } from 'electron';
import type { AppConfig, ChatMessage, ChatRequest, FavoriteStock, HotFocusTab } from '../src/shared/types.js';
import {
  getConfig,
  listFavoriteStocks,
  removeFavoriteStock,
  setConfig,
  toggleFavoriteStockPin,
  upsertFavoriteStock,
} from './services/config-store.js';
import {
  createConversation,
  deleteConversation,
  listConversations,
  listMessages,
  renameConversation,
  saveAssistantMessage,
  saveMessage,
  saveUserMessage,
} from './services/conversation-store.js';
import { runOrchestrator } from './services/agent/orchestrator.js';
import { getBoardDetail, getKline, getStockDetail, listHotFocus } from './services/stock/stock-client.js';
import { listMarketNews } from './services/stock/news-client.js';

export function registerIpcHandlers() {
  ipcMain.handle('config:get', () => getConfig());
  ipcMain.handle('config:set', (_event, config: AppConfig) => setConfig(config));
  ipcMain.handle('favorite:list', () => listFavoriteStocks());
  ipcMain.handle('favorite:upsert', (_event, stock: Pick<FavoriteStock, 'code' | 'name'>) => upsertFavoriteStock(stock));
  ipcMain.handle('favorite:remove', (_event, code: string) => removeFavoriteStock(code));
  ipcMain.handle('favorite:togglePin', (_event, code: string) => toggleFavoriteStockPin(code));
  ipcMain.handle('conversation:list', () => listConversations());
  ipcMain.handle('conversation:create', () => createConversation());
  ipcMain.handle('conversation:delete', (_event, id: string) => deleteConversation(id));
  ipcMain.handle('conversation:rename', (_event, id: string, title: string) => renameConversation(id, title));
  ipcMain.handle('message:list', (_event, conversationId: string) => listMessages(conversationId));
  ipcMain.handle('message:save', (_event, conversationId: string, message: ChatMessage) => saveMessage(conversationId, message));
  ipcMain.handle('stock:getDetail', (_event, symbol: string) => getStockDetail(symbol));
  ipcMain.handle('board:getDetail', (_event, symbol: string) => getBoardDetail(symbol));
  ipcMain.handle('stock:getKline', (_event, symbol: string, limit?: number, period?: string) => getKline(symbol, limit, period));
  ipcMain.handle('hot:list', (_event, tab: HotFocusTab) => listHotFocus(tab));
  ipcMain.handle('news:list', (_event, query?: string, page?: number, pageSize?: number) => listMarketNews(query, page, pageSize));
  ipcMain.handle('chat:send', async (event, request: ChatRequest) => {
    saveUserMessage(request.conversationId, request.message);
    const response = await runOrchestrator(request, (token) => {
      if (request.requestId) event.sender.send('chat:token', { requestId: request.requestId, token });
    });
    saveAssistantMessage(request.conversationId, response.message);
    return response;
  });
}
