import Store from 'electron-store';
import type { AppConfig, FavoriteStock } from '../../src/shared/types.js';

export interface StoreSchema {
  config: AppConfig;
  favoriteStocks: FavoriteStock[];
  installedStoreItems: string[];
}

export const defaultConfig: AppConfig = {
  theme: 'dark',
  marketColorMode: 'red-up-green-down',
  model: {
    provider: 'deepseek',
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    customModel: '',
  },
  tradeStyle: 'value',
  riskProfile: 'moderate',
  holdingPeriod: 'medium',
};

export const store = new Store<StoreSchema>({
  name: 'stocksense-store',
  defaults: {
    config: defaultConfig,
    favoriteStocks: [],
    installedStoreItems: [],
  },
});

export function getConfig(): AppConfig {
  return { ...defaultConfig, ...store.get('config', defaultConfig) };
}

export function setConfig(config: AppConfig): AppConfig {
  const normalized: AppConfig = {
    ...config,
    model: {
      ...config.model,
      model: config.model.customModel?.trim() || config.model.model,
      baseUrl: config.model.baseUrl.replace(/\/$/, ''),
    },
  };
  store.set('config', normalized);
  return normalized;
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
