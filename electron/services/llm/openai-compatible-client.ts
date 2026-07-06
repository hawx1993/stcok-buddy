import { ChatOpenAI } from '@langchain/openai';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { experimental_transcribe as transcribe } from 'ai';
import type { ModelProviderConfig } from '../../../src/shared/types.js';

void transcribe;

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
    throw new Error('请先在设置中配置模型 API Key。');
  }

  const model = new ChatOpenAI({
    apiKey: config.apiKey,
    model: config.customModel?.trim() || config.model,
    temperature: 0.2,
    streaming: Boolean(onToken),
    configuration: { baseURL: normalizeBaseUrl(config.baseUrl) },
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
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/$/, '').replace(/\/chat\/completions$/, '');
}

function contentToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => (typeof part === 'string' ? part : typeof part === 'object' && part && 'text' in part ? String(part.text) : '')).join('');
}
