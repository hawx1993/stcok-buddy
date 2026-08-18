import { ChevronDown, ChevronRight, Handshake } from 'lucide-react';
import { useState } from 'react';
import { marked } from 'marked';
import type { IAgentStatus, IIntermediateResult } from './types';
import cx from '../../../../shared/cx';
import styles from './index.module.scss';
import { normalizeProgressLabel } from './presentation';
import { AGENT_STATUS_ICONS } from './status-icons';

function renderMarkdown(content: string): string {
  return marked.parse(content, { async: false, breaks: true }) as string;
}

export function AgentCollaboration({
  agents,
  intermediateResults,
}: {
  agents: IAgentStatus[];
  intermediateResults: IIntermediateResult[];
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!agents.length) return null;

  const statusText = (agent: IAgentStatus) => {
    switch (agent.status) {
      case 'completed':
        return agent.progressMessage ?? (agent.elapsed ? `已完成，耗时 ${agent.elapsed.toFixed(1)}s` : '已完成');
      case 'running':
        return agent.progressMessage ?? '调用模型分析中...';
      case 'error':
        return '失败';
      default:
        return '等待中';
    }
  };

  const getResult = (agentId: string) => intermediateResults.find((r) => r.agentName === agentId);

  const toggle = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className={styles['agent-collab']}>
      <div className={styles['section-title']}>
        <Handshake aria-hidden='true' size={13} strokeWidth={1.8} />
        <span>Agent 协作</span>
      </div>
      {agents.map((agent) => {
        const result = getResult(agent.id);
        const isExpanded = expandedId === agent.id;
        const canExpand = agent.status === 'completed' && Boolean(result);
        const statusIcon = AGENT_STATUS_ICONS[agent.status];
        const StatusIcon = statusIcon.Icon;

        return (
          <div key={agent.id} className={styles['agent-row']}>
            <button
              aria-expanded={canExpand ? isExpanded : undefined}
              className={cx(styles['agent-item'], styles[agent.status], canExpand && styles['clickable'])}
              onClick={() => canExpand && toggle(agent.id)}
              type='button'
            >
              <span
                className={cx(
                  styles['agent-dot'],
                  styles[agent.status],
                  canExpand && styles['expandable'],
                  isExpanded && styles['expanded'],
                )}
              />
              <span className={styles['agent-name']}>{normalizeProgressLabel(agent.label)}</span>
              <span className={styles['agent-status']}>
                <StatusIcon
                  aria-label={statusIcon.label}
                  className={statusIcon.spin ? styles['icon-spinning'] : undefined}
                  role='img'
                  size={12}
                  strokeWidth={1.8}
                />
                <span>{normalizeProgressLabel(statusText(agent))}</span>
              </span>
              {canExpand ? (
                <span aria-hidden='true' className={styles['agent-expand-icon']}>
                  {isExpanded ? <ChevronDown size={15} strokeWidth={1.8} /> : <ChevronRight size={15} strokeWidth={1.8} />}
                </span>
              ) : null}
            </button>
            {isExpanded && result ? (
              <div
                className={styles['agent-result']}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(result.markdown) }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
