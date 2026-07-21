export type ThemeMode = 'dark' | 'light';
export type MarketColorMode = 'red-up-green-down' | 'green-up-red-down';
export type TAppUpdateChannel = 'stable' | 'beta';

export type ProviderKind =
  | 'deepseek'
  | 'openai'
  | 'qwen'
  | 'minimax'
  | 'zhipu'
  | 'moonshot'
  | 'openai-compatible'
  | 'custom';

export type TradeStyle = 'value' | 'trend' | 'balanced';
export type RiskProfile = 'conservative' | 'moderate' | 'aggressive';
export type HoldingPeriod = 'short' | 'medium' | 'long' | 'very-long';

export interface IAppUpdateSettings {
  channel: TAppUpdateChannel;
  downloadDirectory?: string;
}

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
  appUpdate?: IAppUpdateSettings;
  tradeStyle?: TradeStyle;
  riskProfile?: RiskProfile;
  holdingPeriod?: HoldingPeriod;
}

export type ConversationTab = 'stock' | 'diagnosis' | 'market';

export type DataFreshness = 'live' | 'current' | 'historical' | 'stale' | 'fallback';

export interface MarketDataSyncStatus {
  state: 'idle' | 'checking' | 'initializing' | 'syncing' | 'completed' | 'partial' | 'failed';
  jobType?: 'initial_backfill' | 'daily_incremental' | 'repair';
  targetTradeDate?: string;
  processedSymbols: number;
  totalSymbols: number;
  succeededSymbols: number;
  failedSymbols: number;
  startedAt?: string;
  finishedAt?: string;
  latestLocalTradeDate?: string;
  message?: string;
}

export interface IStockFundFlowSnapshot {
  date: string;
  mainNetInflow: number | null;
  mainNetInflowPercent: number | null;
  superLargeNetInflow: number | null;
  superLargeNetInflowPercent: number | null;
  largeNetInflow: number | null;
  largeNetInflowPercent: number | null;
  mediumNetInflow: number | null;
  mediumNetInflowPercent: number | null;
  smallNetInflow: number | null;
  smallNetInflowPercent: number | null;
  activeBuyRatio?: number;
  activeSellRatio?: number;
  activeSampleCount?: number;
  activeRatioSource?: string;
  source: 'stock-sdk' | 'a-stock-data';
  warnings?: string[];
}

export interface MarketDataStats {
  securityCount: number;
  dailyBarCount: number;
  latestTradeDate?: string;
  databaseBytes: number;
  failedSymbols: number;
}

export type EvidenceSource =
  | 'quote'
  | 'kline'
  | 'technical'
  | 'news'
  | 'announcement'
  | 'dragon-tiger'
  | 'hot-focus'
  | 'chip'
  | 'fund-flow'
  | 'url'
  | 'local-market-data'
  | 'remote-market-data'
  | 'fallback';

export interface EvidenceItem {
  id: string;
  source: EvidenceSource;
  title: string;
  summary?: string;
  value?: string | number;
  url?: string;
  timestamp?: string;
  dataSource?: string;
  storage?: 'local' | 'remote' | 'mixed';
  freshness?: DataFreshness;
  periodStart?: string;
  periodEnd?: string;
  isComplete?: boolean;
  adjustType?: 'qfq' | 'none';
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
  inputSummary?: string;
  outputSummary?: string;
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
  runEvents?: AgentRunEvent[];
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
  | 'command_detected'
  | 'intent_detected'
  | 'step_started'
  | 'step_completed'
  | 'tool_started'
  | 'tool_completed'
  | 'tool_failed'
  | 'tool_result'
  | 'subagent_started'
  | 'subagent_completed'
  | 'progress_updated'
  | 'evidence_added'
  | 'summary_completed'
  | 'final_answer'
  | 'error';

export interface AgentRunEvent {
  type: AgentRunEventType;
  title?: string;
  message?: string;
  progress?: { current: number; total: number };
  step?: AgentStep;
  result?: AgentResultCard;
  stock?: StockDetail;
  toolCall?: ToolCallRecord;
  tool?: {
    name: string;
    purpose?: string;
    inputSummary?: string;
    outputSummary?: string;
    status?: 'running' | 'success' | 'failed';
    error?: string;
  };
  subAgent?: {
    name: string;
    description?: string;
    status?: 'pending' | 'running' | 'completed' | 'error';
    summary?: string;
  };
  command?: {
    name: string;
    args?: string;
    mode?: string;
  };
  intent?: {
    name: string;
    target?: string;
    mode?: string;
  };
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
  token?: string;
  runEvent?: AgentRunEvent;
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
  open?: number | string;
  high?: number | string;
  low?: number | string;
  prevClose?: number | string;
  pe?: number | string;
  pb?: number | string;
  roe?: number | string;
  marketCap?: string;
  volume?: string;
  turnover?: string;
  turnoverRate?: string | number;
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
  kline?: KlinePoint[];
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
export type MarketTab = 'sh-main' | 'sz-main' | 'bj' | 'gem' | 'star';
export type MarketIndexPeriod = '15m' | '1h' | '4h' | '1d';

export interface MarketQuoteRow {
  code: string;
  name: string;
  price?: number | string;
  changePercent?: number | string;
  volume?: number | string;
  amount?: number | string;
  open?: number | string;
  high?: number | string;
  low?: number | string;
  prevClose?: number | string;
  turnoverRate?: number | string;
  marketCap?: number | string;
}

export interface MarketBoardRow {
  code: string;
  name: string;
  price?: number | string;
  changePercent?: number | string;
  volume?: number | string;
  amount?: number | string;
  marketCap?: number | string;
  turnoverRate?: number | string;
  minutes: KlinePoint[];
  constituents?: BoardConstituent[];
}

export type MarketSearchResult = (MarketQuoteRow & { kind?: 'stock' }) | (MarketBoardRow & { kind: 'board' });

export interface MarketMinutePoint {
  time: string;
  price: number;
  volume?: number;
  amount?: number;
}

export interface MarketIndexSnapshot {
  code: string;
  name: string;
  price?: number | string;
  change?: number | string;
  changePercent?: number | string;
  open?: number | string;
  prevClose?: number | string;
  high?: number | string;
  low?: number | string;
  volume?: number | string;
  amount?: number | string;
  minutes: KlinePoint[];
}

export interface MarketPageSnapshot {
  tab: MarketTab;
  period?: MarketIndexPeriod;
  updatedAt: string;
  indices: MarketIndexSnapshot[];
  rows: MarketQuoteRow[];
  boards: MarketBoardRow[];
}

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

export interface StockSurgeEvent extends HotFocusItem {
  tradeDate: string;
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

export type AnalyticsProperties = Record<string, string | number | boolean | null | undefined>;

export interface IAppUpdateProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

export type TAppUpdateStatus = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';

export interface IAppUpdateState {
  status: TAppUpdateStatus;
  currentVersion: string;
  latestVersion?: string;
  releaseName?: string;
  releaseNotes?: string;
  progress?: IAppUpdateProgress;
  error?: string;
  message?: string;
}

export interface StocksenseApi {
  captureAnalytics?(event: string, properties?: AnalyticsProperties): Promise<void>;
  getConfig(): Promise<AppConfig>;
  setConfig(config: AppConfig): Promise<AppConfig>;
  testModelConfig(config: AppConfig): Promise<void>;
  listConversations(): Promise<ConversationSummary[]>;
  createConversation(): Promise<ConversationSummary>;
  deleteConversation(id: string): Promise<ConversationSummary[]>;
  renameConversation(id: string, title: string): Promise<ConversationSummary[]>;
  listMessages(conversationId: string): Promise<ChatMessage[]>;
  saveMessage(conversationId: string, message: ChatMessage): Promise<void>;
  sendChat(request: ChatRequest): Promise<ChatResponse>;
  onChatToken?(handler: (event: ChatStreamEvent) => void): () => void;
  getStockDetail(symbol: string): Promise<StockDetail>;
  searchStocks(query: string): Promise<MarketSearchResult[]>;
  getBoardDetail(symbol: string, forceRefresh?: boolean, boardName?: string): Promise<BoardDetail>;
  getKline(symbol: string, limit?: number, period?: string, beforeTimestamp?: number): Promise<KlinePoint[]>;
  listMarketNews(query?: string, page?: number, pageSize?: number): Promise<PagedMarketNews>;
  listHotFocus(tab: HotFocusTab): Promise<HotFocusItem[]>;
  listSurgeHistoryDates(): Promise<string[]>;
  listSurgeHistory(date: string, offset?: number, limit?: number): Promise<HotFocusItem[]>;
  listStockSurgeEvents(code: string): Promise<StockSurgeEvent[]>;
  getMarketDataSyncStatus(): Promise<MarketDataSyncStatus>;
  startMarketDataSync(): Promise<MarketDataSyncStatus>;
  retryMarketDataFailures(): Promise<MarketDataSyncStatus>;
  cancelMarketDataSync(): Promise<MarketDataSyncStatus>;
  getMarketDataStats(): Promise<MarketDataStats>;
  getMarketPageSnapshot(tab: MarketTab, period?: MarketIndexPeriod): Promise<MarketPageSnapshot>;
  onMarketPageSnapshotUpdated?(handler: (snapshot: MarketPageSnapshot) => void): () => void;
  onMarketDataProgress?(handler: (status: MarketDataSyncStatus) => void): () => void;
  listStoreItems(): Promise<StoreItem[]>;
  listInstalledStoreItems(): Promise<string[]>;
  installStoreItem(id: string): Promise<string[]>;
  uninstallStoreItem(id: string): Promise<string[]>;
  getAppUpdateState(): Promise<IAppUpdateState>;
  checkAppUpdate(settings?: IAppUpdateSettings): Promise<IAppUpdateState>;
  downloadAppUpdate(settings?: IAppUpdateSettings): Promise<IAppUpdateState>;
  installAppUpdate(): Promise<IAppUpdateState>;
  openAppReleaseNotes(): Promise<void>;
  selectAppUpdateDownloadDirectory(): Promise<string | undefined>;
  onAppUpdateStateChanged?(handler: (state: IAppUpdateState) => void): () => void;
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
