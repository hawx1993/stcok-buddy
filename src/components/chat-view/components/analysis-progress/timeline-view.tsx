import { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import type { ITimelineEntry } from './types';
import styles from './index.module.scss';

const MAX_VISIBLE = 8;

function stripMarkdown(text: string): string {
  const html = marked.parse(text, { async: false, breaks: false }) as string;
  // Strip all HTML tags, decode entities, collapse whitespace
  const stripped = html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return stripped.replace(/\s+/g, ' ').trim();
}

export function TimelineView({ entries }: { entries: ITimelineEntry[] }) {
  const [showAll, setShowAll] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries.length]);

  const visible = showAll ? entries : entries.slice(-MAX_VISIBLE);
  const hidden = entries.length - MAX_VISIBLE;

  return (
    <div className={styles['timeline']}>
      <div className={styles['section-title']}>⏱ 执行时间轴</div>
      {hidden > 0 && !showAll ? (
        <button className={styles['timeline-expand']} onClick={() => setShowAll(true)} type="button">
          展开前面 {hidden} 条…
        </button>
      ) : null}
      <div className={styles['timeline-list']}>
        {visible.map((entry, i) => (
          <div key={`${entry.time}-${i}`} className={styles['timeline-entry']}>
            <span className={styles['timeline-dot']} style={{ background: entry.color }} />
            <span className={styles['timeline-time']}>{entry.time}</span>
            <span className={styles['timeline-label']}>{stripMarkdown(entry.label)}</span>
          </div>
        ))}
      </div>
      <div ref={bottomRef} />
    </div>
  );
}
