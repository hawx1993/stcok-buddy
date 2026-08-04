# Agent Tools 知识

适用范围：`electron/services/tools/**`，以及 Agent 调用工具时的职责边界。

## Tool Registry

`electron/services/tools/tool-registry.ts` 定义 `stockToolRegistry`，是 Agent DAG 和子 Agent 访问真实数据的统一工具入口。

当前注册的工具类别：

- 股票工具：`resolveStockSymbol`、`getStockQuote`、`getStockChipDistribution`、`getStockFundFlowSnapshot`、`getStockKline`、`getHistoricalDailyBars`、`getTechnicalIndicators`。
- 市场与复盘：`getMarketDataStatus`、`getMarketReview`、`getDragonTiger`、`getHotFocus`、`getNorthboundFlow`。
- 新闻公告：`getMarketNews`、`getStockNewsAnnouncements`。
- a-stock-data：`getHolderNumberChange`、`getDividendHistory`、`getIndustryRanking`、`getHotConcepts`。
- 本地优先/本地库：`getStockQuoteLocalFirst`、`getStockKlineLocalFirst`、`getStockFundFlowLocalFirst`、`queryLocalDuckDBData`、`screenLocalAStocks`、`queryLocalMarketDuckDB`、`queryLocalMonitorDuckDB`、`queryLocalSurgeDuckDB`。
- Web：`readUrl`。

## `callTool()` 行为

`callTool(name, input)` 会：

1. 从 `stockToolRegistry` 找工具。
2. 创建 `ToolCallRecord`，记录 id、toolName、input、startedAt、inputSummary。
3. 执行 `tool.run(input)`。
4. 成功时记录 output/outputSummary；失败时把错误消息写入 `record.error`。
5. 通过 PostHog 记录工具调用事件。
6. 返回 `ToolCallRecord`。

注意：`callTool()` 捕获错误到 record，不会把工具错误直接抛给 orchestrator。调用方需要检查 `record.error` 或 `record.output`。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `types.ts` | `AgentTool`、工具输入输出基础类型。 |
| `tool-registry.ts` | 统一注册和调用工具。 |
| `stock-tools.ts` | 封装 stock service / market-data service 供 Agent 使用。 |
| `a-stock-data-tools.ts` | a-stock-data 相关真实数据能力。 |
| `web-tools.ts` | URL 读取工具。 |

## 新增工具流程

1. 优先在 `electron/services/stock/**`、`electron/services/market-data/**` 或现有 provider 中实现真实数据逻辑。
2. 在 `electron/services/tools/*` 封装为 `AgentTool`。
3. 在 `stockToolRegistry` 注册。
4. 在 `agent-workflows.ts` 或 `agent-tool-runtime.ts` 中通过 `runContextTool()` / `callTool()` 使用。
5. 输出应包含 source、warnings、freshness、evidence 所需字段。
6. 补充相关测试：工具映射、Agent workflow 或 selfcheck。

## 数据和合规约束

- 工具不能生成伪造行情、新闻、榜单、K 线或资金流。
- 远程或本地数据不可用时，返回明确空/错状态或 warnings，由 Agent 报告数据缺口。
- 投研工具输出要便于 `evidence.ts` 转换为证据项。
- 新增网页读取或外部请求时注意超时、错误暴露和来源标注。