# Agent Services 知识

适用范围：`electron/services/agent/**`。

## 总体链路

```text
chat:send IPC
  ↓
electron/services/agent/orchestrator.ts
  ↓
runStoreCommand / intent-routing / slash command / symbol resolving
  ↓
agent-planning.ts 创建初始计划并绑定 DAG 节点
  ↓
agent-workflows.ts 构建 DAG（必要时先执行 DataCoverage）
  ↓
dag-executor.ts 并发执行节点（orchestrator 当前 concurrency = 5）
  ↓
runContextTool / tool-registry / stock services / market-data / LLM agents
  ↓
dataStatuses → data gap → reflection → plan update
  ↓
evidence + compliance critic + final reflection
  ↓
ChatResponse + runEvents 通过 chat:token 推送给 renderer
```

## 关键入口

| 文件 | 职责 |
| --- | --- |
| `orchestrator.ts` | 聊天编排入口 `runOrchestrator()`；先执行 `runStoreCommand()`，再意图识别、股票解析、计划创建、DAG 执行、合规审查、最终反思、事件汇总。 |
| `intent-routing.ts` | slash command 解析、意图分类、股票/板块/普通聊天路由、单 Agent 命令判断。 |
| `agent-planning.ts` | 创建 `IAgentPlan`、计划项、假设、fallback 策略；把计划项绑定到 DAG 节点；按数据缺口调整计划状态。 |
| `agent-workflows.ts` | 根据 `IAgentContext.intent` 构造 DAG 节点；负责数据节点、分析节点、报告节点依赖；关键数据节点后触发反思事件。 |
| `data-coverage-agent.ts` | 面向全市场问答/选股的本地数据覆盖检查与自动补齐；补证券列表、行情快照、日 K，必要时补筹码缓存。 |
| `condition-screener-agent.ts` | 解析 `/condition-screener` 参数并调用确定性条件选股工具，生成结果卡片、Markdown 和证据。 |
| `stock-picker-agent.ts` / `stock-picker-agent-tools.ts` | 超短线技术选股智能体；先宽筛后精筛，在白名单真实工具内多轮取数并输出候选清单。 |
| `agent-reflection.ts` | 根据 `dataStatuses` 和 fallback evidence 生成数据缺口、计划修订和最终报告前复核。 |
| `dag-executor.ts` | `executeDag()` 按依赖和并发限制执行节点，向 UI 输出 `AgentStep`。默认错误会转为 error step 并继续推进。 |
| `orchestrator-types.ts` | Agent 上下文、token 回调、意图等共享类型；`IAgentContext.dataCoverage` 保存覆盖度检查结果。 |
| `agent-tool-runtime.ts` | workflow 工具调用包装、工具事件、数据状态推断、数据缺口辅助、技术卡片补齐、结构化输入构建。 |
| `evidence.ts` | 将行情、K 线、新闻、龙虎榜、资金流、筹码、筛选结果等转换成证据链。 |
| `compliance-critic.ts` | 投研输出合规检查；检查投资建议、伪造数据、缺少风险、禁用 emoji 等。 |
| `stock-analysis-agents.ts` | 技术面、基本面、资金面、消息面、筹码等子 Agent 输入和运行逻辑。 |
| `stock-analysis-overview-agent.ts` | 聚合结构化子 Agent 发现，生成总览分析。 |
| `analysis-agent.ts`、`data-agent.ts`、`report-agent.ts`、`risk-agent.ts`、`news-analysis-agent.ts` | 专项 Agent 或报告生成逻辑。 |
| `a-stock-data-agent.ts`、`a-stock-data-agent-tools.ts` | a-stock-data 相关 Agent 与工具封装；本地 DuckDB 查询说明也在这里注入给模型。 |
| `agent-data-tools.ts`、`agent-local-duckdb-tools.ts` | Agent 本地优先行情、K 线、资金流和 DuckDB 查询能力。 |
| `agent-result-cards.ts` | 把工具/分析结果转为前端展示卡片。 |

## `runOrchestrator()` 要点

`electron/services/agent/orchestrator.ts` 的核心顺序：

1. `runStoreCommand(request.message)`：本地商店命令命中时直接返回。
2. `parseSlashCommand()` / `classifyIntent()` / `applyStockAgentRouting()`：识别意图。
3. `resolveStockSymbol` 工具：需要股票标的时解析代码和名称。
4. 构造 `IAgentContext`：包含 query、intent、symbol、boardKeyword、evidence、toolCalls、findings、emitEvent。
5. `createInitialAgentPlan(context)` 创建计划，默认 fallback 策略是记录数据缺口并降低置信度，不用替代数据伪造结论。
6. `buildAgentWorkflow()` 生成 DAG，`attachPlanNodeCoverage()` 将计划项关联到实际节点。
7. `emitPlanEvent()` 输出 `plan_created`。
8. `executeDag(nodes, context, ..., { concurrency: 5 })` 并发执行，持续输出子 Agent、工具、数据覆盖和计划更新事件。
9. `reviewComplianceStructured()` 对 draft 做合规修订。
10. `reflectBeforeFinalReport()` 做最终报告前数据缺口和证据支持复核。
11. 输出 `summary_completed` 和 `final_answer`，并返回 `ChatResponse`。

## 数据覆盖预检查

`agent-workflows.ts` 的 `buildDataCoverageNode()` 会在需要全市场数据的链路前插入 `data-coverage` 节点：

- 触发范围：`condition-screener`、`a-stock-data-agent`、`stock-picker`，以及无明确股票代码但被识别为股票相关的问题。
- 默认目标覆盖度：`minCoverage = 5000` 只 A 股。
- 查询含「筹码 / 集中度 / 获利比例 / 控盘 / 单峰」时，`needsChips = true`，会把筹码缓存也纳入达标条件。
- 节点结果写入 `ctx.dataCoverage`，供后续 Agent 判断覆盖度和数据缺口。
- 进度通过 `progress_updated` runEvent 输出，UI 不能把进度文案当成最终数据证据。

`data-coverage-agent.ts` 的补齐顺序：

1. 证券列表：`listRemoteSecurities()` → `upsertSecurities()`。
2. 行情快照：`fetchStockSdkAllMarketSnapshotQuotes()` → `upsertStockSnapshots()`，并补写 `securities`。
3. 日 K：`runImmediateMarketDataSync()`，绕过 12 小时手动强制同步冷却，但仍串行等待当前同步，避免并发写库。
4. 筹码：仅 `needsChips` 时调用 `getChipDistribution(symbol)` 并发补缺失缓存，默认超时 120 秒。

注意：DataCoverage 只能补真实数据或返回 warnings。覆盖度不达标时，后续报告必须标注缺口，不能用模拟股票、合成 K 线或假筹码补齐。

## 计划、数据缺口与反思

核心类型定义在 `src/shared/types.ts`：

- `IAgentPlan`：意图、目标、计划项、假设、数据缺口、计划修订。
- `IAgentPlanItem`：计划项、依赖数据、关联节点、fallback 策略、状态。
- `IAgentDataStatus`：工具返回的数据状态。
- `IAgentDataGap`：面向计划和用户的缺口描述。
- `IAgentReflectionResult`：反思结果、问题、数据缺口、计划修订。

`agent-tool-runtime.ts` 会将工具输出转为 `IAgentDataStatus`：

- `available`：工具返回可用数据。
- `empty`：返回空数据。
- `failed`：工具调用失败。
- `partial`：存在 warnings 或 `isComplete: false`。
- `stale`：`freshness` 为 `fallback` 或 `stale`。
- `skipped`：计划判断不需要或前置数据缺失而跳过。

`agent-reflection.ts` 会把非 available 状态转为数据缺口，并通过 `markPlanItemsByDataGap()` 将相关计划项标记为 `skipped`、`blocked` 或保持降级执行。

## runEvents 输出约定

常见 `AgentRunEvent.type`：

| 类型 | 说明 |
| --- | --- |
| `command_detected` / `intent_detected` | 命令或意图识别结果。 |
| `plan_created` | 初始分析计划。 |
| `plan_updated` | 数据缺口导致计划调整。 |
| `data_gap_detected` | 明确数据缺口，需在报告中降低相关结论强度。 |
| `reflection_completed` | 数据节点后或最终报告前反思完成。 |
| `tool_started` / `tool_completed` / `tool_failed` | 工具运行状态。 |
| `progress_updated` | DataCoverage、条件选股、超短线选股等长任务进度。 |
| `evidence_added` | 可用数据已转为证据。 |
| `subagent_started` / `subagent_completed` | DAG 节点开始/完成。 |
| `intermediate_result` | 子 Agent 中间发现。 |
| `summary_completed` | 汇总工具调用数、子 Agent 数、有效证据和数据缺口。 |
| `final_answer` | 最终内容、结果卡片、证据和 findings。 |

这些事件通过 `chat:token` 推送，renderer 将 token 与 runEvent 合并到最后一条 assistant 消息。

## DAG 约定

- `DagNode<TContext>` 包含 `id`、`agent`、`description`、可选 `dependsOn`、`run(context)`。
- `executeDag()` 默认并发为 3；`orchestrator.ts` 当前传入 `{ concurrency: 5 }`。
- 如果某个节点抛错，executor 会发出 error step 并把该节点视为完成，避免整个 DAG 卡死。
- 新增节点时必须设置清晰 `dependsOn`，避免循环依赖或缺失节点。
- 新增数据节点后，如果数据会影响后续分析，应调用现有反思链路记录数据缺口和计划更新。
- 需要全市场覆盖的 Agent 节点应依赖 `data-coverage`；不要在每个 Agent 内重复触发全量同步。

当前全市场相关 DAG：

| intent | 关键节点 |
| --- | --- |
| `condition-screener` | `data-coverage` → `condition-screener`。 |
| `a-stock-data-agent` | `data-coverage` → `a-stock-data-agent`；进入前会尝试 `resolveStockSymbol` 预解析个股代码。 |
| `stock-picker` | `data-coverage` → `stock-picker-agent`。 |
| 无 symbol 但股票相关 | `data-coverage` → `chat`（用 a-stock-data 真实数据回答）。 |

## 条件选股与超短线选股

- `/condition-screener` 走 `condition-screener-agent.ts`：参数解析是确定性的，支持市值、换手率、成交额、涨幅、筹码 90% 集中度、获利比例、排除 ST、今日领涨板块和换手率排序。
- `condition-screener-agent.ts` 调用 `screenASharesByConditions`，结果会转成 `AgentResultCard`、Markdown 表格和 `EvidenceItem`。
- 自然语言超短线选股走 `stock-picker-agent.ts`：先通过 `stock-picker-agent-tools.ts` 映射意图，再用 `screenLocalAStocks` 或 `getMarketReview` 宽筛，后续只允许调用白名单真实工具精筛。
- `stock-picker-agent.ts` 会压缩筛选结果，避免大 JSON 截断导致模型只看到部分股票；如果模型暴露内部工具预算，会二次重写。

## 证据与合规

- 投研结论必须能追溯到 `EvidenceItem` 或明确的数据缺口。
- 证据来源包括 quote、kline、technical、news、announcement、dragon-tiger、hot-focus、chip、fund-flow、local-market-data、condition-screener 等。
- `compliance-critic.ts` 会处理伪造数据、缺风险提示、过度确定性投资建议、禁用 emoji。
- Agent fallback 文案只能说明数据不可用；不能编造价格、涨跌幅、榜单、资金流或 K 线。
- 数据缺口不是“可替代数据”，只能用于降低置信度、跳过维度或提示数据源暂不可用。

## 修改建议

- 新增意图：先改 `intent-routing.ts`，再在 `agent-planning.ts` 增加计划项，在 `agent-workflows.ts` 增加 DAG，最后补 UI slash command（如需要）。
- 新增全市场 Agent 意图：优先复用 `buildDataCoverageNode()`，明确是否需要筹码覆盖，不要绕过 market-data 同步和 provider。
- 新增工具调用：优先在 `electron/services/agent/tools/*` 和 `tool-registry.ts` 接入真实 service，再用 `runContextTool()` 接入 workflow。
- 新增分析维度：检查 `stock-analysis-agents.ts`、`StructuredAgentFinding.dimension`、结果卡片和合规输出。
- 修 Agent bug 时沿 `orchestrator → intent-routing → planning → workflow/DAG → data-coverage → tool/runtime/service → data gap/reflection → evidence/compliance → renderer runEvents` 排查。
