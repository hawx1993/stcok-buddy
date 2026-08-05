import type { BrowserWindow as TBrowserWindow } from 'electron';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { registerIpcHandlers } from './ipc.js';
import { closeMarketDataInstance, closeMarketDataStore } from './services/market-data/market-data-store.js';
import { ensureMarketDataRuntime, shutdownMarketDataScheduler, stopMarketDataScheduler } from './services/market-data/market-data-scheduler.js';
import { closeConversationStore } from './services/conversation-store.js';
import { shutdownSurgeHistoryScheduler, stopSurgeHistoryScheduler, waitForSurgeHistoryScheduler } from './services/stock/surge-history-scheduler.js';
import { stopDiscoveryRefreshLoop } from './services/stock/discovery-service.js';
import { closeQuoteStore, initializeQuoteStore } from './services/stock/quote-store.js';
import { closeSurgeHistoryInstance, closeSurgeHistoryStore } from './services/stock/surge-history-store.js';
import {
  startMonitorHistoryScheduler,
  stopMonitorHistoryScheduler,
  waitForMonitorHistoryScheduler,
} from './services/stock/monitor-history-scheduler.js';
import { closeMonitorHistoryInstance, closeMonitorHistoryStore } from './services/stock/monitor-history-store.js';
import { captureError, captureEvent, shutdownPostHog } from './services/llm/posthog-client.js';
import { checkAppUpdate, setInstallUpdateHandler } from './services/update-service.js';
import { app, BrowserWindow, shell } from './electron-runtime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

loadDotenv({ path: path.join(__dirname, '../../.env.local'), override: false });
const appIcon = isDev
  ? path.join(__dirname, '../public/icons/icon.svg')
  : path.join(process.resourcesPath, 'icons/icon.svg');

let mainWindow: TBrowserWindow | null = null;
let cleanupStarted = false;
let cleanupDone = false;
let installingUpdate = false;
let sessionStartedAt = Date.now();

const QUIT_SCHEDULER_WAIT_MS = 500;
const QUIT_POSTHOG_WAIT_MS = 800;

function getPackageVersion() {
  try {
    return JSON.parse(readFileSync(path.join(__dirname, '../../package.json'), 'utf8')).version as string;
  } catch {
    return app.getVersion();
  }
}

function getBuildCommitHash() {
  const packagedHashFile = path.join(process.resourcesPath, 'commit-hash.txt');
  if (app.isPackaged && existsSync(packagedHashFile)) return readFileSync(packagedHashFile, 'utf8').trim();
  try {
    return execFileSync('git', ['rev-parse', '--short=10', 'HEAD'], {
      encoding: 'utf8',
      cwd: path.join(__dirname, '..', '..'),
    }).trim();
  } catch {
    return 'unknown';
  }
}

function configureAboutPanel() {
  const aboutText = `版本: ${getPackageVersion()} (${getBuildCommitHash()})\nElectron: ${process.versions.electron}\nChrome: ${process.versions.chrome}\nNode.js: ${process.versions.node}`;
  app.setAboutPanelOptions({
    applicationName: 'StockBuddy',
    applicationVersion: '',
    version: '',
    copyright: aboutText,
  });
}

function prepareForUpdateInstall() {
  installingUpdate = true;
  cleanupDone = true;
  stopMarketDataScheduler();
  stopDiscoveryRefreshLoop();
  stopSurgeHistoryScheduler();
  stopMonitorHistoryScheduler();
}

function finishQuit() {
  cleanupDone = true;
  app.quit();
}

async function runCleanupStep(name: string, cleanup: () => Promise<void> | void) {
  const startedAt = Date.now();
  try {
    await cleanup();
  } catch (error) {
    console.warn(`[app] quit cleanup ${name} failed`, error);
  } finally {
    console.log(`[app] quit cleanup ${name} finished in ${Date.now() - startedAt}ms`);
  }
}

async function waitWithTimeout(name: string, work: Promise<void>, timeoutMs: number) {
  let timeout: NodeJS.Timeout | undefined;
  const observedWork = work
    .then(() => 'done' as const)
    .catch((error) => {
      console.warn(`[app] quit cleanup ${name} failed`, error);
      return 'done' as const;
    });
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    timeout = setTimeout(() => resolve('timeout'), timeoutMs);
    timeout.unref?.();
  });
  const result = await Promise.race([observedWork, timeoutPromise]);
  if (timeout) clearTimeout(timeout);
  if (result === 'timeout') console.warn(`[app] quit cleanup ${name} timed out after ${timeoutMs}ms`);
}

async function cleanupAndQuit() {
  await runCleanupStep('quote-store', () => closeQuoteStore({ flush: false }));
  await runCleanupStep('conversation-store', () => closeConversationStore());
  await runCleanupStep('market-data-duckdb', async () => {
    await waitWithTimeout('market-data-scheduler', shutdownMarketDataScheduler(), QUIT_SCHEDULER_WAIT_MS);
    await closeMarketDataStore(500);
    await closeMarketDataInstance();
  });
  await runCleanupStep('surge-history-duckdb', async () => {
    await waitForSurgeHistoryScheduler({ flushQueued: false, timeoutMs: QUIT_SCHEDULER_WAIT_MS });
    await closeSurgeHistoryStore(500);
    await closeSurgeHistoryInstance();
  });
  await runCleanupStep('monitor-history-duckdb', async () => {
    await waitForMonitorHistoryScheduler({ flushQueued: false, timeoutMs: QUIT_SCHEDULER_WAIT_MS });
    await closeMonitorHistoryStore(500);
    await closeMonitorHistoryInstance();
  });
  await runCleanupStep('posthog', () => waitWithTimeout('posthog', shutdownPostHog(), QUIT_POSTHOG_WAIT_MS));
  finishQuit();
}

function createWindow() {
  const preloadPath = isDev ? path.join(process.cwd(), 'electron/preload.cjs') : path.join(__dirname, 'preload.cjs');
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 720,
    title: 'StockBuddy',
    icon: appIcon,
    backgroundColor: '#0B1426',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    captureEvent('renderer_crashed', { reason: details.reason, exit_code: details.exitCode });
  });

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

app.whenReady().then(() => {
  sessionStartedAt = Date.now();
  configureAboutPanel();
  setInstallUpdateHandler(prepareForUpdateInstall);
  initializeQuoteStore();
  void ensureMarketDataRuntime().catch((error) => {
    console.warn('[market-data] runtime initialization failed', error);
  });
  startMonitorHistoryScheduler();
  registerIpcHandlers();
  createWindow();
  const updateCheckTimer = setTimeout(() => {
    void checkAppUpdate({ silent: true });
  }, 5000);
  updateCheckTimer.unref?.();
  captureEvent('app_started');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (installingUpdate || cleanupDone) return;
  event.preventDefault();
  stopMarketDataScheduler();
  stopDiscoveryRefreshLoop();
  shutdownSurgeHistoryScheduler();
  stopMonitorHistoryScheduler();
  if (cleanupStarted) return;
  cleanupStarted = true;
  mainWindow?.destroy();
  mainWindow = null;
  captureEvent('app_closing', { session_duration_seconds: Math.round((Date.now() - sessionStartedAt) / 1000) });
  void cleanupAndQuit();
});

process.on('uncaughtException', (error) => {
  captureError('app_crashed', error);
  console.error('[app] uncaught exception', error);
});

process.on('unhandledRejection', (reason) => {
  captureError('app_unhandled_rejection', reason);
  console.error('[app] unhandled rejection', reason);
});
