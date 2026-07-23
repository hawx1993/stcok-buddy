import Store from 'electron-store';
import { randomUUID } from 'node:crypto';
import type { AppConfig, FavoriteStock, IPendingDownloadedUpdate } from '../../src/shared/types.js';

export interface StoreSchema {
  config: AppConfig;
  favoriteStocks: FavoriteStock[];
  installedStoreItems: string[];
  pendingDownloadedUpdate?: IPendingDownloadedUpdate;
  deviceId: string;
}

export const defaultConfig: AppConfig = {
  theme: 'dark',
  marketColorMode: 'red-up-green-down',
  model: {
    provider: 'deepseek',
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    customModel: '',
  },
  appUpdate: {
    channel: 'stable',
    downloadDirectory: '',
  },
  tradeStyle: 'value',
  riskProfile: 'moderate',
  holdingPeriod: 'medium',
  notifyOnAiResponse: true,
};
function systemName() {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';
  return process.platform;
}


export const store = new Store<StoreSchema>({
  name: 'stocksense-store',
  defaults: {
    config: defaultConfig,
    favoriteStocks: [],
    installedStoreItems: [],
    deviceId: `${systemName()}-${randomUUID()}`,
  },
});

export function getConfig(): AppConfig {
  const config = store.get('config', defaultConfig);
  return {
    ...defaultConfig,
    ...config,
    model: { ...defaultConfig.model, ...config.model },
    appUpdate: { channel: config.appUpdate?.channel ?? defaultConfig.appUpdate?.channel ?? 'stable', downloadDirectory: config.appUpdate?.downloadDirectory ?? defaultConfig.appUpdate?.downloadDirectory ?? '' },
  };
}

export function setConfig(config: AppConfig): AppConfig {
  const normalized: AppConfig = {
    ...defaultConfig,
    ...config,
    model: {
      ...defaultConfig.model,
      ...config.model,
      model: config.model.customModel?.trim() || config.model.model,
      baseUrl: config.model.baseUrl.replace(/\/$/, ''),
    },
    appUpdate: {
      channel: config.appUpdate?.channel ?? defaultConfig.appUpdate?.channel ?? 'stable',
      downloadDirectory: config.appUpdate?.downloadDirectory?.trim() || '',
    },
  };
  store.set('config', normalized);
  return normalized;
}

export function getPendingDownloadedUpdate(): IPendingDownloadedUpdate | undefined {
  return store.get('pendingDownloadedUpdate');
}

export function setPendingDownloadedUpdate(update: IPendingDownloadedUpdate) {
  store.set('pendingDownloadedUpdate', update);
}

export function clearPendingDownloadedUpdate() {
  store.delete('pendingDownloadedUpdate');
}

function sortFavorites(items: FavoriteStock[]) {
  return [...items].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.createdAt.localeCompare(a.createdAt));
}

export function listFavoriteStocks(): FavoriteStock[] {
  return sortFavorites(store.get('favoriteStocks', []));
}

export function upsertFavoriteStock(stock: Pick<FavoriteStock, 'code' | 'name'>): FavoriteStock[] {
  const favorites = store.get('favoriteStocks', []);
  const existing = favorites.find((item) => item.code === stock.code);
  const next = existing
    ? favorites.map((item) => (item.code === stock.code ? { ...item, name: stock.name || item.name } : item))
    : [{ ...stock, pinned: false, createdAt: new Date().toISOString() }, ...favorites];
  store.set('favoriteStocks', next);
  return listFavoriteStocks();
}

export function listInstalledStoreItems(): string[] {
  return store.get('installedStoreItems', []);
}

export function installStoreItem(id: string): string[] {
  const installed = store.get('installedStoreItems', []);
  if (!installed.includes(id)) store.set('installedStoreItems', [...installed, id]);
  return listInstalledStoreItems();
}

export function uninstallStoreItem(id: string): string[] {
  store.set('installedStoreItems', store.get('installedStoreItems', []).filter((item) => item !== id));
  return listInstalledStoreItems();
}

export function removeFavoriteStock(code: string): FavoriteStock[] {
  store.set('favoriteStocks', store.get('favoriteStocks', []).filter((item) => item.code !== code));
  return listFavoriteStocks();
}

export function toggleFavoriteStockPin(code: string): FavoriteStock[] {
  store.set('favoriteStocks', store.get('favoriteStocks', []).map((item) => (item.code === code ? { ...item, pinned: !item.pinned } : item)));
  return listFavoriteStocks();
}

export function getDeviceId(): string {
  return store.get('deviceId');
}
