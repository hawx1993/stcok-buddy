import Store from 'electron-store';
import type { AppConfig, ChatMessage, ConversationSummary } from '../../src/shared/types.js';

export interface StoreSchema {
  config: AppConfig;
  conversations: ConversationSummary[];
  messages: Record<string, ChatMessage[]>;
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

export const seedConversations: ConversationSummary[] = [
  { id: 'conv-1', title: '白酒板块 + 持仓分析', preview: '帮我看看白酒板块今天怎么样', date: '今天', tab: 'stock', count: 2 },
  { id: 'conv-2', title: '宁德时代财报解读', preview: '宁王财报出了，帮我看看', date: '昨天', tab: 'diagnosis', count: 0 },
  { id: 'conv-3', title: '科技板块资金流向', preview: '今天半导体板块资金流向', date: '昨天', tab: 'market', count: 0 },
];

export const store = new Store<StoreSchema>({
  name: 'stocksense-store',
  defaults: {
    config: defaultConfig,
    conversations: seedConversations,
    messages: {},
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
