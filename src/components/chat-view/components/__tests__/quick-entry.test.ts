import { describe, expect, it } from 'vitest';
import { getQuickEntrySearchKeyword, getQuickEntryValueAfterSearchSelection } from '../quick-entry';

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

  it('选择搜索建议时保留已选 slash 命令', () => {
    expect(getQuickEntryValueAfterSearchSelection('/筹码分析 600', '600519')).toBe('/筹码分析 600519');
    expect(getQuickEntryValueAfterSearchSelection('600', '600519')).toBe('600519');
  });
});
