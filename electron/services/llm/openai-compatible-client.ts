import type { ModelProviderConfig } from '../../../src/shared/types.js';

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function chatWithOpenAICompatible(
  config: ModelProviderConfig,
  messages: LlmChatMessage[],
): Promise<string> {
  if (!config.apiKey.trim()) {
    throw new Error('请先在设置中配置模型 API Key。');
  }

  const endpoint = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.customModel?.trim() || config.model,
      messages,
      temperature: 0.2,
      stream: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`模型调用失败：${response.status} ${text.slice(0, 240)}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('模型未返回有效内容。');
  return content;
}
