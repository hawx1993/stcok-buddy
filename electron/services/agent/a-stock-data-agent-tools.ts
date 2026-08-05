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
const STOCK_SURGE_QUERY_PATTERN = /订单|手数|大笔买入|大笔卖出|超大笔买入|超大笔卖出|特大单|个股异动|盘口异动|快速拉盘|快速拉升|急拉|跳水|涨幅|跌幅|涨速|快速上涨|快速下跌/;
const MARKET_WIDE_SURGE_ORDER_PATTERN = /手数|大于\s*\d+(?:\.\d+)?\s*万?手|[一1]万手|大笔买入|大笔卖出|超大笔买入|超大笔卖出|特大单|个股异动|盘口异动|订单/;
const MARKET_WIDE_SCOPE_PATTERN = /选出|筛选|哪些|个股|股票|今天|今日|近期|最近|全市场|A股|沪深|找出/;
const COMPOUND_CHIP_90_PATTERN = /90\s*%?\s*筹码|筹码[^，。；;]*90\s*%?/;
const COMPOUND_MARKET_CAP_PATTERN = /市值/;
const COMPOUND_BUY_SURGE_PATTERN = /买入|大笔买入|超大笔买入|特大单买入/;

export const A_STOCK_DATA_TOOLBOX: IToolSpec[] = [
  { name: 'resolveStockSymbol', description: '把股票名称或代码解析为 6 位代码，输入 {query}。股票相关问题通常第一步调用。' },
  {
    name: 'getStockQuoteLocalFirst',
    description: '获取个股行情，优先本地 DuckDB；本地缺失或实时性不足时走 stock-sdk；stock-sdk 不可用时再用 a-stock-data(腾讯)，输入 {symbol}。',
  },
  {
    name: 'getStockKlineLocalFirst',
    description: '获取个股日K线，优先本地 DuckDB；本地不完整时走 stock-sdk 补齐；stock-sdk 不可用时再用 a-stock-data(百度)，输入 {symbol, limit?}。',
  },
  {
    name: 'screenLocalAStocks',
    description: '全市场本地筛选 A 股，优先用于选股/条件筛选/筹码+涨幅组合筛选，输入 {changePercentMin?, concentration90Max?, concentration70Max?, chipLookbackDays?, chipMatchMode?, limit?, sortBy?, sortOrder?}。例如最近5天90%筹码集中度均<20%：{chipLookbackDays:5, chipMatchMode:"all", concentration90Max:20}。',
  },
  {
    name: 'screenASharesByMarketCap',
    description: '按市值区间全市场筛选 5000+ A 股，使用 DuckDB → stock-sdk → a-stock-data 获取真实总市值/流通市值，输入 {minMarketCap?, maxMarketCap?, unit?, marketCapField?, limit?, includeST?, sortOrder?}。例如市值在30亿到100亿：{minMarketCap:30,maxMarketCap:100,unit:"yi",marketCapField:"total"}；流通市值50亿以下：{maxMarketCap:50,unit:"yi",marketCapField:"circulating"}。',
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
    description: '查询本地 stocksense-surge DuckDB 的异动历史 stock_surge_events，输入 {date?, code?, tradeDates?, keepDays?, offset?, limit?, side?, minHands?}；全市场按买入/卖出手数筛选时传 side 和 minHands。',
  },
  { name: 'getStockChipDistributionLocalFirst', description: '获取单股筹码分布，按 DuckDB → stock-sdk → a-stock-data 获取真实数据，返回90%/70%筹码集中度，输入 {symbol, days?}。' },
  { name: 'getStockChipDistribution', description: '获取个股筹码分布（获利比例、成本集中度，本地 DuckDB 优先），输入 {symbol}。' },
  {
    name: 'getStockSurgeEventsLocalFirst',
    description: '获取右侧栏同源的个股异动/盘口异动/大单订单数据，优先本地 DuckDB，空则 stock-sdk，仍空则 a-stock-data 逐笔成交，适合订单、手数、大笔买入/卖出、快速拉盘、涨幅跌幅问题，输入 {symbol, days?, limit?, minHands?}。',
  },
  {
    name: 'getStockFundFlowLocalFirst',
    description: '获取个股资金流；本地无完整快照时优先 stock-sdk，stock-sdk 不可用时再用 a-stock-data(东财)，输入 {symbol}。',
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

export function shouldQueryStockSurgeEvents(query: string): boolean {
  return STOCK_SURGE_QUERY_PATTERN.test(query);
}

export function shouldQueryMarketWideSurgeOrders(query: string): boolean {
  return MARKET_WIDE_SURGE_ORDER_PATTERN.test(query) && MARKET_WIDE_SCOPE_PATTERN.test(query);
}

export function parseConcentration90Max(query: string): number | undefined {
  const patterns = [
    /90\s*%?\s*筹码(?:集中度|成本区间|区间)?\s*(?:小于|低于|少于|不高于|不超过|<=|≤|<)\s*(\d+(?:\.\d+)?)\s*%?/,
    /筹码(?:集中度|成本区间|区间)?[^，。；;]*90\s*%?[^，。；;]*(?:小于|低于|少于|不高于|不超过|<=|≤|<)\s*(\d+(?:\.\d+)?)\s*%?/,
  ];
  for (const pattern of patterns) {
    const matched = query.match(pattern);
    if (!matched) continue;
    const value = Number(matched[1]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

export function parseMarketCapRangeYi(query: string): { min?: number; max?: number } | undefined {
  const matched = query.match(/市值[^，。；;]*?(\d+(?:\.\d+)?)\s*亿\s*(?:到|至|~|-|—|–)\s*(\d+(?:\.\d+)?)\s*亿/);
  if (!matched) return undefined;
  const left = Number(matched[1]);
  const right = Number(matched[2]);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return undefined;
  return { min: Math.min(left, right), max: Math.max(left, right) };
}

export function shouldPrefetchCompoundMarketScreening(query: string): boolean {
  return (
    MARKET_WIDE_SCOPE_PATTERN.test(query) &&
    COMPOUND_CHIP_90_PATTERN.test(query) &&
    COMPOUND_MARKET_CAP_PATTERN.test(query) &&
    COMPOUND_BUY_SURGE_PATTERN.test(query) &&
    parseConcentration90Max(query) !== undefined &&
    parseMarketCapRangeYi(query) !== undefined
  );
}
