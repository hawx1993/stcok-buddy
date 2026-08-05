import { describe, expect, it } from 'vitest';
import { getTaskProgressDisplay } from './progress';

describe('data sync task progress display', () => {
  it('uses an initializing badge for running tasks with unknown total', () => {
    const display = getTaskProgressDisplay({ status: 'running', processed: 0, total: 0, message: '正在确定目标交易日…' });

    expect(display.badgeText).toBe('准备中');
    expect(display.isStarting).toBe(true);
  });

  it('does not render 0/0 when a tiny real progress count is available', () => {
    const display = getTaskProgressDisplay({ status: 'running', processed: 1, total: 5000, message: '正在同步近期日K线' });

    expect(display.badgeText).toBe('1/5000');
    expect(display.isStarting).toBe(false);
  });
});
