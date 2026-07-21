import { useEffect, useState } from 'react';
import type { AgentRunEvent, ChatMessage } from '../../../shared/types';
import { dedupeLabelPrefix } from './message-utils';
import cx from '../../../shared/cx';
import styles from '../index.module.scss';

export function ThinkingBanner() {
  return (
    <div className='thinking-line'>
      Stockbuddy{' '}
      <span className='thinking-shimmer'>
        <span>思</span>
        <span>考</span>
        <span>中</span>
        <span>.</span>
        <span>.</span>
        <span>.</span>
      </span>
    </div>
  );
}

export function ProcessedBanner({ seconds }: { seconds: number }) {
  return <div className='processed-line'>StockBuddy 已处理，共耗时 {seconds.toFixed(1)}s</div>;
}

export function ThinkingTrace({ startedAt, steps }: { startedAt: string; steps: NonNullable<ChatMessage['steps']> }) {
  const [seconds, setSeconds] = useState(0);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const start = new Date(startedAt).getTime();
    const tick = () => setSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  return (
    <div className={cx(styles.trace, styles['thinking-trace'], open && styles.open)} data-trace>
      <button
        className={cx(styles['trace-header'], styles['thinking-header'])}
        onClick={() => setOpen(!open)}
        type='button'
      >
        <span>思考了 {seconds} 秒</span>
        <span className={styles['trace-caret']}>{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <div className={cx(styles['trace-body'], styles['thinking-body'])} data-tracebody>
          {steps.map((step) => (
            <div className={styles['trace-step']} key={step.id}>
              <span className={styles.tag}>{step.agent}</span>
              <span className={styles.desc}>{dedupeLabelPrefix(step.agent, step.description)}</span>
              {step.detail ? <span className={styles.progress}>{step.detail}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Trace({ steps }: { steps: NonNullable<ChatMessage['steps']> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cx(styles.trace, open && styles.open)} data-trace>
      <button className={styles['trace-header']} onClick={() => setOpen(!open)} type='button'>
        <span>分析步骤</span>
        <span className={styles['trace-caret']}>{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <div className={styles['trace-body']} data-tracebody>
          {steps.map((step) => (
            <div className={styles['trace-step']} key={`${step.id}-${step.status}`}>
              <span className={styles.tag}>{step.agent}</span>
              <span className={styles.desc}>{step.description}</span>
              {step.detail ? <span className={styles.progress}>{step.detail}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function RunEventTrace({ events }: { events: AgentRunEvent[] }) {
  const [open, setOpen] = useState(true);
  const visible = events.filter((event) => event.type !== 'final_answer');
  if (!visible.length) return null;
  return (
    <div className={cx(styles.trace, styles['run-event-trace'], open && styles.open)} data-trace>
      <button className={styles['trace-header']} onClick={() => setOpen(!open)} type='button'>
        <span>执行过程</span>
        <span className={styles['trace-caret']}>{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <div className={styles['trace-body']} data-tracebody>
          {visible.map((event, index) => (
            <div className={styles['trace-step']} key={`${event.type}-${index}`}>
              <span className={styles.tag}>{eventLabel(event)}</span>
              <span className={styles.desc}>{eventToolLabel(event)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const EVENT_LABELS: Record<string, string> = {
  plan_created: '计划',
  command_detected: 'Command',
  intent_detected: '意图',
  tool_started: '工具开始',
  tool_completed: '工具完成',
  tool_failed: '工具失败',
  subagent_started: 'Agent开始',
  subagent_completed: 'Agent完成',
  progress_updated: '进度',
  evidence_added: '证据',
  intermediate_result: '中间结果',
  data_source_checked: '数据源',
  summary_completed: '汇总',
  step_started: '步骤开始',
  step_completed: '步骤完成',
  tool_result: '工具',
  final_answer: '结论',
  error: '错误',
};

function eventLabel(event: AgentRunEvent) {
  if (event.tool?.name) return event.tool.name;
  if (event.subAgent?.name) return event.subAgent.name;
  if (event.command?.name) return event.command.name;
  return EVENT_LABELS[event.type] ?? event.type;
}

function eventToolLabel(event: AgentRunEvent) {
  return event.tool?.purpose ?? event.step?.description ?? event.message ?? event.type;
}
