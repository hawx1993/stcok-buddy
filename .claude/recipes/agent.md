# Agent Recipe

适用于聊天编排、intent、DAG workflow、Agent tools、投研输出、evidence、data gap 和结果卡片。

## 必读

- `.claude/rules/data.md`
- `.claude/knowledge/agent-services.md`
- `.claude/knowledge/agent-tools.md`（新增或修改 tool 时）
- `.claude/knowledge/stock-services.md` 或 `market-data-services.md`（工具依赖数据服务时）

## 实现步骤

1. 沿 `orchestrator → intent-routing → planning → workflow/DAG → tool runtime → service/provider → evidence/reflection → renderer` 定位边界。
2. 新增意图时同步 routing、planning、workflow、结果展示和测试；全市场任务优先复用 DataCoverage 节点。
3. 新增工具时先找 `stock/**`、`market-data/**`、`stock-db/**` 的真实实现，再封装到 `electron/services/agents/tools/<kebab-case>.ts`。
4. 工具注册不等于模型授权；只有模型确实需要自主选择时才加入对应白名单。
5. workflow 内默认通过 `runContextTool()` 调用工具，保留 toolCalls、dataStatuses、evidence、runEvents 和 data gap。
6. 工具输出要保留 source、freshness、storage、isComplete、warnings 和证据字段。

## 输出约束

- Agent 不生成假行情、假榜单、假新闻、假 K 线、假筛选样本。
- `partial`、`stale`、`empty`、`failed`、`skipped` 必须进入数据缺口或降级说明。
- 投研输出保留风险提示和“不构成投资建议”。
- 结果卡片只展示真实工具输出或明确不可用状态。

## 验证

- 工具改动：验证 registry、白名单、输入限幅、success/empty/failed/partial/stale。
- workflow 改动：验证计划事件、数据缺口、evidence 和最终报告。
- UI 展示改动：同步验证 runEvents / result cards。