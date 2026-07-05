import { ipcMain } from 'electron';
import type { AppConfig, ChatMessage, ChatRequest, HotFocusTab } from '../src/shared/types.js';
import { getConfig, setConfig } from './services/configStore.js';
import {
  createConversation,
  deleteConversation,
  listConversations,
  listMessages,
  saveAssistantMessage,
  saveMessage,
  saveUserMessage,
} from './services/conversationStore.js';
import { runOrchestrator } from './services/agent/orchestrator.js';
import { getBoardDetail, getKline, getStockDetail, listHotFocus } from './services/stock/stockClient.js';
import { listMarketNews } from './services/stock/newsClient.js';

export function registerIpcHandlers() {
  ipcMain.handle('config:get', () => getConfig());
  ipcMain.handle('config:set', (_event, config: AppConfig) => setConfig(config));
  ipcMain.handle('conversation:list', () => listConversations());
  ipcMain.handle('conversation:create', () => createConversation());
  ipcMain.handle('conversation:delete', (_event, id: string) => deleteConversation(id));
  ipcMain.handle('message:list', (_event, conversationId: string) => listMessages(conversationId));
  ipcMain.handle('message:save', (_event, conversationId: string, message: ChatMessage) => saveMessage(conversationId, message));
  ipcMain.handle('stock:getDetail', (_event, symbol: string) => getStockDetail(symbol));
  ipcMain.handle('board:getDetail', (_event, symbol: string) => getBoardDetail(symbol));
  ipcMain.handle('stock:getKline', (_event, symbol: string, limit?: number) => getKline(symbol, limit));
  ipcMain.handle('hot:list', (_event, tab: HotFocusTab) => listHotFocus(tab));
  ipcMain.handle('news:list', (_event, query?: string, page?: number, pageSize?: number) => listMarketNews(query, page, pageSize));
  ipcMain.handle('chat:send', async (_event, request: ChatRequest) => {
    saveUserMessage(request.conversationId, request.message);
    const response = await runOrchestrator(request);
    saveAssistantMessage(request.conversationId, response.message);
    return response;
  });
}
