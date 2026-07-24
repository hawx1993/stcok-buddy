import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { AnalyticsProperties, AppConfig, ChatMessage, ChatRequest, FavoriteStock, HotFocusTab, IAppUpdateSettings, MarketIndexPeriod, MarketTab } from '../src/shared/types.js';
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
import { getMarketDataStats, getMarketDataSyncStatus, onMarketDataProgress, requestMarketDataSyncStop, retryMarketDataFailures, startMarketDataSync } from './services/market-data/market-data-sync.js';
import { runOrchestrator } from './services/agent/orchestrator.js';
import { getBatchQuotes, getBoardDetail, getKline, getMarketPageSnapshot, getStockDetail, listHotFocus, listStockSurgeEvents, onMarketPageSnapshotUpdated, searchStocks } from './services/stock/stock-client.js';
import { listSurgeHistoryWithBackfill } from './services/stock/surge-history-service.js';
import { listSurgeDates } from './services/stock/surge-history-store.js';
import { ensureSurgeHistoryCapture } from './services/stock/surge-history-scheduler.js';
import { listMarketNews } from './services/stock/news-client.js';
import { installStoreItem, listInstalledStoreItems, listStoreItems, uninstallStoreItem } from './services/store-service.js';
import { captureError, captureEvent } from './services/llm/posthog-client.js';
import { testModelConnection } from './services/llm/index.js';
import { notifyAiResponseCompleted, notifyAiResponseTest } from './services/desktop-notification.js';
import {
  checkAppUpdate,
  downloadAppUpdate,
  getAppUpdateState,
  installAppUpdate,
  onAppUpdateStateChanged,
  openAppReleaseNotes,
} from './services/update-service.js';

export function registerIpcHandlers() {
  ipcMain.handle('analytics:capture', (_event, event: string, properties?: AnalyticsProperties) => captureEvent(event, properties));
  ipcMain.handle('config:get', () => getConfig());
  ipcMain.handle('config:set', (_event, config: AppConfig) => setConfig(config));
  ipcMain.handle('config:testModel', (_event, config: AppConfig) => testModelConnection(config.model));
  ipcMain.handle('notification:testAiResponse', () => notifyAiResponseTest());
  ipcMain.handle('notification:openSettings', async () => {
    if (process.platform === 'darwin') {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.notifications');
      return;
    }
    if (process.platform === 'win32') {
      await shell.openExternal('ms-settings:notifications');
      return;
    }
    throw new Error('请在操作系统设置中手动允许 StockBuddy 发送通知。');
  });
  ipcMain.handle('favorite:list', () => listFavoriteStocks());
  ipcMain.handle('favorite:upsert', (_event, stock: Pick<FavoriteStock, 'code' | 'name'>) => {
    const result = upsertFavoriteStock(stock);
    captureEvent('stock_favorited', { code: stock.code, name: stock.name });
    return result;
  });
  ipcMain.handle('favorite:remove', (_event, code: string) => {
    const removed = listFavoriteStocks().find((item) => item.code === code);
    const result = removeFavoriteStock(code);
    captureEvent('stock_unfavorited', { code, name: removed?.name });
    return result;
  });
  ipcMain.handle('favorite:togglePin', (_event, code: string) => {
    const result = toggleFavoriteStockPin(code);
    captureEvent('stock_favorite_pin_toggled', { code });
    return result;
  });
  ipcMain.handle('conversation:list', () => listConversations());
  ipcMain.handle('conversation:create', () => createConversation());
  ipcMain.handle('conversation:delete', (_event, id: string) => deleteConversation(id));
  ipcMain.handle('conversation:rename', (_event, id: string, title: string) => renameConversation(id, title));
  ipcMain.handle('message:list', (_event, conversationId: string) => listMessages(conversationId));
  ipcMain.handle('message:save', (_event, conversationId: string, message: ChatMessage) => saveMessage(conversationId, message));
  ipcMain.handle('stock:getDetail', (_event, symbol: string) => getStockDetail(symbol));
  ipcMain.handle('stock:search', async (_event, query: string) => {
    const startedAt = Date.now();
    const result = await searchStocks(query);
    captureEvent('stock_searched', {
      query_type: /^\d{6}$/.test(query.trim()) ? 'code' : query.trim() ? 'text' : 'empty',
      query_length: query.trim().length,
      code: /^\d{6}$/.test(query.trim()) ? query.trim() : undefined,
      result_count: result.length,
      duration_ms: Date.now() - startedAt,
    });
    return result;
  });
  ipcMain.handle('board:getDetail', (_event, symbol: string, forceRefresh?: boolean, boardName?: string) => getBoardDetail(symbol, forceRefresh, boardName));
  ipcMain.handle('stock:getKline', (_event, symbol: string, limit?: number, period?: string, beforeTimestamp?: number) => getKline(symbol, limit, period, beforeTimestamp));
  ipcMain.handle('stock:getBatchQuotes', (_event, codes: string[]) => getBatchQuotes(codes));
  ipcMain.handle('market:getPageSnapshot', (_event, tab: MarketTab, period?: MarketIndexPeriod) => getMarketPageSnapshot(tab, period));
  const removeMarketPageListener = onMarketPageSnapshotUpdated((snapshot) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('market:pageSnapshotUpdated', snapshot);
  });
  app.once('before-quit', removeMarketPageListener);
  ipcMain.handle('hot:list', async (_event, tab: HotFocusTab) => {
    if (tab === 'surge') ensureSurgeHistoryCapture();
    return listHotFocus(tab);
  });
  ipcMain.handle('hot:historyDates', () => {
    ensureSurgeHistoryCapture();
    return listSurgeDates();
  });
  ipcMain.handle('hot:history', (_event, date: string, offset?: number, limit?: number) => {
    ensureSurgeHistoryCapture();
    return listSurgeHistoryWithBackfill(date, offset, limit);
  });
  ipcMain.handle('stock:surgeEvents', (_event, code: string) => {
    ensureSurgeHistoryCapture();
    return listStockSurgeEvents(code);
  });
  ipcMain.handle('marketData:getStatus', () => getMarketDataSyncStatus());
  ipcMain.handle('marketData:startSync', () => startMarketDataSync(true));
  ipcMain.handle('marketData:retryFailures', () => retryMarketDataFailures());
  ipcMain.handle('marketData:cancelSync', () => requestMarketDataSyncStop());
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
  ipcMain.handle('appUpdate:getState', () => getAppUpdateState());
  ipcMain.handle('appUpdate:check', (_event, settings?: IAppUpdateSettings) => checkAppUpdate({ settings }));
  ipcMain.handle('appUpdate:download', (_event, settings?: IAppUpdateSettings) => downloadAppUpdate(settings));
  ipcMain.handle('appUpdate:install', () => installAppUpdate());
  ipcMain.handle('appUpdate:openReleaseNotes', () => openAppReleaseNotes());
  ipcMain.handle('appUpdate:selectDownloadDirectory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? undefined : result.filePaths[0];
  });
  const removeAppUpdateListener = onAppUpdateStateChanged((state) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('appUpdate:stateChanged', state);
  });
  app.once('before-quit', removeAppUpdateListener);
  ipcMain.handle('chat:send', async (event, request: ChatRequest) => {
    const startedAt = Date.now();
    const command = request.message.trim().startsWith('/') ? request.message.trim().split(/\s+/, 1)[0] : undefined;
    captureEvent('chat_sent', { command, message_length: request.message.length, has_stock_code: /\d{6}/.test(request.message) });
    try {
      saveUserMessage(request.conversationId, request.message);
      const response = await runOrchestrator(request, (token) => {
        if (request.requestId) event.sender.send('chat:token', { requestId: request.requestId, token });
      }, (runEvent) => {
        if (request.requestId) event.sender.send('chat:token', { requestId: request.requestId, runEvent });
      });
      const processedSeconds = Math.max(0.1, (Date.now() - startedAt) / 1000);
      response.message.processedSeconds = processedSeconds;
      saveAssistantMessage(request.conversationId, response.message);
      if (getConfig().notifyOnAiResponse) notifyAiResponseCompleted(response.message.content);
      captureEvent('chat_completed', {
        command,
        duration_ms: Date.now() - startedAt,
        tool_call_count: response.message.toolCalls?.length ?? 0,
        event_count: response.events.length,
      });
      return response;
    } catch (error) {
      captureError('chat_failed', error, { command, duration_ms: Date.now() - startedAt });
      throw error;
    }
  });
}
