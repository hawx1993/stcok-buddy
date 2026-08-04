/**
 * a-stock-data 智能体回答的纯工具逻辑（无运行时依赖，可单测）。
 * 工具箱列表 + LLM 工具调用解析。
 */

export interface IToolSpec {
  name: string;
  description: string;
}

const LOCAL_DUCKDB_TOOL_NAME = 'queryLocalDuckDBData';
const NO_DATA_TEXT_MARKERS = ['暂无数据', '暂不可用', '无可用数据', '空结果', 'not available'];

export const A_STOCK_DATA_TOOLBOX: IToolSpec[] = [
  { name: 'resolveStockSymbol', description: '把股票名称或代码解析为 6 位代码，输入 {query}。股票相关问题通常第一步调用。' },
  {
    name: 'getStockQuoteLocalFirst',
    description: '获取个股行情，优先本地 DuckDB，其次 a-stock-data(腾讯)，stock-sdk 兜底，输入 {symbol}。',
  },
  {
    name: 'getStockKlineLocalFirst',
    description: '获取个股日K线，优先本地 DuckDB，其次 a-stock-data(百度)，stock-sdk 兜底，输入 {symbol, limit?}。',
  },
  {
    name: 'screenLocalAStocks',
    description: '全市场本地筛选 A 股，优先用于选股/条件筛选/筹码+涨幅组合筛选，输入 {changePercentMin?, concentration90Max?, limit?, sortBy?, sortOrder?}。例如 90%筹码集中度<15% 且涨幅>5%。',
  },
  {
    name: 'queryLocalMarketDuckDB',
    description: '查询本地 stocksense-market DuckDB 的基础信息/K线/交易日历/板块缓存/发现页快照/筹码/股票快照，输入 {dataset, symbol?, boardCode?, snapshotKey?, startDate?, endDate?, limit?}。',
  },
  {
    name: 'queryLocalMonitorDuckDB',
    description: '查询本地 stocksense-monitor DuckDB 的 AI 监控历史，输入 {date?, categories?, offset?, limit?, includeCounts?}。未传 date 时返回最近可用日期。',
  },
  {
    name: 'queryLocalSurgeDuckDB',
    description: '查询本地 stocksense-surge DuckDB 的异动历史 stock_surge_events，输入 {date?, code?, tradeDates?, keepDays?, offset?, limit?}。',
  },
  { name: 'getStockChipDistribution', description: '获取个股筹码分布（获利比例、成本集中度，本地 DuckDB 优先），输入 {symbol}。' },
  {
    name: 'getStockFundFlowLocalFirst',
    description: '获取个股资金流，优先 a-stock-data(东财)，stock-sdk 兜底，输入 {symbol}。',
  },
  { name: 'getHolderNumberChange', description: '获取股东户数变化（季度环比，筹码集中信号），输入 {symbol}。' },
  { name: 'getDividendHistory', description: '获取分红送转历史（每股派息、转增/送股比例），输入 {symbol}。' },
  { name: 'getStockNewsAnnouncements', description: '获取个股新闻与公告，输入 {symbol, limit?}。' },
  { name: 'getTechnicalIndicators', description: '获取技术指标摘要（MACD/KDJ/均线等），输入 {symbol}。' },
  { name: 'getIndustryRanking', description: '获取行业涨幅与行业资金流排名，无需输入。' },
  { name: 'getHotConcepts', description: '获取今日热门股与概念归属，无需输入。' },
  { name: 'getHotFocus', description: '获取热点/异动/板块资金流，输入 {tab}，tab 可选 surge/sector/flow/market。北向/沪深港通资金请改用 getNorthboundFlow。' },
  { name: 'getNorthboundFlow', description: '获取沪深港通北向/南向资金流向汇总（沪股通、深股通、港股通），无需输入。北向资金流入流出问题请用本工具。' },
  { name: 'getMarketReview', description: '获取全市场行情复盘（指数、涨停、情绪、热点），无需输入。' },
];

/** 从 LLM 回复中解析工具调用；返回 undefined 表示这是最终回答而非工具调用。 */
export function parseToolCall(response: string): { tool: string; input: unknown } | undefined {
  const lines = response
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates = [response.trim(), ...lines];
  for (const candidate of candidates) {
    const json = candidate.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try {
      const parsed = JSON.parse(json) as { tool?: unknown; input?: unknown };
      if (parsed && typeof parsed.tool === 'string') {
        return { tool: parsed.tool, input: parsed.input ?? {} };
      }
    } catch {
      // 该行不是 JSON 工具调用，继续尝试下一候选
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

export function isNoDataToolResult(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') {
    const text = value.trim();
    return !text || NO_DATA_TEXT_MARKERS.some((marker) => text.toLowerCase().includes(marker.toLowerCase()));
  }
  if (Array.isArray(value)) return value.length === 0;
  const record = asRecord(value);
  if (!record) return false;
  if (record.isEmpty === true) return true;
  const arrayKeys = ['rows', 'list', 'items', 'data', 'news', 'announcements'];
  const arrays = arrayKeys
    .map((key) => record[key])
    .filter((item): item is unknown[] => Array.isArray(item));
  if (arrays.length > 0 && arrays.every((items) => items.length === 0)) return true;
  if ('ranking' in record && 'flow' in record && !record.ranking && !record.flow) return true;
  return false;
}

export function shouldQueryLocalDuckDB(toolName: string, result: unknown): boolean {
  return toolName !== LOCAL_DUCKDB_TOOL_NAME && isNoDataToolResult(result);
}
