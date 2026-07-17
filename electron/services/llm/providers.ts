import type { ProviderKind } from '../../../src/shared/types.js';

export interface ProviderPreset {
  id: ProviderKind;
  name: string;
  baseUrl: string;
  models: string[];
  help: string;
}

export const providerPresets: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    help: 'DeepSeek v4 模型：默认 deepseek-v4-flash，可切换 deepseek-v4-pro。',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini'],
    help: 'OpenAI Chat Completions。',
  },
  {
    id: 'qwen',
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
    help: 'DashScope OpenAI 兼容模式。',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/v1',
    models: ['MiniMax-M1', 'MiniMax-Text-01'],
    help: 'MiniMax OpenAI 兼容接口。',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-plus', 'glm-4-air'],
    help: '智谱 v4 API。',
  },
  {
    id: 'moonshot',
    name: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k3', 'kimi-k2.7-code-highspeed', 'kimi-k2.6', 'kimi-k2.5', 'moonshot-v1-128k', 'moonshot-v1-32k', 'moonshot-v1-8k'],
    help: 'Kimi / Moonshot OpenAI 兼容接口。',
  },
  {
    id: 'openai-compatible',
    name: 'OpenAI Compatible',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o'],
    help: '适用于任何兼容 Chat Completions 的网关或本地模型服务。',
  },
  {
    id: 'custom',
    name: '自定义 API',
    baseUrl: '',
    models: [],
    help: '填写自定义 Base URL 与模型名称。',
  },
];
