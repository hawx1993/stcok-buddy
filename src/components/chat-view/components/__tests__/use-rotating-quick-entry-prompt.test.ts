import { describe, expect, it } from 'vitest';
import { getNextQuickEntryPromptIndex, QUICK_ENTRY_PROMPTS } from '../use-rotating-quick-entry-prompt';

describe('Quick Entry 轮播提示', () => {
  it('包含十条不重复的真实内建命令示例', () => {
    expect(QUICK_ENTRY_PROMPTS).toHaveLength(10);
    expect(new Set(QUICK_ENTRY_PROMPTS)).toHaveProperty('size', 10);
  });

  it('保留用户指定的命令示例', () => {
    expect(QUICK_ENTRY_PROMPTS).toContain('试试 "/条件选股 --总市值=30-100亿 --换手率>8% --成交额>5亿 --排除ST"');
    expect(QUICK_ENTRY_PROMPTS).toContain('试试 "/复盘今日行情"');
    expect(QUICK_ENTRY_PROMPTS).toContain('试试 "/综合投研报告 300017"');
  });

  it('在最后一条提示后回到首条', () => {
    expect(getNextQuickEntryPromptIndex(0)).toBe(1);
    expect(getNextQuickEntryPromptIndex(QUICK_ENTRY_PROMPTS.length - 1)).toBe(0);
  });
});
