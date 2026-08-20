import { useEffect, useRef } from 'react';
import type { TSlashItem } from './quick-entry';
import styles from '../index.module.scss';
import cx from '../../../shared/cx';

export function getNextSlashIndex(
  selectedIndex: number | undefined,
  itemCount: number,
  direction: 'next' | 'previous',
): number | undefined {
  if (!itemCount) return undefined;
  if (direction === 'next') return Math.min((selectedIndex ?? -1) + 1, itemCount - 1);
  return Math.max((selectedIndex ?? itemCount) - 1, 0);
}

export function SlashCommandMenu({
  slashItems,
  selectedIndex,
  onSelect,
}: {
  slashItems: TSlashItem[];
  selectedIndex: number | undefined;
  onSelect(item: TSlashItem): void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);
  const sections = Array.from(new Set(slashItems.map((item) => item.section)));
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);
  return (
    <div
      className={cx(styles['slash-menu'], selectedIndex !== undefined && styles['slash-menu-has-selection'])}
    >
      <div aria-label='Slash 命令菜单' role='listbox'>
        {sections.map((section) => (
          <div aria-label={section} key={section} className={styles['slash-group']} role='group'>
            <div aria-hidden='true' className={styles['slash-section']}>
              {section}
            </div>
            {slashItems.map((item, index) =>
              item.section === section ? (
                <button
                  ref={index === selectedIndex ? activeRef : undefined}
                  aria-selected={index === selectedIndex}
                  className={cx(styles['slash-item'], index === selectedIndex && styles.active)}
                  key={item.id}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onSelect(item);
                  }}
                  role='option'
                  type='button'
                >
                  <span aria-hidden='true' className='slash-icon'>
                    /
                  </span>
                  <span className={styles['slash-copy']}>
                    <span className={styles['slash-label']}>{item.label}</span>
                    <span className={styles['slash-desc']}>{item.description}</span>
                  </span>
                  <span className={styles['slash-meta']}>
                    <span>{item.section === 'Commands' ? '命令' : '全局'}</span>
                    <code>{item.command}</code>
                  </span>
                </button>
              ) : null,
            )}
          </div>
        ))}
      </div>
      <div className={styles['slash-hint']}>
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> 选择
        </span>
        <span>
          <kbd>Enter</kbd> 确认
        </span>
      </div>
    </div>
  );
}
