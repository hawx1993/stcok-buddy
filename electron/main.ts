import { app, BrowserWindow, shell } from 'electron';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { registerIpcHandlers } from './ipc.js';
import { closeMarketDataStore, initializeMarketDataStore } from './services/market-data/market-data-store.js';
import { stopMarketDataScheduler, waitForMarketDataScheduler } from './services/market-data/market-data-scheduler.js';
import { closeConversationStore } from './services/conversation-store.js';
import { startSurgeHistoryScheduler, stopSurgeHistoryScheduler } from './services/stock/surge-history-scheduler.js';
import { closeQuoteStore, initializeQuoteStore } from './services/stock/quote-store.js';
import { closeSurgeHistoryStore } from './services/stock/surge-history-store.js';
import { captureError, captureEvent, shutdownPostHog } from './services/llm/posthog-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

loadDotenv({ path: path.join(__dirname, '../../.env.local'), override: false });
const appIcon = isDev ? path.join(__dirname, '../public/icons/icon.svg') : path.join(process.resourcesPath, 'icons/icon.svg');

let mainWindow: BrowserWindow | null = null;
let cleanupStarted = false;
let cleanupDone = false;
let forceExitTimer: NodeJS.Timeout | undefined;
let sessionStartedAt = Date.now();

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
    return execFileSync('git', ['rev-parse', '--short=10', 'HEAD'], { encoding: 'utf8', cwd: path.join(__dirname, '..', '..') }).trim();
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

function createWindow() {
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
      preload: path.join(__dirname, 'preload.cjs'),
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
  initializeQuoteStore();
  registerIpcHandlers();
  void initializeMarketDataStore().catch((error) => console.warn('[market-data] initialization failed', error));
  startSurgeHistoryScheduler();
  createWindow();
  captureEvent('app_started');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  stopMarketDataScheduler();
  stopSurgeHistoryScheduler();
  if (cleanupDone || cleanupStarted) return;
  event.preventDefault();
  cleanupStarted = true;
  captureEvent('app_closing', { session_duration_seconds: Math.round((Date.now() - sessionStartedAt) / 1000) });
  forceExitTimer = setTimeout(() => {
    cleanupDone = true;
    app.quit();
  }, 8000);
  void Promise.allSettled([
    waitForMarketDataScheduler().then(closeMarketDataStore),
    Promise.resolve(closeQuoteStore()),
    closeSurgeHistoryStore(),
    Promise.resolve(closeConversationStore()),
    shutdownPostHog(),
  ]).finally(() => {
    if (forceExitTimer) clearTimeout(forceExitTimer);
    cleanupDone = true;
    app.quit();
  });
});

process.on('uncaughtException', (error) => {
  captureError('app_crashed', error);
  console.error('[app] uncaught exception', error);
});

process.on('unhandledRejection', (reason) => {
  captureError('app_unhandled_rejection', reason);
  console.error('[app] unhandled rejection', reason);
});
