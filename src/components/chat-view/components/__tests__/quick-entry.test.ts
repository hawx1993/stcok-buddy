import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_STOCK_ENTRY_HINTS } from '../hot-stock-hints';
import {
  getQuickEntrySearchKeyword,
  getQuickEntryValueAfterSearchSelection,
  QuickEntry,
  QUICK_ENTRY_TREND_PATH,
  QUICK_ENTRY_WHALE_MOTION,
  QUICK_ENTRY_WHALE_SIZE,
} from '../quick-entry';

describe('QuickEntry 搜索关键词提取', () => {
  it('忽略 slash 命令前缀并使用命令参数搜索', () => {
    expect(getQuickEntrySearchKeyword('/筹码分析 600')).toBe('600');
    expect(getQuickEntrySearchKeyword('/筹码分析   600')).toBe('600');
  });

  it('保留普通股票或板块搜索输入', () => {
    expect(getQuickEntrySearchKeyword('600')).toBe('600');
    expect(getQuickEntrySearchKeyword(' 贵州茅台 ')).toBe('贵州茅台');
  });

  it('命令没有参数时不触发搜索建议', () => {
    expect(getQuickEntrySearchKeyword('/筹码分析')).toBe('');
    expect(getQuickEntrySearchKeyword('/筹码分析 ')).toBe('');
  });

  it('条件选股参数不会被当作股票搜索词', () => {
    expect(getQuickEntrySearchKeyword('/条件选股 --换手率>8% --成交额>5亿')).toBe('');
  });

  it('选择搜索建议时保留已选 slash 命令', () => {
    expect(getQuickEntryValueAfterSearchSelection('/筹码分析 600', '600519')).toBe('/筹码分析 600519');
    expect(getQuickEntryValueAfterSearchSelection('600', '600519')).toBe('600519');
  });
});

describe('QuickEntry 鲸鱼动画', () => {
  it('复用趋势曲线路径、限制尺寸并在最后一段双倍冲刺', () => {
    const markup = renderToStaticMarkup(
      createElement(QuickEntry, {
        activeModelName: 'test-model',
        onOpenModelSettings: () => undefined,
        onOpenStore: () => undefined,
        onSubmit: () => undefined,
        slashItems: [],
      }),
    );
    const steadySpeed =
      QUICK_ENTRY_WHALE_MOTION.sprintStartPoint /
      (QUICK_ENTRY_WHALE_MOTION.sprintStartTime * QUICK_ENTRY_WHALE_MOTION.durationSeconds);
    const sprintSpeed =
      (1 - QUICK_ENTRY_WHALE_MOTION.sprintStartPoint) /
      ((1 - QUICK_ENTRY_WHALE_MOTION.sprintStartTime) * QUICK_ENTRY_WHALE_MOTION.durationSeconds);

    expect(QUICK_ENTRY_WHALE_SIZE.width).toBeLessThanOrEqual(30);
    expect(sprintSpeed / steadySpeed).toBeCloseTo(2, 2);
    expect(markup).toContain(`d="${QUICK_ENTRY_TREND_PATH}"`);
    expect(markup).toContain(`path="${QUICK_ENTRY_TREND_PATH}"`);
    expect(markup).toContain(`keyPoints="0;${QUICK_ENTRY_WHALE_MOTION.sprintStartPoint};1"`);
    expect(markup).toContain(`keyTimes="0;${QUICK_ENTRY_WHALE_MOTION.sprintStartTime};1"`);
    expect(markup).toContain('transform="translate(-15 -30)"');
    expect(markup).toContain(
      `viewBox="0 0 352 294" width="${QUICK_ENTRY_WHALE_SIZE.width}" height="${QUICK_ENTRY_WHALE_SIZE.height}"`,
    );
    expect(markup).toContain(
      `style="width:${QUICK_ENTRY_WHALE_SIZE.width}px;height:${QUICK_ENTRY_WHALE_SIZE.height}px"`,
    );
    expect(markup).toContain('常用股票（固定入口）');
    for (const hint of DEFAULT_STOCK_ENTRY_HINTS) {
      expect(markup).toContain(`${hint.name}（${hint.code}）`);
    }
  });
});
