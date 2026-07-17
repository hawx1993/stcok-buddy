import { getConfig } from '../config-store.js';
import { chatWithOpenAICompatible, type LlmChatMessage } from './openai-compatible-client.js';
import type { ModelProviderConfig } from '../../../src/shared/types.js';

export async function generateReport(messages: LlmChatMessage[], onToken?: (token: string) => void): Promise<string> {
  const config = getConfig().model;
  return chatWithOpenAICompatible(config, messages, onToken);
}

export async function testModelConnection(config: ModelProviderConfig): Promise<void> {
  await chatWithOpenAICompatible(config, [
    { role: 'system', content: '你只用于连通性测试。' },
    { role: 'user', content: '回复 OK' },
  ]);
}
