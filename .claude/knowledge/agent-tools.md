# Agent Tools 知识

适用范围：`electron/services/tools/**`，以及 Agent 调用工具时的职责边界。

## Tool Registry

`electron/services/tools/tool-registry.ts` 定义 `stockToolRegistry`，是 Agent DAG 和子 Agent 访问真实数据的统一工具入口。

当前注册的工具类别：

- 股票基础工具：`resolveStockSymbol`、`getStockQuote`、`getStockChipDistribution`、`getStockFundFlowSnapshot`、`getStockKline`、`getHistoricalDailyBars`、`getTechnicalIndicators`。
- 市场与复盘：`getMarketDataStatus`、`getMarketReview`、`getDragonTiger`、`getHotFocus`、`getNorthboundFlow`、`screenASharesByMarketCap`。
- 新闻公告：`getMarketNews`、`getStockNewsAnnouncements`。
- a-stock-data：`getHolderNumberChange`、`getDividendHistory`、`getIndustryRanking`、`getHotConcepts`。
- 本地优先工具：`getStockQuoteLocalFirst`、`getStockKlineLocalFirst`、`getStockFundFlowLocalFirst`、`getStockSurgeEventsLocalFirst`、`getStockChipDistributionLocalFirst`。
- DuckDB 查询/筛选：`queryLocalDuckDBData`、`screenLocalAStocks`、`queryLocalMarketDuckDB`、`queryLocalMonitorDuckDB`、`queryLocalSurgeDuckDB`。
- Web：`readUrl`。

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

工具到数据名称的映射在 `dataNamesForTool()` 中维护，例如：

- `getStockQuote*` → 行情
- `getStockKline*` / `getHistoricalDailyBars` → K线
- `getTechnicalIndicators` → 技术指标
- `getStockNewsAnnouncements` → 新闻、公告
- `getStockFundFlow*` → 资金流
- `getStockSurgeEventsLocalFirst` / `queryLocalSurgeDuckDB` → 个股异动历史
- `screenASharesByMarketCap` → A股市值筛选

新增工具后如果会影响计划或报告，应同步维护该映射。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `types.ts` | `AgentTool`、工具输入输出基础类型。 |
| `tool-registry.ts` | 统一注册和调用工具。 |
| `stock-tools.ts` | 封装 stock service / market-data service 供 Agent 使用。 |
| `a-stock-data-tools.ts` | a-stock-data 相关真实数据能力。 |
| `web-tools.ts` | URL 读取工具。 |
| `agent-tool-runtime.ts` | workflow 工具调用包装、数据状态推断、证据事件、fallback 返回。 |
| `agent-data-tools.ts` | Agent 本地优先行情、K 线、资金流、筹码、异动工具。 |
| `agent-local-duckdb-tools.ts` | DuckDB 本地查询、监控/异动库查询、本地 A 股筛选。 |

## 新增工具流程

1. 优先在 `electron/services/stock/**`、`electron/services/market-data/**` 或现有 provider 中实现真实数据逻辑。
2. 在 `electron/services/tools/*` 或 Agent 数据工具文件中封装为 `AgentTool`。
3. 在 `stockToolRegistry` 注册。
4. 在 `agent-workflows.ts` 中通过 `runContextTool()` 使用；只有非常底层或不需要上下文事件时才直接用 `callTool()`。
5. 输出应包含 source、warnings、freshness、isComplete、evidence 所需字段。
6. 如果工具返回本地缓存或过期数据，必须清楚标记 `storage` / `freshness` / warnings。
7. 补充相关测试：工具映射、Agent workflow、tool runtime 或 selfcheck。

## 数据和合规约束

- 工具不能生成伪造行情、新闻、榜单、K 线或资金流。
- 远程或本地数据不可用时，返回明确空/错状态或 warnings，由 Agent 报告数据缺口。
- 投研工具输出要便于 `evidence.ts` 转换为证据项。
- 新增网页读取或外部请求时注意超时、错误暴露和来源标注。
- 本地 DuckDB 查询结果只能表达真实落库数据；缺表、空表、过期数据不能被解释成“市场没有发生”。
