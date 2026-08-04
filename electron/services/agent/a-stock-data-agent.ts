import type { LlmChatMessage } from '../llm/openai-compatible-client.js';
import { generateReport } from '../llm/index.js';
import { runContextTool } from './agent-tool-runtime.js';
import type { IAgentContext } from './orchestrator-types.js';
import {
  A_STOCK_DATA_TOOLBOX,
  isNoDataToolResult,
  parseToolCall,
  shouldQueryLocalDuckDB,
} from './a-stock-data-agent-tools.js';

/**
 * 智能体式 a-stock-data 回答：股票 / A 股相关问题由大模型自主决定调用哪个真实数据工具，
 * 多轮取数后基于真实结果作答。工具调用走 runContextTool，自动写入 toolCalls 并 emit 事件，
 * AnalysisProgress 卡片可见工具调用过程。
 */

const MAX_TOOL_ROUNDS = 3;
const LOCAL_DUCKDB_TOOL_NAME = 'queryLocalDuckDBData';

function buildAgenticSystemPrompt(): string {
  const tools = A_STOCK_DATA_TOOLBOX.map((tool) => `- ${tool.name}：${tool.description}`).join('\n');
  return `你是 StockBuddy 的 A 股投研助手。用户的问题是股票 / A 股市场相关，必须基于真实数据回答，严禁编造任何数值、股票、板块、涨跌、资金或概念数据。

可调用工具（真实数据源）：
${tools}

输出协议（严格遵守）：
- 如果需要获取真实数据，只输出一行 JSON：{"tool":"工具名","input":{...}}，不要输出其他文字。input 为空对象时写 {"tool":"工具名","input":{}}。
- 每轮最多调用一个工具；需要多个数据时连续多轮调用。
- 如果问题不需要工具（概念解释、观点、或已获得足够数据），直接输出最终回答（Markdown）。
- 工具结果会追加到对话中，请基于真实工具结果作答。
- 工具返回"数据源暂不可用"或为空时，明确写"暂无数据/数据源暂不可用"，不得脑补。

遵守 emoji 规则：专业金融风格，禁止 🚀🔥💎🌙🤑🎉，每段至多 2 个 Emoji。输出 Markdown，观点与事实分段，不使用确定性买卖指令，保留风险提示。`;
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

function buildLocalDuckDBInput(ctx: IAgentContext, input: unknown): { symbol?: string; limit: number } {
  const symbol = readTextField(input, 'symbol') ?? readTextField(input, 'code') ?? ctx.symbol;
  return { symbol, limit: 60 };
}

async function queryLocalDuckDBAfterNoData(ctx: IAgentContext, sourceTool: string, input: unknown): Promise<unknown> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const step = {
    id: 'local-duckdb',
    agent: 'LocalDuckDBAgent',
    description: '查询本地 DuckDB 数据库',
    status: 'running' as const,
    startedAt,
  };
  ctx.emitEvent?.({
    type: 'subagent_started',
    title: '子 Agent 启动',
    message: '查询本地 DuckDB 数据库中...',
    step,
    subAgent: {
      name: '本地 DuckDB 数据库',
      description: `a-stock-data 工具 ${sourceTool} 无数据，改查本地 DuckDB`,
      status: 'running',
      summary: '查询本地 DuckDB 数据库中...',
    },
  });

  const result = await runContextTool(ctx, LOCAL_DUCKDB_TOOL_NAME, buildLocalDuckDBInput(ctx, input), () => ({
    source: 'duckdb:local',
    storage: 'local',
    kline: [],
    marketRows: [],
    warnings: ['本地 DuckDB 查询失败'],
    isEmpty: true,
  }));
  const endedAtMs = Date.now();
  const empty = isNoDataToolResult(result);
  ctx.emitEvent?.({
    type: 'subagent_completed',
    title: '子 Agent 结果',
    message: empty ? '本地 DuckDB 查询完成，但暂无可用数据' : '本地 DuckDB 查询完成',
    step: {
      ...step,
      status: 'completed',
      elapsed: Math.max(0, Math.round((endedAtMs - startedAtMs) / 100) / 10),
      endedAt: new Date(endedAtMs).toISOString(),
    },
    subAgent: {
      name: '本地 DuckDB 数据库',
      description: '查询本地 DuckDB 数据库',
      status: 'completed',
      elapsed: Math.max(0, Math.round((endedAtMs - startedAtMs) / 100) / 10),
      summary: empty ? '本地 DuckDB 暂无可用数据' : '本地 DuckDB 返回可用数据',
    },
  });
  return result;
}

function emitAgentProgress(ctx: IAgentContext, message: string, round: number): void {
  ctx.emitEvent?.({
    type: 'progress_updated',
    title: 'a-stock-data 分析进度',
    message,
    progress: { current: round, total: MAX_TOOL_ROUNDS },
    step: { id: 'a-stock-data-agent', agent: 'a-stock-data', description: message, status: 'running' },
    subAgent: { name: 'a-stock-data', description: message, status: 'running' },
  });
}

/** 股票 / A 股相关问题：LLM 自主选工具取真实数据后作答，并在 Agent 协作区展示调用进度。 */
export async function agenticAStockDataAnswer(ctx: IAgentContext): Promise<string> {
  const symbolHint = ctx.symbol ? `\n（已预解析股票代码：${ctx.symbol}，个股工具可直接使用该代码。）` : '';
  const messages: LlmChatMessage[] = [
    { role: 'system', content: buildAgenticSystemPrompt() },
    { role: 'user', content: ctx.query + symbolHint },
  ];
  const allowedTools = new Set(A_STOCK_DATA_TOOLBOX.map((tool) => tool.name));

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    emitAgentProgress(ctx, 'a-stock-data 调用模型分析中...', round + 1);
    const response = await generateReport(messages);
    const call = parseToolCall(response);
    if (!call) return response;
    if (!allowedTools.has(call.tool)) {
      messages.push({ role: 'assistant', content: response });
      messages.push({
        role: 'user',
        content: `工具 ${call.tool} 不在可用列表。可用工具：${[...allowedTools].join('、')}。请重新选择工具或直接回答。`,
      });
      continue;
    }
    const result = await runContextTool(ctx, call.tool, call.input, () => '该数据源暂不可用');
    const localDuckDBResult = shouldQueryLocalDuckDB(call.tool, result)
      ? await queryLocalDuckDBAfterNoData(ctx, call.tool, call.input)
      : undefined;
    emitAgentProgress(
      ctx,
      localDuckDBResult === undefined
        ? `已获取 ${call.tool} 真实数据，继续分析...`
        : 'a-stock-data 无可用数据，已继续查询本地 DuckDB...',
      round + 1,
    );
    messages.push({ role: 'assistant', content: response });
    messages.push({
      role: 'user',
      content:
        localDuckDBResult === undefined
          ? `工具 ${call.tool} 返回结果：\n${summarizeToolResult(result)}`
          : `工具 ${call.tool} 返回为空或暂不可用：\n${summarizeToolResult(
              result,
            )}\n\n已继续查询本地 DuckDB，返回结果：\n${summarizeToolResult(localDuckDBResult)}`,
    });
  }

  emitAgentProgress(ctx, '已达工具调用上限，汇总真实数据生成最终回答...', MAX_TOOL_ROUNDS);
  messages.push({ role: 'user', content: '工具调用已达上限，请基于以上真实工具结果直接给出最终回答。' });
  return generateReport(messages);
}
