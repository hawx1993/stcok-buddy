import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { statSync, statfsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type {
  AnalyticsProperties,
  AppConfig,
  ChatMessage,
  ChatRequest,
  FavoriteStock,
  HotFocusTab,
  IAppUpdateSettings,
  IDiskInfo,
  IStorageStats,
  MarketIndexPeriod,
  MarketNewsItem,
  MarketTab,
} from '../src/shared/types.js';
import {
  addStockNewsSubscription,
  defaultConfig,
  getConfig,
  getStockNewsPreferences,
  listFavoriteStocks,
  removeFavoriteStock,
  removeStockNewsSubscription,
  setConfig,
  setStockNewsFavoritesOnly,
  store,
  toggleFavoriteStockPin,
  upsertFavoriteStock,
} from './services/config-store.js';
import {
  closeConversationStore,
  createConversation,
  deleteConversation,
  listConversations,
  listMessages,
  renameConversation,
  saveAssistantMessage,
  saveMessage,
  saveUserMessage,
} from './services/conversation-store.js';
import {
  getMarketDataStats,
  getMarketDataSyncStatus,
  onMarketDataProgress,
  requestMarketDataSyncStop,
  retryMarketDataFailures,
  startMarketDataSync,
} from './services/market-data/market-data-sync.js';
import { runOrchestrator } from './services/agent/orchestrator.js';
import {
  getBatchQuotes,
  getBoardDetail,
  getChipDistribution,
  getKline,
  getMarketPageSnapshot,
  getStockDetail,
  listHotFocus,
  listStockSurgeEvents,
  onMarketPageSnapshotUpdated,
  searchStocks,
} from './services/stock/stock-client.js';
import { listHotStockHintSource } from './services/stock/hot-stock-hints-service.js';
import { listSurgeHistoryWithBackfill } from './services/stock/surge-history-service.js';
import { listSurgeDates } from './services/stock/surge-history-store.js';
import { ensureSurgeHistoryCapture } from './services/stock/surge-history-scheduler.js';
import {
  ensureMarketNewsSummaryState,
  getMarketNewsDetail,
  listMarketNews,
  listStockNewsAnnouncements,
  listStockNewsFeed,
} from './services/stock/news-client.js';
import {
  installStoreItem,
  listInstalledStoreItems,
  listStoreItems,
  uninstallStoreItem,
} from './services/store-service.js';
import { closeQuoteStore, flushQuoteRows, initializeQuoteStore } from './services/stock/quote-store.js';
import { closeSurgeHistoryStore } from './services/stock/surge-history-store.js';
import { closeMarketDataStore, getMarketDataDatabasePath, initializeMarketDataStore } from './services/market-data/market-data-store.js';
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

const feedbackEmailRecipient = 'trigkit@163.com';
const feedbackEmailSubject = 'StockBuddy 问题反馈';
const feedbackEmailBody = `请填写以下信息，方便我们定位问题：

1. 问题描述：
2. 复现步骤：
3. 预期结果：
4. 实际结果：
5. 操作系统：
6. StockBuddy 版本：

请尽量附上截图/录屏或相关图片附件，帮助我们更快定位问题。`;

function getFeedbackEmailUrl() {
  const subject = encodeURIComponent(feedbackEmailSubject);
  const body = encodeURIComponent(feedbackEmailBody);
  return `mailto:${feedbackEmailRecipient}?subject=${subject}&body=${body}`;
}

export function registerIpcHandlers() {
  ipcMain.handle('analytics:capture', (_event, event: string, properties?: AnalyticsProperties) =>
    captureEvent(event, properties),
  );
  ipcMain.handle('config:get', () => getConfig());
  ipcMain.handle('config:set', (_event, config: AppConfig) => setConfig(config));
  ipcMain.handle('app:getRuntimeInfo', () => ({
    version: app.getVersion(),
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
  }));
  ipcMain.handle('app:openFeedbackEmail', () => shell.openExternal(getFeedbackEmailUrl()));
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
  ipcMain.handle('message:save', (_event, conversationId: string, message: ChatMessage) =>
    saveMessage(conversationId, message),
  );
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
  ipcMain.handle('board:getDetail', (_event, symbol: string, forceRefresh?: boolean, boardName?: string) =>
    getBoardDetail(symbol, forceRefresh, boardName),
  );
  ipcMain.handle(
    'stock:getKline',
    (_event, symbol: string, limit?: number, period?: string, beforeTimestamp?: number) =>
      getKline(symbol, limit, period, beforeTimestamp),
  );
  ipcMain.handle('stock:getChipDistribution', (_event, symbol: string) => getChipDistribution(symbol));
  ipcMain.handle('stock:getBatchQuotes', (_event, codes: string[]) => getBatchQuotes(codes));
  ipcMain.handle('market:getPageSnapshot', (_event, tab: MarketTab, period?: MarketIndexPeriod) =>
    getMarketPageSnapshot(tab, period),
  );
  const removeMarketPageListener = onMarketPageSnapshotUpdated((snapshot) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('market:pageSnapshotUpdated', snapshot);
  });
  app.once('before-quit', removeMarketPageListener);
  ipcMain.handle('hot:list', async (_event, tab: HotFocusTab) => {
    if (tab === 'surge') ensureSurgeHistoryCapture();
    return listHotFocus(tab);
  });
  ipcMain.handle('hot:hintSource', () => listHotStockHintSource());
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
  ipcMain.handle('news:list', (_event, query?: string, page?: number, pageSize?: number) =>
    listMarketNews(query, page, pageSize),
  );
  ipcMain.handle('news:stockList', async (_event, code: string, limit = 10) => {
    if (!/^\d{6}$/.test(code)) throw new Error('股票代码无效');
    const safeLimit = Math.min(10, Math.max(1, Number.isFinite(limit) ? Math.trunc(limit) : 10));
    const { news } = await listStockNewsAnnouncements(code, safeLimit);
    return news.slice(0, safeLimit);
  });
  ipcMain.handle('news:stockFeed', () => listStockNewsFeed());
  ipcMain.handle('news:stockPreferences', () => getStockNewsPreferences());
  ipcMain.handle('news:setFavoritesOnly', (_event, favoritesOnly: boolean) => {
    if (typeof favoritesOnly !== 'boolean') throw new Error('仅收藏开关参数无效');
    return setStockNewsFavoritesOnly(favoritesOnly);
  });
  ipcMain.handle('news:addStockSubscription', (_event, stock: Pick<FavoriteStock, 'code' | 'name'>) =>
    addStockNewsSubscription(stock),
  );
  ipcMain.handle('news:removeStockSubscription', (_event, code: string) => removeStockNewsSubscription(code));
  ipcMain.handle('news:getSummary', () => ensureMarketNewsSummaryState());
  ipcMain.handle(
    'news:getDetail',
    async (_event, item: Pick<MarketNewsItem, 'id' | 'title' | 'source' | 'time' | 'url' | 'content'>) => {
      if (!/^em-\d+-|^stock-news-\d{6}-/.test(item.id)) throw new Error('新闻标识无效');
      return getMarketNewsDetail(item);
    },
  );
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

  // ── storage space management ──
  ipcMain.handle('storage:getStats', () => getStorageStats());
  ipcMain.handle('storage:clear', (_event, keys: string[]) => clearStorages(keys));
  ipcMain.handle('system:getDiskInfo', () => getDiskInfo());

  ipcMain.handle('chat:send', async (event, request: ChatRequest) => {
    const startedAt = Date.now();
    const command = request.message.trim().startsWith('/') ? request.message.trim().split(/\s+/, 1)[0] : undefined;
    captureEvent('chat_sent', {
      command,
      message_length: request.message.length,
      has_stock_code: /\d{6}/.test(request.message),
    });
    try {
      saveUserMessage(request.conversationId, request.message);
      const response = await runOrchestrator(
        request,
        (token) => {
          if (request.requestId) event.sender.send('chat:token', { requestId: request.requestId, token });
        },
        (runEvent) => {
          if (request.requestId) event.sender.send('chat:token', { requestId: request.requestId, runEvent });
        },
      );
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

// ── storage: helpers ──

function fileSize(filePath: string) {
  try { return statSync(filePath).size; } catch { return 0; }
}

function userDataDir() {
  return app.getPath('userData');
}

function getStorageStats(): IStorageStats {
  const chatPath = path.join(userDataDir(), 'stocksense-chat.sqlite');
  const quotesSqlite = app.isPackaged ? 'stocksense-quotes.sqlite' : 'stocksense-quotes-dev.sqlite';
  const quotesPath = path.join(userDataDir(), quotesSqlite);
  const configPath = path.join(userDataDir(), 'stocksense-store.json');
  const surgeDb = app.isPackaged ? 'stocksense-surge.duckdb' : 'stocksense-surge-dev.duckdb';
  const surgePath = path.join(userDataDir(), surgeDb);
  const marketPath = getMarketDataDatabasePath();

  return {
    chat:     { label: '聊天记录',    bytes: fileSize(chatPath) },
    config:   { label: '应用配置和收藏', bytes: fileSize(configPath) },
    quotes:   { label: '最新行情缓存',  bytes: fileSize(quotesPath) },
    market:   { label: '本地行情数据库', bytes: fileSize(marketPath) },
    surge:    { label: '异动/热点历史', bytes: fileSize(surgePath) },
  };
}

function getDiskInfo(): IDiskInfo {
  const stats = getStorageStats();
  const usedByAppBytes = stats.chat.bytes + stats.config.bytes + stats.quotes.bytes + stats.market.bytes + stats.surge.bytes;
  let totalBytes = 0;
  let freeBytes = 0;
  try {
    const s = statfsSync(userDataDir());
    totalBytes = Number(s.blocks) * Number(s.bsize);
    freeBytes = Number(s.bavail > 0 ? s.bavail : s.bfree) * Number(s.bsize);
  } catch { /* fall back to zeros if statfs not available */ }
  return { totalBytes, freeBytes, usedByAppBytes };
}

async function clearStorages(keys: string[]) {
  for (const key of keys) {
    switch (key) {
      case 'chat':
        closeConversationStore();
        try { unlinkSync(path.join(userDataDir(), 'stocksense-chat.sqlite')); } catch { /* file may not exist */ }
        break;
      case 'config':
        store.clear();
        store.set({
          config: defaultConfig,
          favoriteStocks: [],
          installedStoreItems: [],
          stockNewsPreferences: { favoritesOnly: false, manualStocks: [] },
          deviceId: store.get('deviceId', ''),
        });
        break;
      case 'quotes':
        flushQuoteRows();
        closeQuoteStore();
        const quotesName = app.isPackaged ? 'stocksense-quotes.sqlite' : 'stocksense-quotes-dev.sqlite';
        try { unlinkSync(path.join(userDataDir(), quotesName)); } catch { /* file may not exist */ }
        break;
      case 'market':
        await closeMarketDataStore();
        try { unlinkSync(getMarketDataDatabasePath()); } catch { /* file may not exist */ }
        break;
      case 'surge':
        await closeSurgeHistoryStore();
        const surgeName = app.isPackaged ? 'stocksense-surge.duckdb' : 'stocksense-surge-dev.duckdb';
        try { unlinkSync(path.join(userDataDir(), surgeName)); } catch { /* file may not exist */ }
        break;
    }
  }
  return getStorageStats();
}
