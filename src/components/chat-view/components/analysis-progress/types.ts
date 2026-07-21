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
