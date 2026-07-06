import Store from 'electron-store';
import type { AppConfig } from '../../src/shared/types.js';

export interface StoreSchema {
  config: AppConfig;
}

export const defaultConfig: AppConfig = {
  theme: 'dark',
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
  },
});

export function getConfig(): AppConfig {
  return store.get('config', defaultConfig);
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
