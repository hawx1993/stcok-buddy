# Agent Services 知识

适用范围：`electron/services/agent/**`。

## 总体链路

```text
chat:send IPC
  ↓
electron/services/agent/orchestrator.ts
  ↓
intent-routing / slash command / symbol resolving
  ↓
agent-workflows.ts 构建 DAG
  ↓
dag-executor.ts 并发执行节点
  ↓
tool-registry / stock services / LLM agents
  ↓
evidence + compliance critic
  ↓
ChatResponse + runEvents 推送给 renderer
```

## 关键入口

| 文件 | 职责 |
| --- | --- |
| `orchestrator.ts` | 聊天编排入口 `runOrchestrator()`；先执行 `runStoreCommand()`，再意图识别、股票解析、DAG 执行、合规审查、事件汇总。 |
| `intent-routing.ts` | slash command 解析、意图分类、股票/板块/普通聊天路由、单 Agent 命令判断。 |
| `agent-workflows.ts` | 根据 `IAgentContext.intent` 构造 DAG 节点；负责数据节点、分析节点、报告节点的依赖关系。 |
| `dag-executor.ts` | `executeDag()` 按依赖和并发限制执行节点，向 UI 输出 `AgentStep`。默认错误会转为 error step 并继续推进。 |
| `orchestrator-types.ts` | Agent 上下文、token 回调等共享类型。 |
| `agent-tool-runtime.ts` | Agent 工具调用辅助、数据缺口识别、技术卡片补齐、结构化输入构建。 |
| `evidence.ts` | 将行情、K 线、新闻、龙虎榜、资金流、筹码等转换成证据链。 |
| `compliance-critic.ts` | 投研输出合规检查；检查投资建议、伪造数据、缺少风险、禁用 emoji 等。 |
| `stock-analysis-agents.ts` | 技术面、基本面、资金面、消息面、筹码等子 Agent 输入和运行逻辑。 |
| `analysis-agent.ts`、`data-agent.ts`、`report-agent.ts`、`risk-agent.ts`、`news-analysis-agent.ts` | 专项 Agent 或报告生成逻辑。 |
| `a-stock-data-agent.ts`、`a-stock-data-agent-tools.ts` | a-stock-data 相关 Agent 与工具封装。 |
| `agent-data-tools.ts`、`agent-local-duckdb-tools.ts` | Agent 本地优先行情、K 线、资金流和 DuckDB 查询能力。 |
| `agent-result-cards.ts` | 把工具/分析结果转为前端展示卡片。 |

## `runOrchestrator()` 要点

`electron/services/agent/orchestrator.ts` 的核心顺序：

1. `runStoreCommand(request.message)`：本地商店命令命中时直接返回。
2. `parseSlashCommand()` / `classifyIntent()` / `applyStockAgentRouting()`：识别意图。
3. `resolveStockSymbol` 工具：需要股票标的时解析代码和名称。
4. 构造 `IAgentContext`：包含 query、intent、symbol、boardKeyword、evidence、toolCalls、findings、emitEvent。
5. `buildAgentWorkflow()` 生成 DAG。
6. `executeDag()` 并发执行，持续输出 `subagent_started` / `subagent_completed` 等事件。
7. `reviewComplianceStructured()` 对 draft 做合规修订。
8. 输出 `summary_completed` 和 `final_answer`，并返回 `ChatResponse`。

## DAG 约定

- `DagNode<TContext>` 包含 `id`、`agent`、`description`、可选 `dependsOn`、`run(context)`。
- `executeDag()` 默认并发为 3；`orchestrator.ts` 当前传入 `{ concurrency: 5 }`。
- 如果某个节点抛错，executor 会发出 error step 并把该节点视为完成，避免整个 DAG 卡死。
- 新增节点时必须设置清晰 `dependsOn`，避免循环依赖或缺失节点。

## 证据与合规

- 投研结论必须能追溯到 `EvidenceItem` 或明确的数据缺口。
- 证据来源包括 quote、kline、technical、news、announcement、dragon-tiger、hot-focus、chip、fund-flow、local-market-data 等。
- `compliance-critic.ts` 会处理伪造数据、缺风险提示、过度确定性投资建议、禁用 emoji。
- Agent fallback 文案只能说明数据不可用；不能编造价格、涨跌幅、榜单、资金流或 K 线。

## 修改建议

- 新增意图：先改 `intent-routing.ts`，再在 `agent-workflows.ts` 增加 DAG，最后补 UI slash command（如需要）。
- 新增工具调用：优先在 `electron/services/tools/*` 和 `tool-registry.ts` 接入真实 service，再在 `agent-tool-runtime.ts` 或 workflow 节点中使用。
- 新增分析维度：检查 `stock-analysis-agents.ts`、`StructuredAgentFinding.dimension`、结果卡片和合规输出。
- 修 Agent bug 时沿 `orchestrator → intent-routing → workflow/DAG → tool/service → evidence/compliance → renderer runEvents` 排查。