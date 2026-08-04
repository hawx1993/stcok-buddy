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
  notifyOnAiResponse?: boolean;
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
  | 'hot-concepts'
  | 'chip'
  | 'shareholder-count'
  | 'industry-ranking'
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
  adjustType?: 'qfq' | 'none' | 'qfq_weekly' | 'qfq_monthly';
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
  updatedAt: string;
  tab: ConversationTab;
  count: number;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  marketReview?: TMarketReviewReport;
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
  /** 节点已运行或完成的耗时（秒） */
  elapsed?: number;
  /** 节点开始时间戳 */
  startedAt?: string;
  /** 节点结束时间戳 */
  endedAt?: string;
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
  | 'intermediate_result'
  | 'data_source_checked'
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
    /** 子 Agent 已运行或完成的耗时（秒） */
    elapsed?: number;
  };
  command?: {
    name: string;
    args?: string;
    mode?: string;
    label?: string;
  };
  intent?: {
    name: string;
    target?: string;
    mode?: string;
    label?: string;
  };
  plan?: {
    agents: Array<{ id: string; agent: string; description: string }>;
  };
  intermediateResult?: {
    agentName: string;
    label: string;
    markdown: string;
    findings: StructuredAgentFinding[];
  };
  dataSource?: {
    name: string;
    status: 'pending' | 'loading' | 'done' | 'error';
  };
  evidence?: EvidenceItem[];
  findings?: StructuredAgentFinding[];
  marketReview?: TMarketReviewReport;
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
  industry?: string;
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

export type TBoardDashboardRange = 'today' | 'five-days' | 'twenty-days';
export type TBoardDashboardBucket = 'potential' | 'hot' | 'avoid' | 'leader';
export type TBoardDashboardSource = 'duckdb' | 'stock-sdk' | 'a-stock-data' | 'merged' | 'constituent-aggregate';

export interface IBoardLeaderCandidate {
  code: string;
  name: string;
  price?: number | null;
  changePercent?: number | null;
  mainNetInflow?: number | null;
  amount?: number | null;
  turnoverRate?: number | null;
  amplitude?: number | null;
  leaderScore: number | null;
  reason: string;
}

export interface IBoardDashboardMetric {
  boardCode: string;
  boardName: string;
  boardKind?: 'industry' | 'concept' | 'unknown';
  range: TBoardDashboardRange;
  tradeDate: string;
  changePercent: number | null;
  maxDailyChangePercent: number | null;
  mainNetInflow: number | null;
  amount: number | null;
  limitUpCount: number | null;
  upCount: number | null;
  downCount: number | null;
  constituentCount: number;
  upRatio: number | null;
  averageTurnoverRate: number | null;
  averageAmplitude: number | null;
  momentumScore: number | null;
  fundScore: number | null;
  breadthScore: number | null;
  leaderScore: number | null;
  riskScore: number | null;
  rawScore: number | null;
  heatScore: number | null;
  heatRank: number | null;
  bucket: TBoardDashboardBucket;
  leaders: IBoardLeaderCandidate[];
  reason: string;
  source: TBoardDashboardSource;
  updatedAt: string;
  warnings?: string[];
}

export interface IBoardDashboardSnapshot {
  range: TBoardDashboardRange;
  tradeDate: string;
  updatedAt: string;
  summary: {
    hottest?: IBoardDashboardMetric;
    potential?: IBoardDashboardMetric;
    avoid?: IBoardDashboardMetric;
    strongestLeader?: IBoardDashboardMetric;
  };
  rankings: IBoardDashboardMetric[];
  potential: IBoardDashboardMetric[];
  hot: IBoardDashboardMetric[];
  avoid: IBoardDashboardMetric[];
  leaders: IBoardDashboardMetric[];
  tips?: string[];
  warnings?: string[];
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

export type TChipDistributionSource = 'stock-sdk' | 'a-stock-data';

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

export interface IChipDistributionResult {
  latest?: ChipDistribution;
  distributions: ChipDistribution[];
  trend: Array<{ days: number; concentration70?: number; concentration90?: number }>;
  source: TChipDistributionSource;
  warnings?: string[];
}

export type TMonitorCategory =
  | 'large-order'
  | 'chip'
  | 'technical'
  | 'dragon-tiger'
  | 'news'
  | 'risk'
  | 'ai-opportunity'
  | 'ai-warning';

export type TMonitorMode = 'realtime' | 'history';

export interface IMonitorEvent {
  id: string;
  category: TMonitorCategory;
  timestamp: string;
  code: string;
  name: string;
  price?: number | string;
  changePercent?: number | string;
  title: string;
  badge?: string;
  details: string[];
  aiAnalysis: string;
  star?: boolean;
  chart?: {
    type: 'line' | 'bar' | 'radar';
    data: number[];
    labels?: string[];
  };
  score?: number;
}

export interface IMonitorFeed {
  updatedAt: string;
  events: IMonitorEvent[];
  mode: TMonitorMode;
  isTradingTime: boolean;
  availableDates: string[];
  selectedDate?: string;
  total?: number;
  categoryTotals?: Partial<Record<TMonitorCategory, number>>;
}

export interface IStockNewsSubscription {
  code: string;
  name: string;
  createdAt: string;
}

export interface IStockNewsPreferences {
  favoritesOnly: boolean;
  manualStocks: IStockNewsSubscription[];
}

export interface IStockNewsFeed {
  preferences: IStockNewsPreferences;
  items: MarketNewsItem[];
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
  stockCode?: string;
  stockName?: string;
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

export interface IMarketNewsSummary {
  tradeDate: string;
  generatedAt: string;
  content: string;
  sourceNews: Array<Pick<MarketNewsItem, 'id' | 'title' | 'source' | 'time' | 'url' | 'content'>>;
}

export interface IMarketNewsSummaryState {
  tradeDate: string;
  summary?: IMarketNewsSummary;
  error?: string;
}

export type HotFocusTab = 'sector' | 'market' | 'surge' | 'strategy' | 'diagnosis' | 'flow';
export type MarketTab = 'sh-main' | 'sz-main' | 'bj' | 'gem' | 'star';
export type MarketIndexPeriod = '15m' | '1h' | '4h' | '1d' | '1w' | '1mo';
export type TDragonTigerRange = 'today' | '5d' | '10d' | '30d';

export interface IDragonTigerDetailRow {
  id: string;
  code: string;
  name: string;
  date: string;
  reason: string;
  close: number | null;
  changePercent: number | null;
  netBuyAmount: number | null;
  buyAmount: number | null;
  sellAmount: number | null;
  dealAmount: number | null;
  totalAmount: number | null;
  netBuyRatio: number | null;
  dealAmountRatio: number | null;
  turnoverRate: number | null;
  floatMarketValue: number | null;
  afterChange1d: number | null;
  afterChange2d: number | null;
  afterChange5d: number | null;
  afterChange10d: number | null;
}

export interface IDragonTigerLeader {
  code: string;
  name: string;
  date: string;
  value: number;
  changePercent: number | null;
  reason: string;
}

export interface IDragonTigerReasonStat {
  reason: string;
  count: number;
  netBuyAmount: number;
  buyAmount: number;
  sellAmount: number;
}

export interface IDragonTigerInstitutionRow {
  code: string;
  name: string;
  date: string;
  price: number | null;
  changePercent: number | null;
  buyOrgCount: number | null;
  sellOrgCount: number | null;
  orgBuyAmount: number | null;
  orgSellAmount: number | null;
  orgNetAmount: number | null;
}

export interface IDragonTigerBranchRow {
  code: string;
  name: string;
  totalBuyAmount: number | null;
  totalSellAmount: number | null;
  buyCount: number | null;
  sellCount: number | null;
  totalCount: number | null;
}

export interface IDragonTigerSummary {
  tradeDate: string;
  startDate: string;
  endDate: string;
  totalCount: number;
  netBuyAmount: number;
  buyAmount: number;
  sellAmount: number;
  netBuyCount: number;
  netSellCount: number;
  topNetBuy?: IDragonTigerLeader;
  dataSource: 'stock-sdk';
  updatedAt: string;
}

export interface IDragonTigerSnapshot {
  range: TDragonTigerRange;
  summary: IDragonTigerSummary;
  topNetBuy: IDragonTigerDetailRow[];
  topNetSell: IDragonTigerDetailRow[];
  activeReasons: IDragonTigerReasonStat[];
  institutionTop: IDragonTigerInstitutionRow[];
  branchTop: IDragonTigerBranchRow[];
  rows: IDragonTigerDetailRow[];
  warnings: string[];
}

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
  industry?: string;
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

export interface IStockTimelinePoint {
  time: string;
  timestamp?: number;
  price: number;
  volume?: number;
  amount?: number;
  avgPrice?: number;
}

export interface IStockTimelineSnapshot {
  code: string;
  date?: string;
  preClose?: number;
  points: IStockTimelinePoint[];
  source: 'stock-sdk';
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
  rowOrderSource?: 'local' | 'remote';
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

export interface IHotStockHintSource {
  items: HotFocusItem[];
  tradeDate?: string;
  isPreviousTradeDay: boolean;
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

export type TMarketReviewRating = 1 | 2 | 3 | 4 | 5;

export interface IMarketReviewMetric {
  label: string;
  value: number | null;
  unit?: '家' | '%' | '板' | '亿' | '分';
}

export interface IMarketReviewHotTheme {
  id: string;
  boardCode: string | null;
  name: string;
  score: TMarketReviewRating | null;
  changePercent: number | null;
  limitUpCount: number | null;
  leaderName: string | null;
  leaderCode: string | null;
  leaderHeight: number | null;
  mainNetInflow: number | null;
  amount: number | null;
  limitUpStocks: Array<{ code: string; name: string; height: number | null }>;
  coreStocks: Array<{ code: string; name: string; changePercent: number | null }>;
  reason: string | null;
  trackingNote: string | null;
}

export interface IMarketReviewLeader {
  code: string;
  name: string;
  concepts: string[];
  height: number | null;
  amount: number | null;
  turnoverRate: number | null;
  sealAmount: number | null;
  changePercent: number | null;
}

export type TMarketReviewWatchCategory = 'leader' | 'theme' | 'liquidity' | 'sentiment' | 'risk' | 'northbound';
export type TMarketReviewTone = 'up' | 'down' | 'neutral' | 'warn';

export interface IMarketReviewWatchItem {
  id: string;
  category: TMarketReviewWatchCategory;
  condition: string;
  baseline: number | null;
  unit?: '%' | '家' | '亿' | '板';
  tone: TMarketReviewTone;
}

export interface TMarketReviewReport {
  tradeDate: string;
  generatedAt: string;
  dataSources: string[];
  dataGaps: string[];
  indexSummary: Array<{ name: string; changePercent: number | null; amount: number | null }>;
  sentimentScore: number | null;
  sentiment: IMarketReviewMetric[];
  wealthEffect: IMarketReviewMetric[];
  profitDirections: string[];
  lossDirections: string[];
  hotThemes: IMarketReviewHotTheme[];
  leaders: IMarketReviewLeader[];
  nextDayFocus: IMarketReviewWatchItem[];
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

export interface IPendingDownloadedUpdate {
  version: string;
  releaseName?: string;
  releaseNotes?: string;
  message?: string;
}

export type TAppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

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

export interface IAppRuntimeInfo {
  version: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
}

export interface IDesktopNotificationResult {
  delivered: boolean;
  reason?: string;
}

export interface IStorageStats {
  chat: { label: string; bytes: number };
  config: { label: string; bytes: number };
  market: { label: string; bytes: number };
  surge: { label: string; bytes: number };
  monitor: { label: string; bytes: number };
}

export interface IDiskInfo {
  totalBytes: number;
  freeBytes: number;
  usedByAppBytes: number;
}

export interface IStorageClearProgress {
  key: string;
  processed: number;
  total: number;
  message: string;
  /** 0-1 sub-progress within the current key, for smooth bar animation */
  fraction?: number;
}

export type DataSyncTaskType = 'kline' | 'surge' | 'stockDetail' | 'marketSnapshot';

export interface IDataSyncTaskProgress {
  taskType: DataSyncTaskType;
  status: 'running' | 'completed' | 'error';
  processed: number;
  total: number;
  message: string;
  error?: string;
}

export interface ITradingAdviceSector {
  name: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  leaderCode: string;
  leaderName: string;
}

export interface ITradingAdvice {
  starRating: number;
  starLabel: string;
  suggestedPosition: number;
  positionReason: string;
  suitableStrategies: string[];
  unsuitableStrategies: string[];
  keySectors: ITradingAdviceSector[];
  marketSummary: string;
  riskReminder: string;
}

export type TDiscoverySnapshotSection =
  | 'trade-date-nav'
  | 'hero'
  | 'market-summary'
  | 'opportunity-radar'
  | 'sentiment'
  | 'dragon-tiger'
  | 'hot-rotation'
  | 'limit-up'
  | 'tomorrow';

export interface IDiscoverySnapshotOptions {
  tradeDate?: string;
  sections?: TDiscoverySnapshotSection[];
}

export interface ITradingAdviceOptions {
  tradeDate?: string;
}

export interface StocksenseApi {
  getStorageStats(): Promise<IStorageStats>;
  clearStorage(keys: string[]): Promise<IStorageStats>;
  onStorageClearProgress?(handler: (progress: IStorageClearProgress) => void): () => void;
  getDiskInfo(): Promise<IDiskInfo>;
  captureAnalytics?(event: string, properties?: AnalyticsProperties): Promise<void>;
  getConfig(): Promise<AppConfig>;
  setConfig(config: AppConfig): Promise<AppConfig>;
  getAppRuntimeInfo(): Promise<IAppRuntimeInfo>;
  openFeedbackEmail(): Promise<void>;
  testModelConfig(config: AppConfig): Promise<void>;
  testAiResponseNotification(): Promise<IDesktopNotificationResult>;
  openSystemNotificationSettings(): Promise<void>;
  listConversations(): Promise<ConversationSummary[]>;
  createConversation(): Promise<ConversationSummary>;
  deleteConversation(id: string): Promise<ConversationSummary[]>;
  renameConversation(id: string, title: string): Promise<ConversationSummary[]>;
  listMessages(conversationId: string): Promise<ChatMessage[]>;
  saveMessage(conversationId: string, message: ChatMessage): Promise<void>;
  sendChat(request: ChatRequest): Promise<ChatResponse>;
  onChatToken?(handler: (event: ChatStreamEvent) => void): () => void;
  onAiResponseNotification?(handler: (payload: { title: string; body: string; source: 'system' | 'in-app' }) => void): () => void;
  getStockDetail(symbol: string): Promise<StockDetail>;
  searchStocks(query: string): Promise<MarketSearchResult[]>;
  getBoardDetail(symbol: string, forceRefresh?: boolean, boardName?: string): Promise<BoardDetail>;
  getBoardDashboard(range?: TBoardDashboardRange, forceRefresh?: boolean): Promise<IBoardDashboardSnapshot>;
  getKline(symbol: string, limit?: number, period?: string, beforeTimestamp?: number): Promise<KlinePoint[]>;
  getChipDistribution(symbol: string): Promise<IChipDistributionResult>;
  getBatchQuotes(codes: string[]): Promise<StockDetail[]>;
  getStockTimelines(codes: string[]): Promise<Record<string, IStockTimelineSnapshot>>;
  listMarketNews(query?: string, page?: number, pageSize?: number): Promise<PagedMarketNews>;
  listStockNews(code: string, limit?: number): Promise<MarketNewsItem[]>;
  listStockNewsFeed(): Promise<IStockNewsFeed>;
  getStockNewsPreferences(): Promise<IStockNewsPreferences>;
  setStockNewsFavoritesOnly(favoritesOnly: boolean): Promise<IStockNewsPreferences>;
  addStockNewsSubscription(stock: Pick<IStockNewsSubscription, 'code' | 'name'>): Promise<IStockNewsPreferences>;
  removeStockNewsSubscription(code: string): Promise<IStockNewsPreferences>;
  getMarketNewsSummaryState(): Promise<IMarketNewsSummaryState>;
  getMarketNewsItem(
    item: Pick<MarketNewsItem, 'id' | 'title' | 'source' | 'time' | 'url' | 'content'>,
  ): Promise<MarketNewsItem>;
  listHotFocus(tab: HotFocusTab): Promise<HotFocusItem[]>;
  getHotStockHintSource(): Promise<IHotStockHintSource>;
  listSurgeHistoryDates(): Promise<string[]>;
  listSurgeHistory(date: string, offset?: number, limit?: number): Promise<HotFocusItem[]>;
  listStockSurgeEvents(code: string): Promise<StockSurgeEvent[]>;
  ensureMarketDataReady(): Promise<void>;
  getMarketDataSyncStatus(): Promise<MarketDataSyncStatus>;
  startMarketDataSync(): Promise<MarketDataSyncStatus>;
  retryMarketDataFailures(): Promise<MarketDataSyncStatus>;
  cancelMarketDataSync(): Promise<MarketDataSyncStatus>;
  getMarketDataStats(): Promise<MarketDataStats>;
  getMarketPageSnapshot(tab: MarketTab, period?: MarketIndexPeriod): Promise<MarketPageSnapshot>;
  getDragonTigerSnapshot(range?: TDragonTigerRange): Promise<IDragonTigerSnapshot>;
  getDiscoverySnapshot(options?: IDiscoverySnapshotOptions): Promise<Record<string, unknown>>;
  getMonitorFeed(options?: { categories?: TMonitorCategory[]; since?: string; limit?: number; offset?: number; date?: string; mode?: TMonitorMode }): Promise<IMonitorFeed>;
  getTradingAdvice(options?: ITradingAdviceOptions): Promise<ITradingAdvice>;
  onMarketPageSnapshotUpdated?(handler: (snapshot: MarketPageSnapshot) => void): () => void;
  onMarketDataProgress?(handler: (status: MarketDataSyncStatus) => void): () => void;
  syncKlines(): Promise<MarketDataSyncStatus>;
  syncSurgeHistory(): Promise<void>;
  syncStockDetails(): Promise<void>;
  syncMarketSnapshot(): Promise<void>;
  onDataSyncProgress?(handler: (progress: IDataSyncTaskProgress) => void): () => void;
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
  onFavoritesCleared?(handler: () => void): () => void;
}

declare global {
  interface Window {
    stocksense?: StocksenseApi;
  }
}
