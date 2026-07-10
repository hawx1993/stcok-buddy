import type { ToolCallRecord } from '../../../src/shared/types.js';

export interface AgentTool<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  inputSchema: unknown;
  run(input: Input): Promise<Output>;
}

export type { ToolCallRecord };
