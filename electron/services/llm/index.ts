import { getConfig } from '../configStore.js';
import { chatWithOpenAICompatible, type LlmChatMessage } from './openaiCompatibleClient.js';

export async function generateReport(messages: LlmChatMessage[]): Promise<string> {
  const config = getConfig().model;
  return chatWithOpenAICompatible(config, messages);
}
