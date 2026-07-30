import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { existsSync, statSync, statfsSync, truncateSync, unlinkSync } from 'node:fs';
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
  waitForMarketDataSync,
} from './services/market-data/market-data-sync.js';
import { syncSurgeHistory, syncStockDetails, syncMarketSnapshot } from './services/market-data/data-sync-handlers.js';
import { runOrchestrator } from './services/agent/orchestrator.js';
import {
  clearSurgeCache,
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
import { getDiscoverySnapshot } from './services/stock/discovery-service.js';
import { getMonitorFeed } from './services/stock/monitor-service.js';
import { getTradingAdvice } from './services/stock/trading-advice-service.js';
import { listHotStockHintSource } from './services/stock/hot-stock-hints-service.js';
import { listSurgeHistoryWithBackfill } from './services/stock/surge-history-service.js';
import { closeSurgeHistoryInstance, listSurgeDates } from './services/stock/surge-history-store.js';
import { ensureSurgeHistoryCapture, stopSurgeHistoryScheduler } from './services/stock/surge-history-scheduler.js';
import { stopMonitorHistoryScheduler } from './services/stock/monitor-history-scheduler.js';
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
import { closeSurgeHistoryStore, resetSurgeHistoryStore } from './services/stock/surge-history-store.js';
import { closeMonitorHistoryInstance, closeMonitorHistoryStore, resetMonitorHistoryStore } from './services/stock/monitor-history-store.js';
import {
  closeMarketDataStore,
  getMarketDataDatabasePath,
  initializeMarketDataStore,
  resetMarketDataStore,
} from './services/market-data/market-data-store.js';
import { captureError, captureEvent } from './services/llm/posthog-client.js';
import { testModelConnection } from './services/llm/index.js';
import {
  getNotificationState,
  isAppFocused,
  notifyAiResponseCompleted,
  notifyAiResponseTest,
  summarizeResponse as summarizeForNotification,
} from './services/desktop-notification.js';
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
  ipcMain.handle('discovery:getSnapshot', () => getDiscoverySnapshot());
  ipcMain.handle('monitor:getFeed', (_event, options?: Parameters<typeof getMonitorFeed>[0]) => getMonitorFeed(options));
  ipcMain.handle('trading-advice:get', () => getTradingAdvice());
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
  // Data sync handlers
  ipcMain.handle('dataSync:syncKlines', async () => {
    // ponytail: if a sync is already running (e.g. started by the scheduler),
    // ask it to stop at its next checkpoint so the user's explicit force-sync
    // can take over. startMarketDataSync(true) then waits for the old run to
    // finish before kicking off a fresh force run — we no longer race a fixed
    // 1500ms sleep that could return the stale promise and leave the UI at 0%.
    if ((await getMarketDataSyncStatus()).state !== 'idle') {
      requestMarketDataSyncStop();
      await waitForMarketDataSync();
    }
    return startMarketDataSync(true);
  });
  ipcMain.handle('dataSync:syncSurgeHistory', () => syncSurgeHistory());
  ipcMain.handle('dataSync:syncStockDetails', () => syncStockDetails());
  ipcMain.handle('dataSync:syncSnapshot', () => syncMarketSnapshot());
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
  ipcMain.handle('storage:clear', async (event, keys: string[]) => {
    const total = keys.length;
    let done = 0;
    for (const key of keys) {
      const startTime = Date.now();
      // ponytail: start with a small non-zero fraction so the progress bar
      // is visible immediately. Starting at fraction=0 renders a 0%-width
      // fill that's invisible, making the user think "no progress bar".
      event.sender.send('storage:clearProgress', {
        key,
        processed: done,
        total,
        fraction: 0.05,
        message: `正在清空 ${storageLabel(key)}…`,
      });

      // Pulse fraction upward while the async clear runs, so single-key clears
      // don't sit at 0% for 30s then jump to 100%.
      const pulseTimer = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        const fraction = Math.min(0.05 + elapsed / 8, 0.92); // start at 5%, reach ~92% after ~8s
        event.sender.send('storage:clearProgress', {
          key,
          processed: done,
          total,
          fraction,
          message: `正在清空 ${storageLabel(key)}…`,
        });
      }, 500);

      try {
        await clearSingleStorage(key);
      } finally {
        clearInterval(pulseTimer);
      }

      done += 1;
      // ponytail: fraction must be 0 here — the completed key is already fully
      // counted in `processed`. Sending fraction: 1 on top of the incremented
      // `processed` makes (processed + fraction) / total overshoot to 100% for
      // a moment, then the next key's small fraction snaps the bar back down.
      event.sender.send('storage:clearProgress', {
        key,
        processed: done,
        total,
        fraction: 0,
        message: `已清空 ${storageLabel(key)}`,
      });
    }
    event.sender.send('storage:clearProgress', { key: '', processed: done, total, fraction: 0, message: '清理完成' });
    return getStorageStats();
  });
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

      // AI 回复完成后发送系统通知；若无法展示（权限/前台），则通过 IPC 发送应用内兜底提示
      if (getConfig().notifyOnAiResponse) {
        const result = notifyAiResponseCompleted(response.message.content);
        if (!result.delivered) {
          event.sender.send('notification:aiResponse', {
            title: 'AI 回答完成',
            body: `${summarizeForNotification(response.message.content) || 'StockBuddy 已完成回答'}（${result.reason}）`,
            source: 'in-app',
          });
        }
      }
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
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

function userDataDir() {
  return app.getPath('userData');
}

function getStorageStats(): IStorageStats {
  const chatPath = path.join(userDataDir(), 'stocksense-chat.sqlite');
  const configPath = path.join(userDataDir(), 'stocksense-store.json');
  const surgeDb = app.isPackaged ? 'stocksense-surge.duckdb' : 'stocksense-surge-dev.duckdb';
  const surgePath = path.join(userDataDir(), surgeDb);
  const monitorDb = app.isPackaged ? 'stocksense-monitor.duckdb' : 'stocksense-monitor-dev.duckdb';
  const monitorPath = path.join(userDataDir(), monitorDb);
  const marketPath = getMarketDataDatabasePath();

  return {
    chat: { label: '聊天记录', bytes: fileSize(chatPath) },
    config: { label: '应用配置和收藏', bytes: fileSize(configPath) },
    market: { label: '本地行情数据库', bytes: fileSize(marketPath) },
    surge: { label: '异动/热点历史', bytes: fileSize(surgePath) },
    monitor: { label: 'AI监控历史', bytes: fileSize(monitorPath) },
  };
}

function getDiskInfo(): IDiskInfo {
  const stats = getStorageStats();
  const usedByAppBytes = stats.chat.bytes + stats.config.bytes + stats.market.bytes + stats.surge.bytes + stats.monitor.bytes;
  let totalBytes = 0;
  let freeBytes = 0;
  try {
    const s = statfsSync(userDataDir());
    totalBytes = Number(s.blocks) * Number(s.bsize);
    freeBytes = Number(s.bavail > 0 ? s.bavail : s.bfree) * Number(s.bsize);
  } catch {
    /* fall back to zeros if statfs not available */
  }
  return { totalBytes, freeBytes, usedByAppBytes };
}

function storageLabel(key: string) {
  switch (key) {
    case 'chat':
      return '聊天记录';
    case 'config':
      return '应用配置';
    case 'market':
      return '本地行情数据库';
    case 'surge':
      return '异动/热点历史';
    case 'monitor':
      return 'AI监控历史';
    default:
      return key;
  }
}

async function clearSingleStorage(key: string) {
  switch (key) {
    case 'chat':
      closeConversationStore();
      try {
        unlinkSync(path.join(userDataDir(), 'stocksense-chat.sqlite'));
      } catch {
        /* file may not exist */
      }
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
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('favorite:cleared');
      break;
    case 'market':
      // ponytail: must stop any running sync before closing the store.
      // Otherwise closeMarketDataStore() waits for activeConnections to
      // reach 0 while sync workers are still holding DuckDB connections,
      // causing the UI to hang indefinitely with a 0% progress bar.
      requestMarketDataSyncStop();
      // ponytail: a sync worker stuck mid network-call won't stop until that
      // call returns, so waitForMarketDataSync() can hang for a very long
      // time. Bound it with a grace period — we delete + reset the database
      // anyway after the timeout, so the clear UI never freezes.
      await Promise.race([waitForMarketDataSync(), new Promise((resolve) => setTimeout(resolve, 8000))]);
      await closeMarketDataStore(5000);
      try {
        unlinkSync(getMarketDataDatabasePath());
      } catch {
        /* file may not exist */
      }
      // ponytail: closeMarketDataStore sets isClosing=true permanently and
      // dbReady still points at the old (now-closed) DuckDB instance. Without
      // resetting, every subsequent read()/write() throws "market data store
      // is closing" and the database is broken until app restart.
      await resetMarketDataStore().catch((error) => console.warn('[market-data] reset after clear failed', error));
      void initializeMarketDataStore().catch((error) =>
        console.warn('[market-data] re-init after clear failed', error),
      );
      break;
    case 'surge':
      // ponytail: stop the background scheduler before closing the store.
      // Otherwise the 30s capture loop calls listHotFocus('surge') and
      // saveSurgeSnapshot() shortly after the file is deleted, recreating
      // a non-empty database and making the clear look like it failed.
      stopSurgeHistoryScheduler();
      clearSurgeCache();
      await closeSurgeHistoryStore(5000);
      // ponytail: close the actual DuckDB instance to release its file handle
      // before unlinking. Otherwise the OS can keep the old inode alive and
      // subsequent reads through the old instance still see the "deleted" data.
      await closeSurgeHistoryInstance();
      const surgeName = app.isPackaged ? 'stocksense-surge.duckdb' : 'stocksense-surge-dev.duckdb';
      const surgePath = path.join(userDataDir(), surgeName);
      try {
        unlinkSync(surgePath);
      } catch {
        /* file may not exist */
      }
      // ponytail: verify the file is really gone; if a dangling handle keeps it
      // alive, fall back to SQL truncate so the next opened DB starts empty.
      if (existsSync(surgePath)) {
        console.warn('[storage:clear] surge db file still exists after unlink, truncating in-place');
        try {
          truncateSync(surgePath, 0);
        } catch {
          /* ignore */
        }
      }
      await resetSurgeHistoryStore();
      break;
    case 'monitor':
      stopMonitorHistoryScheduler();
      await closeMonitorHistoryStore(5000);
      await closeMonitorHistoryInstance();
      const monitorName = app.isPackaged ? 'stocksense-monitor.duckdb' : 'stocksense-monitor-dev.duckdb';
      const monitorPath = path.join(userDataDir(), monitorName);
      try {
        unlinkSync(monitorPath);
      } catch {
        /* file may not exist */
      }
      if (existsSync(monitorPath)) {
        console.warn('[storage:clear] monitor db file still exists after unlink, truncating in-place');
        try {
          truncateSync(monitorPath, 0);
        } catch {
          /* ignore */
        }
      }
      await resetMonitorHistoryStore();
      break;
  }
}
