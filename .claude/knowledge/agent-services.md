# Agent Services 知识

适用范围：`electron/services/agents/**`。当前目录的源码与相邻 `__tests__/` 是实现事实来源；`electron/services/agents/README.md` 是本目录的导航说明。

## 总体链路

```text
chat:send IPC
  ↓
electron/services/agents/orchestrator.ts
  ↓
runStoreCommand / intent-routing / slash command / symbol resolving
  ↓
agent-planning.ts 创建计划并绑定 DAG 节点
  ↓
agent-workflows.ts 构建 DAG（全市场任务先执行 DataCoverage）
  ↓
dag-executor.ts 执行节点（orchestrator 当前 concurrency = 5）
  ↓
runContextTool() → tool-registry.ts → tools/*.ts → service / provider / DuckDB / stock-sdk
  ↓
dataStatuses → data gap → reflection → plan update
  ↓
evidence + compliance critic + final reflection
  ↓
ChatResponse + runEvents 通过 chat:token 推送给 renderer
```

生产数据链路必须保持：本地 DuckDB 或真实缓存 → `stock-sdk` → `a-stock-data` → 明确 `empty` / `failed` / `partial` / `stale` 状态。Agent、renderer 和 fallback 文案均不得生成行情、K 线、新闻、榜单、板块或筛选样本。

## 关键入口

| 文件 | 职责 |
| --- | --- |
| `orchestrator.ts` | 聊天编排入口 `runOrchestrator()`；处理本地命令、路由、标的解析、计划、DAG、合规、最终反思和响应事件。 |
| `orchestrator-types.ts` | `IAgentContext`、意图、token 和 run-event 回调等编排共享类型。 |
| `intent-routing.ts` | slash command 解析、意图分类、股票/板块/普通聊天路由和单 Agent 判断。 |
| `agent-planning.ts` | 创建 `IAgentPlan`、计划项、数据依赖、假设和 fallback 策略；把计划项关联到 DAG 并根据缺口更新状态。 |
| `agent-workflows.ts` | 按 `IAgentContext.intent` 构造数据、分析、报告节点及依赖；为全市场相关任务复用数据覆盖节点。 |
| `dag-executor.ts` | `executeDag()` 按依赖和并发限制执行节点，将错误转换为 error step，避免整条 DAG 卡死。 |
| `data-coverage-agent.ts` | 检查并补齐全市场证券、快照、日 K 以及按需筹码覆盖度；只能同步真实数据或返回 warnings。 |
| `agent-tool-runtime.ts` | `runContextTool()`、数据状态推断、数据缺口、技术卡片补齐和结构化分析输入。 |
| `tool-registry.ts` / `tools/*.ts` | 统一注册、调用和封装真实数据工具；模型白名单另由对应 Agent 文件控制。 |
| `agent-reflection.ts` | 由 data status、fallback evidence 和计划执行状态生成数据缺口、计划修订及最终报告前复核。 |
| `evidence.ts` | 将行情、K 线、新闻、资金流、筹码、筛选等真实工具输出转换为可追溯证据。 |
| `agent-result-cards.ts` | 将工具和分析结果转成 renderer 可展示的 `AgentResultCard`。 |
| `stock-analysis-agents.ts` | 技术、基本面、资金、消息、筹码专项子 Agent 的输入、调用及结构化 findings。 |
| `stock-analysis-overview-agent.ts` | 聚合专项 findings 和 evidence，形成结构化个股综合投研报告。 |
| `a-stock-data-agent.ts` / `a-stock-data-agent-tools.ts` | a-stock-data 风格的文本 JSON 多轮工具调用、21 项白名单及调用解析。 |
| `stock-picker-agent.ts` / `stock-picker-agent-tools.ts` | 自然语言超短线选股：先宽筛再精筛、压缩候选上下文、11 项专用白名单和意图模板。 |
| `condition-screener-agent.ts` / `condition-screener-compiler.ts` / `condition-screener-session.ts` | `/condition-screener` 的受限条件编译、确定性执行和会话延续；不能交给模型自由猜测参数。 |
| `compliance-critic.ts` | 最终文本级合规修订：禁用 emoji、直接投资指令、部分证据来源缺口、风险提示和“不构成投资建议”声明。 |

## `runOrchestrator()` 顺序

`electron/services/agents/orchestrator.ts` 当前按以下顺序工作：

1. 调用 `runStoreCommand(request.message)`；命中本地商店命令时直接返回，跳过后续 Agent DAG。
2. 解析 slash command、分类意图，并执行 `applyStockAgentRouting()`。
3. 对需要标的的意图通过 `callTool('resolveStockSymbol', ...)` 解析股票；纯代码问题会尝试转为 analysis。
4. 构造 `IAgentContext`，其中包含 query、intent、symbol、urls、evidence、toolCalls、findings 和 `emitEvent`。
5. 通过 `createInitialAgentPlan()` 创建计划，默认 fallback 只记录缺口和降低置信度，绝不生成替代市场事实。
6. 通过 `buildAgentWorkflow()` 构建 DAG，并以 `attachPlanNodeCoverage()` 关联计划项和实际节点。
7. 调用 `executeDag(nodes, context, ..., { concurrency: 5 })`，持续输出子 Agent、工具、数据覆盖和计划更新事件。
8. 对 draft 调用 `reviewComplianceStructured()`，再调用 `reflectBeforeFinalReport()` 记录最终数据缺口和计划修订。
9. 输出 `summary_completed`、`final_answer`，把 runEvents、证据、findings、toolCalls 和合规结果写入 `ChatResponse`。

`callTool()` 会把工具异常写入 `ToolCallRecord.error` 而非直接抛出。工作流节点默认必须经 `runContextTool()` 调用工具，以保留 `toolCalls`、`dataStatuses`、run events、evidence 和 data-gap 链路；不要以直接 `callTool()` 代替有上下文的工作流调用。

## DataCoverage 与全市场任务

`agent-workflows.ts` 的 `buildDataCoverageNode()` 是全市场数据的单一前置入口：

- 用于 `condition-screener`、`a-stock-data-agent`、`stock-picker`，以及无明确 symbol 的股票相关问答。
- 默认目标为 5,000 只 A 股；查询包含筹码/集中度/获利比例/控盘等条件时，条件选股以外的任务会要求筹码覆盖。
- 条件选股不把本地日 K 覆盖作为前置，以避免每次执行都触发全市场 K 线同步；其他全市场任务默认要求日 K 覆盖。
- `data-coverage-agent.ts` 会按证券列表、行情快照、日 K、按需筹码的顺序补齐。日 K 使用 `runImmediateMarketDataSync()`，可绕过手动同步冷却但仍复用/等待当前同步，避免并发写库。
- 覆盖不足只能产生 warning 和数据缺口；后续 Agent 必须降低相关结论强度，不能补模拟股票、假筹码或合成 K 线。

不要在每个 Agent 节点内各自触发全量同步。新增需要全市场真实数据的意图时，先复用此节点，并明确是否需要日 K 或筹码覆盖。

## 数据状态、反思与事件

`agent-tool-runtime.ts` 根据工具输出产生 `IAgentDataStatus`：

| 状态 | 含义 |
| --- | --- |
| `available` | 返回可用数据，可转为 evidence 并支撑对应结论。 |
| `empty` | 没有可用样本；通常会形成数据缺口。 |
| `failed` | `ToolCallRecord.error` 存在；必须向计划和报告暴露失败。 |
| `partial` | 有 warnings 或 `isComplete: false`；可使用已返回部分，但需降低置信度。 |
| `stale` | `freshness` 为 `fallback` 或 `stale`；不能表述为已验证的实时结论。 |
| `skipped` | 计划不需要、或前置数据缺失而跳过；报告需要说明被跳过的维度。 |

以下是真实完成的有效空交集，不应误报成数据源故障：

- `screenASharesByConditions`：`isComplete === true`、`rows` 为空且 `matchedCount === 0`。
- `screenLocalAStocks`：`rows` 为空、`matchedCount === 0`、无 warnings 且没有 stale/fallback 标记。

常见 `AgentRunEvent.type` 包括 `command_detected`、`intent_detected`、`plan_created`、`plan_updated`、`data_gap_detected`、`reflection_completed`、`tool_started`、`tool_completed`、`tool_failed`、`progress_updated`、`evidence_added`、`subagent_started`、`subagent_completed`、`intermediate_result`、`summary_completed` 和 `final_answer`。renderer 只负责呈现这些真实运行状态，不能把进度文案或缺口补成结果。

## 个股综合报告与合规

`stock-analysis-overview-agent.ts` 的当前评分维度和权重是：技术面 25%、基本面 10%、资金面 25%、筹码分析 25%、消息面 15%。报告使用综合结论、技术面、基本面、资金面、筹码、按真实消息证据决定是否展示的消息面、证据摘要和风险提示等结构，并以 `🟢 偏利好`、`🟡 中性` 或 `🔴 偏利空` 给出最终评级。

- 资金流字段不存在或不可用时必须明确为“暂无真实资金流数据”；不能显示为 `0`、`+0.00` 或由其他字段推断。
- data gap 应在受影响维度内说明数据状态和置信度，不以独立“过程回顾”章节替代分析。
- `compliance-critic.ts` 会替换禁用 emoji 和直接投资指令，基于关键字检查对应 evidence 来源，并补充风险提示和免责声明。它是文本保护层，不会证明数值或结论真实；数据和 evidence 必须在此前由真实工具取得。
- 投研输出不得使用 `🚀🔥💎🌙🤑🎉`，不得出现确定性的买卖、仓位或收益承诺，并必须保留“仅供研究参考，不构成投资建议”。

## 修改路径

- **新增意图**：`intent-routing.ts` → `agent-planning.ts` → `agent-workflows.ts` → 结果卡片/提示词/测试；新增全市场意图优先复用 `buildDataCoverageNode()`。
- **新增真实工具**：先复用 `stock/stock-detail/**`、`stock/quotes/**`、`stock/anomaly/**`、`stock/chip-distribution/**`、`market-data/**` 或 `stock-db/**` 的 service/provider，再接入 `tools/<kebab-case>.ts`、`tools/index.ts`、`tool-registry.ts` 和按需模型白名单；详见 `agent-tools.md`。
- **新增分析维度**：同步检查 `stock-analysis-agents.ts`、`StructuredAgentFinding`、`evidence.ts`、`stock-analysis-overview-agent.ts`、结果卡片、合规与测试。
- **排查 Agent 问题**：沿 `orchestrator → intent-routing → planning → workflow/DAG → DataCoverage → tool runtime/tool/service → data status/reflection → evidence/compliance → renderer runEvents` 定位根因；不要用假数据、吞错或删除逻辑绕过问题。
