import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getNextSlashIndex, SlashCommandMenu } from '../slash-command-menu';

const slashItems = [
  {
    id: 'report',
    section: 'Commands',
    label: '综合投研报告',
    command: '/综合投研报告',
    description: '生成完整综合投资报告',
    argPlaceholder: '[输入股票代码]',
  },
  {
    id: 'news',
    section: 'Commands',
    label: '新闻公告',
    command: '/新闻公告',
    description: '拉取个股新闻和公告',
    argPlaceholder: '[输入股票代码]',
  },
] as const;

describe('getNextSlashIndex', () => {
  it('从无选中状态按方向键选择边界项', () => {
    expect(getNextSlashIndex(undefined, slashItems.length, 'next')).toBe(0);
    expect(getNextSlashIndex(undefined, slashItems.length, 'previous')).toBe(slashItems.length - 1);
  });

  it('在菜单边界保持已选项，并在空菜单保持无选中', () => {
    expect(getNextSlashIndex(0, slashItems.length, 'previous')).toBe(0);
    expect(getNextSlashIndex(slashItems.length - 1, slashItems.length, 'next')).toBe(slashItems.length - 1);
    expect(getNextSlashIndex(undefined, 0, 'next')).toBeUndefined();
  });
});

describe('SlashCommandMenu', () => {
  it('初始打开时不标记任何命令为选中', () => {
    const markup = renderToStaticMarkup(
      createElement(SlashCommandMenu, {
        slashItems: [...slashItems],
        selectedIndex: undefined,
        onSelect: () => undefined,
      }),
    );

    expect(markup).not.toContain('aria-selected="true"');
    expect(markup).not.toContain('slash-menu-has-selection');
    expect(markup.match(/aria-selected="false"/g)).toHaveLength(slashItems.length);
    expect(markup).toContain('Enter</kbd> 确认');
  });

  it('只标记键盘选中的命令', () => {
    const markup = renderToStaticMarkup(
      createElement(SlashCommandMenu, {
        slashItems: [...slashItems],
        selectedIndex: 1,
        onSelect: () => undefined,
      }),
    );

    expect(markup.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(markup).toContain('slash-menu-has-selection');
  });
});
