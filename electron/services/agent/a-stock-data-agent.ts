import type { LlmChatMessage } from '../llm/openai-compatible-client.js';
import { toShanghaiMarketTime } from '../../../src/shared/market-time.js';
import { generateReport } from '../llm/index.js';
import { runContextTool } from './agent-tool-runtime.js';
import type { IAgentContext } from './orchestrator-types.js';
import {
  A_STOCK_DATA_TOOLBOX,
  isNoDataToolResult,
  parseConcentration90Max,
  parseMarketCapRangeYi,
  parseToolCall,
  shouldPrefetchCompoundMarketScreening,
  shouldQueryMarketWideSurgeOrders,
  shouldQueryStockSurgeEvents,
} from './a-stock-data-agent-tools.js';

/**
 * 智能体式 a-stock-data 回答：股票 / A 股相关问题由大模型自主决定调用哪个真实数据工具，
 * 多轮取数后基于真实结果作答。工具调用走 runContextTool，自动写入 toolCalls 并 emit 事件，
 * AnalysisProgress 卡片可见工具调用过程。
 */

const MAX_TOOL_ROUNDS = 3;
const LOCAL_DUCKDB_TOOL_NAME = 'queryLocalDuckDBData';
const SCREEN_LOCAL_TOOL_NAME = 'screenLocalAStocks';
const MARKET_CAP_TOOL_NAME = 'screenASharesByMarketCap';
const MARKET_SURGE_TOOL_NAME = 'queryLocalSurgeDuckDB';
const STOCK_SURGE_TOOL_NAME = 'getStockSurgeEventsLocalFirst';
const COMPOUND_SURGE_MIN_HANDS = 10000;
const INTERNAL_EXECUTION_LIMIT_PATTERN = /工具调用[^。；;\n]*(?:上限|已达上限)|调用[^。；;\n]*上限|执行预算|系统约束/;

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
- 自由提问的默认取数顺序是：本地 DuckDB / 本地缓存 → stock-sdk → a-stock-data。你会先收到一段本地 DuckDB 预查询结果。
- 如果本地 DuckDB 预查询结果已经覆盖用户问题且时效满足，可以直接基于该真实数据回答。
- 如果本地结果为空、缺字段、或用户强调强实时数据而本地结果不满足时，优先调用 stock-sdk 主数据源对应工具；stock-sdk 不支持、返回空或失败后，才调用 a-stock-data 工具补充。
- 全市场选股、条件筛选、筹码+涨幅组合筛选、历史监控/异动查询，优先使用本地 DuckDB 工具（screenLocalAStocks/queryLocalMarketDuckDB/queryLocalMonitorDuckDB/queryLocalSurgeDuckDB）。
- 工具返回"数据源暂不可用"或为空时，明确写"暂无数据/数据源暂不可用"，不得脑补。

遵守 emoji 规则：专业金融风格，禁止 🚀🔥💎🌙🤑🎉，每段至多 2 个 Emoji。输出 Markdown，观点与事实分段，不使用确定性买卖指令，保留风险提示。`;
}

function summarizeToolResult(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return (text ?? '').slice(0, 4000) || '（空结果）';
}

function buildLocalPrecheckMessage(result: unknown): string {
  const empty = isNoDataToolResult(result);
  return empty
    ? `本地 DuckDB 预查询结果为空或不可用：\n${summarizeToolResult(
        result,
      )}\n\n后续如需取数，请优先调用 stock-sdk 主数据源工具；stock-sdk 不支持或失败后，再调用 a-stock-data。`
    : `本地 DuckDB 预查询返回真实数据：\n${summarizeToolResult(
        result,
      )}\n\n如果这些数据已覆盖用户问题且时效满足，请直接基于本地真实数据回答；否则优先调用 stock-sdk，再调用 a-stock-data。`;
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

function buildLocalDuckDBInput(ctx: IAgentContext, input: unknown): { symbol?: string; limit: number } {
  const symbol = readTextField(input, 'symbol') ?? readTextField(input, 'code') ?? ctx.symbol;
  return { symbol, limit: 60 };
}

function inferMarketWideOrderSide(query: string): 'buy' | 'sell' {
  return /卖出/.test(query) && !/买入/.test(query) ? 'sell' : 'buy';
}

function resolveMarketWideSurgeTradeDate(query: string, now = new Date()): string {
  const today = toShanghaiMarketTime(now).date;
  if (!/昨天|昨日/.test(query)) return today;
  const value = new Date(`${today}T12:00:00+08:00`);
  value.setDate(value.getDate() - 1);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function containsInternalExecutionLimit(text: string): boolean {
  return INTERNAL_EXECUTION_LIMIT_PATTERN.test(text);
}

function removeInternalExecutionLimitText(text: string): string {
  const cleaned = text
    .split(/(?<=[。！？!?])|\n/)
    .map((line) => line.trim())
    .filter((line) => line && !containsInternalExecutionLimit(line))
    .join('\n')
    .trim();
  return cleaned || '已获取的真实工具结果不足以形成可验证结论，请稍后重试或缩小条件范围。';
}

async function finalizeAgenticAnswer(messages: LlmChatMessage[], response: string): Promise<string> {
  if (!containsInternalExecutionLimit(response)) return response;
  messages.push({ role: 'assistant', content: response });
  messages.push({
    role: 'user',
    content:
      '上一版回答暴露了“工具调用上限/执行预算”等内部执行约束，且不能把内部约束当作数据缺口原因。请基于上文已经返回的真实工具结果重写最终回答：不得提及内部工具调用上限、执行预算或系统约束；如果复合筛选汇总 matchedRows 有数据，列出真实匹配样本；如果 matchedRows 为空，只能说明真实数据交集为空或对应真实数据源未返回可验证样本，不得编造股票、订单、手数或行情。',
  });
  const revised = await generateReport(messages);
  return removeInternalExecutionLimitText(revised);
}

function buildCompoundScreeningSummary(
  concentration90Max: number,
  marketCapRange: { min?: number; max?: number },
  chipResult: unknown,
  marketCapResult: unknown,
  surgeResult: unknown,
) {
  const chipRows = readRows(chipResult);
  const marketCapRows = readRows(marketCapResult);
  const surgeRows = readRows(surgeResult);
  const marketCapByCode = new Map(marketCapRows.map((row) => [readStockCode(row), row]));
  const surgeByCode = new Map<string, Record<string, unknown>[]>();
  for (const row of surgeRows) {
    const code = readStockCode(row);
    if (!code) continue;
    surgeByCode.set(code, [...(surgeByCode.get(code) ?? []), row]);
  }

  const matchedRows = chipRows
    .map((chipRow) => {
      const code = readStockCode(chipRow);
      if (!code) return undefined;
      const marketCapRow = marketCapByCode.get(code);
      const largeBuyRows = surgeByCode.get(code) ?? [];
      if (!marketCapRow || !largeBuyRows.length) return undefined;
      const firstLargeBuy = largeBuyRows[0];
      return {
        code,
        name: readTextField(chipRow, 'name') ?? readTextField(marketCapRow, 'name') ?? readTextField(firstLargeBuy, 'name'),
        concentration90Percent: readNumberField(chipRow, 'concentration90Percent'),
        chipDate: readTextField(chipRow, 'chipDate'),
        marketCapYi: readNumberField(marketCapRow, 'marketCapYi'),
        marketCapText: readTextField(marketCapRow, 'marketCapText'),
        recentLargeBuyCount: largeBuyRows.length,
        recentLargeBuySamples: largeBuyRows.slice(0, 3).map((item) => ({
          title: readTextField(item, 'title'),
          time: readTextField(item, 'time'),
          amount: readTextField(item, 'amount'),
          description: readTextField(item, 'description') ?? readTextField(item, 'tag'),
        })),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== undefined)
    .sort((left, right) => (left.concentration90Percent ?? Number.POSITIVE_INFINITY) - (right.concentration90Percent ?? Number.POSITIVE_INFINITY));

  const warnings: string[] = [];
  if (!chipRows.length) warnings.push('本地筹码筛选未返回符合 90% 筹码集中度条件的样本');
  if (!marketCapRows.length) warnings.push('市值筛选未返回符合区间的样本');
  if (!surgeRows.length) warnings.push('近期大单买入/个股异动未返回符合手数方向条件的样本');
  if (chipRows.length && marketCapRows.length && surgeRows.length && !matchedRows.length) {
    warnings.push('三类真实数据交集为空，暂无同时满足筹码、市值和近期大单买入条件的样本');
  }

  return {
    source: 'agent:compound-market-screening',
    criteria: {
      concentration90Max,
      marketCapMinYi: marketCapRange.min,
      marketCapMaxYi: marketCapRange.max,
      largeOrderSide: 'buy',
      minHands: COMPOUND_SURGE_MIN_HANDS,
    },
    sourceCounts: {
      chipRows: chipRows.length,
      marketCapRows: marketCapRows.length,
      surgeRows: surgeRows.length,
      matchedRows: matchedRows.length,
    },
    matchedRows,
    warnings,
    isEmpty: matchedRows.length === 0,
  };
}

async function prefetchCompoundMarketScreening(ctx: IAgentContext, messages: LlmChatMessage[]): Promise<boolean> {
  if (ctx.symbol || !shouldPrefetchCompoundMarketScreening(ctx.query)) return false;
  const concentration90Max = parseConcentration90Max(ctx.query);
  const marketCapRange = parseMarketCapRangeYi(ctx.query);
  if (concentration90Max === undefined || !marketCapRange) return false;

  emitAgentProgress(ctx, '正在执行筹码、市值与近期大单买入复合筛选...', 1);
  const [chipResult, marketCapResult, surgeResult] = await Promise.all([
    runContextTool(ctx, SCREEN_LOCAL_TOOL_NAME, {
      concentration90Max,
      limit: 500,
      sortBy: 'concentration90',
      sortOrder: 'asc',
    }, () => ({ source: 'duckdb:market', storage: 'local', rows: [], warnings: ['本地筹码筛选暂不可用'], isEmpty: true })),
    runContextTool(ctx, MARKET_CAP_TOOL_NAME, {
      minMarketCap: marketCapRange.min,
      maxMarketCap: marketCapRange.max,
      unit: 'yi',
      marketCapField: 'total',
      limit: 500,
      sortOrder: 'asc',
    }, () => ({ source: 'duckdb+stock-sdk+a-stock-data', storage: 'none', rows: [], warnings: ['市值筛选暂不可用'], isEmpty: true })),
    runContextTool(ctx, MARKET_SURGE_TOOL_NAME, {
      side: 'buy',
      minHands: COMPOUND_SURGE_MIN_HANDS,
      keepDays: 7,
      limit: 1000,
    }, () => ({ source: 'duckdb:surge', storage: 'local', dataset: 'stock_surge_events', rows: [], warnings: ['本地个股异动数据源暂不可用'], isEmpty: true })),
  ]);
  const summary = buildCompoundScreeningSummary(concentration90Max, marketCapRange, chipResult, marketCapResult, surgeResult);
  messages.push({
    role: 'user',
    content: `用户问题命中筹码集中度 + 市值区间 + 近期大单买入复合选股场景，已确定性调用本地/真实数据工具完成交集筛选。复合筛选汇总：\n${summarizeToolResult(
      summary,
    )}\n\n后续回答必须只基于该汇总和以上真实工具结果；matchedRows 为空时明确说明暂无同时满足条件的样本或列出数据缺口，不得编造股票、订单、手数或行情。`,
  });
  return true;
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
  emitAgentProgress(ctx, '正在优先查询本地 DuckDB 数据库...', 0);
  const localPrecheck = await runContextTool(ctx, LOCAL_DUCKDB_TOOL_NAME, buildLocalDuckDBInput(ctx, {}), () => ({
    source: 'duckdb:local',
    storage: 'local',
    kline: [],
    marketRows: [],
    warnings: ['本地 DuckDB 预查询失败'],
    isEmpty: true,
  }));
  messages.push({ role: 'user', content: buildLocalPrecheckMessage(localPrecheck) });

  const compoundPrefetched = await prefetchCompoundMarketScreening(ctx, messages);

  if (!compoundPrefetched && !ctx.symbol && shouldQueryMarketWideSurgeOrders(ctx.query)) {
    const side = inferMarketWideOrderSide(ctx.query);
    const tradeDate = resolveMarketWideSurgeTradeDate(ctx.query);
    emitAgentProgress(ctx, '正在查询右侧栏同源全市场大单异动数据...', 1);
    const marketSurgeResult = await runContextTool(
      ctx,
      MARKET_SURGE_TOOL_NAME,
      { date: tradeDate, side, minHands: 10000, limit: 1000 },
      () => ({
        source: 'duckdb:surge',
        storage: 'local',
        dataset: 'stock_surge_events',
        rows: [],
        warnings: ['本地个股异动数据源暂不可用'],
        isEmpty: true,
      }),
    );
    messages.push({
      role: 'user',
      content: `用户问题命中全市场订单/手数/个股异动筛选场景，已强制调用右侧栏同源 ${MARKET_SURGE_TOOL_NAME}，筛选日期：${tradeDate}，筛选方向：${side === 'buy' ? '买入' : '卖出'}，阈值：不低于10000手。工具返回结果：\n${summarizeToolResult(
        marketSurgeResult,
      )}\n\n后续回答必须基于该真实全市场个股异动结果；如果 rows 有多条，必须完整覆盖返回样本中的所有符合条件股票，不得只列部分结果；如果 rows 为空，明确说明暂无符合条件的同源异动样本，不得编造订单和手数。`,
    });
  }

  if (ctx.symbol && shouldQueryStockSurgeEvents(ctx.query)) {
    emitAgentProgress(ctx, '正在查询个股异动和大单订单数据...', 1);
    const surgeResult = await runContextTool(
      ctx,
      STOCK_SURGE_TOOL_NAME,
      { symbol: ctx.symbol, days: 7, limit: 200, minHands: 10000 },
      () => ({
        source: 'a-stock-data',
        storage: 'remote',
        symbol: ctx.symbol,
        rows: [],
        warnings: ['个股异动数据源暂不可用'],
        isEmpty: true,
      }),
    );
    messages.push({
      role: 'user',
      content: `用户问题命中订单/手数/个股异动场景，已强制调用 ${STOCK_SURGE_TOOL_NAME}。工具返回结果：\n${summarizeToolResult(
        surgeResult,
      )}\n\n后续回答必须基于该真实个股异动结果；如果 rows 为空，明确说明暂无个股异动或逐笔大单样本，不得编造订单和手数。`,
    });
  }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    emitAgentProgress(ctx, 'a-stock-data 调用模型分析中...', round + 1);
    const response = await generateReport(messages);
    const call = parseToolCall(response);
    if (!call) return finalizeAgenticAnswer(messages, response);
    if (!allowedTools.has(call.tool)) {
      messages.push({ role: 'assistant', content: response });
      messages.push({
        role: 'user',
        content: `工具 ${call.tool} 不在可用列表。可用工具：${[...allowedTools].join('、')}。请重新选择工具或直接回答。`,
      });
      continue;
    }
    const result = await runContextTool(ctx, call.tool, call.input, () => '该数据源暂不可用');
    emitAgentProgress(ctx, `已获取 ${call.tool} 真实数据，继续分析...`, round + 1);
    messages.push({ role: 'assistant', content: response });
    messages.push({
      role: 'user',
      content: `工具 ${call.tool} 返回结果：\n${summarizeToolResult(result)}`,
    });
  }

  emitAgentProgress(ctx, '正在汇总已获取的真实数据...', MAX_TOOL_ROUNDS);
  messages.push({
    role: 'user',
    content: '已完成本轮可用真实数据查询。请只基于以上真实工具结果给出最终回答；如数据不足，明确说明缺口或暂无数据，不要提及内部执行预算或系统约束。',
  });
  return finalizeAgenticAnswer(messages, await generateReport(messages));
}
