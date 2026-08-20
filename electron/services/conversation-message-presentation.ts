import type { AgentRunEvent, ChatMessage, ToolCallRecord } from '../../src/shared/types.js';

const SUMMARY_LIMIT = 300;

/**
 * Tool inputs and outputs are execution-only data. The conversation UI only
 * renders their summaries, so keep the persisted/IPC representation bounded.
 */
export function toToolCallPresentation(record: ToolCallRecord): ToolCallRecord {
  return {
    id: record.id,
    toolName: record.toolName,
    input: undefined,
    inputSummary: toSummary(record.inputSummary, record.input),
    outputSummary: toSummary(record.outputSummary, record.output),
    error: record.error,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
  };
}

export function toChatMessagePresentation(message: ChatMessage): ChatMessage {
  const toolCalls = message.toolCalls?.map(toToolCallPresentation);
  const runEvents = message.runEvents?.map(toRunEventPresentation);

  return {
    ...message,
    ...(toolCalls ? { toolCalls } : {}),
    ...(runEvents ? { runEvents } : {}),
  };
}

function toRunEventPresentation(event: AgentRunEvent): AgentRunEvent {
  if (!event.toolCall) return event;
  return { ...event, toolCall: toToolCallPresentation(event.toolCall) };
}

function toSummary(summary: string | undefined, value: unknown): string | undefined {
  if (summary) return truncateSummary(summary);
  if (value === undefined) return undefined;
  if (typeof value === 'string') return truncateSummary(value);
  if (Array.isArray(value)) return `数组（${value.length} 项）`;
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value);
    return keys.length ? `对象（${keys.slice(0, 6).join('、')}）` : '空对象';
  }
  return truncateSummary(String(value));
}

function truncateSummary(value: string): string {
  return value.replace(/\s+/g, ' ').slice(0, SUMMARY_LIMIT);
}
