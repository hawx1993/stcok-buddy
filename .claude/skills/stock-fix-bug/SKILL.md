---
name: stock-fix-bug
description: 通过项目文件索引快速定位根因，以最小改动修复 Stock Agents Bug。
argument-hint: '用户问题描述'
---

# Bug 快速定位技能

目标：先用本索引定位**可能出错的文件和完整调用链**，再只读取与症状直接相关的实现和测试。禁止一开始批量阅读知识文档或无关源码。

## 必须遵守的规则

开始前读取并遵守：

- `.claude/rules/bug-fix.md`
- `.claude/rules/typescript-react.md`
- `.claude/rules/data.md`
- `.claude/rules/emoji.md`（修改 Agent 投研输出时）

不得以 mock、伪造行情、静默 fallback、`any`、`@ts-ignore`、删除业务逻辑或关闭检查掩盖问题。

## 快速定位步骤

1. 根据用户症状在下方索引选择入口文件；先读该文件和同名/相邻测试。
2. 对入口导出的**函数、类型、IPC channel、store action 或组件**执行全局搜索，沿实际调用链逐层读取；不要预先读取整个目录。
3. 确认可复现症状、根因和最小修复点后再编辑。
4. 编辑前、后均全局搜索被改符号的所有调用方；只修改用户要求直接涉及的文件和调用方。
5. 运行定向测试；随后运行 `pnpm run typecheck`、`pnpm run test` 与 `git diff --check`。失败必须如实区分既有失败和本次失败。

## 项目入口索引

| 文件 | 职责 | 优先用于定位 |
| --- | --- | --- |
| `src/main.tsx` | Renderer 启动入口。 | 页面未挂载、全局初始化。 |
| `src/app.tsx` | 主布局、视图切换、全局弹层。 | 页面切换、布局、弹层。 |
| `electron/main.ts` | Electron 生命周期、窗口、运行时和 scheduler 启停。 | 启动、退出、后台任务。 |
| `electron/app-main.ts` | Electron 应用初始化辅助。 | 主进程启动配置。 |
| `electron/preload.cjs` | 安全暴露 `window.stocksense`。 | renderer API 缺失、IPC 调用失败。 |
| `electron/ipc.ts` | IPC channel → service 路由。 | channel、参数、主进程错误。 |
| `src/shared/types.ts` | 跨 renderer / preload / IPC / service 的共享类型和 API 接口。 | 返回类型、消息、IPC 类型不一致。 |
| `src/shared/stocksense-api.ts` | renderer 访问 API 的统一入口和浏览器空态降级。 | Electron / 浏览器差异、API 调用。 |
| `src/store/app-store.ts` | store 聚合出口。 | store 导入入口。 |
| `src/store/app-ui-store.ts` | 视图、面板、弹层、同步进度等 UI 状态。 | 视图切换、面板状态。 |
| `src/store/app-data-store.ts` | 会话、消息、收藏、选中标的、K 线等业务状态。 | 聊天流、选股、数据不同步。 |
| `src/workers/stock-compute.worker.ts` | K 线、分时、筹码的重计算 worker。 | 图表计算卡顿或数据转换错误。 |
| `src/workers/stock-compute-client.ts` / `stock-compute-types.ts` | worker 客户端和共享契约。 | worker API 或类型问题。 |

## Renderer 文件索引

| 路径 | 职责 | 优先用于定位 |
| --- | --- | --- |
| `src/components/chat-view/` | 对话发送、流式 runEvents、Markdown、结果卡、slash command。 | AI 回复、进度、工具卡、发送失败。 |
| `chat-view/hooks/use-chat-send.ts` | 聊天发送和流式响应订阅。 | 发送、token 流、取消订阅。 |
| `chat-view/components/analysis-progress/` | Agent 计划、步骤、工具调用、数据缺口展示。 | 进度/计划/工具调用展示。 |
| `src/components/market-view/` | 行情页、指数、股票表、龙虎榜、指数 K 线弹层。 | 行情列表、排序、实时刷新。 |
| `src/components/discovery-view/` | 探索页和各 section。 | 机会雷达、复盘、热点、历史交易日。 |
| `discovery-view/hooks/use-discovery-sections.ts` | section 懒加载、缓存、竞态控制。 | section 不加载、旧请求覆盖新状态。 |
| `src/components/stock-detail-panel/` | 右侧个股、板块、新闻、异动、收藏、AI 监控。 | 详情面板、选中标的、收藏。 |
| `src/components/kline-chart/` | K 线、分时、筹码 overlay、加载更多历史。 | 图表空态、指标、时间序列。 |
| `src/components/global-stock-search/` | 全局股票搜索和快捷键。 | 搜索/代码名称匹配。 |
| `src/components/data-sync-modal/` | 手动数据同步与进度。 | 同步状态、进度事件。 |
| `src/components/settings-modal/` | 模型、偏好、更新设置。 | 设置、模型校验、更新。 |
| `src/components/sidebar/` | 会话列表、分组、离线/同步/更新提示。 | 会话、侧栏状态。 |
| `src/components/news-reader/` | 新闻阅读覆盖层。 | 新闻详情与返回视图。 |
| `src/components/{empty,error-boundary,theme-toggle,topbar,about-modal,storage-manager-modal,market-phase-pill}/` | 通用 UI：空/错态、主题、顶部栏、关于、存储、交易时段。 | 对应通用 UI 问题。 |
| `src/shared/condition-screener.ts` | 条件选股的 renderer 侧格式和约束。 | 条件选股输入/展示。 |
| `src/shared/{market-time,market-color,board-dashboard-rankings,hot-stock-hints-service,chat-message-pagination}.ts` | 时间、颜色、排行榜、热点提示、消息分页纯逻辑。 | 对应数据转换或展示规则。 |
| `src/styles/` | 全局、主题、富文本和应用样式。 | 跨页面样式/主题问题。 |

> `components/<feature>/index.tsx` 是该功能入口；`components/` 为拆分的 UI 子块；`hooks/` 为状态与副作用；`utils.ts`、`*-utils.ts`、`*-format.ts` 为纯转换；`*.module.scss` 是该功能私有样式；`__tests__/` 是对应回归测试。

## Electron Service 文件索引

| 路径 | 职责 | 优先用于定位 |
| --- | --- | --- |
| `electron/services/stock/stock-client.ts` | 股票 IPC 的聚合入口：搜索、行情、K 线、分时、筹码、热点。 | 个股数据、搜索、K 线总入口。 |
| `electron/services/stock/shared.ts` | `stock-sdk`、K 线转换、板块缓存等通用能力。 | SDK 调用、K 线/板块共性问题。 |
| `electron/services/stock/{symbols,schemas,format}.ts` | 标的标准化、校验、格式化。 | 代码解析、数据形状、数值格式。 |
| `electron/services/stock/{market-page,market-indices,market-state,industry-provider}.ts` | 行情页快照、指数、市场状态、行业映射。 | 行情页、指数、行业。 |
| `electron/services/stock/{board-detail,board-dashboard,board-dashboard-utils}.ts` | 板块详情和驾驶舱。 | 板块、成分股、板块排行。 |
| `electron/services/stock/{discovery-service,discovery-market-summary,discovery-hot-themes,discovery-monthly-themes}.ts` | 探索页快照、摘要、热点和月度题材。 | 探索页/历史复盘。 |
| `electron/services/stock/{market-review-service,market-review-data,trading-advice-service}.ts` | 市场复盘、情绪和交易建议。 | 复盘、建议内容。 |
| `electron/services/stock/{news-client,northbound-flow,fund-flow,dragon-tiger,hot-focus}.ts` | 新闻、北向、资金流、龙虎榜、热点。 | 对应数据源与聚合。 |
| `electron/services/stock/{quote-store,surge-history-store,monitor-history-store}.ts` | SQLite/DuckDB 缓存与批量持久化。 | 缓存、历史数据、写入性能。 |
| `electron/services/stock/{surge-history-service,surge-history-scheduler,monitor-history-scheduler,monitor-service}.ts` | 异动/AI 监控历史查询和后台调度。 | 异动、监控、定时任务。 |
| `electron/services/stock/{chip-distribution,chip-distribution-provider,chip-distribution-worker-client}.ts` | 筹码数据、provider、worker 桥接。 | 筹码图/计算。 |
| `electron/services/market-data/market-data-query.ts` | DuckDB 本地优先日线/行情查询和真实远程补齐。 | K 线、最新行情、本地/远程一致性。 |
| `electron/services/market-data/market-data-store.ts` | DuckDB schema、查询和写入队列。 | 本地库、迁移、批量写入。 |
| `electron/services/market-data/{market-data-sync,market-data-scheduler,market-data-sync.worker}.ts` | 市场数据同步状态机、调度和 worker 实现。 | 自动同步、取消、重试、后台同步。 |
| `electron/services/market-data/{data-sync-handlers,providers,quality,trade-date-resolver}.ts` | 手动同步、真实 provider、数据质量、交易日。 | 同步入口、数据异常、交易日。 |
| `electron/services/market-data/{condition-screener-service,condition-screener-board-provider,market-cap-screener}.ts` | 条件选股与市值筛选。 | 条件选股结果。 |
| `electron/services/agent/orchestrator.ts` | 对话编排总入口。 | Agent 请求未完成、最终响应错误。 |
| `electron/services/agent/{intent-routing,agent-planning,agent-workflows,dag-executor}.ts` | 意图、计划、DAG 构建和执行。 | 命令路由、步骤顺序、子 Agent。 |
| `electron/services/agent/{agent-tool-runtime,evidence,agent-reflection,compliance-critic}.ts` | 工具运行、证据、数据缺口、合规。 | 工具状态、报告证据、投研文案。 |
| `electron/services/agent/{stock-analysis-agents,stock-analysis-overview-agent,report-agent,risk-agent,news-analysis-agent}.ts` | 专项分析和最终报告。 | 某分析维度/报告异常。 |
| `electron/services/agent/tools/` | 一个文件一个 Agent 工具；`index.ts` 汇总、`input.ts` 定义输入。 | 某个 tool call 的参数、结果、真实数据来源。 |
| `electron/services/tools/tool-registry.ts` | 可调用工具注册。 | 工具未注册/无法调用。 |
| `electron/services/{config-store,conversation-store,store-service,update-service,desktop-notification}.ts` | 配置、会话、商店、更新、系统通知。 | 设置、会话、命令、更新、通知。 |

> `electron/services/**/__tests__/` 是单元回归测试；`electron/selfchecks/*.selfcheck.ts` 是需要 Electron/服务链路的定向自检。新增/修改外部数据必须走 `Provider → Service → IPC → renderer`，不得在组件中直接请求第三方接口。

## 症状到调用链

| 症状 | 从这里开始 | 必查链路 |
| --- | --- | --- |
| 页面不显示、状态错乱 | 对应 `src/components/<feature>/index.tsx` | component → hook/store → `getStocksenseApi()`。 |
| renderer API 不存在、IPC 报错 | `src/shared/stocksense-api.ts` | types → API → preload → IPC → service。 |
| 行情、K 线、新闻、板块数据不对 | `stock-client.ts` 或专项 stock service | service → market-data query/cache → provider → `stock-sdk`。 |
| 同步卡住、历史数据缺失 | `market-data-sync.ts` | handler/scheduler → worker → store/query/provider。 |
| 聊天回复、意图、工具、报告异常 | `orchestrator.ts` | intent → planning → workflow/DAG → tool → evidence/reflection → `chat:token` → chat view/store。 |
| 发现页某 section 错误 | `use-discovery-sections.ts` 或 `discovery-service.ts` | UI section → snapshot options → service section/cache → 数据服务。 |
| 缓存、数据库、性能问题 | 相关 `*-store.ts` / `*.worker.ts` / scheduler | memory cache → batch/queue/transaction → SQLite/DuckDB；禁止逐条写库。 |

## 需要深入背景时才读

只有索引和直接调用方不足以判断根因时，按需读取**一份**对应文档：

- renderer / store / worker：`.claude/knowledge/frontend-architecture.md`
- IPC / preload / API：`.claude/knowledge/ipc-data-flow.md`
- 股票、行情、探索、监控、新闻：`.claude/knowledge/stock-services.md`
- DuckDB、同步、交易日：`.claude/knowledge/market-data-services.md`
- Agent、报告、runEvents、DAG：`.claude/knowledge/agent-services.md`
- Agent 工具：`.claude/knowledge/agent-tools.md`
- 配置、会话、通知、更新：`.claude/knowledge/electron-services-overview.md`

## 修改边界与验证

- 每项改动都必须能直接对应用户原始问题；不得顺手重构、格式化或修改相邻无关逻辑。
- 修改 public API、共享类型、IPC channel、service 方法、store action、组件 props 或数据库 schema 时，必须全局搜索**定义、导入、调用和测试**，逐一确认影响。
- 先建立覆盖原症状的定向测试/selfcheck；不能建立时，明确缺失的复现信息，不得猜测修复。
- 完成后报告：`Root Cause`、`Fix`、`Impact`、`Risk`、`Verification`。