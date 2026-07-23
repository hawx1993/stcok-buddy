import type { AgentResultCard, AgentRunEvent, EvidenceItem, HotFocusItem, StockDetail } from '../../../src/shared/types.js';
import { callTool } from '../tools/tool-registry.js';
import type { IAgentContext, ILinkedPage } from './orchestrator-types.js';

export async function runContextTool<T>(ctx: IAgentContext, name: string, input: unknown, fallback: () => T): Promise<T> {
  const startedAt = new Date().toISOString();
  ctx.emitEvent?.({
    type: 'tool_started', title: '工具调用', message: `正在执行 ${name}`,
    toolCall: { id: `tool-pending-${startedAt}-${name}`, toolName: name, input, inputSummary: summarizeEventValue(input), startedAt },
    tool: { name, inputSummary: summarizeEventValue(input), status: 'running' },
  });
  const record = await callTool(name, input);
  ctx.toolCalls.push(record);
  ctx.emitEvent?.({
    type: record.error ? 'tool_failed' : 'tool_completed', title: record.error ? '工具失败' : '工具结果',
    message: record.error ? `${name} 失败，已使用兜底策略继续分析` : `${name} completed`, toolCall: record,
    tool: { name, inputSummary: record.inputSummary, outputSummary: record.outputSummary, status: record.error ? 'failed' : 'success', error: record.error },
  });
  if (!record.error) {
    ctx.emitEvent?.({ type: 'evidence_added', title: '证据更新', message: `${name} 返回可用数据`, evidence: dedupeEvidence(ctx.evidence) });
  }
  return record.error ? fallback() : (record.output as T);
}

export function buildStockAnalysisInput(ctx: IAgentContext) {
  return {
    query: buildReportQuery(ctx.query, ctx.linkedPages), symbol: ctx.symbol!, stockLabel: ctx.quote?.name ?? ctx.symbol!,
    quote: ctx.quote, technical: ctx.technical, kline: ctx.kline, news: ctx.news, chip: ctx.chip,
    fundFlow: ctx.fundFlow, largeOrders: ctx.largeOrders, evidence: dedupeEvidence(ctx.evidence),
  };
}

export function dedupeEvidence(items: EvidenceItem[]): EvidenceItem[] {
  return items.filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index);
}

export function dataGaps(ctx: IAgentContext): string[] {
  const gaps: string[] = [];
  if (needsSymbol(ctx.intent) && !ctx.quote) gaps.push('行情');
  if ((ctx.intent === 'analysis' || ctx.intent === 'technical') && !ctx.technical) gaps.push('技术指标');
  if ((ctx.intent === 'analysis' || ctx.intent === 'news-announcements') && !ctx.news?.length) gaps.push('新闻');
  if (ctx.intent === 'news-announcements' && !ctx.announcements?.length) gaps.push('公告');
  return gaps;
}

export function filterLargeOrders(items: HotFocusItem[], symbol: string): HotFocusItem[] {
  return items.filter((item) => item.code === symbol && /特大单/.test(`${item.description ?? ''}${item.tag ?? ''}${item.amount ?? ''}`));
}

export function enrichTechnicalCard(card?: AgentResultCard, quote?: StockDetail): AgentResultCard | undefined {
  return card && quote ? { ...card, stocks: [quote] } : card;
}

function buildReportQuery(query: string, pages?: ILinkedPage[]): string {
  if (!pages?.length) return query;
  let used = 0;
  const blocks = pages.map((page, index) => {
    const content = page.content.slice(0, Math.min(4000, Math.max(0, 8000 - used)));
    used += content.length;
    return ` ${index + 1}. 标题：${page.title ?? '未提取'}\nURL：${page.url}\n正文摘录：\n${content}`;
  }).filter((block) => block.trim());
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
