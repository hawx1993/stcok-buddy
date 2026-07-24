import { useEffect, useRef } from 'react';
import type { TSlashItem } from './quick-entry';
import styles from '../index.module.scss';
import cx from '../../../shared/cx';

export function SlashCommandMenu({ slashItems, selectedIndex, onSelect }: {
  slashItems: TSlashItem[];
  selectedIndex: number;
  onSelect(item?: TSlashItem): void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);
  const sections = Array.from(new Set(slashItems.map((item) => item.section)));
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);
  return <div className={styles['slash-menu']}>{sections.map((section) => <div key={section}>
    <div className={styles['slash-section']}>{section}</div>
    {slashItems.map((item, index) => item.section === section ? <button ref={index === selectedIndex ? activeRef : undefined} className={cx(styles['slash-item'], index === selectedIndex && styles.active)} key={item.id} onMouseDown={(event) => { event.preventDefault(); onSelect(item); }} type='button'>
      <span className='slash-icon'>/</span><span className={styles['slash-copy']}><span className={styles['slash-label']}>{item.label}</span><span className={styles['slash-desc']}>{item.description}</span></span><span className={styles['slash-meta']}><span>{item.section === 'Commands' ? '命令' : '全局'}</span><code>{item.command}</code></span>
    </button> : null)}
  </div>)}</div>;
}
