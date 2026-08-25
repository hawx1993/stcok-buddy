---
name: electron-ai-tools
description: 在 StockBuddy 中盘点、新增、修改、暴露或验证 Electron Agent 的文本 JSON 工具调用、Tool Registry、runContextTool 或真实行情数据链路时使用。
argument-hint: '[工具接入或修改任务]'
---

# Electron Agent 工具调用

> 本 Skill 适用于 `electron/services/agents/tools/` 下的工具。每个注册的 Function Call 工具必须独立维护在一个 kebab-case 文件中，并在导出前添加说明其用途、数据路径与调用面的 JSDoc。

## 1. 按需资料与权威入口

开始修改前先判断任务类型，并只读取命中的资料；不要为了工具任务一次性加载全部 Knowledge。

- **始终读取**：[Agent 工具、数据状态与接入流程](../../knowledge/agent-tools.md)。
- **修改 orchestrator、DAG、`runContextTool()`、evidence、data gap、结果卡片或工具调用循环时**，再读取 [Agent 服务与 DAG](../../knowledge/agent-services.md)。
- **工具依赖 `electron/services/stock/**` 或涉及真实行情 / 板块 / 新闻 / 资金数据时**，再读取 [Stock Services 知识](../../knowledge/stock-services.md) 与 [数据访问规则](../../rules/data.md)。
- **触碰 TypeScript public API、shared type、React / renderer 或 IPC 暴露类型时**，再读取 [TypeScript / React 规则](../../rules/typescript-react.md)。

以下为运行时的唯一事实来源：

- `../../../electron/services/agents/tools/`：32 个独立 `AgentTool` 实现。
- `../../../electron/services/agents/tools/index.ts`：全部可执行工具的聚合导出。
- `../../../electron/services/agents/a-stock-data-agent-tools.ts`：a-stock-data 模型 Agent 的 21 项白名单和输入描述。
- `../../../electron/services/agents/stock-picker-agent-tools.ts`：stock-picker 模型 Agent 的 11 项白名单和意图模板。
- `../../../electron/services/agents/a-stock-data-agent.ts` / `../../../electron/services/agents/stock-picker-agent.ts`：JSON 工具调用循环与轮数限制。
- `../../../electron/services/agents/tool-registry.ts`：完整执行注册表与 `callTool()`。
- `../../../electron/services/agents/agent-tool-runtime.ts`：`runContextTool()`、数据状态、证据与运行事件。

Stock service 已按子域拆分；工具接入真实数据时优先复用这些入口：

- `../../../electron/services/stock/stock-detail/**`：个股解析、行情、K 线、分时、指标、新闻、资金流、交易建议。
- `../../../electron/services/stock/quotes/**`：共享 stock-sdk、行情页、指数、板块缓存、北向资金、a-stock-data runner。
- `../../../electron/services/stock/anomaly/**`：热点、龙虎榜、复盘、异动、同花顺板块热度和异动历史。
- `../../../electron/services/stock/chip-distribution/**`：筹码分布 provider、计算和 worker。
- `../../../electron/services/stock/discovery/**`、`../../../electron/services/stock/monitor/**`：探索页和 AI 监控能力。

## 2. 当前是文本 JSON 协议，不是 Provider 原生 Tool Call

当前没有通过 OpenAI / Anthropic SDK 的 `tools` 参数执行结构化工具调用。模型输出 JSON 文本，Electron 主进程自行解析、校验并分发：

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
{ "tool": "getStockQuoteLocalFirst", "input": { "symbol": "600519" } }
```

关键约束：

- 每轮最多请求一个工具；具体轮数限制以对应 Agent 源码为准。
- `parseToolCall()` 支持完整回复、代码块及独立 JSON 行。
- 非白名单工具名不得执行；应要求模型重新选择有效工具或直接回答。
- `screenASharesByConditions` 是 `/condition-screener` 的确定性工具，参数来自受限编译器，不允许模型自由猜测复杂筛选参数。
- `callTool()` 将异常写入 `ToolCallRecord.error`，调用方必须检查它，不能把“未抛异常”视为成功。
- workflow/DAG 默认使用 `runContextTool()`，以保留 `toolCalls`、`dataStatuses`、`runEvents`、evidence 与 data-gap 链路。

## 3. 工具集合不可混用

数字是当前源码快照；每次工具增删改名后必须重新核对。

| 集合 | 权威来源 | 当前数量 | 含义 |
| --- | --- | ---: | --- |
| 已注册可执行工具 | `stockToolRegistry` / `agents/tools/index.ts` | 32 | 由 `callTool()` 执行的全部工具，包含 workflow、预查询和确定性工具。 |
| a-stock-data 模型可选工具 | `A_STOCK_DATA_TOOLBOX` | 21 | a-stock-data Agent 能以 JSON 文本自主请求的唯一白名单。 |
| stock-picker 模型可选工具 | `STOCK_PICKER_TOOLBOX` | 11 | 超短线选股 Agent 在先宽筛后精筛流程中可自主请求的唯一白名单。 |

**Registry 中存在不等于模型可调用。** 当前 8 个 registry-only 工具不在任一模型自由调用白名单中：`getStockQuote`、`getStockFundFlowSnapshot`、`getStockKline`、`getHistoricalDailyBars`、`getMarketDataStatus`、`getMarketNews`、`screenASharesByConditions`、`queryLocalDuckDBData`。

## 4. a-stock-data 模型可调用工具（21 个）

每项工具均独立在 `electron/services/agents/tools/`，输入字段仍以 `A_STOCK_DATA_TOOLBOX` 为准。

| 工具 | 文件 | 备注 / 适用场景 |
| --- | --- | --- |
| `resolveStockSymbol` | `resolve-stock-symbol.ts` | 将名称、简称或模糊代码解析为标准 A 股代码。 |
| `getStockQuoteLocalFirst` | `get-stock-quote-local-first.ts` | 个股行情；DuckDB → stock-sdk → a-stock-data。 |
| `getStockKlineLocalFirst` | `get-stock-kline-local-first.ts` | 个股日 K 线；本地优先并回退真实远程数据。 |
| `screenLocalAStocks` | `screen-local-a-stocks.ts` | 用本地市场快照与筹码缓存进行全市场条件选股。 |
| `screenASharesByMarketCap` | `screen-a-shares-by-market-cap.ts` | 按总市值或流通市值筛选；DuckDB → stock-sdk → a-stock-data。 |
| `queryLocalMarketDuckDB` | `query-local-market-duckdb.ts` | 查询本地证券、日线、交易日、板块与筹码数据集。 |
| `queryLocalMonitorDuckDB` | `query-local-monitor-duckdb.ts` | 查询 AI 监控历史与分类统计。 |
| `queryLocalSurgeDuckDB` | `query-local-surge-duckdb.ts` | 查询异动、大单、买卖方向与手数历史。 |
| `getStockChipDistributionLocalFirst` | `get-stock-chip-distribution-local-first.ts` | 筹码、成本区间和 70%/90% 集中度；缓存过期会刷新。 |
| `getStockChipDistribution` | `get-stock-chip-distribution.ts` | 通用个股筹码路径；需既有输出契约时使用。 |
| `getStockSurgeEventsLocalFirst` | `get-stock-surge-events-local-first.ts` | 个股异动、盘口和大单；优先右侧栏同源数据。 |
| `getStockFundFlowLocalFirst` | `get-stock-fund-flow-local-first.ts` | 个股资金流，复用真实数据降级链路。 |
| `getHolderNumberChange` | `get-holder-number-change.ts` | 股东户数变化与筹码集中信号。 |
| `getDividendHistory` | `get-dividend-history.ts` | 分红与送转历史。 |
| `getStockNewsAnnouncements` | `get-stock-news-announcements.ts` | 个股新闻与公告。 |
| `getTechnicalIndicators` | `get-technical-indicators.ts` | MACD、KDJ、均线等技术指标摘要。 |
| `getIndustryRanking` | `get-industry-ranking.ts` | 行业涨幅排名与行业资金流。 |
| `getHotConcepts` | `get-hot-concepts.ts` | 热门股票和概念；同花顺热榜优先、东财人气榜降级。 |
| `getHotFocus` | `get-hot-focus.ts` | 热点、异动、板块资金流；使用 `tab` 区分维度。 |
| `getNorthboundFlow` | `get-northbound-flow.ts` | 北向、南向与沪深港通资金汇总。 |
| `getMarketReview` | `get-market-review.ts` | 指数、涨停、情绪和热点的市场复盘原始数据。 |

## 5. stock-picker 模型可调用工具（11 个）

以 `STOCK_PICKER_TOOLBOX` 为准，面向超短线选股的“先宽筛、后精筛”流程：

- 宽筛：`screenLocalAStocks`、`screenASharesByMarketCap`。
- 精筛：`getTechnicalIndicators`、`getStockChipDistributionLocalFirst`、`getStockFundFlowLocalFirst`、`getStockSurgeEventsLocalFirst`、`getDragonTiger`。
- 市场/题材：`getHotConcepts`、`getMarketReview`。
- 催化核查：`webSearch`、`readUrl`；未配置搜索或读取失败时只能返回数据缺口，不得编造新闻。

## 6. Registry / workflow-only 工具（8 个）

这些工具能被确定性工作流或预查询使用，但不得加入模型自由调用白名单，也不能由模型自由选择。

| 工具 | 文件 | 备注 / 使用边界 |
| --- | --- | --- |
| `queryLocalDuckDBData` | `query-local-duckdb-data.ts` | 模型循环前或本地上下文预取，仅读取 DuckDB。 |
| `getStockQuote` | `get-stock-quote.ts` | workflow 的既有基础行情输出契约。 |
| `getStockFundFlowSnapshot` | `get-stock-fund-flow-snapshot.ts` | workflow 的个股资金流快照。 |
| `getHistoricalDailyBars` | `get-historical-daily-bars.ts` | 本地日线及远程回补，供确定性分析使用。 |
| `getStockKline` | `get-stock-kline.ts` | 既有基础 K 线输出路径。 |
| `getMarketDataStatus` | `get-market-data-status.ts` | 本地市场数据同步状态。 |
| `getMarketNews` | `get-market-news.ts` | 既有市场新闻列表路径。 |
| `screenASharesByConditions` | `screen-a-shares-by-conditions.ts` | `/condition-screener` 受限编译器产物，不由模型自由构造参数。 |

## 7. 真实数据与结果状态红线

适用于本地优先工具时，必须遵循：

```text
本地 DuckDB / 真实缓存
  → stock-sdk
  → a-stock-data
  → 明确 empty / failed / partial / stale 状态
```

- 先复用既有 DuckDB、service、provider 与 `stock-sdk`；只有 stock-sdk 不支持、不适配或不可用时才使用 a-stock-data。
- DuckDB 仅代表真实落库数据；空表、缺表或过期数据不得被表述为“市场没有发生”。
- 所有真实源不可用时，只能返回明确空状态、错误、`warnings` 或 data gap。
- 禁止构造行情、K 线、新闻、资金流、板块、概念、股票或数值。
- 输出应保留适用的 `source`、`storage`、`freshness`、`warnings`、`isComplete` 和 evidence 字段。
- `runContextTool()` fallback 只能表达数据缺口或降低置信度，不能成为面向用户的替代行情。

## 8. 新增或修改工具 Checklist

1. **确定调用面**：先判断是否属于 a-stock-data 模型可选、stock-picker 模型可选、workflow 专用或 Registry 内部能力；注册成功不代表可暴露给模型。
2. **一工具一文件**：在 `electron/services/agents/tools/<tool-name>.ts` 实现一个 `AgentTool`；在导出前添加用途、真实数据路径和调用面 JSDoc。
3. **复用真实数据层**：先检查 `stock/stock-detail/**`、`stock/quotes/**`、`stock/anomaly/**`、`stock/chip-distribution/**`、market-data provider、DuckDB 与 `stock-sdk`；必要时才接入 a-stock-data，UI 不得直连第三方行情接口。
4. **维护聚合与执行面**：向 `agents/tools/index.ts` 聚合导出，再向 `stockToolRegistry` 注册唯一名称；保持 `ToolCallRecord` 行为。
5. **按需维护模型面**：只有模型应自由选择时，才为对应 toolbox 添加同名条目及准确的触发条件、输入与数据优先级。
6. **接入上下文运行时**：workflow/DAG 通过 `runContextTool()` 调用；检查计划、data status、evidence、data gap、reflection 与 `tool_started` / `tool_completed` / `tool_failed` 事件。
7. **复核与测试**：每个白名单工具必须已注册；每个注册工具必须有一个独立工具文件；确认 registry-only 工具未意外暴露给模型。

## 9. 验证

工具代码变动至少执行：

```bash
pnpm test -- electron/services/agents/__tests__/a-stock-data-agent.test.ts
pnpm test -- electron/services/agents/__tests__/agent-tool-runtime.test.ts
pnpm typecheck
git diff --check
```

并确认：白名单名称无重复且均在 Registry 中；成功、empty、failed、partial、stale 结果产生正确 data status、run event、evidence 或 data gap；所有本地/远端降级链路仍只返回真实数据或明确失败状态。
