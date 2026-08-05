import type {
  AgentResultCard,
  AgentRunEvent,
  AnnouncementItem,
  ComplianceReview,
  EvidenceItem,
  HotFocusItem,
  IAgentDataStatus,
  IAgentPlan,
  IAgentReflectionResult,
  IStockFundFlowSnapshot,
  KlinePoint,
  MarketNewsItem,
  StockDetail,
  StructuredAgentFinding,
  TMarketReviewReport,
  ToolCallRecord,
} from '../../../src/shared/types.js';
import type { DailyDragonTigerItem } from '../stock/stock-client.js';
import type { StockAnalysisAgentName, StockAnalysisResult } from './stock-analysis-agents.js';

export type TAgentIntent =
  | 'quote'
  | 'technical'
  | 'analysis'
  | 'news-announcements'
  | 'theme-attribution'
  | 'daily-lhb'
  | 'market-review'
  | 'board'
  | 'portfolio'
  | 'shareholder-chip'
  | 'hot-concepts'
  | 'industry-ranking'
  | 'a-stock-data-agent'
  | 'chat';

export interface ILinkedPage {
  url: string;
  title?: string;
  content: string;
}

export interface IAgentContext {
  query: string;
  intent: TAgentIntent;
  urls: string[];
  symbol?: string;
  boardKeyword?: string;
  quote?: StockDetail;
  technical?: AgentResultCard;
  board?: AgentResultCard;
  kline?: KlinePoint[];
  news?: MarketNewsItem[];
  announcements?: AnnouncementItem[];
  hotFocus?: HotFocusItem[];
  chip?: unknown;
  fundFlow?: IStockFundFlowSnapshot;
  largeOrders?: HotFocusItem[];
  dailyDragonTiger?: DailyDragonTigerItem[];
  marketReview?: TMarketReviewReport;
  linkedPages?: ILinkedPage[];
  analysisResults?: StockAnalysisResult[];
  analysisOverview?: string;
  themeAttribution?: string;
  singleAgent?: StockAnalysisAgentName;
  evidence: EvidenceItem[];
  toolCalls: ToolCallRecord[];
  findings: StructuredAgentFinding[];
  plan?: IAgentPlan;
  dataStatuses?: IAgentDataStatus[];
  finalReflection?: IAgentReflectionResult;
  compliance?: ComplianceReview;
  emitEvent?: (event: AgentRunEvent) => void;
}

export type TOnToken = (token: string) => void;
