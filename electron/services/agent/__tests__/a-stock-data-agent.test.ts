import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../tools/tool-registry.js', () => ({
  callTool: vi.fn(),
}));

vi.mock('../../llm/index.js', () => ({
  generateReport: vi.fn(),
}));

import type { ToolCallRecord } from '../../../../src/shared/types.js';
import { generateReport } from '../../llm/index.js';
import { callTool } from '../../tools/tool-registry.js';
import { agenticAStockDataAnswer } from '../a-stock-data-agent.js';
import {
  A_STOCK_DATA_TOOLBOX,
  isNoDataToolResult,
  parseConcentration90Max,
  parseMarketCapRangeYi,
  parseToolCall,
  shouldPrefetchCompoundMarketScreening,
  shouldQueryLocalDuckDB,
  shouldQueryMarketWideSurgeOrders,
  shouldQueryStockSurgeEvents,
} from '../a-stock-data-agent-tools.js';
import type { IAgentContext } from '../orchestrator-types.js';

const mockedCallTool = vi.mocked(callTool);
const mockedGenerateReport = vi.mocked(generateReport);

function record(toolName: string, output: unknown, input: unknown = {}): ToolCallRecord {
  return {
    id: `tool-${toolName}`,
    toolName,
    input,
    output,
    startedAt: '2026-08-05T00:00:00.000Z',
    endedAt: '2026-08-05T00:00:00.000Z',
  };
}

beforeEach(() => {
  mockedCallTool.mockReset();
  mockedGenerateReport.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

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
    expect(names).toContain('screenLocalAStocks');
    expect(names).toContain('screenASharesByMarketCap');
    expect(names).toContain('queryLocalMarketDuckDB');
    expect(names).toContain('queryLocalMonitorDuckDB');
    expect(names).toContain('queryLocalSurgeDuckDB');
    expect(names).toContain('getStockSurgeEventsLocalFirst');
    expect(names).toContain('getStockChipDistributionLocalFirst');
    expect(names).not.toContain('getStockQuote');
  });

  it('本地优先工具描述遵循 DuckDB 到 stock-sdk 再到 a-stock-data', () => {
    const quote = A_STOCK_DATA_TOOLBOX.find((tool) => tool.name === 'getStockQuoteLocalFirst');
    const kline = A_STOCK_DATA_TOOLBOX.find((tool) => tool.name === 'getStockKlineLocalFirst');
    const chip = A_STOCK_DATA_TOOLBOX.find((tool) => tool.name === 'getStockChipDistributionLocalFirst');

    expect(quote?.description).toContain('本地 DuckDB');
    expect(quote?.description).toContain('stock-sdk');
    expect(quote?.description).toContain('a-stock-data');
    expect(kline?.description).toContain('本地 DuckDB');
    expect(kline?.description).toContain('stock-sdk');
    expect(kline?.description).toContain('a-stock-data');
    expect(chip?.description).toContain('DuckDB');
    expect(chip?.description).toContain('stock-sdk');
    expect(chip?.description).toContain('a-stock-data');
  });

  it('提供北向资金工具，getHotFocus 描述将北向问题引导到 getNorthboundFlow', () => {
    expect(A_STOCK_DATA_TOOLBOX.map((tool) => tool.name)).toContain('getNorthboundFlow');
    const hotFocus = A_STOCK_DATA_TOOLBOX.find((tool) => tool.name === 'getHotFocus');
    const northbound = A_STOCK_DATA_TOOLBOX.find((tool) => tool.name === 'getNorthboundFlow');
    expect(hotFocus?.description).toContain('getNorthboundFlow');
    expect(northbound?.description).toContain('北向');
  });

  it('全市场条件筛选描述引导到本地 DuckDB', () => {
    const screen = A_STOCK_DATA_TOOLBOX.find((tool) => tool.name === 'screenLocalAStocks');
    expect(screen?.description).toContain('全市场本地筛选');
    expect(screen?.description).toContain('筹码+涨幅');
    expect(screen?.description).toContain('chipLookbackDays');
    expect(screen?.description).toContain('最近5天90%筹码集中度均<20%');
  });

  it('市值筛选工具描述包含区间和真实数据优先级', () => {
    const screen = A_STOCK_DATA_TOOLBOX.find((tool) => tool.name === 'screenASharesByMarketCap');
    expect(screen?.description).toContain('市值');
    expect(screen?.description).toContain('30亿到100亿');
    expect(screen?.description).toContain('DuckDB');
    expect(screen?.description).toContain('stock-sdk');
    expect(screen?.description).toContain('a-stock-data');
  });

  it('个股异动工具描述覆盖订单和手数场景', () => {
    const surge = A_STOCK_DATA_TOOLBOX.find((tool) => tool.name === 'getStockSurgeEventsLocalFirst');
    expect(surge?.description).toContain('订单');
    expect(surge?.description).toContain('手数');
    expect(surge?.description).toContain('本地 DuckDB');
    expect(surge?.description).toContain('stock-sdk');
    expect(surge?.description).toContain('a-stock-data');
  });
});

describe('个股异动关键词识别', () => {
  it('识别订单、手数、大笔买卖和快速拉盘问题', () => {
    expect(shouldQueryStockSurgeEvents('600519 今天有没有大笔买入手数')).toBe(true);
    expect(shouldQueryStockSurgeEvents('帮我看下这个票有没有快速拉盘')).toBe(true);
    expect(shouldQueryStockSurgeEvents('最近个股异动和跌幅风险')).toBe(true);
  });

  it('普通估值问题不触发个股异动查询', () => {
    expect(shouldQueryStockSurgeEvents('600519 PE 和 PB 是多少')).toBe(false);
  });

  it('识别全市场买入手数筛选问题', () => {
    expect(shouldQueryMarketWideSurgeOrders('帮我选出今天个股买入大于10000手的股票')).toBe(true);
    expect(shouldQueryMarketWideSurgeOrders('帮我选出昨天个股买入大于10000手的股票')).toBe(true);
    expect(shouldQueryMarketWideSurgeOrders('今天哪些股票有特大单买入超过1万手')).toBe(true);
  });

  it('普通估值问题不触发全市场大单预查询', () => {
    expect(shouldQueryMarketWideSurgeOrders('600519 PE 和 PB 是多少')).toBe(false);
  });
});

describe('复合选股关键词和阈值识别', () => {
  const query = '帮我找出90%筹码小于15%，市值在30亿到100亿，近期有超大笔买入的股票';

  it('识别筹码、市值和近期大单买入复合选股', () => {
    expect(shouldPrefetchCompoundMarketScreening(query)).toBe(true);
    expect(shouldPrefetchCompoundMarketScreening('600519 PE 和 PB 是多少')).toBe(false);
  });

  it('解析 90% 筹码集中度上限和市值区间', () => {
    expect(parseConcentration90Max(query)).toBe(15);
    expect(parseMarketCapRangeYi(query)).toEqual({ min: 30, max: 100 });
  });
});

describe('无数据结果识别与本地 DuckDB 递归保护', () => {
  it('识别空结果和暂不可用文案为无数据', () => {
    expect(isNoDataToolResult([])).toBe(true);
    expect(isNoDataToolResult({ rows: [] })).toBe(true);
    expect(isNoDataToolResult({ list: [] })).toBe(true);
    expect(isNoDataToolResult({ news: [], announcements: [] })).toBe(true);
    expect(isNoDataToolResult('该数据源暂不可用')).toBe(true);
  });

  it('有效数据不会触发本地 DuckDB 续查', () => {
    expect(shouldQueryLocalDuckDB('getHotConcepts', { list: [{ code: '600519' }] })).toBe(false);
    expect(shouldQueryLocalDuckDB('getStockNewsAnnouncements', { news: [{ title: '公告' }], announcements: [] })).toBe(false);
  });

  it('本地 DuckDB 工具自身不会递归续查', () => {
    expect(shouldQueryLocalDuckDB('queryLocalDuckDBData', { rows: [] })).toBe(false);
    expect(shouldQueryLocalDuckDB('getHotConcepts', { rows: [] })).toBe(true);
  });
});

describe('agenticAStockDataAnswer 全市场异动日期解析', () => {
  it('昨天买入手数筛选查询前一日 DuckDB 异动历史', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-05T02:00:00.000Z'));
    const context: IAgentContext = {
      query: '帮我选出昨天个股买入大于10000手的股票',
      intent: 'a-stock-data-agent',
      urls: [],
      evidence: [],
      toolCalls: [],
      findings: [],
      emitEvent: vi.fn(),
    };

    mockedCallTool.mockImplementation(async (toolName, input) => {
      if (toolName === 'queryLocalDuckDBData') return record(toolName, { rows: [], isEmpty: true }, input);
      if (toolName === 'queryLocalSurgeDuckDB') {
        return record(toolName, {
          rows: [{ code: '000889', name: '中嘉博创', title: '中嘉博创 000889', time: '11:28', amount: '买入1.02万手', description: '特大单买入' }],
          isEmpty: false,
        }, input);
      }
      return record(toolName, { rows: [], isEmpty: true }, input);
    });
    mockedGenerateReport.mockResolvedValueOnce('最终回答');

    await expect(agenticAStockDataAnswer(context)).resolves.toBe('最终回答');

    const surgeCalls = mockedCallTool.mock.calls.filter(([toolName]) => toolName === 'queryLocalSurgeDuckDB');
    expect(surgeCalls).toHaveLength(1);
    expect(surgeCalls[0]?.[1]).toEqual(expect.objectContaining({
      date: '2026-08-04',
      side: 'buy',
      minHands: 10000,
      limit: 1000,
    }));
    expect(surgeCalls[0]?.[1]).not.toEqual(expect.objectContaining({ date: '2026-08-05' }));
    const reportMessages = mockedGenerateReport.mock.calls.at(-1)?.[0] ?? [];
    expect(JSON.stringify(reportMessages)).toContain('筛选日期：2026-08-04');
  });
});

describe('agenticAStockDataAnswer 复合选股预取', () => {
  it('预取筹码、市值和近期大单买入数据，最终提示不暴露内部上限', async () => {
    const context: IAgentContext = {
      query: '帮我找出90%筹码小于15%，市值在30亿到100亿，近期有超大笔买入的股票',
      intent: 'a-stock-data-agent',
      urls: [],
      evidence: [],
      toolCalls: [],
      findings: [],
      emitEvent: vi.fn(),
    };

    mockedCallTool.mockImplementation(async (toolName, input) => {
      if (toolName === 'queryLocalDuckDBData') return record(toolName, { rows: [], isEmpty: true }, input);
      if (toolName === 'screenLocalAStocks') {
        return record(toolName, {
          rows: [{ code: '000889', name: '中嘉博创', concentration90Percent: 14.2, chipDate: '2026-08-05' }],
          isEmpty: false,
        }, input);
      }
      if (toolName === 'screenASharesByMarketCap') {
        return record(toolName, {
          rows: [{ code: '000889', name: '中嘉博创', marketCapYi: 45, marketCapText: '45.00亿' }],
          isEmpty: false,
        }, input);
      }
      if (toolName === 'queryLocalSurgeDuckDB') {
        return record(toolName, {
          rows: [{ code: '000889', name: '中嘉博创', title: '中嘉博创 000889', time: '11:28', amount: '买入1.02万手', description: '特大单买入' }],
          isEmpty: false,
        }, input);
      }
      return record(toolName, { rows: [{ code: '000889' }], isEmpty: false }, input);
    });
    mockedGenerateReport
      .mockResolvedValueOnce('{"tool":"getHotConcepts","input":{}}')
      .mockResolvedValueOnce('{"tool":"getIndustryRanking","input":{}}')
      .mockResolvedValueOnce('{"tool":"getMarketReview","input":{}}')
      .mockResolvedValueOnce('最终回答');

    await expect(agenticAStockDataAnswer(context)).resolves.toBe('最终回答');

    expect(mockedCallTool).toHaveBeenCalledWith('screenLocalAStocks', expect.objectContaining({ concentration90Max: 15, limit: 500 }));
    expect(mockedCallTool).toHaveBeenCalledWith('screenASharesByMarketCap', expect.objectContaining({ minMarketCap: 30, maxMarketCap: 100, unit: 'yi' }));
    expect(mockedCallTool).toHaveBeenCalledWith('queryLocalSurgeDuckDB', expect.objectContaining({ side: 'buy', minHands: 10000, keepDays: 7 }));
    const lastMessages = mockedGenerateReport.mock.calls.at(-1)?.[0] ?? [];
    expect(JSON.stringify(lastMessages)).not.toContain('工具调用已达上限');
    expect(JSON.stringify(lastMessages)).not.toContain('调用上限');
    expect(JSON.stringify(lastMessages)).toContain('复合筛选汇总');
  });

  it('直接最终回答暴露工具上限时会基于真实结果重写', async () => {
    const context: IAgentContext = {
      query: '帮我找出90%筹码小于15%，市值在30亿到100亿，近期有超大笔买入的股票',
      intent: 'a-stock-data-agent',
      urls: [],
      evidence: [],
      toolCalls: [],
      findings: [],
      emitEvent: vi.fn(),
    };

    mockedCallTool.mockImplementation(async (toolName, input) => {
      if (toolName === 'queryLocalDuckDBData') return record(toolName, { rows: [], isEmpty: true }, input);
      if (toolName === 'screenLocalAStocks') {
        return record(toolName, {
          rows: [{ code: '000889', name: '中嘉博创', concentration90Percent: 14.2, chipDate: '2026-08-05' }],
          isEmpty: false,
        }, input);
      }
      if (toolName === 'screenASharesByMarketCap') {
        return record(toolName, {
          rows: [{ code: '000889', name: '中嘉博创', marketCapYi: 45, marketCapText: '45.00亿' }],
          isEmpty: false,
        }, input);
      }
      if (toolName === 'queryLocalSurgeDuckDB') {
        return record(toolName, {
          rows: [{ code: '000889', name: '中嘉博创', title: '中嘉博创 000889', time: '11:28', amount: '买入1.02万手', description: '特大单买入' }],
          isEmpty: false,
        }, input);
      }
      return record(toolName, { rows: [], isEmpty: true }, input);
    });
    mockedGenerateReport
      .mockResolvedValueOnce('该项条件需要个股异动/大单成交数据来验证，本次工具调用已达上限，未能获取到对应的异动数据，因此无法确认。')
      .mockResolvedValueOnce('真实工具结果显示：000889 中嘉博创同时满足90%筹码集中度小于15%、总市值45.00亿、近期出现买入1.02万手特大单买入样本。');

    const answer = await agenticAStockDataAnswer(context);

    expect(answer).not.toContain('工具调用已达上限');
    expect(answer).not.toContain('调用上限');
    expect(answer).toContain('000889');
    expect(mockedGenerateReport).toHaveBeenCalledTimes(2);
    const rewriteMessages = mockedGenerateReport.mock.calls.at(-1)?.[0] ?? [];
    expect(JSON.stringify(rewriteMessages)).toContain('不能把内部约束当作数据缺口原因');
  });
});
