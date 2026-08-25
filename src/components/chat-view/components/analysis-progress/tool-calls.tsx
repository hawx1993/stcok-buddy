import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { ToolCallRecord } from '../../../../shared/types';
import styles from './index.module.scss';
import cx from '../../../../shared/cx';
import { normalizeProgressLabel } from './presentation';

function summarize(value: unknown): string {
  if (value === undefined) return '--';
  return (typeof value === 'string' ? value : JSON.stringify(value)).replace(/\s+/g, ' ').slice(0, 160);
}

export function ToolCalls({ toolCalls }: { toolCalls?: ToolCallRecord[] }) {
  const [open, setOpen] = useState(false);

  if (!toolCalls?.length) return null;

  return (
    <div className={styles['tool-calls']}>
      <button aria-expanded={open} className={styles['tool-header']} onClick={() => setOpen(!open)} type='button'>
        <span className={styles['section-title']}>接口调用 · {toolCalls.length} 次</span>
        <span aria-hidden='true' className={styles['tool-caret']}>
          {open ? <ChevronDown size={15} strokeWidth={1.8} /> : <ChevronRight size={15} strokeWidth={1.8} />}
        </span>
      </button>
      {open ? (
        <div className={styles['tool-list']}>
          {toolCalls.map((tc) => {
            const duration = tc.endedAt ? new Date(tc.endedAt).getTime() - new Date(tc.startedAt).getTime() : undefined;
            return (
              <div key={tc.id} className={styles['tool-item']}>
                <div className={styles['tool-item-header']}>
                  <span className={styles['tool-name']}>{normalizeProgressLabel(tc.toolName)}</span>
                  <span className={cx(styles['tool-meta'], tc.error && styles['error'])}>
                    {tc.error ? '失败' : '成功'}
                    {duration !== undefined ? ` · ${duration}ms` : ''}
                  </span>
                </div>
                <div className={styles['tool-io']}>输入：{tc.inputSummary ?? summarize(tc.input)}</div>
                {tc.error ? (
                  <div className={styles['tool-err']}>{tc.error}</div>
                ) : (
                  <div className={styles['tool-io']}>输出：{tc.outputSummary ?? summarize(tc.output)}</div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
