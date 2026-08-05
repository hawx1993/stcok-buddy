# Stock Agents Knowledge 索引

本目录是 StockBuddy / Stock Agents 项目的可复用知识库。使用 `stock-dev` 或 `stock-fix-bug` skill 时，先读本索引，再按任务领域读取对应文档。

## 阅读顺序

1. 先读强制规则：
   - `.claude/rules/typescript-react.md`
   - `.claude/rules/data.md`
   - `.claude/rules/bug-fix.md`（修 Bug 时）
   - `.claude/rules/emoji.md`（AI 投研输出时）
2. 再读本文件，确认任务属于哪个链路。
3. 按领域读取：
   - Agent / 投研 / 子 Agent：`.claude/knowledge/agent-services.md`
   - Agent 工具 / tool registry：`.claude/knowledge/agent-tools.md`
   - 市场数据同步 / DuckDB：`.claude/knowledge/market-data-services.md`
   - 股票、行情、探索、监控、新闻：`.claude/knowledge/stock-services.md`
   - Electron 顶层服务：`.claude/knowledge/electron-services-overview.md`
   - IPC / preload / renderer API：`.claude/knowledge/ipc-data-flow.md`
   - React 组件、Zustand store、Web Worker：`.claude/knowledge/frontend-architecture.md`

## 总数据流

生产功能必须保持真实数据链路：

```text
React Component / Hook
  ↓ getStocksenseApi()
src/shared/stocksense-api.ts
  ↓ window.stocksense [Electron]
electron/preload.cjs
  ↓ ipcRenderer.invoke / push event
electron/ipc.ts
  ↓ service function
electron/services/**
  ↓ stock-sdk / a-stock-data / DuckDB / SQLite / LLM
真实数据源或本地持久化
```

浏览器/PWA 环境只能提供空状态、错误状态、加载状态，或调用真实可用接口；不能展示伪造行情、伪造新闻、伪造 K 线或合成走势。

## 真实数据红线

- 面向用户的股票、行情、板块、新闻、图表、Agent 投研结果必须基于真实数据。
- 数据源优先级：`stock-sdk` → `a-stock-data skill` → 明确空/错误/加载状态。
- 禁止新增 fake/mock/preview/demo/sample/hardcoded 行情、榜单、新闻、K 线、分时或合成走势图。
- 测试和 selfcheck 可以使用替身数据，但必须限定在 `__tests__/` 或 `selfchecks/` 场景。
- Agent fallback 文案只能说明“暂无数据 / 数据源暂不可用”，不能编造市场数值。

## 常见修改路径

### 新增 renderer 可调用能力

详见 `.claude/knowledge/ipc-data-flow.md`。顺序通常是：

1. `src/shared/types.ts`
2. `src/shared/stocksense-api.ts`
3. `electron/preload.cjs`
4. `electron/ipc.ts`
5. `electron/services/**`
6. React hook/component
7. 相关测试或 selfcheck

当前 IPC 需要特别区分：

- `marketData:*`：DuckDB 市场数据运行时、状态、同步、取消、失败重试和统计。
- `dataSync:*`：renderer 手动触发的数据任务，包括 K 线、异动历史、个股详情和行情页快照。
- push listener 必须在 `preload.cjs` 返回取消订阅函数，并在 React effect 中清理。

### 新增或修改股票数据服务

优先查：

- `.claude/knowledge/stock-services.md`
- `.claude/knowledge/market-data-services.md`
- `stock-sdk` 文档：https://stock-sdk.linkdiary.cn/api/

必须复用已有 provider/service/cache/worker，不要在 UI 层直接请求第三方行情接口。

### 新增或修改 Agent 能力

优先查：

- `.claude/knowledge/agent-services.md`
- `.claude/knowledge/agent-tools.md`

需要沿以下链路检查影响：

```text
orchestrator
  ↓ runStoreCommand / intent-routing / symbol resolving
agent-planning
  ↓ 初始计划、计划项和 fallbackStrategy
agent-workflows + dag-executor
  ↓ 数据节点、分析节点、报告节点
runContextTool + tool-registry/service
  ↓ ToolCallRecord、dataStatuses、evidence
data gap / reflection
  ↓ plan_updated、data_gap_detected、reflection_completed
compliance + final answer
```

新增工具或数据节点时，工具输出应提供 `source`、`warnings`、`freshness`、`isComplete` 和证据字段，便于 Agent 正确识别 `available`、`empty`、`failed`、`partial`、`stale`、`skipped` 状态。
