import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GlobalStockSearch } from '../index';
import { MarketSearchSuggestionList } from '../components/market-search-suggestion-list';
import {
  formatSearchChangePercent,
  formatSearchQuoteValue,
  getConversationRoleLabel,
  getGlobalSearchResultKey,
  getSearchChangeTone,
  isConversationSearchResult,
} from '../utils';
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

describe('全局搜索会话结果辅助函数', () => {
  it('识别会话和消息结果', () => {
    expect(isConversationSearchResult({ kind: 'conversation', conversationId: 'c-1', title: '会话', preview: '', updatedAt: '2026', snippet: '会话' })).toBe(true);
    expect(isConversationSearchResult({ kind: 'board', code: 'BK0001', name: '板块', minutes: [] })).toBe(false);
  });

  it('生成稳定搜索结果 key', () => {
    expect(getGlobalSearchResultKey({ code: '600519', name: '贵州茅台' })).toBe('stock-600519');
    expect(getGlobalSearchResultKey({ kind: 'message', conversationId: 'c-1', messageId: 'm-1', title: '会话', preview: '', updatedAt: '2026', snippet: 'AI 内容' })).toBe('message-c-1-m-1');
  });

  it('展示会话角色标签', () => {
    expect(getConversationRoleLabel('user')).toBe('用户');
    expect(getConversationRoleLabel('assistant')).toBe('AI');
    expect(getConversationRoleLabel()).toBe('会话');
  });
});

describe('全局行情搜索弹层', () => {
  it('渲染可访问的实体搜索对话框', () => {
    const markup = renderToStaticMarkup(
      createElement(GlobalStockSearch, {
        open: true,
        onOpenChange: () => undefined,
      }),
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-label="全局搜索"');
    expect(markup).toContain('aria-label="关闭全局搜索"');
    expect(markup).not.toContain('data-particle-field');
    expect(markup).not.toContain('data-particle-light');
  });

  it('支持入口传入的自定义 placeholder', () => {
    const markup = renderToStaticMarkup(
      createElement(GlobalStockSearch, {
        open: true,
        onOpenChange: () => undefined,
        placeholder: '搜索代码 / 名称 / 事件',
      }),
    );

    expect(markup).toContain('placeholder="搜索代码 / 名称 / 事件"');
  });

  it('AI监控模式只展示AI监控搜索语境', () => {
    const markup = renderToStaticMarkup(
      createElement(GlobalStockSearch, {
        open: true,
        mode: 'ai-monitor',
        onOpenChange: () => undefined,
      }),
    );

    expect(markup).toContain('aria-label="AI监控搜索"');
    expect(markup).toContain('仅搜索AI监控列表');
    expect(markup).not.toContain('行情 / 板块');
    expect(markup).not.toContain('会话 / 消息');
  });
});

describe('全局行情搜索候选列表', () => {
  it('展示与快速输入一致的四项实时指标', () => {
    const markup = renderToStaticMarkup(
      createElement(MarketSearchSuggestionList, {
        onSelect: () => undefined,
        suggestions: [
          {
            code: '603000',
            name: '人民网',
            price: 16.35,
            marketCap: 18_080_000_000,
            turnoverRate: 1.23,
            changePercent: -2.21,
          },
        ],
      }),
    );

    expect(markup).toContain('现价');
    expect(markup).toContain('市值');
    expect(markup).toContain('换手率');
    expect(markup).toContain('涨跌幅');
    expect(markup).toContain('16.35');
    expect(markup).toContain('180.8亿');
    expect(markup).toContain('+1.23%');
    expect(markup).toContain('-2.21%');
  });

  it('板块候选不渲染股票专属的实时指标', () => {
    const markup = renderToStaticMarkup(
      createElement(MarketSearchSuggestionList, {
        onSelect: () => undefined,
        suggestions: [{ code: 'BK0800', name: '人工智能', kind: 'board', minutes: [] }],
      }),
    );

    expect(markup).toContain('人工智能');
    expect(markup).toContain('BK0800');
    expect(markup).not.toContain('现价');
    expect(markup).not.toContain('市值');
    expect(markup).not.toContain('换手率');
    expect(markup).not.toContain('涨跌幅');
  });
});
