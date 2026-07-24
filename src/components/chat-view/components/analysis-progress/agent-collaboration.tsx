import { useState } from 'react';
import { marked } from 'marked';
import type { IAgentStatus, IIntermediateResult } from './types';
import styles from './index.module.scss';
import cx from '../../../../shared/cx';

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

  const statusIcon = (status: IAgentStatus['status']) => {
    switch (status) {
      case 'completed':
        return '✓';
      case 'running':
        return '⏳';
      case 'error':
        return '✗';
      default:
        return '○';
    }
  };

  const statusText = (status: IAgentStatus['status']) => {
    switch (status) {
      case 'completed':
        return '已完成';
      case 'running':
        return '分析中…';
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
      <div className={styles['section-title']}>🤝 Agent 协作</div>
      {agents.map((agent) => {
        const result = getResult(agent.id);
        const isExpanded = expandedId === agent.id;
        const canExpand = agent.status === 'completed' && Boolean(result);

        return (
          <div key={agent.id} className={styles['agent-row']}>
            <button
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
              <span className={styles['agent-name']}>{agent.label}</span>
              <span className={styles['agent-status']}>
                {statusIcon(agent.status)} {statusText(agent.status)}
              </span>
              {canExpand ? <span className={styles['agent-expand-icon']}>{isExpanded ? '▾' : '▸'}</span> : null}
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
