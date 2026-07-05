export type ThemeMode = 'dark' | 'light';

export type ProviderKind = 'deepseek' | 'openai' | 'qwen' | 'baidu' | 'zhipu' | 'moonshot' | 'openai-compatible' | 'custom';

export type TradeStyle = 'value' | 'trend' | 'balanced';
export type RiskProfile = 'conservative' | 'moderate' | 'aggressive';
export type HoldingPeriod = 'short' | 'medium' | 'long' | 'very-long';

export interface ModelProviderConfig {
  provider: ProviderKind;
  apiKey: string;
  baseUrl: string;
  model: string;
  customModel?: string;
}

export interface AppConfig {
  theme: ThemeMode;
  model: ModelProviderConfig;
  tradeStyle?: TradeStyle;
  riskProfile?: RiskProfile;
  holdingPeriod?: HoldingPeriod;
}

export type ConversationTab = 'stock' | 'diagnosis' | 'market';

export interface ConversationSummary {
  id: string;
  title: string;
  preview: string;
  date: string;
  tab: ConversationTab;
  count: number;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  steps?: AgentStep[];
  thinking?: {
    startedAt: string;
    steps: AgentStep[];
  };
  result?: AgentResultCard;
}

export interface AgentStep {
  id: string;
  agent: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  detail?: string;
}

export type AgentRunEventType =
  | 'plan_created'
  | 'step_started'
  | 'step_completed'
  | 'tool_result'
  | 'final_answer'
  | 'error';

export interface AgentRunEvent {
  type: AgentRunEventType;
  message?: string;
  step?: AgentStep;
  result?: AgentResultCard;
  stock?: StockDetail;
}

export interface ChatRequest {
  conversationId: string;
  message: string;
}

export interface ChatResponse {
  message: ChatMessage;
  events: AgentRunEvent[];
}

export interface StockDetail {
  code: string;
  name: string;
  exchange?: string;
  price?: number | string;
  change?: string;
  changePercent?: string;
  pe?: number | string;
  pb?: number | string;
  roe?: number | string;
  marketCap?: string;
  volume?: string;
  turnover?: string;
  rating?: {
    fundamental: string;
    valuation: string;
    tech: string;
    risk: string;
  };
  summary?: string;
}

export interface MarketNewsItem {
  id: string;
  time: string;
  title: string;
  tags: string[];
  tagType?: 'positive' | 'impact' | 'neutral';
  url?: string;
  source?: string;
}

export interface AgentResultCard {
  title: string;
  subtitle?: string;
  metrics?: Array<{ label: string; value: string; tone?: 'up' | 'down' | 'warn' | 'neutral' }>;
  rows?: Array<Record<string, string>>;
  narrative?: string;
  stocks?: StockDetail[];
}

export interface StocksenseApi {
  getConfig(): Promise<AppConfig>;
  setConfig(config: AppConfig): Promise<AppConfig>;
  listConversations(): Promise<ConversationSummary[]>;
  createConversation(): Promise<ConversationSummary>;
  deleteConversation(id: string): Promise<ConversationSummary[]>;
  listMessages(conversationId: string): Promise<ChatMessage[]>;
  saveMessage(conversationId: string, message: ChatMessage): Promise<void>;
  sendChat(request: ChatRequest): Promise<ChatResponse>;
  getStockDetail(symbol: string): Promise<StockDetail>;
  listMarketNews(query?: string): Promise<MarketNewsItem[]>;
}

declare global {
  interface Window {
    stocksense?: StocksenseApi;
  }
}
