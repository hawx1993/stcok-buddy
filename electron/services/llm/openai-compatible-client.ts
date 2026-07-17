import { ChatOpenAI } from '@langchain/openai';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { experimental_transcribe as transcribe } from 'ai';
import type { ModelProviderConfig } from '../../../src/shared/types.js';
import { PostHogCallbackHandler } from './posthog-langchain-handler.js';

void transcribe;

export class LlmRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmRequestError';
  }
}

export function isLlmRequestError(error: unknown): error is LlmRequestError {
  return error instanceof LlmRequestError;
}

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function chatWithOpenAICompatible(
  config: ModelProviderConfig,
  messages: LlmChatMessage[],
  onToken?: (token: string) => void,
): Promise<string> {
  if (!config.apiKey.trim()) {
    throw new LlmRequestError('请先在设置中配置模型 API Key。');
  }

  const modelName = config.customModel?.trim() || config.model;
  try {
    const model = new ChatOpenAI({
      apiKey: config.apiKey,
      model: modelName,
      temperature: 0.2,
      streaming: Boolean(onToken),
      configuration: { baseURL: normalizeBaseUrl(config.baseUrl) },
      callbacks: [new PostHogCallbackHandler()],
    });

    const langchainMessages = messages.map((message) => {
      if (message.role === 'system') return new SystemMessage(message.content);
      if (message.role === 'assistant') return new AIMessage(message.content);
      return new HumanMessage(message.content);
    });

    if (!onToken) {
      const response = await model.invoke(langchainMessages);
      const content = contentToString(response.content);
      if (!content) throw new Error('模型未返回有效内容。');
      return content;
    }

    let content = '';
    for await (const chunk of await model.stream(langchainMessages)) {
      const token = contentToString(chunk.content);
      if (!token) continue;
      content += token;
      onToken(token);
    }
    if (!content) throw new Error('模型未返回有效内容。');
    return content;
  } catch (error) {
    if (isLlmRequestError(error)) throw error;
    throw new LlmRequestError(formatLlmError(error, { ...config, model: modelName }));
  }
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/$/, '').replace(/\/chat\/completions$/, '');
}

function formatLlmError(error: unknown, config: ModelProviderConfig) {
  const detail = error instanceof Error ? error.message : String(error);
  return `模型调用失败：请检查大模型厂商、API 地址、API Key 和模型名称是否匹配。当前配置：${config.provider} / ${config.model} / ${normalizeBaseUrl(config.baseUrl)}。原始错误：${detail}`;
}

function contentToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => (typeof part === 'string' ? part : typeof part === 'object' && part && 'text' in part ? String(part.text) : '')).join('');
}
