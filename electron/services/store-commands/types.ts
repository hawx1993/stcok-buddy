import type { generateReport } from '../llm/index.js';
import type { AgentRunEvent, ChatMessage, StoreItem } from '../../../src/shared/types.js';

export interface IStoreCommandInput {
  args: string;
  query: string;
  item: StoreItem;
  llm?: {
    generate: typeof generateReport;
  };
}

export interface IStoreCommandResult {
  content: string;
  result?: ChatMessage['result'];
  events?: AgentRunEvent[];
}

export type TStoreCommandRunner = (input: IStoreCommandInput) => Promise<IStoreCommandResult>;
