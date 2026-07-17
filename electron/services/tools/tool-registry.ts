import { captureEvent } from '../llm/posthog-client.js';
import type { AgentTool, ToolCallRecord } from './types.js';
import { readUrl } from './web-tools.js';
import {
  getDragonTiger,
  getHistoricalDailyBars,
  getHotFocus,
  getMarketDataStatus,
  getMarketNews,
  getStockChipDistribution,
  getStockKline,
  getStockNewsAnnouncements,
  getStockQuote,
  getTechnicalIndicators,
  resolveStockSymbol,
} from './stock-tools.js';

export const stockToolRegistry = {
  resolveStockSymbol,
  getStockQuote,
  getStockChipDistribution,
  getStockKline,
  getHistoricalDailyBars,
  getMarketDataStatus,
  getTechnicalIndicators,
  getMarketNews,
  getStockNewsAnnouncements,
  getDragonTiger,
  getHotFocus,
  readUrl,
} satisfies Record<string, AgentTool>;

let nextToolCallId = 0;

export async function callTool(name: keyof typeof stockToolRegistry | string, input: unknown): Promise<ToolCallRecord> {
  const tool = stockToolRegistry[name as keyof typeof stockToolRegistry];
  const startedAtMs = Date.now();
  const record: ToolCallRecord = {
    id: `tool-${Date.now()}-${nextToolCallId += 1}`,
    toolName: name,
    input,
    startedAt: new Date().toISOString(),
    inputSummary: summarizeToolValue(input),
  };

  try {
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    record.output = await tool.run(input as never);
    record.outputSummary = summarizeToolValue(record.output);
  } catch (error) {
    record.error = error instanceof Error ? error.message : String(error);
  } finally {
    record.endedAt = new Date().toISOString();
    captureEvent('tool_called', {
      tool_name: name,
      success: !record.error,
      has_error: Boolean(record.error),
      duration_ms: Date.now() - startedAtMs,
      input_summary_length: record.inputSummary?.length ?? 0,
      output_summary_length: record.outputSummary?.length ?? 0,
      error_message: record.error?.slice(0, 300),
    });
  }

  return record;
}

function summarizeToolValue(value: unknown) {
  if (value === undefined) return undefined;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.replace(/\s+/g, ' ').slice(0, 300);
}
