import type {
  AgentResultCard,
  AgentRunEvent,
  EvidenceItem,
  HotFocusItem,
  IAgentDataStatus,
  StockDetail,
} from '../../../src/shared/types.js';
import { callTool } from '../tools/tool-registry.js';
import { findPlanItemIdsByDataName } from './agent-planning.js';
import type { IAgentContext, ILinkedPage } from './orchestrator-types.js';

export async function runContextTool<T>(
  ctx: IAgentContext,
  name: string,
  input: unknown,
  fallback: () => T,
): Promise<T> {
  const startedAt = new Date().toISOString();
  ctx.emitEvent?.({
    type: 'tool_started',
    title: '工具调用',
    message: `正在执行 ${name}`,
    toolCall: {
      id: `tool-pending-${startedAt}-${name}`,
      toolName: name,
      input,
      inputSummary: summarizeEventValue(input),
      startedAt,
    },
    tool: { name, inputSummary: summarizeEventValue(input), status: 'running' },
  });
  const record = await callTool(name, input);
  ctx.toolCalls.push(record);
  const dataStatuses = createDataStatuses(ctx, name, record.id, record.output, record.error);
  ctx.dataStatuses = [...(ctx.dataStatuses ?? []), ...dataStatuses];
  const hasDataGap = dataStatuses.some((status) => status.status !== 'available');
  ctx.emitEvent?.({
    type: record.error ? 'tool_failed' : 'tool_completed',
    title: record.error ? '工具失败' : '工具结果',
    message: record.error
      ? `${name} 失败，已记录数据缺口并降低相关结论置信度`
      : hasDataGap
        ? `${name} completed，已记录数据缺口`
        : `${name} completed`,
    toolCall: record,
    tool: {
      name,
      inputSummary: record.inputSummary,
      outputSummary: record.outputSummary,
      status: record.error ? 'failed' : 'success',
      error: record.error,
    },
  });
  if (!record.error && !hasDataGap) {
    ctx.emitEvent?.({
      type: 'evidence_added',
      title: '证据更新',
      message: `${name} 返回可用数据`,
      evidence: dedupeEvidence(ctx.evidence),
    });
  }
  return record.error ? fallback() : (record.output as T);
}

export function buildStockAnalysisInput(ctx: IAgentContext) {
  return {
    query: buildReportQuery(ctx.query, ctx.linkedPages),
    symbol: ctx.symbol!,
    stockLabel: ctx.quote?.name ?? ctx.symbol!,
    quote: ctx.quote,
    technical: ctx.technical,
    kline: ctx.kline,
    news: ctx.news,
    chip: ctx.chip,
    fundFlow: ctx.fundFlow,
    largeOrders: ctx.largeOrders,
    evidence: dedupeEvidence(ctx.evidence),
    plan: ctx.plan,
    dataGaps: ctx.plan?.dataGaps ?? ctx.finalReflection?.dataGaps ?? [],
    planRevisions: ctx.plan?.revisions ?? ctx.finalReflection?.revisions ?? [],
  };
}

export function dedupeEvidence(items: EvidenceItem[]): EvidenceItem[] {
  return items.filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index);
}

export function dataGaps(ctx: IAgentContext): string[] {
  const gaps = new Set<string>();
  for (const status of ctx.dataStatuses ?? []) {
    if (status.status !== 'available') gaps.add(status.dataName);
  }
  if (needsSymbol(ctx.intent) && !ctx.quote) gaps.add('行情');
  if ((ctx.intent === 'analysis' || ctx.intent === 'technical') && !ctx.technical) gaps.add('技术指标');
  if ((ctx.intent === 'analysis' || ctx.intent === 'news-announcements') && !ctx.news?.length) gaps.add('新闻');
  if (ctx.intent === 'news-announcements' && !ctx.announcements?.length) gaps.add('公告');
  return [...gaps];
}

export function createSkippedDataStatus(
  ctx: IAgentContext,
  toolName: string,
  dataName: string,
  reason: string,
): IAgentDataStatus {
  return {
    id: `data-status-skipped-${toolName}-${dataName}`,
    toolName,
    dataName,
    status: 'skipped',
    reason,
    relatedPlanItemIds: findPlanItemIdsByDataName(ctx.plan, dataName),
  };
}

export function createDataStatuses(
  ctx: IAgentContext,
  toolName: string,
  recordId: string,
  output: unknown,
  error?: string,
): IAgentDataStatus[] {
  return dataNamesForTool(toolName).map((dataName, index) => {
    const scopedOutput = outputForDataName(output, dataName);
    const status = inferToolDataStatus(scopedOutput, error);
    return {
      id: `data-status-${recordId}-${index + 1}`,
      toolName,
      dataName,
      status,
      reason: reasonForStatus(status, toolName, scopedOutput, error),
      relatedPlanItemIds: findPlanItemIdsByDataName(ctx.plan, dataName),
      recordId,
    };
  });
}

export function inferToolDataStatus(output: unknown, error?: string): IAgentDataStatus['status'] {
  if (error) return 'failed';
  if (hasFreshness(output, 'fallback') || hasFreshness(output, 'stale')) return 'stale';
  if (hasWarnings(output) || hasIncompleteFlag(output)) return 'partial';
  if (isEmptyToolOutput(output)) return 'empty';
  return 'available';
}

export function isEmptyToolOutput(output: unknown): boolean {
  if (output === undefined || output === null) return true;
  if (Array.isArray(output)) return output.length === 0;
  if (typeof output !== 'object') return false;
  const record = output as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => key !== 'meta' && key !== 'source' && key !== 'warnings');
  if (!keys.length) return true;
  const knownKeys = ['data', 'rows', 'list', 'news', 'announcements', 'items', 'top', 'bottom'];
  const presentKnownKeys = knownKeys.filter((key) => key in record);
  if (!presentKnownKeys.length) return false;
  return presentKnownKeys.every((key) => isEmptyToolOutput(record[key]));
}

function outputForDataName(output: unknown, dataName: string): unknown {
  if (!isRecord(output)) return output;
  if (dataName === '新闻') return withSharedMeta(output.news, output);
  if (dataName === '公告') return withSharedMeta(output.announcements, output);
  if (dataName === 'K线' && 'data' in output) return output;
  if (dataName === '热门股/概念') return withSharedMeta(output.list, output);
  if (dataName === '行业涨幅/资金流') return withSharedMeta(output.ranking ?? output.flow, output);
  return output;
}

function withSharedMeta(value: unknown, parent: Record<string, unknown>): unknown {
  if (isRecord(value)) {
    return { ...value, meta: value.meta ?? parent.meta, warnings: value.warnings ?? parent.warnings };
  }
  return value;
}

function dataNamesForTool(toolName: string): string[] {
  const map: Record<string, string[]> = {
    getStockQuote: ['行情'],
    getStockQuoteLocalFirst: ['行情'],
    getHistoricalDailyBars: ['K线'],
    getStockKline: ['K线'],
    getStockKlineLocalFirst: ['K线'],
    getTechnicalIndicators: ['技术指标'],
    getStockNewsAnnouncements: ['新闻', '公告'],
    getMarketNews: ['新闻'],
    getStockFundFlowSnapshot: ['资金流'],
    getStockFundFlowLocalFirst: ['资金流'],
    getStockSurgeEventsLocalFirst: ['个股异动历史'],
    getStockChipDistribution: ['筹码集中度'],
    getStockChipDistributionLocalFirst: ['筹码集中度'],
    screenLocalAStocks: ['本地选股/筹码筛选'],
    screenASharesByMarketCap: ['A股市值筛选'],
    getHotFocus: ['热点/特大单'],
    queryLocalSurgeDuckDB: ['个股异动历史'],
    getMarketReview: ['市场复盘'],
    getDragonTiger: ['龙虎榜'],
    getHotConcepts: ['热门股/概念'],
    getIndustryRanking: ['行业涨幅/资金流'],
    getHolderNumberChange: ['股东户数'],
    readUrl: ['链接正文'],
  };
  return map[toolName] ?? [toolName];
}

function reasonForStatus(status: IAgentDataStatus['status'], toolName: string, output: unknown, error?: string): string {
  if (status === 'failed') return `${toolName} 调用失败：${error ?? '未知错误'}`;
  if (status === 'empty') return `${toolName} 未返回可用样本。`;
  if (status === 'stale') return `${toolName} 返回的数据可能过期或来自不可用兜底标记。`;
  if (status === 'partial') return `${toolName} 返回的数据不完整：${collectWarnings(output).join('；') || '存在缺失字段或不完整标记'}`;
  return `${toolName} 返回可用数据。`;
}

function hasFreshness(output: unknown, freshness: 'fallback' | 'stale'): boolean {
  return readStringField(output, 'freshness') === freshness || readNestedStringField(output, 'meta', 'freshness') === freshness;
}

function hasWarnings(output: unknown): boolean {
  return collectWarnings(output).length > 0;
}

function hasIncompleteFlag(output: unknown): boolean {
  return readBooleanField(output, 'isComplete') === false || readNestedBooleanField(output, 'meta', 'isComplete') === false;
}

function collectWarnings(output: unknown): string[] {
  const warnings = readArrayField(output, 'warnings');
  const metaWarnings = readNestedArrayField(output, 'meta', 'warnings');
  return [...warnings, ...metaWarnings].map(String).filter(Boolean);
}

function readStringField(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === 'string' ? value[key] : undefined;
}

function readBooleanField(value: unknown, key: string): boolean | undefined {
  return isRecord(value) && typeof value[key] === 'boolean' ? value[key] : undefined;
}

function readArrayField(value: unknown, key: string): unknown[] {
  return isRecord(value) && Array.isArray(value[key]) ? value[key] : [];
}

function readNestedStringField(value: unknown, parent: string, key: string): string | undefined {
  return isRecord(value) ? readStringField(value[parent], key) : undefined;
}

function readNestedBooleanField(value: unknown, parent: string, key: string): boolean | undefined {
  return isRecord(value) ? readBooleanField(value[parent], key) : undefined;
}

function readNestedArrayField(value: unknown, parent: string, key: string): unknown[] {
  return isRecord(value) ? readArrayField(value[parent], key) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function filterLargeOrders(items: HotFocusItem[], symbol: string): HotFocusItem[] {
  return items.filter(
    (item) => item.code === symbol && /特大单/.test(`${item.description ?? ''}${item.tag ?? ''}${item.amount ?? ''}`),
  );
}

export function enrichTechnicalCard(card?: AgentResultCard, quote?: StockDetail): AgentResultCard | undefined {
  return card && quote ? { ...card, stocks: [quote] } : card;
}

function buildReportQuery(query: string, pages?: ILinkedPage[]): string {
  if (!pages?.length) return query;
  let used = 0;
  const blocks = pages
    .map((page, index) => {
      const content = page.content.slice(0, Math.min(4000, Math.max(0, 8000 - used)));
      used += content.length;
      return ` ${index + 1}. 标题：${page.title ?? '未提取'}\nURL：${page.url}\n正文摘录：\n${content}`;
    })
    .filter((block) => block.trim());
  return `${query}\n\n用户提供的链接内容：\n${blocks.join('\n\n')}`;
}

function summarizeEventValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.replace(/\s+/g, ' ').slice(0, 300);
}

function needsSymbol(intent: IAgentContext['intent']): boolean {
  return intent === 'quote' || intent === 'technical' || intent === 'analysis' || intent === 'news-announcements';
}
