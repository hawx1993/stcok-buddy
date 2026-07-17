import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { Serialized } from '@langchain/core/load/serializable';
import type { LLMResult } from '@langchain/core/outputs';
import type { BaseMessage } from '@langchain/core/messages';
import { getPostHogClient } from './posthog-client.js';
import { getDeviceId } from '../config-store.js';

interface RunState {
  startedAt: number;
  model: string;
  provider: string;
  baseUrl: string;
  input: unknown;
}

function extractModelInfo(llm: Serialized): { model: string; provider: string; baseUrl: string } {
  const kwargs = (llm as unknown as Record<string, unknown>).kwargs as Record<string, unknown> | undefined;
  const model = String(kwargs?.model ?? kwargs?.model_name ?? 'unknown');
  const configuration = kwargs?.configuration as Record<string, unknown> | undefined;
  const baseUrl = String(configuration?.baseURL ?? '');
  const provider = deriveProvider(baseUrl, model);
  return { model, provider, baseUrl };
}

function deriveProvider(baseUrl: string, model: string): string {
  if (baseUrl.includes('deepseek')) return 'deepseek';
  if (baseUrl.includes('dashscope') || baseUrl.includes('aliyuncs')) return 'qwen';
  if (baseUrl.includes('minimax')) return 'minimax';
  if (baseUrl.includes('bigmodel') || baseUrl.includes('zhipu')) return 'zhipu';
  if (baseUrl.includes('moonshot')) return 'moonshot';
  if (baseUrl.includes('openai')) return 'openai';
  if (model.startsWith('gpt-')) return 'openai';
  if (model.startsWith('deepseek')) return 'deepseek';
  return 'openai-compatible';
}

function serializeMessages(messages: BaseMessage[][]): unknown {
  return messages.flat().map((msg) => ({
    role: msg._getType(),
    content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
  }));
}

function extractOutput(output: LLMResult): string {
  const gen = output.generations?.[0]?.[0];
  if (!gen) return '';
  if ('message' in gen) {
    const content = (gen as { message: { content: unknown } }).message.content;
    return typeof content === 'string' ? content : JSON.stringify(content);
  }
  return gen.text ?? '';
}

function extractTokenUsage(output: LLMResult): { inputTokens: number; outputTokens: number } {
  const usage = output.llmOutput?.tokenUsage as Record<string, number> | undefined;
  return {
    inputTokens: usage?.promptTokens ?? 0,
    outputTokens: usage?.completionTokens ?? 0,
  };
}

export class PostHogCallbackHandler extends BaseCallbackHandler {
  name = 'PostHogCallbackHandler';

  private runs = new Map<string, RunState>();

  override handleChatModelStart(
    llm: Serialized,
    messages: BaseMessage[][],
    runId: string,
  ): void {
    const { model, provider, baseUrl } = extractModelInfo(llm);
    this.runs.set(runId, {
      startedAt: Date.now(),
      model,
      provider,
      baseUrl,
      input: serializeMessages(messages),
    });
  }

  override handleLLMEnd(output: LLMResult, runId: string, parentRunId?: string): void {
    const state = this.runs.get(runId);
    if (!state) return;
    this.runs.delete(runId);

    const client = getPostHogClient();
    if (!client) return;

    const latency = (Date.now() - state.startedAt) / 1000;
    const { inputTokens, outputTokens } = extractTokenUsage(output);

    client.capture({
      distinctId: getDeviceId(),
      event: '$ai_generation',
      properties: {
        $ai_trace_id: parentRunId ?? runId,
        $ai_generation_id: runId,
        $ai_provider: state.provider,
        $ai_model: state.model,
        $ai_base_url: state.baseUrl,
        $ai_input: state.input,
        $ai_output_choices: [{ role: 'assistant', content: extractOutput(output) }],
        $ai_input_tokens: inputTokens || undefined,
        $ai_output_tokens: outputTokens || undefined,
        $ai_latency: latency,
        $ai_http_status: 200,
      },
    });
  }

  override handleLLMError(err: Error, runId: string, parentRunId?: string): void {
    const state = this.runs.get(runId);
    if (!state) return;
    this.runs.delete(runId);

    const client = getPostHogClient();
    if (!client) return;

    const latency = (Date.now() - state.startedAt) / 1000;

    client.capture({
      distinctId: getDeviceId(),
      event: '$ai_generation',
      properties: {
        $ai_trace_id: parentRunId ?? runId,
        $ai_generation_id: runId,
        $ai_provider: state.provider,
        $ai_model: state.model,
        $ai_base_url: state.baseUrl,
        $ai_input: state.input,
        $ai_latency: latency,
        $ai_http_status: 500,
        $ai_error: err.message,
        $ai_is_error: true,
      },
    });
  }
}
