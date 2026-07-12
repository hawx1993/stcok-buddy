import { app, BrowserWindow, ipcMain } from 'electron';
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
import { getMarketDataStats, getMarketDataSyncStatus, onMarketDataProgress, retryMarketDataFailures, startMarketDataSync } from './services/market-data/market-data-sync.js';
import { runOrchestrator } from './services/agent/orchestrator.js';
import { getBoardDetail, getKline, getStockDetail, listHotFocus } from './services/stock/stock-client.js';
import { listSurgeHistoryWithBackfill } from './services/stock/surge-history-service.js';
import { listSurgeDates, saveSurgeSnapshot } from './services/stock/surge-history-store.js';
import { listMarketNews } from './services/stock/news-client.js';
import { installStoreItem, listInstalledStoreItems, listStoreItems, uninstallStoreItem } from './services/store-service.js';

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
  ipcMain.handle('hot:list', async (_event, tab: HotFocusTab) => {
    const items = await listHotFocus(tab);
    if (tab === 'surge' && items.length) void saveSurgeSnapshot(items).catch(console.error);
    return items;
  });
  ipcMain.handle('hot:historyDates', () => listSurgeDates());
  ipcMain.handle('hot:history', (_event, date: string, offset?: number, limit?: number) => listSurgeHistoryWithBackfill(date, offset, limit));
  ipcMain.handle('marketData:getStatus', () => getMarketDataSyncStatus());
  ipcMain.handle('marketData:startSync', () => startMarketDataSync(true));
  ipcMain.handle('marketData:retryFailures', () => retryMarketDataFailures());
  ipcMain.handle('marketData:getStats', () => getMarketDataStats());
  const removeMarketDataListener = onMarketDataProgress((status) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('marketData:progress', status);
  });
  app.once('before-quit', removeMarketDataListener);
  ipcMain.handle('news:list', (_event, query?: string, page?: number, pageSize?: number) => listMarketNews(query, page, pageSize));
  ipcMain.handle('store:list', () => listStoreItems());
  ipcMain.handle('store:installed', () => listInstalledStoreItems());
  ipcMain.handle('store:install', (_event, id: string) => installStoreItem(id));
  ipcMain.handle('store:uninstall', (_event, id: string) => uninstallStoreItem(id));
  ipcMain.handle('chat:send', async (event, request: ChatRequest) => {
    saveUserMessage(request.conversationId, request.message);
    const response = await runOrchestrator(request, (token) => {
      if (request.requestId) event.sender.send('chat:token', { requestId: request.requestId, token });
    }, (runEvent) => {
      if (request.requestId) event.sender.send('chat:token', { requestId: request.requestId, runEvent });
    });
    saveAssistantMessage(request.conversationId, response.message);
    return response;
  });
}
