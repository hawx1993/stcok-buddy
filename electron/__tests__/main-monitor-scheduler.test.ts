import { beforeEach, describe, expect, it, vi } from 'vitest';

const lifecycle = vi.hoisted(() => ({
  registerIpcHandlers: vi.fn(),
  initializeQuoteStore: vi.fn(),
  ensureMarketDataRuntime: vi.fn(() => Promise.resolve()),
  stopMarketDataScheduler: vi.fn(),
  shutdownMarketDataScheduler: vi.fn(() => Promise.resolve()),
  stopDiscoveryRefreshLoop: vi.fn(),
  shutdownSurgeHistoryScheduler: vi.fn(),
  stopSurgeHistoryScheduler: vi.fn(),
  waitForSurgeHistoryScheduler: vi.fn(() => Promise.resolve()),
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
    loadFile: ReturnType<typeof vi.fn>;
    loadURL: ReturnType<typeof vi.fn>;
  }

  const createMockWindow = (): IMockWindow => ({
    webContents: {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    },
    destroy: vi.fn(),
    loadFile: vi.fn(),
    loadURL: vi.fn(),
  });
  const BrowserWindow = vi.fn(function MockBrowserWindow() {
    return createMockWindow();
  });
  Object.assign(BrowserWindow, { getAllWindows: vi.fn(() => []) });

  return {
    app: {
      getVersion: vi.fn(() => '0.0.0-test'),
      isPackaged: false,
      on: vi.fn(),
      quit: vi.fn(),
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

vi.mock('../electron-runtime.js', () => electronRuntime);
vi.mock('../ipc.js', () => ({ registerIpcHandlers: lifecycle.registerIpcHandlers }));
vi.mock('../services/stock/monitor-history-scheduler.js', () => monitorScheduler);
vi.mock('../services/market-data/market-data-store.js', () => ({
  closeMarketDataInstance: lifecycle.closeMarketDataInstance,
  closeMarketDataStore: lifecycle.closeMarketDataStore,
}));
vi.mock('../services/market-data/market-data-scheduler.js', () => ({
  ensureMarketDataRuntime: lifecycle.ensureMarketDataRuntime,
  shutdownMarketDataScheduler: lifecycle.shutdownMarketDataScheduler,
  stopMarketDataScheduler: lifecycle.stopMarketDataScheduler,
}));
vi.mock('../services/conversation-store.js', () => ({
  closeConversationStore: lifecycle.closeConversationStore,
}));
vi.mock('../services/stock/surge-history-scheduler.js', () => ({
  shutdownSurgeHistoryScheduler: lifecycle.shutdownSurgeHistoryScheduler,
  stopSurgeHistoryScheduler: lifecycle.stopSurgeHistoryScheduler,
  waitForSurgeHistoryScheduler: lifecycle.waitForSurgeHistoryScheduler,
}));
vi.mock('../services/stock/discovery-service.js', () => ({
  stopDiscoveryRefreshLoop: lifecycle.stopDiscoveryRefreshLoop,
}));
vi.mock('../services/stock/quote-store.js', () => ({
  closeQuoteStore: lifecycle.closeQuoteStore,
  initializeQuoteStore: lifecycle.initializeQuoteStore,
}));
vi.mock('../services/stock/surge-history-store.js', () => ({
  closeSurgeHistoryInstance: lifecycle.closeSurgeHistoryInstance,
  closeSurgeHistoryStore: lifecycle.closeSurgeHistoryStore,
}));
vi.mock('../services/stock/monitor-history-store.js', () => ({
  closeMonitorHistoryInstance: lifecycle.closeMonitorHistoryInstance,
  closeMonitorHistoryStore: lifecycle.closeMonitorHistoryStore,
}));
vi.mock('../services/llm/posthog-client.js', () => ({
  captureError: lifecycle.captureError,
  captureEvent: lifecycle.captureEvent,
  shutdownPostHog: lifecycle.shutdownPostHog,
}));
vi.mock('../services/update-service.js', () => ({
  checkAppUpdate: lifecycle.checkAppUpdate,
  setInstallUpdateHandler: lifecycle.setInstallUpdateHandler,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  Object.defineProperty(process, 'resourcesPath', { value: process.cwd(), configurable: true });
});

describe('Electron 主进程启动', () => {
  it('应用 ready 后启动 AI 监控历史后台调度器', async () => {
    await import('../main.js');
    await Promise.resolve();

    expect(lifecycle.initializeQuoteStore).toHaveBeenCalledTimes(1);
    expect(monitorScheduler.startMonitorHistoryScheduler).toHaveBeenCalledTimes(1);
    expect(lifecycle.registerIpcHandlers).toHaveBeenCalledTimes(1);
  });
});
