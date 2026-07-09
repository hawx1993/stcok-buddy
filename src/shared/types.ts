export type ThemeMode = 'dark' | 'light';
export type MarketColorMode = 'red-up-green-down' | 'green-up-red-down';

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
  marketColorMode?: MarketColorMode;
  model: ModelProviderConfig;
  tradeStyle?: TradeStyle;
  riskProfile?: RiskProfile;
  holdingPeriod?: HoldingPeriod;
}

export type ConversationTab = 'stock' | 'diagnosis' | 'market';

export type EvidenceSource =
  | 'quote'
  | 'kline'
  | 'technical'
  | 'news'
  | 'announcement'
  | 'dragon-tiger'
  | 'hot-focus'
  | 'chip'
  | 'fallback';

export interface EvidenceItem {
  id: string;
  source: EvidenceSource;
  title: string;
  summary?: string;
  value?: string | number;
  url?: string;
  timestamp?: string;
  raw?: unknown;
}

export interface StructuredAgentFinding {
  id: string;
  dimension: 'technical' | 'fundamental' | 'capital' | 'sentiment' | 'chip' | 'overview' | 'risk';
  stance: 'bullish' | 'neutral' | 'bearish' | 'unknown';
  score?: number;
  confidence: number;
  summary: string;
  evidenceIds: string[];
  risks: string[];
}

export interface StructuredAgentOutput {
  agentName: string;
  label: string;
  findings: StructuredAgentFinding[];
  evidence: EvidenceItem[];
  markdown: string;
}

export interface ToolCallRecord {
  id: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  error?: string;
  startedAt: string;
  endedAt?: string;
}

export interface ComplianceReview {
  passed: boolean;
  issues: Array<{
    type: 'investment-advice' | 'fabricated-data' | 'missing-risk' | 'unsupported-claim' | 'forbidden-emoji' | 'other';
    severity: 'low' | 'medium' | 'high';
    message: string;
  }>;
  revisedText: string;
}

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
  processedSeconds?: number;
  result?: AgentResultCard;
  evidence?: EvidenceItem[];
  findings?: StructuredAgentFinding[];
  toolCalls?: ToolCallRecord[];
  compliance?: ComplianceReview;
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
  toolCall?: ToolCallRecord;
  evidence?: EvidenceItem[];
  findings?: StructuredAgentFinding[];
}

export interface ChatRequest {
  conversationId: string;
  message: string;
  requestId?: string;
}

export interface ChatStreamEvent {
  requestId: string;
  token: string;
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
  kline?: KlinePoint[];
}

export interface FavoriteStock {
  code: string;
  name: string;
  pinned?: boolean;
  createdAt: string;
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
  timestamp?: number;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount?: number;
  change?: number;
  changePercent?: number;
  turnoverRate?: number;
  pe?: number | string;
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
  content?: string;
  tagType?: 'positive' | 'impact' | 'neutral';
  url?: string;
  source?: string;
}

export interface AnnouncementItem {
  title: string;
  type: string;
  date: string;
  url: string;
  content?: string;
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

export interface StoreItem {
  id: string;
  name: string;
  section: 'Commands' | 'Skills' | 'Sub Agents';
  category: 'commands' | 'skills' | 'sub-agents';
  command?: string;
  description: string;
  argPlaceholder?: string;
  handler?: string;
}

export type StoreCategory = StoreItem['category'];

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
  onChatToken?(handler: (event: ChatStreamEvent) => void): () => void;
  getStockDetail(symbol: string): Promise<StockDetail>;
  getBoardDetail(symbol: string): Promise<BoardDetail>;
  getKline(symbol: string, limit?: number, period?: string): Promise<KlinePoint[]>;
  listMarketNews(query?: string, page?: number, pageSize?: number): Promise<PagedMarketNews>;
  listHotFocus(tab: HotFocusTab): Promise<HotFocusItem[]>;
  listSurgeHistoryDates(): Promise<string[]>;
  listSurgeHistory(date: string): Promise<HotFocusItem[]>;
  listStoreItems(): Promise<StoreItem[]>;
  listInstalledStoreItems(): Promise<string[]>;
  installStoreItem(id: string): Promise<string[]>;
  uninstallStoreItem(id: string): Promise<string[]>;
  listFavoriteStocks(): Promise<FavoriteStock[]>;
  upsertFavoriteStock(stock: Pick<FavoriteStock, 'code' | 'name'>): Promise<FavoriteStock[]>;
  removeFavoriteStock(code: string): Promise<FavoriteStock[]>;
  toggleFavoriteStockPin(code: string): Promise<FavoriteStock[]>;
}

declare global {
  interface Window {
    stocksense?: StocksenseApi;
  }
}
