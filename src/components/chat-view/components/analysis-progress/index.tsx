import { useEffect, useMemo, useState } from 'react';
import type { AgentRunEvent, ToolCallRecord } from '../../../../shared/types';
import { ProgressBar } from './progress-bar';
import { AgentCollaboration } from './agent-collaboration';
import { TimelineView } from './timeline-view';
import { DataSources } from './data-sources';
import { ToolCalls } from './tool-calls';
import {
  deriveSteps,
  deriveAgentStatuses,
  deriveIntermediateResults,
  deriveDataSources,
  deriveTimeline,
  calcElapsed,
  calcEstimatedRemaining,
  extractStockName,
  hasPendingAgents,
  resetStartTime,
} from './derived';
import styles from './index.module.scss';

export function AnalysisProgress({ events, toolCalls }: { events: AgentRunEvent[]; toolCalls?: ToolCallRecord[] }) {
  const [open, setOpen] = useState(true);
  const [elapsed, setElapsed] = useState(0);

  const stockName = useMemo(() => extractStockName(events), [events]);
  const steps = useMemo(() => deriveSteps(events), [events]);
  const agentStatuses = useMemo(() => deriveAgentStatuses(events), [events]);
  const intermediateResults = useMemo(() => deriveIntermediateResults(events), [events]);
  const dataSources = useMemo(() => deriveDataSources(events), [events]);
  const timeline = useMemo(() => deriveTimeline(events), [events]);
  const pending = useMemo(() => hasPendingAgents(events), [events]);
  const remaining = useMemo(() => calcEstimatedRemaining(events), [events]);
  const preparing = !events.length;

  const completed = steps.filter((s) => s.status === 'completed').length;
  const total = steps.length || 1;

  useEffect(() => {
    if (events.length) resetStartTime();
  }, [events.length]);

  useEffect(() => {
    if (!pending && !preparing) return;
    const interval = setInterval(() => setElapsed(calcElapsed(events)), 1000);
    return () => clearInterval(interval);
  }, [events, pending, preparing]);

  const elapsedSec = elapsed || calcElapsed(events);

  return (
    <div className={styles['analysis-progress']}>
      <button className={styles['ap-header']} onClick={() => setOpen(!open)} type='button'>
        <span className={styles['ap-header-left']}>
          <span className={styles['ap-dot']}>{preparing || pending ? '⏳' : '✅'}</span>
          <span className={styles['ap-title']}>{stockName ? `分析 ${stockName}` : 'AI 分析过程'}</span>
          <span className={styles['ap-summary']}>
            {preparing ? '准备中…' : `${completed}/${total} 步骤 · ${elapsedSec}s`}
          </span>
        </span>
        <span className={styles['ap-caret']}>{open ? '▾' : '▸'}</span>
      </button>

      {open ? (
        <div className={styles['ap-body']}>
          {preparing ? (
            <div className={styles['preparing']}>🔄 模型思考中，分析即将开始…</div>
          ) : (
            <>
              <ProgressBar stockName={stockName} steps={steps} />
              <AgentCollaboration agents={agentStatuses} intermediateResults={intermediateResults} />
              <DataSources sources={dataSources} />
              <TimelineView entries={timeline} />
            </>
          )}
          <ToolCalls toolCalls={toolCalls} />
        </div>
      ) : null}
    </div>
  );
}
