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
   - Agent / 投研 / 子 Agent / 数据覆盖：`.claude/knowledge/agent-services.md`
   - Agent 工具 / tool registry / 条件选股工具：`.claude/knowledge/agent-tools.md`
   - 市场数据同步 / DuckDB / 条件选股服务：`.claude/knowledge/market-data-services.md`
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

## 当前重点链路

### 全市场 Agent 与选股

需要先读：`.claude/knowledge/agent-services.md`、`.claude/knowledge/agent-tools.md`、`.claude/knowledge/market-data-services.md`。

当前全市场相关能力：

- `data-coverage-agent.ts`：在条件选股、a-stock-data Agent、超短线选股和无 symbol 的股票相关问答前检查并补齐本地覆盖度。
- `condition-screener-agent.ts` + `screenASharesByConditions`：确定性 `/condition-screener` 参数解析和条件选股。
- `stock-picker-agent.ts` + `screenLocalAStocks`：自然语言超短线技术选股，先宽筛后精筛。
- `market-data/condition-screener-service.ts`：真实条件筛选服务，结合 DuckDB、stock-sdk、a-stock-data、板块和筹码缓存。

这些链路的空结果要区分：

- 真实执行完成且 0 命中：可展示“条件交集为空”。
- 数据源失败、缺字段、覆盖不足或 stale：必须展示 warnings / 数据缺口，不能补假样本。

### 本地 DuckDB 与同步

需要先读：`.claude/knowledge/market-data-services.md`。

当前注意点：

- 手动 UI 同步仍走 `marketData:*` / `dataSync:*`，受冷却和调度约束。
- Agent 覆盖度补齐可走 `runImmediateMarketDataSync()`，该入口绕过 12 小时强制同步冷却，但仍串行等待当前同步。
- 同步 worker 通过批量预取本地最新交易日和批量写入降低 DuckDB 开销。

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
- `.claude/knowledge/market-data-services.md`（涉及全市场、筛选、DuckDB 或同步时）

需要沿以下链路检查影响：

```text
orchestrator
  ↓ runStoreCommand / intent-routing / symbol resolving
agent-planning
  ↓ 初始计划、计划项和 fallbackStrategy
agent-workflows + dag-executor
  ↓ data-coverage / 数据节点 / 分析节点 / 报告节点
runContextTool + tool-registry/service
  ↓ ToolCallRecord、dataStatuses、evidence
data gap / reflection
  ↓ plan_updated、data_gap_detected、reflection_completed
compliance + final answer
```

新增工具或数据节点时，工具输出应提供 `source`、`warnings`、`freshness`、`isComplete` 和证据字段，便于 Agent 正确识别 `available`、`empty`、`failed`、`partial`、`stale`、`skipped` 状态。

### 新增或修改条件选股

优先查：

- `.claude/knowledge/agent-services.md` 的“条件选股与超短线选股”。
- `.claude/knowledge/agent-tools.md` 的“筛选类工具边界”。
- `.claude/knowledge/market-data-services.md` 的“条件选股服务”。

常见同步点：

1. `electron/services/market-data/condition-screener-types.ts`
2. `electron/services/market-data/condition-screener-service.ts`
3. `electron/services/agent/tools/screen-a-shares-by-conditions.ts`
4. `electron/services/agent/condition-screener-agent.ts`
5. `electron/services/agent/agent-tool-runtime.ts` 的数据状态特殊判断（如空结果不是缺口）
6. 相邻 `__tests__` 或 selfcheck
