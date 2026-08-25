import { beforeEach, describe, expect, it, vi } from 'vitest';

const lifecycle = vi.hoisted(() => ({
  registerIpcHandlers: vi.fn(),
  syncSurgeHistoryIfNeeded: vi.fn(() => Promise.resolve(false)),
  initializeQuoteStore: vi.fn(),
  ensureMarketDataRuntime: vi.fn(() => Promise.resolve()),
  stopMarketDataScheduler: vi.fn(),
  shutdownMarketDataScheduler: vi.fn(() => Promise.resolve()),
  stopDiscoveryRefreshLoop: vi.fn(),
  shutdownSurgeHistoryScheduler: vi.fn(),
  stopSurgeHistoryScheduler: vi.fn(),
  waitForSurgeHistoryScheduler: vi.fn(() => Promise.resolve()),
  ensureSurgeHistoryCapture: vi.fn(),
  closeQuoteStore: vi.fn(() => Promise.resolve()),
  closeConversationStore: vi.fn(() => Promise.resolve()),
  closeMarketDataStore: vi.fn(() => Promise.resolve()),
  closeMarketDataInstance: vi.fn(() => Promise.resolve()),
  closeSurgeHistoryStore: vi.fn(() => Promise.resolve()),
  closeSurgeHistoryInstance: vi.fn(() => Promise.resolve()),
  closeMonitorHistoryStore: vi.fn(() => Promise.resolve()),
  closeMonitorHistoryInstance: vi.fn(() => Promise.resolve()),
  captureEvent: vi.fn(),
  captureError: vi.fn(),
  shutdownPostHog: vi.fn(() => Promise.resolve()),
  checkAppUpdate: vi.fn(() => Promise.resolve()),
  setInstallUpdateHandler: vi.fn(),
}));

const monitorScheduler = vi.hoisted(() => ({
  startMonitorHistoryScheduler: vi.fn(),
  stopMonitorHistoryScheduler: vi.fn(),
  waitForMonitorHistoryScheduler: vi.fn(() => Promise.resolve()),
}));

const electronRuntime = vi.hoisted(() => {
  interface IMockWindow {
    webContents: {
      on: ReturnType<typeof vi.fn>;
      setWindowOpenHandler: ReturnType<typeof vi.fn>;
    };
    destroy: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    isMinimized: ReturnType<typeof vi.fn>;
    loadFile: ReturnType<typeof vi.fn>;
    loadURL: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
  }

  const createMockWindow = (): IMockWindow => ({
    webContents: {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    },
    destroy: vi.fn(),
    focus: vi.fn(),
    isMinimized: vi.fn(() => false),
    loadFile: vi.fn(),
    loadURL: vi.fn(),
    restore: vi.fn(),
  });
  const BrowserWindow = vi.fn(function MockBrowserWindow() {
    return createMockWindow();
  });
  Object.assign(BrowserWindow, { getAllWindows: vi.fn(() => []) });

  return {
    app: {
      getPath: vi.fn((name: string) => `/tmp/stockbuddy-test-${name}`),
      getVersion: vi.fn(() => '0.0.0-test'),
      isPackaged: false,
      on: vi.fn(),
      quit: vi.fn(),
      requestSingleInstanceLock: vi.fn(() => true),
      setAboutPanelOptions: vi.fn(),
      whenReady: vi.fn(() => Promise.resolve()),
    },
    BrowserWindow,
    shell: { openExternal: vi.fn() },
  };
});

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(() => 'test-commit\n'),
}));

vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

vi.mock('../electron-runtime', () => electronRuntime);
vi.mock('../ipc', () => ({ registerIpcHandlers: lifecycle.registerIpcHandlers }));
vi.mock('../services/market-data/data-sync-handlers', () => ({
  syncSurgeHistoryIfNeeded: lifecycle.syncSurgeHistoryIfNeeded,
}));
vi.mock('../services/stock/monitor/monitor-history-scheduler', () => monitorScheduler);
vi.mock('../services/stock-db/market-data-store', () => ({
  closeMarketDataInstance: lifecycle.closeMarketDataInstance,
  closeMarketDataStore: lifecycle.closeMarketDataStore,
}));
vi.mock('../services/market-data/market-data-scheduler', () => ({
  ensureMarketDataRuntime: lifecycle.ensureMarketDataRuntime,
  shutdownMarketDataScheduler: lifecycle.shutdownMarketDataScheduler,
  stopMarketDataScheduler: lifecycle.stopMarketDataScheduler,
}));
vi.mock('../services/stock-db/conversation-store', () => ({
  closeConversationStore: lifecycle.closeConversationStore,
}));
vi.mock('../services/stock/anomaly/surge-history-scheduler', () => ({
  ensureSurgeHistoryCapture: lifecycle.ensureSurgeHistoryCapture,
  shutdownSurgeHistoryScheduler: lifecycle.shutdownSurgeHistoryScheduler,
  stopSurgeHistoryScheduler: lifecycle.stopSurgeHistoryScheduler,
  waitForSurgeHistoryScheduler: lifecycle.waitForSurgeHistoryScheduler,
}));
vi.mock('../services/stock/discovery/discovery-service', () => ({
  stopDiscoveryRefreshLoop: lifecycle.stopDiscoveryRefreshLoop,
}));
vi.mock('../services/stock-db/quote-store', () => ({
  closeQuoteStore: lifecycle.closeQuoteStore,
  initializeQuoteStore: lifecycle.initializeQuoteStore,
}));
vi.mock('../services/stock-db/surge-history-store', () => ({
  closeSurgeHistoryInstance: lifecycle.closeSurgeHistoryInstance,
  closeSurgeHistoryStore: lifecycle.closeSurgeHistoryStore,
}));
vi.mock('../services/stock-db/monitor-history-store', () => ({
  closeMonitorHistoryInstance: lifecycle.closeMonitorHistoryInstance,
  closeMonitorHistoryStore: lifecycle.closeMonitorHistoryStore,
}));
vi.mock('../services/llm/posthog-client', () => ({
  captureError: lifecycle.captureError,
  captureEvent: lifecycle.captureEvent,
  shutdownPostHog: lifecycle.shutdownPostHog,
}));
vi.mock('../services/update-service', () => ({
  checkAppUpdate: lifecycle.checkAppUpdate,
  setInstallUpdateHandler: lifecycle.setInstallUpdateHandler,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  electronRuntime.app.requestSingleInstanceLock.mockReturnValue(true);
  Object.defineProperty(process, 'resourcesPath', { value: process.cwd(), configurable: true });
});

describe('Electron 主进程启动', () => {
  it('应用 ready 后启动 AI 监控历史后台调度器', async () => {
    await import('../main.js');
    await Promise.resolve();

    expect(electronRuntime.app.requestSingleInstanceLock).toHaveBeenCalledTimes(1);
    expect(lifecycle.initializeQuoteStore).toHaveBeenCalledTimes(1);
    expect(lifecycle.syncSurgeHistoryIfNeeded).toHaveBeenCalledTimes(1);
    expect(monitorScheduler.startMonitorHistoryScheduler).toHaveBeenCalledTimes(1);
    expect(lifecycle.ensureSurgeHistoryCapture).toHaveBeenCalledTimes(1);
    expect(lifecycle.registerIpcHandlers).toHaveBeenCalledTimes(1);
  });

  it('已有实例运行时提前退出且不初始化后台服务', async () => {
    electronRuntime.app.requestSingleInstanceLock.mockReturnValue(false);

    await import('../main.js');
    await Promise.resolve();

    expect(electronRuntime.app.quit).toHaveBeenCalledTimes(1);
    expect(lifecycle.initializeQuoteStore).not.toHaveBeenCalled();
    expect(lifecycle.ensureMarketDataRuntime).not.toHaveBeenCalled();
    expect(monitorScheduler.startMonitorHistoryScheduler).not.toHaveBeenCalled();
    expect(lifecycle.ensureSurgeHistoryCapture).not.toHaveBeenCalled();
    expect(lifecycle.registerIpcHandlers).not.toHaveBeenCalled();
  });
});
