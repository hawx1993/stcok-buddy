import { describe, expect, it } from 'vitest';
import { formatSearchChangePercent, formatSearchQuoteValue, getSearchChangeTone } from '../index';
import { getGlobalSearchShortcutLabel, isGlobalSearchShortcut, isMacPlatform } from '../shortcut';

function keyEvent(key: string, metaKey = false, ctrlKey = false): Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'> {
  return { key, metaKey, ctrlKey };
}

describe('全局行情搜索快捷键', () => {
  it('识别 macOS 平台', () => {
    expect(isMacPlatform('MacIntel')).toBe(true);
    expect(isMacPlatform('Win32')).toBe(false);
  });

  it('按平台展示快捷键提示', () => {
    expect(getGlobalSearchShortcutLabel('MacIntel')).toBe('⌘/');
    expect(getGlobalSearchShortcutLabel('Win32')).toBe('Ctrl+/');
  });

  it('macOS 使用 Command 加斜杠呼出搜索', () => {
    expect(isGlobalSearchShortcut(keyEvent('/', true), true)).toBe(true);
    expect(isGlobalSearchShortcut(keyEvent('/', false, true), true)).toBe(false);
  });

  it('Windows 和 Linux 使用 Control 加斜杠呼出搜索', () => {
    expect(isGlobalSearchShortcut(keyEvent('/', false, true), false)).toBe(true);
    expect(isGlobalSearchShortcut(keyEvent('/', true), false)).toBe(false);
  });

  it('忽略没有修饰键或按键不匹配的输入', () => {
    expect(isGlobalSearchShortcut(keyEvent('/'), false)).toBe(false);
    expect(isGlobalSearchShortcut(keyEvent(',', false, true), false)).toBe(false);
  });
});

describe('全局行情搜索结果行情字段格式化', () => {
  it('展示现价缺省值', () => {
    expect(formatSearchQuoteValue(undefined)).toBe('--');
    expect(formatSearchQuoteValue(12.34)).toBe('12.34');
  });

  it('格式化涨跌幅并识别颜色方向', () => {
    expect(formatSearchChangePercent(1.2)).toBe('+1.20%');
    expect(formatSearchChangePercent('-0.35%')).toBe('-0.35%');
    expect(getSearchChangeTone(1.2)).toBe('up');
    expect(getSearchChangeTone('-0.35%')).toBe('down');
    expect(getSearchChangeTone('--')).toBe('flat');
  });
});
