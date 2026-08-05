import type { AgentRunEvent } from '../../../../shared/types';
import type { IAgentStatus, IDataSource, IIntermediateResult, IStep, ITimelineEntry } from './types';

// ── Agent color map ──
const AGENT_COLORS: Record<string, string> = {
  DataAgent: '#52c41a',
  TechnicalAgent: '#faad14',
  Technical: '#faad14',
  NewsAnalysisAgent: '#1890ff',
  Fundamental: '#722ed1',
  Capital: '#eb2f96',
  Sentiment: '#fa8c16',
  Chip: '#13c2c2',
  Overview: '#ffffff',
  LocalDuckDBAgent: '#13c2c2',
  DuckDB: '#13c2c2',
  Orchestrator: '#8c8c8c',
};

export function getAgentColor(agentName: string): string {
  for (const [key, color] of Object.entries(AGENT_COLORS)) {
    if (agentName.includes(key)) return color;
  }
  return AGENT_COLORS.Orchestrator;
}

// ── Step labels ──
const STEP_LABELS: Record<string, string> = {
  quote: '获取实时行情',
  'market-data': '获取K线与指标',
  'analysis-technical': '技术面分析',
  'analysis-fundamental': '基本面分析',
  'analysis-capital': '资金面分析',
  'analysis-sentiment': '消息面分析',
  'analysis-chip': '筹码分析',
  'analysis-report': '生成投研报告',
  'read-links': '读取链接内容',
  chat: '投研问答',
};

function stepLabel(nodeId: string, description?: string): string {
  if (STEP_LABELS[nodeId]) return STEP_LABELS[nodeId];
  if (description) return description;
  return nodeId;
}

type TProviderStage = 'duckdb' | 'stock-sdk' | 'a-stock-data';

const PROVIDER_STAGE_LABELS: Record<TProviderStage, string> = {
  duckdb: '1. 查询 DuckDB 本地库',
  'stock-sdk': '2. stock-sdk 补充',
  'a-stock-data': '3. a-stock-data 补充',
};

const LOCAL_TOOL_NAMES = new Set([
  'queryLocalDuckDBData',
  'screenLocalAStocks',
  'queryLocalMarketDuckDB',
  'queryLocalMonitorDuckDB',
  'queryLocalSurgeDuckDB',
]);

const STOCK_SDK_TOOL_NAMES = new Set([
  'getStockQuoteLocalFirst',
  'getStockKlineLocalFirst',
  'getStockFundFlowLocalFirst',
  'getStockQuote',
  'getStockKline',
  'getHistoricalDailyBars',
  'getTechnicalIndicators',
  'getStockChipDistribution',
  'getStockNewsAnnouncements',
  'getMarketReview',
  'getNorthboundFlow',
  'getDragonTiger',
]);

const A_STOCK_DATA_TOOL_NAMES = new Set([
  'getHotConcepts',
  'getIndustryRanking',
  'getHotFocus',
  'getHolderNumberChange',
  'getDividendHistory',
]);

function providerStageForTool(toolName: string): TProviderStage | undefined {
  if (LOCAL_TOOL_NAMES.has(toolName)) return 'duckdb';
  if (STOCK_SDK_TOOL_NAMES.has(toolName)) return 'stock-sdk';
  if (A_STOCK_DATA_TOOL_NAMES.has(toolName)) return 'a-stock-data';
  return undefined;
}

function isFreeQuestionProviderFlow(events: AgentRunEvent[]): boolean {
  return events.some(
    (event) =>
      event.step?.id === 'a-stock-data-agent' ||
      event.plan?.agents.some((agent) => agent.id === 'a-stock-data-agent'),
  );
}

function providerStepLabel(stage: TProviderStage, status: IStep['status']): string {
  if (stage === 'duckdb') {
    if (status === 'running') return '1. 正在查询 DuckDB 本地库';
    if (status === 'completed') return '1. DuckDB 本地库数据可用';
    if (status === 'error') return '1. DuckDB 本地库不可用';
  }
  if (stage === 'stock-sdk') {
    if (status === 'running') return '2. 正在调用 stock-sdk 补充';
    if (status === 'completed') return '2. stock-sdk 数据可用';
    if (status === 'skipped') return '2. stock-sdk 已跳过';
    if (status === 'error') return '2. stock-sdk 不可用';
  }
  if (stage === 'a-stock-data') {
    if (status === 'running') return '3. 正在调用 a-stock-data 补充';
    if (status === 'completed') return '3. a-stock-data 数据可用';
    if (status === 'skipped') return '3. a-stock-data 已跳过';
    if (status === 'error') return '3. a-stock-data 不可用';
  }
  return PROVIDER_STAGE_LABELS[stage];
}

function isTerminalStepStatus(status: IStep['status']): boolean {
  return status === 'completed' || status === 'skipped' || status === 'error';
}

function setProviderStageStatus(
  statusMap: Map<TProviderStage, IStep['status']>,
  stage: TProviderStage,
  status: IStep['status'],
): void {
  const previous = statusMap.get(stage);
  if (status === 'running' && previous && isTerminalStepStatus(previous)) return;
  statusMap.set(stage, status);
}

function deriveProviderSteps(events: AgentRunEvent[]): IStep[] | undefined {
  if (!isFreeQuestionProviderFlow(events)) return undefined;

  const statusMap = new Map<TProviderStage, IStep['status']>([
    ['duckdb', 'pending'],
    ['stock-sdk', 'pending'],
    ['a-stock-data', 'pending'],
  ]);
  let hasProviderTool = false;

  for (const event of events) {
    const stage = event.tool?.name ? providerStageForTool(event.tool.name) : undefined;
    if (!stage) continue;
    hasProviderTool = true;
    if (event.type === 'tool_started') setProviderStageStatus(statusMap, stage, 'running');
    if (event.type === 'tool_completed')
      setProviderStageStatus(statusMap, stage, event.tool?.status === 'failed' ? 'error' : 'completed');
    if (event.type === 'tool_failed') setProviderStageStatus(statusMap, stage, 'error');
  }

  if (!hasProviderTool) {
    const duckdbPreparing = events.some((event) => event.message?.includes('DuckDB'));
    if (!duckdbPreparing) return undefined;
    statusMap.set('duckdb', 'running');
  }

  const finished = events.some(
    (event) => event.type === 'final_answer' || (event.type === 'subagent_completed' && event.step?.id === 'a-stock-data-agent'),
  );
  const duckdbStatus = statusMap.get('duckdb');
  const stockSdkStatus = statusMap.get('stock-sdk');
  const aStockDataStatus = statusMap.get('a-stock-data');

  if (finished && duckdbStatus === 'completed' && stockSdkStatus === 'pending' && aStockDataStatus === 'pending') {
    statusMap.set('stock-sdk', 'skipped');
    statusMap.set('a-stock-data', 'skipped');
  } else if (finished && aStockDataStatus === 'completed' && stockSdkStatus === 'pending') {
    statusMap.set('stock-sdk', 'skipped');
  } else if (finished && stockSdkStatus === 'completed' && aStockDataStatus === 'pending') {
    statusMap.set('a-stock-data', 'skipped');
  }

  return (['duckdb', 'stock-sdk', 'a-stock-data'] as const).map((stage) => {
    const status = statusMap.get(stage) ?? 'pending';
    return { id: `provider-${stage}`, label: providerStepLabel(stage, status), status };
  });
}

function providerFlowSummary(events: AgentRunEvent[]): string | undefined {
  const steps = deriveProviderSteps(events);
  if (!steps) return undefined;
  const duckdb = steps.find((step) => step.id === 'provider-duckdb')?.status;
  const stockSdk = steps.find((step) => step.id === 'provider-stock-sdk')?.status;
  const aStockData = steps.find((step) => step.id === 'provider-a-stock-data')?.status;
  if (duckdb === 'running') return '正在查询 DuckDB 本地库';
  if (duckdb === 'completed' && stockSdk === 'skipped' && aStockData === 'skipped') return 'DuckDB 数据可用，已跳过 stock-sdk/a-stock-data';
  if (stockSdk === 'running') return 'DuckDB 不足，正在调用 stock-sdk';
  if (stockSdk === 'completed' && aStockData === 'skipped') return 'stock-sdk 数据可用，已跳过 a-stock-data';
  if (aStockData === 'running') return 'stock-sdk 不足，正在调用 a-stock-data';
  if (aStockData === 'completed') return '已使用 a-stock-data 补充数据';
  return undefined;
}

// ── Derive step list from events ──
export function deriveSteps(events: AgentRunEvent[]): IStep[] {
  const providerSteps = deriveProviderSteps(events);
  if (providerSteps) return providerSteps;

  const planEvent = events.find((e) => e.type === 'plan_created');
  const total = planEvent?.progress?.total ?? 0;
  if (!total) return [];

  const stepMap = new Map<string, IStep>();
  const runningIds = new Set<string>();

  for (const event of events) {
    const step = event.step;
    if (!step?.id) continue;
    const nodeId = step.id;

    if (event.type === 'subagent_started') {
      runningIds.add(nodeId);
      stepMap.set(nodeId, {
        id: nodeId,
        label: stepLabel(nodeId, step.description),
        status: 'running',
      });
    } else if (event.type === 'subagent_completed') {
      runningIds.delete(nodeId);
      stepMap.set(nodeId, {
        id: nodeId,
        label: stepLabel(nodeId, step.description),
        status: step.status === 'error' ? 'error' : 'completed',
      });
    }
  }

  // Include plan agents as steps
  const planAgents = planEvent?.plan?.agents;
  if (planAgents?.length) {
    for (const agent of planAgents) {
      const nodeId = planAgentToNodeId(agent.id);
      if (!stepMap.has(nodeId)) {
        stepMap.set(nodeId, { id: nodeId, label: agent.description, status: 'pending' });
      }
    }
    const ordered = planAgents.map((a) => {
      const id = planAgentToNodeId(a.id);
      return stepMap.get(id) ?? { id, label: a.description, status: 'pending' as const };
    });
    return ordered;
  }

  return [...stepMap.values()];
}

// ── Derive agent collaboration status ──
export function deriveAgentStatuses(events: AgentRunEvent[]): IAgentStatus[] {
  const planAgents = events.find((e) => e.type === 'plan_created')?.plan?.agents ?? [];

  const statusMap = new Map<string, IAgentStatus['status']>();
  const labelMap = new Map<string, string>();
  const elapsedMap = new Map<string, number>();
  const startedAtMap = new Map<string, string>();
  const progressMap = new Map<string, number>();
  const progressMessageMap = new Map<string, string>();
  const runningAgentIds = new Set<string>();
  const order: string[] = [];
  let latestRunningAgentId: string | undefined;

  const ensureAgent = (id: string, label: string) => {
    if (!statusMap.has(id)) {
      statusMap.set(id, 'pending');
      labelMap.set(id, label);
      order.push(id);
      return;
    }
    if (!labelMap.get(id)) labelMap.set(id, label);
  };

  const markAgentRunning = (id: string) => {
    statusMap.set(id, 'running');
    runningAgentIds.add(id);
    latestRunningAgentId = id;
  };

  const currentRunningAgentId = () => {
    const ids = [...runningAgentIds];
    return latestRunningAgentId ?? ids[ids.length - 1];
  };

  for (const agent of planAgents) ensureAgent(agent.id, agent.agent);

  for (const event of events) {
    if (event.type === 'tool_started' && event.tool?.name) {
      const id = currentRunningAgentId();
      if (id) progressMessageMap.set(id, `正在调用工具：${event.tool.name}`);
      continue;
    }

    if ((event.type === 'tool_completed' || event.type === 'tool_failed') && event.tool?.name) {
      const id = currentRunningAgentId();
      if (id) {
        const failed = event.type === 'tool_failed' || event.tool.status === 'failed';
        progressMessageMap.set(id, `${failed ? '工具失败' : '工具完成'}：${event.tool.name}`);
      }
      continue;
    }

    const id = agentIdFromEvent(event);
    if (!id || !event.subAgent) continue;
    ensureAgent(id, event.subAgent.name);

    if (event.type === 'subagent_started') {
      markAgentRunning(id);
      if (event.step?.startedAt) startedAtMap.set(id, event.step.startedAt);
      if (event.message) progressMessageMap.set(id, event.message);
    }
    if (event.type === 'progress_updated' && event.progress) {
      markAgentRunning(id);
      progressMap.set(id, event.progress.current);
      if (event.message) progressMessageMap.set(id, event.message);
    }
    if (event.type === 'subagent_completed') {
      statusMap.set(id, event.subAgent.status === 'error' ? 'error' : 'completed');
      runningAgentIds.delete(id);
      if (latestRunningAgentId === id) {
        const ids = [...runningAgentIds];
        latestRunningAgentId = ids[ids.length - 1];
      }
      if (typeof event.subAgent.elapsed === 'number') elapsedMap.set(id, event.subAgent.elapsed);
      progressMap.delete(id);
      progressMessageMap.delete(id);
    }
  }

  const providerSummary = providerFlowSummary(events);
  if (providerSummary && statusMap.has('a-stock-data-agent')) {
    progressMessageMap.set('a-stock-data-agent', providerSummary);
  }

  return order.map((id) => ({
    id,
    label: labelMap.get(id) ?? id,
    status: statusMap.get(id) ?? 'pending',
    elapsed: elapsedMap.get(id),
    startedAt: startedAtMap.get(id),
    progress: progressMap.get(id),
    progressMessage: progressMessageMap.get(id),
  }));
}

const ANALYSIS_AGENT_IDS = new Set(['technical', 'fundamental', 'capital', 'sentiment', 'chip']);

function planAgentToNodeId(agentId: string): string {
  if (agentId === 'data') return 'quote';
  if (agentId === 'report') return 'analysis-report';
  if (ANALYSIS_AGENT_IDS.has(agentId)) return `analysis-${agentId}`;
  return agentId;
}

function agentIdFromEvent(event: AgentRunEvent): string | undefined {
  const stepId = event.step?.id;
  if (!stepId) return undefined;
  if (stepId === 'quote' || stepId === 'market-data') return 'data';
  if (stepId === 'analysis-report') return 'report';
  if (stepId.startsWith('analysis-')) return stepId.replace('analysis-', '');
  // Non-analysis DAG nodes (board-data, theme-attribution-data, etc.)
  return stepId;
}

// ── Derive intermediate results ──
export function deriveIntermediateResults(events: AgentRunEvent[]): IIntermediateResult[] {
  return events
    .filter((e) => e.type === 'intermediate_result' && e.intermediateResult)
    .map((e) => ({
      agentName: e.intermediateResult!.agentName,
      label: e.intermediateResult!.label,
      markdown: e.intermediateResult!.markdown,
      findings: e.intermediateResult!.findings,
      timestamp: new Date().toISOString(),
    }));
}

// ── Derive data sources ──
export function deriveDataSources(events: AgentRunEvent[]): IDataSource[] {
  const sourceMap = new Map<string, IDataSource['status']>();
  for (const event of events) {
    if (event.type === 'data_source_checked' && event.dataSource) {
      sourceMap.set(event.dataSource.name, event.dataSource.status);
    }
    if (event.type === 'tool_completed' && event.tool) {
      sourceMap.set(event.tool.name, event.tool.status === 'failed' ? 'error' : 'done');
    }
    if (event.type === 'tool_started' && event.tool) {
      if (!sourceMap.has(event.tool.name)) sourceMap.set(event.tool.name, 'loading');
    }
  }
  return [...sourceMap.entries()].map(([name, status]) => ({ name, status }));
}

// ── Derive timeline entries ──
export function deriveTimeline(events: AgentRunEvent[]): ITimelineEntry[] {
  const entries: ITimelineEntry[] = [];
  for (const event of events) {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const color = event.subAgent?.name
      ? getAgentColor(event.subAgent.name)
      : event.tool?.name
        ? getAgentColor(event.tool.name)
        : '#8c8c8c';
    const label = event.message ?? event.step?.description ?? event.tool?.name ?? event.type;
    if (label && event.type !== 'final_answer') {
      entries.push({ time, label, color });
    }
  }
  return entries;
}

// ── Timing helpers ──
let startTime: number | undefined;

export function getStartTime(events: AgentRunEvent[]): number {
  if (!startTime && events.length) startTime = Date.now();
  return startTime ?? Date.now();
}

export function resetStartTime(): void {
  startTime = undefined;
}

export function calcElapsed(events: AgentRunEvent[]): number {
  const t0 = getStartTime(events);
  return Math.round((Date.now() - t0) / 1000);
}

export function formatProgressSummary({
  preparing,
  pending,
  terminal,
  total,
  elapsedSec,
}: {
  preparing: boolean;
  pending: boolean;
  terminal: number;
  total: number;
  elapsedSec: number;
}): string {
  if (preparing) return '准备中…';
  const stepSummary = `${terminal}/${total} 步骤`;
  return pending ? `${stepSummary} · ${elapsedSec}s` : stepSummary;
}

export function calcEstimatedRemaining(events: AgentRunEvent[]): number | undefined {
  const planEvent = events.find((e) => e.type === 'plan_created');
  const total = planEvent?.progress?.total;
  if (!total || total === 0) return undefined;

  const completed = events.filter((e) => e.type === 'subagent_completed').length;
  if (completed === 0) return undefined;

  const elapsed = calcElapsed(events);
  const rate = completed / elapsed; // steps per second
  if (rate <= 0) return undefined;

  const remaining = total - completed;
  return Math.round(remaining / rate);
}

// ── Extract stock name ──
export function extractStockName(events: AgentRunEvent[]): string | undefined {
  const intentEvent = events.find((e) => e.type === 'intent_detected' || e.type === 'command_detected');
  return (
    intentEvent?.intent?.label ??
    intentEvent?.command?.label ??
    intentEvent?.intent?.target ??
    intentEvent?.command?.args
  );
}

// ── Check if analysis is still in progress ──
export function hasPendingAgents(events: AgentRunEvent[]): boolean {
  const hasFinal = events.some((e) => e.type === 'final_answer');
  return !hasFinal;
}

// ── Check if this is an analysis flow (vs simple chat) ──
export function isAnalysisFlow(events: AgentRunEvent[]): boolean {
  return events.some((e) => e.type === 'plan_created');
}
