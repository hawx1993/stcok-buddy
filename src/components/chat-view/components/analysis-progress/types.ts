import type { StructuredAgentFinding } from '../../../../shared/types';

export interface IStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'error';
}

export interface IAgentStatus {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  /** 已完成/失败的耗时（秒） */
  elapsed?: number;
  /** 当前正在运行的已耗时（秒），用于实时刷新 */
  runningElapsed?: number;
  startedAt?: string;
  /** 来自后端的最新进度百分比（0-100） */
  progress?: number;
  /** 后端传来的当前步骤描述 */
  progressMessage?: string;
}

export interface IIntermediateResult {
  agentName: string;
  label: string;
  markdown: string;
  findings: StructuredAgentFinding[];
  timestamp: string;
}

export interface IDataSource {
  name: string;
  status: 'pending' | 'loading' | 'done' | 'error';
}

export interface ITimelineEntry {
  time: string;
  label: string;
  color: string;
}
