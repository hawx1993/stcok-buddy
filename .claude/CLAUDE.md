# Stock Agents 项目规则

适用于本仓库 `stock-agents` / StockBuddy 的所有开发、排障、数据接入、Agent 工具和文档维护任务。本文件是 `.claude/` 目录的入口索引；具体实现细节以命中的 `rules/`、`knowledge/`、`recipes/` 和 `skills/` 文件为准。

## 执行优先级

1. **用户当前明确要求**。
2. **本文件与 `.claude/rules/**` 的强制规则**。
3. **命中领域的 `.claude/knowledge/**` 与 `.claude/recipes/**` 指南**。
4. **项目现有源码、类型、测试和架构边界**。

如果规则与当前实现冲突：

- 优先遵循规则文件。
- 不得绕过规则或用 mock / fallback 掩盖问题。
- 不得为了快速完成任务而忽略类型、数据、测试或范围约束。

## 开始任何任务前必须先按需加载的规则

本文件只作为入口索引。除非明确希望 Claude Code 启动时自动内联文件，否则不要在索引表中使用 `@path`；使用普通路径，并由当前任务按需读取对应文件。

必须优先读取并遵守：

- 通用开发规则：`rules/core.md`
- TypeScript / React / Electron：`rules/typescript-react.md`
- 数据访问和读取：`rules/data.md`
- 修复 Bug：`rules/bug-fix.md`（任务包含排障、报错、失败测试或回归时）

规则摘要：

- 先定位既有边界，再修改代码。
- 默认最小改动；不做顺手重构、全文件格式化、依赖升级或目录整理。
- 默认修改文件不超过 5 个；Bug 修复默认不超过 3 个。超过预算或影响公共 API / schema / 依赖 / 数据库结构时，先暂停说明影响和方案。
- 首轮搜索最多选 20 个候选，首轮最多读取 5 个代码文件；沿调用链逐步扩展上下文。
- 完成后至少考虑 `pnpm run typecheck` 和 `git diff --check`，再按影响范围运行定向测试、selfcheck 或 build。

## `.claude/` 目录结构

```text
.claude/
  CLAUDE.md                         # 本入口文件
  rules/                             # 强制工程规则
    core.md
    typescript-react.md
    data.md
    bug-fix.md
  knowledge/                         # 项目架构导航和领域知识
    index.md                         # Knowledge 选择入口
    frontend-architecture.md
    ipc-data-flow.md
    stock-services.md
    market-data-services.md
    agent-services.md
    agent-tools.md
    electron-services-overview.md
    api-guide.md
  recipes/                           # 按任务类型执行的实现配方
    renderer-ui.md
    renderer-api.md
    ipc.md
    stock-data.md
    persistence.md
    agent.md
    testing.md
  skills/                            # 项目/集成技能
    stock-dev/
    stock-fix-bug/
    electron-ai-tools/
    a-stock-data/
    integration-javascript_web/
  settings.local.json                # 本机权限与 MCP 启用配置，不作为可移植项目规范
```

## Knowledge 加载规则

需要跨多个领域时，先读 `knowledge/index.md`，再只加载与当前任务直接相关的 Knowledge，禁止一次性加载整个 `knowledge/` 目录。

| 领域 | 适用场景 | 读取文件 |
| --- | --- | --- |
| Frontend | React 页面、组件、hook、Zustand、worker、K 线/分时/筹码 UI、探索页、行情页、右侧栏 | `knowledge/frontend-architecture.md` |
| Renderer API / IPC | `getStocksenseApi()`、`src/shared/types.ts`、browser fallback、preload、IPC channel、push event、renderer listener | `knowledge/ipc-data-flow.md` |
| Stock Services | 个股行情、搜索、K 线、分时、板块、行业、新闻、热点、龙虎榜、异动、监控、交易建议 | `knowledge/stock-services.md` |
| Market Data | DuckDB 市场库、同步任务、交易日、全市场快照、条件选股、本地优先查询、DataCoverage | `knowledge/market-data-services.md` |
| Agent | 聊天编排、intent、DAG、DataCoverage、Agent tool、投研报告、证据链、data gap、结果卡片 | `knowledge/agent-services.md`；新增/修改工具时加读 `knowledge/agent-tools.md` |
| Electron Services | Electron 启动/退出、配置、会话、通知、命令商店、更新、存储统计与清理 | `knowledge/electron-services-overview.md` |
| API Guide | 项目已整理的 API 使用说明、命令能力或集成说明 | `knowledge/api-guide.md` |

读取 Knowledge 后仍以源码、类型和测试为事实来源；Knowledge 是导航，不替代代码确认。

## Recipe 使用规则

按任务命中领域选择 Recipe；不要一次性读取整个 `recipes/` 目录。下表中的路径是选择索引，不是自动内联引用。

| Recipe | 使用场景 |
| --- | --- |
| `recipes/renderer-ui.md` | React 页面、组件、hook、Zustand store、worker、UI 状态、图表展示 |
| `recipes/renderer-api.md` | renderer 可调用能力、shared types、browser fallback、preload 暴露、IPC 服务链路 |
| `recipes/ipc.md` | Electron IPC channel、preload listener、主进程服务调用、push event |
| `recipes/stock-data.md` | 行情、搜索、K 线、分时、板块、行业、新闻、热点、龙虎榜、异动、资金流 |
| `recipes/persistence.md` | SQLite、DuckDB、cache、batch flush、同步任务、scheduler、退出清理 |
| `recipes/agent.md` | 聊天编排、intent、DAG workflow、Agent tools、投研输出、evidence、data gap、结果卡片 |
| `recipes/testing.md` | 选择、补充和执行验证；文档-only 改动可用结构检查和 `git diff --check` 替代生产代码验证 |

## Skill 使用规则

项目内已有技能用于加载更具体的流程。用户直接输入对应 slash command 时必须调用对应 Skill；未直接调用但任务命中时，也优先按该技能流程执行。

| Skill | 适用场景 |
| --- | --- |
| `stock-dev` | 新增或扩展功能；按 UI、State、Renderer API、IPC、Stock Service、Market Data、Agent、Persistence、Testing 分类加载规则、Knowledge 和 Recipe |
| `stock-fix-bug` | 纯 Bug 修复、失败测试、报错、回归；必须先定位根因，遵守该 skill 下 `rules/scope.md`、`rules/testing.md`、`rules/safety.md`，可使用 `scripts/locate.sh`、`scripts/test.sh`、`scripts/verify.sh` 辅助 |
| `electron-ai-tools` | 盘点、新增、修改、暴露或验证 Electron Agent 的文本 JSON 工具调用、Tool Registry、`runContextTool()` 或真实行情数据链路 |
| `a-stock-data` | 只有在需要实际取 A 股真实数据、且 `stock-sdk` 不支持或不适合时使用；不得用于普通投资观点讨论的无取数场景 |
| `integration-javascript_web` | PostHog JavaScript Web 集成；必须按其 `references/` 流程执行，使用环境变量，禁止硬编码 key 或采集 PII |

## 行情数据源规则

所有面向用户的接口/API 功能必须使用真实数据。**不得**在用户可见的股票、行情、板块、新闻、图表等响应中使用编造数据、mock 数据、preview 数据、demo 数据、sample 数据或硬编码行情数据。

股票/行情数据源优先级：

1. **优先使用 `stock-sdk`**
   - 已安装 `stock-sdk` 时，任何股票/行情接口都必须优先使用它。
   - 新增或修改接口前先参考文档：https://stock-sdk.linkdiary.cn/api/
   - stock-sdk skills 参考文档：https://stock-sdk.linkdiary.cn/skills/catalog
   - 行情、搜索、K 线、板块/行业、热点、筹码、新闻等能力，凡是 `stock-sdk` 支持的都优先走 `stock-sdk`。

2. **其次使用 `a-stock-data skills`**
   - 如果 `stock-sdk` 没有数据、没有对应接口，或接口不适合当前场景，再使用 `a-stock-data skills` 提供的真实数据能力。
   - 等待或降级到 `a-stock-data skills` 时，不得自行编造替代数据。

3. **禁止伪造 fallback 行情**
   - 如果 `stock-sdk` 和 `a-stock-data skills` 都失败或返回空，必须展示明确的空状态/错误状态/加载状态，例如“暂无数据 / 数据源暂不可用”。
   - 不得静默替换为假的股票、价格、指数、板块排行、新闻、K 线、分时线或合成走势图。
   - 仅测试、自检文件可以使用 mock，但必须明确限定在 test/selfcheck 场景，不能进入生产 UI 或生产 API 响应。

标准数据链路：

```text
UI
  → Service
  → Provider
  → Data Source
```

React 组件不得直接请求东方财富、腾讯行情、Tushare 等第三方行情接口。Browser / PWA fallback 只能展示空状态、错误状态、加载状态或“请在桌面客户端查看”；不能返回预览行情、模拟 K 线或示例新闻。

## 代码组织规则

1. **一个文件一个组件**
   - React 组件文件中原则上只维护一个主组件。
   - 多余组件必须拆到当前目录下的 `components/` 子目录维护。
   - 示例：`src/components/market-view/index.tsx` 中的子组件应拆到 `src/components/market-view/components/`。

2. **组件和模块大小约束**
   - 单组件文件超过 400 行时应拆分组件或提取 hook；超过 500 行时必须拆分。
   - 单个 hook 不超过 300 行，单个 service / provider 不超过 500 行。
   - 拆分优先按 UI 区块、业务职责、列表项、弹层、图表等边界进行。
   - 不要为了绕过行数限制把多个无关组件塞进同一个文件。

3. **优先复用成熟实现**
   - 写代码前先查现有 service、provider、hook、组件、类型、测试、已安装 npm 包和成熟开源实现。
   - 能用已有依赖或可靠开源实现解决的，不要重新写一套。
   - 新增依赖前先确认项目里是否已有等价依赖；已有依赖能解决就复用已有依赖。
   - 自己实现只用于业务胶水代码、小型适配逻辑，或现有依赖无法覆盖的场景。

## TypeScript / React 红线

- 禁止新增 `any`、`as any`、`as unknown as`、`@ts-ignore`，不得降低 tsconfig 或 lint 严格度。
- 共享类型优先放在现有共享位置；修改 public API 类型时必须说明影响范围并搜索调用方。
- 异步函数必须处理失败路径，错误不能被静默吞掉。
- Hook 必须在组件或自定义 hook 顶层调用；不得通过删除依赖项、删除 effect 或删除 Hook 来规避问题。
- 列表使用稳定 key，不使用随机数、数组 index 或频繁变化的值。
- 复杂逻辑优先提取 hook、纯函数或子组件；不滥用 `useMemo` / `useCallback` 掩盖结构问题。
- 禁止硬编码行情、颜色或需求之外文案。

## Bug 修复规则

修复 Bug 时必须优先定位根因（Root Cause）。修改前必须形成简短判断：

1. Bug 的根因是什么？
2. 为什么会发生？
3. 当前实现为什么失效？
4. 最小修复点在哪里？
5. 修复是否影响其他功能或 public API？
6. 是否引入新的性能、数据、状态同步或兼容性问题？
7. 是否改动了需求之外的地方？

禁止通过以下方式“修好现象”：

- 空 `catch` 后返回 `[]`、`null`、`{}`。
- 删除业务逻辑、删除校验、删除 Hook、删除 effect 依赖。
- 注释掉功能、测试或错误分支。
- 新增 fallback/mock/fake/demo/sample/preview 行情数据。
- 跳过测试、关闭 lint/typecheck 或降低类型安全。

完成 Bug 修复后必须说明：Root Cause、Fix、Impact、Risk、Verification。

## 实现指导

- 新增行情 fallback 前，必须先搜索项目里已有真实数据 provider 并复用。
- 图表 UI 不得根据单个价格或涨跌幅合成走势/K线/分时数据；有真实序列才画图，否则显示“暂无图表数据”。
- 搜索/自动补全必须支持股票代码和名称的部分匹配，数据源优先 `stock-sdk`，其次 `a-stock-data skills`。
- 领涨板块/行业展示必须使用真实板块/行业排行接口；失败时只能展示空状态或错误状态。
- 实时行情写库必须使用 Memory Cache → Batch Flush / Transaction → SQLite / DuckDB；禁止收到每条行情立即同步写库。
- Agent 工具输出必须保留 source、freshness、storage、isComplete、warnings、evidence 和 data gap 状态；结果卡片只展示真实工具输出或明确不可用状态。

## 验证要求

基础验证：

```bash
pnpm run typecheck
git diff --check
```

按影响范围选择：

```bash
pnpm run test -- <相关测试>
pnpm run selfcheck:<相关自检>
pnpm run build
```

验证报告必须区分：已通过、失败、未运行及原因。失败时报告首个相关失败和关键输出，不把未验证或失败说成通过。

如果只有 `.claude` 文档改动，可用以下验证替代生产代码验证：

- 检查 `.claude` 文件路径和引用是否存在。
- 检查 Markdown 结构、重复或过期入口。
- 运行 `git diff --check`。

## 当前扫描记录

2026-07-13 扫描项目时发现以下历史硬编码或 fallback 数据模式。后续触碰相关文件时，不得继续扩展这些模式，应逐步替换为真实数据源：

- `src/shared/stocksense-api.ts`：浏览器预览 `stockMap`、`fallbackNews`、`fallbackHot`、`makePreview*` 数据。
- `electron/services/stock/stock-client.ts`：`fallbackMarketQuotes`、`fallbackMarketBoards`、`fallbackSectorHot`、合成指数辅助函数。
- `src/components/kline-chart/index.tsx`：无股票代码时的合成图表数据。
- Agent 的 fallback 文案/证据 helper 可以保留“数据不可用”提示，但不得伪造市场数值。
