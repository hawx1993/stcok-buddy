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

export interface BoardConstituent {
  code: string;
  name: string;
  price?: string | number;
  changePercent?: string;
  turnover?: string;
  amount?: string;
}

export interface BoardDetail {
  code: string;
  name: string;
  changePercent?: string;
  constituents?: BoardConstituent[];
}

export interface KlinePoint {
  time: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

export interface ChipPoint {
  date?: string;
  price: number;
  weight: number;
  profit?: number;
}

export interface ChipDistribution {
  date: string;
  profitRatio?: number;
  avgCost?: number;
  cost90?: string;
  cost70?: string;
  concentration90?: number;
  concentration70?: number;
  points: ChipPoint[];
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

export interface PagedMarketNews {
  items: MarketNewsItem[];
  total: number;
  page: number;
  pageSize: number;
}

export type HotFocusTab = 'sector' | 'market' | 'surge' | 'strategy' | 'diagnosis' | 'flow';

export interface HotFocusItem {
  id: string;
  title: string;
  code?: string;
  name?: string;
  price?: string | number;
  changePercent?: string;
  turnover?: string;
  amount?: string;
  time?: string;
  description?: string;
  tag?: string;
  type?: 'surge' | 'plummet' | 'volume' | 'neutral';
}

export interface AgentResultCard {
  title: string;
  subtitle?: string;
  metrics?: Array<{ label: string; value: string; tone?: 'up' | 'down' | 'warn' | 'neutral' }>;
  rows?: Array<Record<string, unknown>>;
  narrative?: string;
  stocks?: StockDetail[];
  chart?: { type: 'kline'; data: KlinePoint[] };
}

export interface StocksenseApi {
  getConfig(): Promise<AppConfig>;
  setConfig(config: AppConfig): Promise<AppConfig>;
  listConversations(): Promise<ConversationSummary[]>;
  createConversation(): Promise<ConversationSummary>;
  deleteConversation(id: string): Promise<ConversationSummary[]>;
  renameConversation(id: string, title: string): Promise<ConversationSummary[]>;
  listMessages(conversationId: string): Promise<ChatMessage[]>;
  saveMessage(conversationId: string, message: ChatMessage): Promise<void>;
  sendChat(request: ChatRequest): Promise<ChatResponse>;
  getStockDetail(symbol: string): Promise<StockDetail>;
  getBoardDetail(symbol: string): Promise<BoardDetail>;
  getKline(symbol: string, limit?: number): Promise<KlinePoint[]>;
  listMarketNews(query?: string, page?: number, pageSize?: number): Promise<PagedMarketNews>;
  listHotFocus(tab: HotFocusTab): Promise<HotFocusItem[]>;
}

declare global {
  interface Window {
    stocksense?: StocksenseApi;
  }
}
