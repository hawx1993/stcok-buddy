import { describe, expect, it } from 'vitest';

import { A_STOCK_DATA_TOOLBOX, parseToolCall } from '../a-stock-data-agent-tools.js';

describe('parseToolCall 解析工具调用', () => {
  it('解析整段 JSON 工具调用', () => {
    expect(parseToolCall('{"tool":"getStockQuote","input":{"symbol":"000858"}}')).toEqual({
      tool: 'getStockQuote',
      input: { symbol: '000858' },
    });
  });

  it('解析 json 代码块中的工具调用', () => {
    const response = '```json\n{"tool":"getIndustryRanking","input":{}}\n```';
    expect(parseToolCall(response)).toEqual({ tool: 'getIndustryRanking', input: {} });
  });

  it('解析最终回答前夹杂的工具调用行', () => {
    const response = '我先取一下数据。\n{"tool":"getHotConcepts","input":{}}\n请稍候。';
    expect(parseToolCall(response)).toEqual({ tool: 'getHotConcepts', input: {} });
  });

  it('input 缺省时默认空对象', () => {
    expect(parseToolCall('{"tool":"getMarketReview"}')).toEqual({ tool: 'getMarketReview', input: {} });
  });

  it('普通最终回答不误判为工具调用', () => {
    expect(parseToolCall('## 今日市场\n- 上证指数收涨 0.5%。')).toBeUndefined();
    expect(parseToolCall('市盈率（PE）是股价与每股收益的比值。')).toBeUndefined();
  });

  it('非 JSON 或缺少 tool 字段返回 undefined', () => {
    expect(parseToolCall('{"input":{"symbol":"000858"}}')).toBeUndefined();
    expect(parseToolCall('hello world')).toBeUndefined();
  });
});

describe('A_STOCK_DATA_TOOLBOX', () => {
  it('工具列表包含真实数据工具且无重复', () => {
    const names = A_STOCK_DATA_TOOLBOX.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('getHolderNumberChange');
    expect(names).toContain('getDividendHistory');
    expect(names).toContain('getStockQuoteLocalFirst');
    expect(names).not.toContain('getStockQuote');
  });

  it('提供北向资金工具，getHotFocus 描述将北向问题引导到 getNorthboundFlow', () => {
    expect(A_STOCK_DATA_TOOLBOX.map((tool) => tool.name)).toContain('getNorthboundFlow');
    const hotFocus = A_STOCK_DATA_TOOLBOX.find((tool) => tool.name === 'getHotFocus');
    const northbound = A_STOCK_DATA_TOOLBOX.find((tool) => tool.name === 'getNorthboundFlow');
    expect(hotFocus?.description).toContain('getNorthboundFlow');
    expect(northbound?.description).toContain('北向');
  });
});
