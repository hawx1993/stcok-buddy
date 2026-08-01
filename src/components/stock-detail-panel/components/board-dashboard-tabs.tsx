import type { TBoardDashboardRange } from '../../../shared/types';
import styles from '../index.module.scss';

interface IBoardDashboardTabsProps {
  value: TBoardDashboardRange;
  disabled?: boolean;
  onChange(range: TBoardDashboardRange): void;
}

const ranges: Array<{ value: TBoardDashboardRange; label: string }> = [
  { value: 'today', label: '今日' },
  { value: 'five-days', label: '近 5 日' },
  { value: 'twenty-days', label: '近 20 日' },
];

export function BoardDashboardTabs({ value, disabled, onChange }: IBoardDashboardTabsProps) {
  return (
    <div className={styles['board-dashboard-tabs']} role='tablist' aria-label='板块 Dashboard 时间范围'>
      {ranges.map((range) => (
        <button
          key={range.value}
          type='button'
          role='tab'
          aria-selected={value === range.value}
          className={value === range.value ? styles.active : undefined}
          disabled={disabled}
          onClick={() => onChange(range.value)}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}
