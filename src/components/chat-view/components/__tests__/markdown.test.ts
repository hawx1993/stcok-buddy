import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { renderMarkdownContent } from '../markdown';

describe('renderMarkdownContent', () => {
  it('links stock names in markdown tables with stock metadata', () => {
    const html = renderMarkdownContent('| 名称 | 涨跌幅 |\n| --- | --- |\n| 宁德时代 | +2.35% |', {
      disclaimer: false,
      stocks: [{ code: '300750', name: '宁德时代' }],
    });

    expect(html).toContain(
      '<a href="#" class="stock-link" data-stock-code="300750" data-stock-name="宁德时代">宁德时代</a>',
    );
  });

  it('links stock names from the code column in msg-text markdown tables', () => {
    const html = renderMarkdownContent('| 排名 | 代码 | 名称 | 涨跌幅 |\n| --- | --- | --- | --- |\n| 1 | 300308 | 中际旭创 | -7.64% |', {
      disclaimer: false,
    });
    const msgText = renderToStaticMarkup(createElement('div', { className: 'msg-text', dangerouslySetInnerHTML: { __html: html } }));

    expect(msgText).toContain('class="msg-text"');
    expect(msgText).toContain(
      '<a href="#" class="stock-link" data-stock-code="300308" data-stock-name="中际旭创">中际旭创</a>',
    );
  });

  it('links stock names and marks change values in leader stock cells', () => {
    const html = renderMarkdownContent('| 题材方向 | 板块涨幅 | 领涨个股 |\n| --- | --- | --- |\n| 有色金属・钨 | +9.02% | 翔鹭钨业 +9.99% |', {
      disclaimer: false,
    });
    const msgText = renderToStaticMarkup(createElement('div', { className: 'msg-text', dangerouslySetInnerHTML: { __html: html } }));

    expect(msgText).toContain(
      '<a href="#" class="stock-link" data-stock-name="翔鹭钨业">翔鹭钨业</a> <span class="up">+9.99%</span>',
    );
  });

  it('marks rise and fall values inside msg-text tables for market color variables', () => {
    const html = renderMarkdownContent('| 名称 | 涨跌幅 |\n| --- | --- |\n| 宁德时代 | +2.35% |\n| 比亚迪 | -1.20% |', {
      disclaimer: false,
      stocks: [
        { code: '300750', name: '宁德时代' },
        { code: '002594', name: '比亚迪' },
      ],
    });
    const msgText = renderToStaticMarkup(createElement('div', { className: 'msg-text', dangerouslySetInnerHTML: { __html: html } }));

    expect(msgText).toContain('class="msg-text"');
    expect(msgText).toContain('<span class="up">+2.35%</span>');
    expect(msgText).toContain('<span class="down">-1.20%</span>');
  });
});
