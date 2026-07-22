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
  'analysis-sentiment': '情绪面分析',
  'analysis-chip': '筹码分析',
  'analysis-report': '生成投研报告',
  'read-links': '读取链接内容',
  chat: '投研问答',
};

function stepLabel(nodeId: string, description?: string): string {
  if (STEP_LABELS[nodeId]) return STEP_LABELS[nodeId];
  if (description) return description.length > 18 ? `${description.slice(0, 16)}…` : description;
  return nodeId;
}

// ── Derive step list from events ──
export function deriveSteps(events: AgentRunEvent[]): IStep[] {
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
  const planAgents = events.find((e) => e.type === 'plan_created')?.plan?.agents;
  if (!planAgents?.length) return [];

  const statusMap = new Map<string, IAgentStatus['status']>();
  for (const agent of planAgents) statusMap.set(agent.id, 'pending');

  for (const event of events) {
    if (event.type === 'subagent_started' && event.subAgent) {
      const id = agentIdFromEvent(event);
      if (id && statusMap.has(id)) statusMap.set(id, 'running');
    }
    if (event.type === 'subagent_completed' && event.subAgent) {
      const id = agentIdFromEvent(event);
      if (id && statusMap.has(id)) {
        statusMap.set(id, event.subAgent.status === 'error' ? 'error' : 'completed');
      }
    }
  }

  return planAgents.map((a) => ({
    id: a.id,
    label: a.agent,
    status: statusMap.get(a.id) ?? 'pending',
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
