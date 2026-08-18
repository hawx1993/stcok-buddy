import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../tools/tool-registry', () => ({
  callTool: vi.fn(),
}));

vi.mock('../../llm/index', () => ({
  generateReport: vi.fn(),
}));

import type { ToolCallRecord } from '../../../../src/shared/types.js';
import { generateReport } from '../../llm/index.js';
import { callTool } from '../../tools/tool-registry.js';
import { agenticStockPickerAnswer } from '../stock-picker-agent.js';
import {
  buildStockPickerIntentPromptPart,
  isStockPickerToolAllowed,
  resolveStockPickerIntent,
} from '../stock-picker-agent-tools.js';
import type { IAgentContext } from '../orchestrator-types.js';

const mockedCallTool = vi.mocked(callTool);
const mockedGenerateReport = vi.mocked(generateReport);

function record(toolName: string, output: unknown, input: unknown = {}): ToolCallRecord {
  return {
    id: `tool-${toolName}`,
    toolName,
    input,
    output,
    startedAt: '2026-08-18T00:00:00.000Z',
    endedAt: '2026-08-18T00:00:00.000Z',
  };
}

function createContext(query: string): IAgentContext {
  return {
    query,
    intent: 'stock-picker',
    urls: [],
    evidence: [],
    toolCalls: [],
    findings: [],
    emitEvent: vi.fn(),
  };
}

beforeEach(() => {
  mockedCallTool.mockReset();
  mockedGenerateReport.mockReset();
});

describe('选股意图映射', () => {
  it('把强势股请求映射为趋势强势宽筛参数', () => {
    const intent = resolveStockPickerIntent('帮我找强势股');

    expect(intent.id).toBe('trend-strength');
    expect(intent.primaryTool).toBe('screenLocalAStocks');
    expect(intent.primaryInput).toEqual(expect.objectContaining({ turnoverRateMin: 5, includeST: false }));
    expect(intent.followupTools).toContain('getTechnicalIndicators');
  });

  it('把主力控盘请求映射为筹码集中和获利比例条件', () => {
    const intent = resolveStockPickerIntent('找主力控盘的票');

    expect(intent.id).toBe('chip-control');
    expect(intent.primaryTool).toBe('screenLocalAStocks');
    expect(intent.primaryInput).toEqual(
      expect.objectContaining({ concentration90Max: 15, profitRatioMin: 80, includeST: false }),
    );
    expect(intent.followupTools).toContain('getStockFundFlowLocalFirst');
  });

  it('把连板请求映射为真实市场复盘优先并提示封单竞价缺口', () => {
    const intent = resolveStockPickerIntent('找能连板的');
    const promptPart = buildStockPickerIntentPromptPart(intent);

    expect(intent.id).toBe('limit-up-potential');
    expect(intent.primaryTool).toBe('getMarketReview');
    expect(intent.followupTools).toContain('getHotConcepts');
    expect(promptPart).toContain('封单金额');
    expect(promptPart).toContain('不得编造');
  });

  it('限制选股智能体只能调用白名单工具', () => {
    expect(isStockPickerToolAllowed('screenLocalAStocks')).toBe(true);
    expect(isStockPickerToolAllowed('getStockQuote')).toBe(false);
  });
});

describe('选股智能体取数流程', () => {
  it('命中模板时先执行推荐宽筛，再让模型继续精筛', async () => {
    const context = createContext('帮我找强势股');
    mockedCallTool.mockImplementation(async (toolName, input) => {
      if (toolName === 'screenLocalAStocks') {
        return record(
          toolName,
          {
            rows: [{ code: '600001', name: '强势样本', industry: '软件', changePercent: 5.2, turnoverRate: 8.6 }],
            matchedCount: 1,
            returnedCount: 1,
            warnings: [],
            isEmpty: false,
          },
          input,
        );
      }
      if (toolName === 'getTechnicalIndicators') {
        return record(toolName, { symbol: '600001', summary: '均线多头，MACD 金叉' }, input);
      }
      return record(toolName, { rows: [], isEmpty: true }, input);
    });
    mockedGenerateReport
      .mockResolvedValueOnce('{"tool":"getTechnicalIndicators","input":{"symbol":"600001"}}')
      .mockResolvedValueOnce('## 选股结论\n- 强势样本来自真实工具结果。\n## 风险提示\n- 不构成买卖建议。');

    const answer = await agenticStockPickerAnswer(context);

    expect(mockedCallTool).toHaveBeenCalledWith(
      'screenLocalAStocks',
      expect.objectContaining({ turnoverRateMin: 5, includeST: false }),
    );
    expect(mockedCallTool).toHaveBeenCalledWith('getTechnicalIndicators', { symbol: '600001' });
    expect(answer).toContain('强势样本');
    const reportMessages = mockedGenerateReport.mock.calls.at(0)?.[0] ?? [];
    expect(JSON.stringify(reportMessages)).toContain('趋势强势');
  });

  it('最终回答暴露内部执行约束时会重写清洗', async () => {
    const context = createContext('找主力控盘的票');
    mockedCallTool.mockResolvedValue(
      record('screenLocalAStocks', {
        rows: [{ code: '600002', name: '筹码样本', concentration90Percent: 14, profitRatioPercent: 82 }],
        matchedCount: 1,
        returnedCount: 1,
        warnings: [],
        isEmpty: false,
      }),
    );
    mockedGenerateReport
      .mockResolvedValueOnce('本次工具调用已达上限，因此无法继续验证。')
      .mockResolvedValueOnce('## 选股结论\n- 600002 筹码样本来自真实筛选结果。\n## 风险提示\n- 不构成买卖建议。');

    const answer = await agenticStockPickerAnswer(context);

    expect(answer).not.toContain('工具调用已达上限');
    expect(answer).not.toContain('执行预算');
    expect(answer).toContain('600002');
    expect(mockedGenerateReport).toHaveBeenCalledTimes(2);
  });
});
