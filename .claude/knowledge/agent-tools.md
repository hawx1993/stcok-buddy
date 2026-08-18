# Agent Tools 知识

适用范围：`electron/services/tools/tool-registry.ts`、`electron/services/tools/types.ts`、`electron/services/agent/tools/**`、`electron/services/agent/agent-tool-runtime.ts`，以及 Agent 调用工具时的职责边界。

## Tool Registry

`electron/services/tools/tool-registry.ts` 定义 `stockToolRegistry`，是 Agent DAG、a-stock-data Agent、超短线选股 Agent 和子 Agent 访问真实数据的统一工具入口。

当前注册的工具类别：

- 股票基础工具：`resolveStockSymbol`、`getStockQuote`、`getStockChipDistribution`、`getStockFundFlowSnapshot`、`getStockKline`、`getHistoricalDailyBars`、`getTechnicalIndicators`。
- 市场与复盘：`getMarketDataStatus`、`getMarketReview`、`getDragonTiger`、`getHotFocus`、`getNorthboundFlow`。
- 全市场筛选：`screenASharesByConditions`、`screenASharesByMarketCap`、`screenLocalAStocks`。
- 新闻公告：`getMarketNews`、`getStockNewsAnnouncements`。
- a-stock-data：`getHolderNumberChange`、`getDividendHistory`、`getIndustryRanking`、`getHotConcepts`。
- 本地优先工具：`getStockQuoteLocalFirst`、`getStockKlineLocalFirst`、`getStockFundFlowLocalFirst`、`getStockSurgeEventsLocalFirst`、`getStockChipDistributionLocalFirst`。
- DuckDB 查询：`queryLocalDuckDBData`、`queryLocalMarketDuckDB`、`queryLocalMonitorDuckDB`、`queryLocalSurgeDuckDB`。
- Web：`readUrl`、`webSearch`。

## Agent 调用工具的两层入口

### `callTool()`

`callTool(name, input)` 位于 `electron/services/tools/tool-registry.ts`，会：

1. 从 `stockToolRegistry` 找工具。
2. 创建 `ToolCallRecord`，记录 id、toolName、input、startedAt、inputSummary。
3. 执行 `tool.run(input)`。
4. 成功时记录 output/outputSummary；失败时把错误消息写入 `record.error`。
5. 通过 PostHog 记录 `tool_called`，包含成功状态、耗时、输入/输出摘要长度和错误摘要。
6. 返回 `ToolCallRecord`。

注意：`callTool()` 捕获错误到 record，不会把工具错误直接抛给 orchestrator。调用方需要检查 `record.error` 或 `record.output`。

### `runContextTool()`

`runContextTool(ctx, name, input, fallback)` 位于 `electron/services/agent/agent-tool-runtime.ts`，是 workflow 节点优先使用的包装层：

1. 发送 `tool_started` runEvent。
2. 调用 `callTool()`。
3. 将 `ToolCallRecord` 追加到 `ctx.toolCalls`。
4. 根据工具输出和错误生成 `ctx.dataStatuses`。
5. 发送 `tool_completed` 或 `tool_failed` runEvent。
6. 当工具成功且没有数据缺口时发送 `evidence_added`。
7. 工具失败时返回调用方提供的 fallback 值。

fallback 值只能让流程继续表达“缺数据/降置信度”，不能伪造成真实行情、新闻、榜单、资金流或 K 线。

## 数据状态推断

`agent-tool-runtime.ts` 通过 `createDataStatuses()` 和 `inferToolDataStatus()` 将工具输出映射到 Agent 计划的数据状态：

| 状态 | 触发条件 | 后续影响 |
| --- | --- | --- |
| `available` | 工具返回非空且没有 stale/partial 标记。 | 可转为证据并支持结论。 |
| `empty` | 输出为空数组、空对象、空 data/rows/list/news/items 等。 | 记录数据缺口。 |
| `failed` | `ToolCallRecord.error` 存在。 | 记录失败缺口，相关结论降级。 |
| `partial` | 输出或 meta 中包含 warnings，或 `isComplete: false`。 | 记录不完整缺口，保留可用部分但降低置信度。 |
| `stale` | 输出或 meta 中 `freshness` 为 `fallback` / `stale`。 | 只能作为过期/本地兜底标记，不能当作实时结论。 |
| `skipped` | 计划或前置数据判断该工具不应执行。 | 后续报告需说明该维度跳过。 |

特殊情况：筛选类工具返回“真实执行完成但 0 命中”时，不应被误判为数据缺口。

- `screenASharesByConditions`：当 `isComplete === true`、`rows` 为空且 `matchedCount === 0` 时，状态改为 `available`，表示真实条件交集为空。
- `screenLocalAStocks`：当 `rows` 为空、`matchedCount === 0`、无 warnings 且无 stale/fallback 标记时，状态改为 `available`。

工具到数据名称的映射在 `dataNamesForTool()` 中维护，例如：

- `getStockQuote*` → 行情
- `getStockKline*` / `getHistoricalDailyBars` → K线
- `getTechnicalIndicators` → 技术指标
- `getStockNewsAnnouncements` → 新闻、公告
- `getStockFundFlow*` → 资金流
- `getStockSurgeEventsLocalFirst` / `queryLocalSurgeDuckDB` → 个股异动历史
- `getStockChipDistribution*` → 筹码集中度
- `screenLocalAStocks` → 本地选股/筹码筛选
- `screenASharesByConditions` → 条件选股
- `screenASharesByMarketCap` → A股市值筛选
- `getHotConcepts` → 热门股/概念
- `getIndustryRanking` → 行业涨幅/资金流
- `readUrl` → 链接正文
- `webSearch` → 联网搜索

新增工具后如果会影响计划或报告，应同步维护该映射。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `electron/services/tools/types.ts` | `AgentTool`、工具输入输出基础类型。 |
| `electron/services/tools/tool-registry.ts` | 统一注册和调用工具。 |
| `electron/services/agent/tools/index.ts` | Agent 工具聚合导出，供 registry 引入。 |
| `electron/services/agent/tools/get-stock-*.ts` | 个股行情、K 线、资金流、筹码、新闻公告、技术指标等工具封装。 |
| `electron/services/agent/tools/get-market-*.ts` / `get-hot-*.ts` / `get-industry-ranking.ts` | 市场复盘、市场数据状态、热点、行业排行等工具封装。 |
| `electron/services/agent/tools/get-dragon-tiger.ts` / `get-northbound-flow.ts` | 龙虎榜和北向资金工具封装。 |
| `electron/services/agent/tools/get-holder-number-change.ts` / `get-dividend-history.ts` | a-stock-data 相关基本面补充工具。 |
| `electron/services/agent/tools/query-local-*.ts` | DuckDB 本地 market / monitor / surge / 通用查询工具，必须走白名单参数。 |
| `electron/services/agent/tools/screen-a-shares-by-conditions.ts` | 确定性条件选股工具，输入来自已校验 slash 参数。 |
| `electron/services/agent/tools/screen-a-shares-by-market-cap.ts` | A 股市值筛选工具。 |
| `electron/services/agent/tools/screen-local-a-stocks.ts` | 基于本地 DuckDB 行情快照和筹码缓存的全市场宽筛工具。 |
| `electron/services/agent/tools/read-url.ts` / `web-search.ts` | URL 读取和联网搜索工具。 |
| `electron/services/agent/tools/input.ts` | 工具输入解析和限幅 helper。 |
| `electron/services/agent/agent-tool-runtime.ts` | workflow 工具调用包装、数据状态推断、证据事件、fallback 返回。 |
| `electron/services/agent/agent-data-tools.ts` | Agent 本地优先行情、K 线、资金流、筹码、异动工具。 |
| `electron/services/agent/agent-local-duckdb-tools.ts` | DuckDB 本地查询、监控/异动库查询、本地 A 股筛选。 |
| `electron/services/agent/a-stock-data-agent-tools.ts` | a-stock-data Agent 的工具说明、白名单和 LLM tool-call 解析。 |
| `electron/services/agent/stock-picker-agent-tools.ts` | 超短线选股工具白名单和意图模板。 |

## 筛选类工具边界

| 工具 | 用途 | 数据来源与约束 |
| --- | --- | --- |
| `screenASharesByConditions` | `/condition-screener` 的确定性筛选工具。 | 服务层为 `market-data/condition-screener-service.ts`；按市值、换手率、成交额、涨幅、筹码、领涨板块等条件筛选。输入应来自解析器，不交给模型自由猜测。 |
| `screenLocalAStocks` | 超短线选股和 a-stock-data Agent 的本地宽筛。 | 只读本地 `listLatestMarketRows()`、`listStockChips()`、`getMarketDataStats()`；可筛涨跌幅、换手、筹码 90/70 集中度、获利比例，支持 `chipLookbackDays` 与 `chipMatchMode`。本地缺数据只能返回 warnings。 |
| `screenASharesByMarketCap` | 市值区间和换手率组合筛选。 | 走 market-data 市值筛选服务，遵循 DuckDB → stock-sdk → a-stock-data 的真实数据顺序。 |

筛选工具输出应尽量包含：`source`、`storage`、`freshness`、`isComplete`、`latestTradeDate`、`rows`、`matchedCount`、`returnedCount`、`warnings`、`isEmpty`。缺字段会影响 `dataStatuses`、证据和最终报告可信度。

## DuckDB 查询工具边界

`queryLocalMarketDuckDB` 只能查询白名单数据集，不能把模型输入直接拼 SQL：

- `securities`：证券列表。
- `daily_bars`：日 K 线，必须传 `symbol`。
- `trade_calendar`：交易日历。
- `market_rows`：最新市场快照。
- `market_boards`：板块列表。
- `board_constituents`：板块成分股，必须传 `boardCode`。
- `board_snapshot`、`board_detail`、`discovery_snapshot`。
- `stock_chip`：筹码，可传 `symbol` 或查询列表。
- `stock_snapshot`：股票快照。

查个股日 K 务必使用 `dataset: "daily_bars"`；本地缺表、空表、过期数据不能被解释成“市场没有发生”。

## 新增工具流程

1. 优先在 `electron/services/stock/**`、`electron/services/market-data/**` 或现有 provider 中实现真实数据逻辑。
2. 在 `electron/services/agent/tools/*` 或 Agent 数据工具文件中封装为 `AgentTool`。
3. 在 `stockToolRegistry` 注册，并从 `electron/services/agent/tools/index.ts` 导出。
4. 在 `agent-workflows.ts` 中通过 `runContextTool()` 使用；只有非常底层或不需要上下文事件时才直接用 `callTool()`。
5. 输出应包含 source、warnings、freshness、isComplete、evidence 所需字段。
6. 如果工具返回本地缓存或过期数据，必须清楚标记 `storage` / `freshness` / warnings。
7. 如果工具能返回“真实执行但空结果”，在 `agent-tool-runtime.ts` 明确区分空交集和数据缺口。
8. 补充相关测试：工具映射、Agent workflow、tool runtime 或 selfcheck。

## 数据和合规约束

- 工具不能生成伪造行情、新闻、榜单、K 线或资金流。
- 远程或本地数据不可用时，返回明确空/错状态或 warnings，由 Agent 报告数据缺口。
- 投研工具输出要便于 `evidence.ts` 转换为证据项。
- 新增网页读取或外部请求时注意超时、错误暴露和来源标注。
- 本地 DuckDB 查询结果只能表达真实落库数据；缺表、空表、过期数据不能被解释成“市场没有发生”。
- 联网搜索不可用时只能标注数据缺口，不能让模型补写“搜索结果”。
