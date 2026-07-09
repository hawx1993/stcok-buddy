import type { AgentTool, ToolCallRecord } from './types.js';
import {
  getDragonTiger,
  getHotFocus,
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
  getTechnicalIndicators,
  getMarketNews,
  getStockNewsAnnouncements,
  getDragonTiger,
  getHotFocus,
} satisfies Record<string, AgentTool>;

let nextToolCallId = 0;

export async function callTool(name: keyof typeof stockToolRegistry | string, input: unknown): Promise<ToolCallRecord> {
  const tool = stockToolRegistry[name as keyof typeof stockToolRegistry];
  const record: ToolCallRecord = {
    id: `tool-${Date.now()}-${nextToolCallId += 1}`,
    toolName: name,
    input,
    startedAt: new Date().toISOString(),
  };

  try {
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    record.output = await tool.run(input as never);
  } catch (error) {
    record.error = error instanceof Error ? error.message : String(error);
  } finally {
    record.endedAt = new Date().toISOString();
  }

  return record;
}
