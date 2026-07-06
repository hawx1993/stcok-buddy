import { getConfig } from '../config-store.js';
import { chatWithOpenAICompatible, type LlmChatMessage } from './openai-compatible-client.js';

export async function generateReport(messages: LlmChatMessage[]): Promise<string> {
  const config = getConfig().model;
  return chatWithOpenAICompatible(config, messages);
}
