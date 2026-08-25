# Agent Tools 知识

适用范围：`electron/services/agents/tool-registry.ts`、`electron/services/agents/types.ts`、`electron/services/agents/tools/**`、`electron/services/agents/agent-tool-runtime.ts`，以及两个模型 Agent 的工具白名单。

工具不是 renderer API。所有股票数据必须先经 `stock/**`、`market-data/**`、`stock-db/**` 的 service/provider，再由 Agent 工具封装；UI 不得直连第三方行情接口。当前 stock service 已按 `stock-detail/`、`quotes/`、`anomaly/`、`discovery/`、`monitor/`、`chip-distribution/` 子域拆分，新增工具应复用对应子域入口而不是恢复旧扁平路径。

## 工具集合与调用授权

`stockToolRegistry` 是可执行注册表，不是模型授权列表。当前集合以源码为准：

| 集合 | 权威文件 | 当前数量 | 边界 |
| --- | --- | ---: | --- |
| 可执行注册表 | `tool-registry.ts` | 32 | `callTool()` 可执行的全部工具，供确定性工作流、预查询和受控 Agent 使用。 |
| a-stock-data 白名单 | `a-stock-data-agent-tools.ts` 的 `A_STOCK_DATA_TOOLBOX` | 21 | a-stock-data Agent 能以文本 JSON 自主选择的工具。 |
| 超短线选股白名单 | `stock-picker-agent-tools.ts` 的 `STOCK_PICKER_TOOLBOX` | 11 | 仅供 stock-picker Agent 在先宽筛后精筛流程中自主选择。 |

两个模型白名单共享 8 项：`screenLocalAStocks`、`screenASharesByMarketCap`、`getTechnicalIndicators`、`getStockChipDistributionLocalFirst`、`getStockFundFlowLocalFirst`、`getStockSurgeEventsLocalFirst`、`getHotConcepts`、`getMarketReview`。

以下 8 个已注册工具不在任一模型自由调用白名单中：`getStockQuote`、`getStockFundFlowSnapshot`、`getStockKline`、`getHistoricalDailyBars`、`getMarketDataStatus`、`getMarketNews`、`screenASharesByConditions`、`queryLocalDuckDBData`。它们可被受控 workflow 或确定性预查询使用，但不能因“已注册”而开放给模型。

a-stock-data 白名单的其余工具包括标的解析、本地优先行情/K 线/筹码、受限 DuckDB 查询、股东户数、分红、新闻公告、行业与热点、北向资金等。stock-picker 额外可调用 `getDragonTiger`、`readUrl`、`webSearch`；这些能力只应在其专用意图和约束内使用。

## 文本 JSON 工具协议

当前不是 OpenAI/Anthropic SDK 的原生 `tools` 参数调用。模型输出文本，主进程解析、校验并分发：

```text
LLM 文本响应
  → parseToolCall()
  → 对应 Agent 白名单校验
  → runContextTool()
  → callTool()
  → stockToolRegistry
  → AgentTool.run()
```

标准请求：

```json
{"tool":"getStockQuoteLocalFirst","input":{"symbol":"600519"}}
```

`parseToolCall()` 可识别完整 JSON、JSON 代码块和独立 JSON 行。每个 Agent 必须校验工具名是否在自己的白名单内；未知或未授权的工具不能执行，应要求模型选择有效工具或直接生成最终答复。`screenASharesByConditions` 的参数来自受限条件编译器，是 `/condition-screener` 的确定性工具，不应作为模型随意猜测条件的入口。

## 两层执行入口

### `callTool()`

`callTool(name, input)` 位于 `electron/services/agents/tool-registry.ts`：

1. 从 `stockToolRegistry` 查找工具。
2. 创建 `ToolCallRecord`，记录 id、工具名、输入、开始时间和摘要。
3. 执行 `tool.run(input)`。
4. 成功时写入 output/output summary；失败时把异常写入 `record.error`。
5. 写入 `tool_called` 埋点并返回记录。

异常被记录而非继续抛给 orchestrator，因此调用方必须检查 `record.error`，不能将“函数已返回”误判为工具成功。

### `runContextTool()`

`runContextTool(ctx, name, input, fallback)` 位于 `electron/services/agents/agent-tool-runtime.ts`，是 DAG/workflow 默认入口：

1. 发送 `tool_started`。
2. 调用 `callTool()`，并将展示层调用记录加入 `ctx.toolCalls`。
3. 生成 `ctx.dataStatuses`。
4. 发送 `tool_completed` 或 `tool_failed`。
5. 没有数据缺口时发送 `evidence_added`。
6. 仅在工具失败时返回调用方提供的 fallback。

fallback 只能使流程继续表达“数据缺口/置信度下降”，不能伪造价格、K 线、新闻、榜单、资金流或分析 evidence。需要 run events、计划、evidence 或 data-gap 行为时不得绕过此包装层直接调用 `callTool()`。

## 数据状态约定

`inferToolDataStatus()` 的优先级是：错误为 `failed`；`freshness: fallback/stale` 为 `stale`；warnings 或 `isComplete: false` 为 `partial`；空输出为 `empty`；其余为 `available`。`skipped` 由计划或前置条件显式记录。

- `available` 才能作为完整可用数据支撑相应证据和结论。
- `partial`、`stale`、`empty`、`failed`、`skipped` 必须经 reflection 进入数据缺口或降级说明。
- `screenASharesByConditions` 在 `isComplete === true`、`rows` 为空、`matchedCount === 0` 时，及无 warning/stale 的 `screenLocalAStocks` 同等空交集时，应保留为 `available`：这表示真实筛选完成且条件交集为空，不是数据源失败。

工具输出尽量提供 `source`、`storage`、`freshness`、`isComplete`、`warnings`、可追溯 rows/数据时间和 evidence 所需字段。本地空表、缺表或过期缓存不等于“市场没有发生”。

## 当前工具注册表

`stockToolRegistry` 当前的 32 项工具按职责分组如下：

| 类别 | 工具 |
| --- | --- |
| 标的与个股基础 | `resolveStockSymbol`、`getStockQuote`、`getStockQuoteLocalFirst`、`getStockKline`、`getStockKlineLocalFirst`、`getHistoricalDailyBars`、`getTechnicalIndicators`。 |
| 资金、筹码与异动 | `getStockFundFlowSnapshot`、`getStockFundFlowLocalFirst`、`getStockChipDistribution`、`getStockChipDistributionLocalFirst`、`getStockSurgeEventsLocalFirst`、`getHolderNumberChange`、`getDividendHistory`、`getDragonTiger`。 |
| 市场、行业与消息 | `getMarketDataStatus`、`getMarketReview`、`getMarketNews`、`getStockNewsAnnouncements`、`getHotFocus`、`getHotConcepts`、`getNorthboundFlow`、`getIndustryRanking`。 |
| 筛选与本地数据集 | `screenASharesByConditions`、`screenASharesByMarketCap`、`screenLocalAStocks`、`queryLocalDuckDBData`、`queryLocalMarketDuckDB`、`queryLocalMonitorDuckDB`、`queryLocalSurgeDuckDB`。 |
| 外部公开内容 | `readUrl`、`webSearch`。 |

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `electron/services/agents/types.ts` | `AgentTool`、`ToolCallRecord` 等 Agent 工具基础类型。 |
| `electron/services/agents/tool-registry.ts` | 32 项工具的唯一注册表和 `callTool()` 执行入口。 |
| `electron/services/agents/tools/index.ts` | 汇总导出工具实现，供 registry 引入。 |
| `electron/services/agents/tools/input.ts` | 输入记录读取、数值/枚举/数组限幅和错误格式化 helper。 |
| `electron/services/agents/tools/get-stock-*.ts` | 个股行情、K 线、资金流、筹码、异动、新闻公告和技术指标等工具封装。 |
| `electron/services/agents/tools/get-market-*.ts`、`get-hot-*.ts`、`get-industry-ranking.ts` | 市场复盘、同步状态、热点、行业排行和资金流等市场级工具。 |
| `electron/services/agents/tools/query-local-*.ts` | 受白名单数据集保护的 market / monitor / surge / 通用 DuckDB 查询；绝不拼接模型提供的任意 SQL。 |
| `electron/services/agents/tools/screen-*.ts` | 条件选股、市值筛选和本地全市场宽筛；真实 0 命中与数据缺口必须区分。 |
| `electron/services/agents/tools/read-url.ts` / `web-search.ts` | 用户 URL 正文读取和受控联网搜索；失败时只能返回错误或数据缺口。 |
| `electron/services/agents/agent-tool-runtime.ts` | 上下文调用、状态推断、evidence event 和 fallback 处理。 |
| `electron/services/agents/a-stock-data-agent-tools.ts` | a-stock-data Agent 的 21 项工具说明、白名单和 `parseToolCall()`。 |
| `electron/services/agents/stock-picker-agent-tools.ts` | stock-picker 的 11 项白名单、自然语言意图模板和首轮筛选参数。 |

## 筛选与 DuckDB 边界

| 工具 | 边界 |
| --- | --- |
| `screenASharesByConditions` | `/condition-screener` 的确定性筛选。参数由 `condition-screener-compiler.ts` 受限编译，服务在 `market-data/condition-screener-service.ts`。 |
| `screenLocalAStocks` | 超短线和 a-stock-data 的本地宽筛。读取真实的 `listLatestMarketRows()`、`listStockChips()` 和 `getMarketDataStats()`；覆盖不足只返回 warnings。 |
| `screenASharesByMarketCap` | 总/流通市值与换手率区间筛选，遵循本地 DuckDB → `stock-sdk` → `a-stock-data` 的真实数据顺序。 |
| `queryLocalMarketDuckDB` | 仅可查询 securities、daily bars、交易日、市场快照、板块、成分股、筹码及已定义快照等白名单数据集。 |
| `queryLocalMonitorDuckDB` / `queryLocalSurgeDuckDB` | 仅表达真实落库的 AI 监控或个股异动历史；本地缺失不能转述为未发生。 |

## 新增或修改工具

1. 先在 `electron/services/stock/stock-detail/**`、`electron/services/stock/quotes/**`、`electron/services/stock/anomaly/**`、`electron/services/stock/chip-distribution/**`、`electron/services/market-data/**`、`electron/services/stock-db/**` 或现有 provider 中寻找真实实现；`stock-sdk` 优先，只有不支持或不可用时才使用 `a-stock-data`。
2. 在 `electron/services/agents/tools/<kebab-case>.ts` 实现职责单一的 `AgentTool`，保持来源、存储、新鲜度、完整性、warning 和 evidence 所需字段。
3. 从 `tools/index.ts` 导出，并在 `tool-registry.ts` 注册唯一名称。
4. 只有模型确实需要自主选择时，才把它加入相应 Agent 的白名单和提示说明；registry 注册本身不授予授权。
5. 通过 `runContextTool()` 接入 workflow，维护 data-name 映射、data status、证据、数据缺口及相邻测试。
6. 工具变更后同步复核 registry 数量、两份白名单及它们的交集；避免文档和执行面再次漂移。

## 约束与验证

- 工具只能返回真实数据或明确 unavailable/empty/error/partial/stale 状态，不能生成 fake/mock/preview/demo/sample 市场内容。
- 网页读取和搜索要保留来源、超时/失败状态；模型不能在工具失败后补写“搜索结果”。
- 变更工具代码时，按影响范围运行 `pnpm test -- electron/services/agents/__tests__/<相关测试>` 和 `pnpm typecheck`；至少验证白名单名均已注册、注册工具没有重复，以及 success/empty/failed/partial/stale 的事件、evidence 或 data gap 行为正确。
