import type { LlmChatMessage } from '../llm/openai-compatible-client.js';
import { generateReport } from '../llm/index.js';
import { runContextTool } from './agent-tool-runtime.js';
import type { IAgentContext } from './orchestrator-types.js';
import {
  STOCK_PICKER_TOOLBOX,
  buildStockPickerIntentPromptPart,
  isStockPickerToolAllowed,
  parseToolCall,
  resolveStockPickerIntent,
} from './stock-picker-agent-tools.js';

/**
 * 超短线技术选股智能体：用户用自然语言描述技术选股需求，由大模型自主决定调用
 * 哪些真实数据工具（screenLocalAStocks 宽筛 → getTechnicalIndicators 等精筛），
 * 多轮取数后输出候选清单。工具调用走 runContextTool，自动写入 toolCalls 并 emit 事件，
 * AnalysisProgress 卡片可见调用过程。范式与 a-stock-data-agent 一致（ReAct 式 prompt 工具调用）。
 */

const MAX_TOOL_ROUNDS = 5;
const AGENT_ID = 'stock-picker-agent';

function buildStockPickerSystemPrompt(): string {
  const tools = STOCK_PICKER_TOOLBOX.map((tool) => `- ${tool.name}：${tool.description}`).join('\n');
  return `你是 StockBuddy 的「超短线技术选股」智能体。用户用自然语言描述一个超短线（持仓 1–5 个交易日，博涨停/连板/题材轮动/平台突破）的技术选股需求，你必须：自主拆解条件 → 决定调用哪些真实数据工具 → 多轮取数 → 对全市场候选股做技术面筛选与排序 → 输出候选清单与理由。严禁编造任何股票、价格、指标或资金数据。

可调用工具（真实数据源，仅以下白名单）：
${tools}

超短线技术因子体系（你筛选与排序的依据）：
- 量价：换手率、量比、成交额、涨跌幅、振幅
- 形态：涨停/首板/连板/炸板、上影/下影线、平台突破、跳空缺口
- 趋势：均线多头（5/10/20）、MACD 金叉/死叉、KDJ、BOLL 开口
- 筹码：90%/70% 集中度、获利比例、成本单峰密集
- 资金：主力净流入、大单/特大单、龙虎榜游资、北向
- 情绪/题材：连板高度、板块效应、热点题材、消息催化（需联网）

决策与工具调用协议（严格遵守）：
1. 先宽筛后精筛：第一步用 screenLocalAStocks 做全市场宽口径初筛（changePercent/turnoverRate/concentration90Max/includeST/limit）拿到候选池；再对候选池 Top N 逐只调用 getTechnicalIndicators / getStockChipDistributionLocalFirst / getStockFundFlowLocalFirst 验证，必要时 getStockSurgeEventsLocalFirst / getDragonTiger 看异动与游资。
2. 每轮只输出一行 JSON：{"tool":"工具名","input":{...}}，不要输出其他文字；input 为空写 {}。
3. 每轮最多一个工具；需要多个数据就连续多轮调用。
4. 取数顺序：本地 DuckDB → stock-sdk → a-stock-data；本地预查询已覆盖且时效满足则直接采用。
5. 工具返回"暂不可用/空"时明确标注数据缺口，不得脑补；候选为 0 时如实说明，禁止虚构。
6. 条件矛盾或数据不足时，返回空清单并说明原因。
7. 最多 5 轮工具调用预算，避免死循环。

输出格式（最终回答，Markdown）：
## 选股结论
- 一句话：今日符合条件约 N 只（数据缺口：…）
## 候选清单（按综合评分降序）
| 排名 | 代码 | 名称 | 涨幅% | 换手% | 筹码90% | 评分 | 一句话理由 |
| --- | --- | --- | --- | --- | --- | --- | --- |
候选清单表格不得展示量比、MACD、主力净流入三列，也不要用“暂无”“--”等占位；若工具返回对应真实数据且对判断有价值，只能在技术面理由中描述，未返回则不提及。
（评分 0–100，基于：量价健康、趋势多头、筹码集中、资金流入、题材/情绪共振；并标明置信度）
## 技术面理由（逐只 2–3 句）
## 风险提示
- 超短线波动极大，本结果仅基于历史技术面与公开数据，不构成任何买卖建议；A 股 T+1，当日买入次日方可卖出；需结合实时盘口、仓位管理与止损纪律独立决策。

遵守：禁止 🚀🔥💎🌙🤑🎉；每段至多 2 个 Emoji；不使用确定性买卖指令；必须保留风险提示。`;
}

function summarizeToolResult(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return (text ?? '').slice(0, 4000) || '（空结果）';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function readTextField(value: unknown, key: string): string | undefined {
  const raw = asRecord(value)?.[key];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

function readNumberField(value: unknown, key: string): number | undefined {
  const raw = asRecord(value)?.[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

function readRows(value: unknown): Record<string, unknown>[] {
  const rows = asRecord(value)?.rows;
  return Array.isArray(rows) ? rows.filter((row): row is Record<string, unknown> => Boolean(asRecord(row))) : [];
}

function readStockCode(row: unknown): string | undefined {
  return readTextField(row, 'code') ?? readTextField(row, 'symbol');
}

/**
 * 全市场选股（screenLocalAStocks / screenASharesByMarketCap）结果可能上百行，
 * JSON 在 4000 字符处被截断会导致模型只看到部分股票。改为紧凑的"代码 名称 涨幅 换手 量比 筹码90%"
 * 逐行输出，并先给出 matchedCount/returnedCount，确保模型能看到全部命中样本。
 */
function summarizePickerToolResult(toolName: string, value: unknown): string {
  if (toolName !== 'screenLocalAStocks' && toolName !== 'screenASharesByMarketCap') {
    return summarizeToolResult(value);
  }
  const record = asRecord(value);
  const rows = readRows(value);
  if (!rows.length) return summarizeToolResult(value);
  const matchedCount = readNumberField(value, 'matchedCount');
  const returnedCount = readNumberField(value, 'returnedCount');
  const latestTradeDate = readTextField(value, 'latestTradeDate');
  const warnings = Array.isArray(record?.warnings) ? (record.warnings as unknown[]).map(String) : [];
  const header = `共 ${matchedCount ?? rows.length} 只股票符合条件，本次返回 ${returnedCount ?? rows.length} 只（每行：代码 名称 行业 涨幅% 换手% 成交额 筹码90% 获利比例 主力净流入）：`;
  const lines = rows.map((row) => {
    const code = readStockCode(row) ?? '--';
    const name = readTextField(row, 'name') ?? '';
    const industry = readTextField(row, 'industry') ?? '';
    const changePercent = readNumberField(row, 'changePercent');
    const turnoverRate = readNumberField(row, 'turnoverRate');
    const amount = readNumberField(row, 'amount') ?? readNumberField(row, 'amountYuan');
    const concentration90 = readNumberField(row, 'concentration90Percent');
    const profitRatio = readNumberField(row, 'profitRatioPercent');
    const fundFlow = readTextField(row, 'mainFundNetInflow') ?? readTextField(row, 'fundFlow');
    return [
      code,
      name,
      industry,
      changePercent !== undefined ? `涨${changePercent}%` : '',
      turnoverRate !== undefined ? `换${turnoverRate}%` : '',
      amount !== undefined ? `额${amount}` : '',
      concentration90 !== undefined ? `筹90%${concentration90}` : '',
      profitRatio !== undefined ? `获利${profitRatio}%` : '',
      fundFlow ?? '',
    ]
      .filter(Boolean)
      .join(' ');
  });
  const tradeDateText = latestTradeDate ? `最新交易日：${latestTradeDate}\n` : '';
  const warningText = warnings.length ? `\n注意：${warnings.join('；')}` : '';
  return `${tradeDateText}${header}${warningText}\n${lines.join('\n')}`.slice(0, 20000);
}

function emitAgentProgress(ctx: IAgentContext, message: string, round: number): void {
  ctx.emitEvent?.({
    type: 'progress_updated',
    title: '超短线选股进度',
    message,
    progress: { current: round, total: MAX_TOOL_ROUNDS },
    step: { id: AGENT_ID, agent: 'stock-picker', description: message, status: 'running' },
    subAgent: { name: 'stock-picker', description: message, status: 'running' },
  });
}

/** 超短线技术选股：LLM 自主选工具取真实数据后作答，并在 Agent 协作区展示调用进度。 */
export async function agenticStockPickerAnswer(ctx: IAgentContext): Promise<string> {
  const resolvedIntent = resolveStockPickerIntent(ctx.query);
  const messages: LlmChatMessage[] = [
    { role: 'system', content: buildStockPickerSystemPrompt() },
    { role: 'user', content: ctx.query },
    { role: 'user', content: buildStockPickerIntentPromptPart(resolvedIntent) },
  ];
  const allowedToolNames = STOCK_PICKER_TOOLBOX.map((tool) => tool.name);
  emitAgentProgress(ctx, `已识别为「${resolvedIntent.label}」，正在准备真实数据宽筛...`, 0);

  let usedToolRounds = 0;
  if (resolvedIntent.primaryTool) {
    emitAgentProgress(ctx, `正在按「${resolvedIntent.label}」执行首轮宽筛...`, 1);
    const result = await runContextTool(
      ctx,
      resolvedIntent.primaryTool,
      resolvedIntent.primaryInput ?? {},
      () => '该数据源暂不可用',
    );
    usedToolRounds += 1;
    messages.push({
      role: 'user',
      content: `已按「${resolvedIntent.label}」意图优先调用 ${resolvedIntent.primaryTool}。工具返回结果：\n${summarizePickerToolResult(
        resolvedIntent.primaryTool,
        result,
      )}`,
    });
  }

  for (let round = usedToolRounds; round < MAX_TOOL_ROUNDS; round++) {
    emitAgentProgress(ctx, '选股智能体调用模型分析中...', round + 1);
    const response = await generateReport(messages);
    const call = parseToolCall(response);
    if (!call) return finalizePickerAnswer(messages, response);
    if (!isStockPickerToolAllowed(call.tool)) {
      messages.push({ role: 'assistant', content: response });
      messages.push({
        role: 'user',
        content: `工具 ${call.tool} 不在可用列表。可用工具：${allowedToolNames.join('、')}。请重新选择工具或直接输出最终回答。`,
      });
      continue;
    }
    const result = await runContextTool(ctx, call.tool, call.input, () => '该数据源暂不可用');
    emitAgentProgress(ctx, `已获取 ${call.tool} 真实数据，继续筛选...`, round + 1);
    messages.push({ role: 'assistant', content: response });
    messages.push({
      role: 'user',
      content: `工具 ${call.tool} 返回结果：\n${summarizePickerToolResult(call.tool, result)}`,
    });
  }

  emitAgentProgress(ctx, '正在汇总已获取的真实数据并生成候选清单...', MAX_TOOL_ROUNDS);
  messages.push({
    role: 'user',
    content:
      '已完成本轮可用真实数据查询。请只基于以上真实工具结果给出最终候选清单；如数据不足，明确说明缺口或暂无数据，不要提及内部执行预算或系统约束。',
  });
  return finalizePickerAnswer(messages, await generateReport(messages));
}

async function finalizePickerAnswer(messages: LlmChatMessage[], response: string): Promise<string> {
  // 防止模型把内部工具调用预算/系统约束当作数据缺口原因暴露给用户
  if (/工具调用[^。；;\n]*(?:上限|已达上限)|执行预算|系统约束|内部约束/.test(response)) {
    messages.push({ role: 'assistant', content: response });
    messages.push({
      role: 'user',
      content:
        '上一版回答暴露了内部执行约束，且不能把内部约束当作数据缺口原因。请基于上文已经返回的真实工具结果重写最终回答：不得提及内部工具调用上限、执行预算或系统约束；如果筛选 matchedRows 有数据，列出真实匹配样本；如果为空，只能说明真实数据交集为空或对应真实数据源未返回可验证样本，不得编造股票、行情或资金。',
    });
    const revised = await generateReport(messages);
    return revised
      .split(/(?<=[。！？!?])|\n/)
      .map((line) => line.trim())
      .filter((line) => line && !/工具调用[^。；;\n]*上限|执行预算|系统约束|内部约束/.test(line))
      .join('\n')
      .trim();
  }
  return response;
}
