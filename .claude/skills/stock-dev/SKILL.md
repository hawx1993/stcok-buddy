---
name: stock-dev
description: StockBuddy 项目开发导航。覆盖 Electron/React 结构、stock-sdk 数据源、Provider/Service 数据流、IPC 通道、数据库、测试与编码规范。
argument-hint: '[开发任务描述]'
---

# StockBuddy 开发技能

> 本技能是项目开发导航和速查手册。开发新功能、修改数据层、接入数据源、调整 UI/IPC 前，先按本文件确认项目结构与强制规范。

---

## 1. 必读规则与优先级

开始编码前必须阅读并遵守 `.claude/rules/` 下的规则文件：

| 优先级 | 规则文件                            | 适用场景               |
| ------ | ----------------------------------- | ---------------------- |
| 1      | `.claude/rules/typescript-react.md` | 所有 TS/TSX/React 代码 |
| 2      | `.claude/rules/data.md`             | 行情、数据访问、存储   |
| 3      | `.claude/rules/emoji.md`            | AI 投研输出、文案      |
| 4      | `.claude/rules/bug-fix.md`          | Bug 修复               |

核心红线：

- **真实数据优先**：面向用户的股票、行情、板块、新闻、图表、投研响应必须使用真实数据。
- **数据源优先级**：`stock-sdk` → `a-stock-data skill` → 明确空状态/错误状态/加载状态。
- **禁止伪造 fallback**：不得使用 fake/mock/preview/demo/sample/hardcoded 行情、新闻、K 线、板块排行或合成走势图。
- **统一数据流**：UI → Service → Provider → Data Source；React 组件不得直接请求第三方行情接口。
- **类型安全**：禁止新增 `any`、`as any`、`as unknown as`、`@ts-ignore`；优先补类型和泛型。
- **精准修改**：不得改动需求之外的文件、逻辑和公共 API。
- **金融计算**：禁止用浮点数做金额/收益等金融计算；必要时使用整数单位或可靠数值工具。

---

## 2. 当前项目结构

```text
src/                                  # React 渲染进程
  app.tsx                             # 主布局、主视图路由、右侧栏入口、全局 ErrorBoundary
  store/app-store.ts                  # Zustand 全局状态；MainView/RightPanelTab 等 UI 状态
  shared/
    stocksense-api.ts                 # 渲染进程数据门面；Electron: window.stocksense → IPC；Browser: 空/错误状态
    types.ts                          # 渲染/主进程共享类型
    analytics.ts                      # 前端埋点
  hooks/                              # 组件级/应用级 hooks
  components/
    chat-view/                        # AI 对话区
    discovery-view/                   # 探索页：市场摘要、情绪、涨停复盘、龙虎榜、AI 监控等
    market-view/                      # 行情页：指数卡片、行情表格、指数 K 线弹层
    news-reader/                      # 新闻详情阅读器
    stock-detail-panel/               # 右侧栏：收藏、个股、板块、异动、新闻、AI 监控
    kline-chart/                      # K 线图表
    error-boundary/                   # React 错误边界

electron/                             # Electron 主进程
  main.ts                             # Electron 启动入口
  preload.cjs                         # contextBridge 暴露 window.stocksense；新增 IPC 时需同步
  ipc.ts                              # IPC handler 注册中心
  services/
    stock/                            # 股票、板块、新闻、探索、监控、投研数据服务
      stock-client.ts                 # 股票详情、搜索、K 线、批量行情、分时等聚合入口
      shared.ts                       # stock-sdk 实例、通用请求/格式化工具
      market-page.ts                  # 行情页快照
      discovery-service.ts            # 探索页快照聚合
      discovery-*.ts                  # 探索页分模块数据
      monitor-service.ts              # AI 监控数据
      monitor-history-store.ts        # AI 监控历史 DuckDB
      trading-advice-service.ts       # AI 交易建议
      news-client.ts                  # 新闻、公告、新闻摘要
      board-detail.ts                 # 板块详情
      fund-flow.ts                    # 个股资金流
      hot-focus.ts                    # 热点/异动/板块资金流
      hot-stock-hints-service.ts      # 热点股票提示
      surge-history-*.ts              # 异动历史存储/调度/服务
      quote-store.ts                  # SQLite 实时行情缓存
      chip-distribution.ts            # 筹码分布
      indicators.ts                   # 技术指标
      symbols.ts                      # 股票/板块代码标准化
      schemas.ts                      # 数据 schema/校验
      format.ts                       # 数值格式化
    market-data/                      # DuckDB 市场数据持久层
      market-data-store.ts            # DuckDB 表结构 + CRUD
      market-data-query.ts            # 本地优先查询入口
      market-data-sync.ts             # K 线同步调度
      data-sync-handlers.ts           # 同步按钮触发的任务
      providers.ts                    # 市场数据 Provider
      quality.ts                      # 数据质量检查
      trade-date-resolver.ts          # 交易日解析
    agent/                            # AI Agent 系统
      orchestrator.ts                 # Chat 核心编排入口
      dag-executor.ts                 # DAG 执行器
      intent-routing.ts               # 意图路由
      analysis-agent.ts               # 技术/结构化分析 Agent
      data-agent.ts                   # 数据获取 Agent
      report-agent.ts                 # 报告生成 Agent
      risk-agent.ts                   # 风险 Agent
      compliance-critic.ts            # 合规/伪造数据/Emoji 检查
      evidence.ts                     # 证据链工具
      agent-tool-runtime.ts           # Agent 工具运行时
    tools/                            # Agent Tool 注册与股票工具
    llm/                              # LLM 客户端与埋点
selfchecks/                           # Electron/Node 自检脚本
```

### 主视图路由

`MainView` 定义在 `src/store/app-store.ts`：

| MainView        | 组件                | 说明                                      |
| --------------- | ------------------- | ----------------------------------------- |
| `'chat'`        | `<ChatView />`      | 默认 AI 对话视图                          |
| `'market'`      | `<MarketView />`    | 行情页                                    |
| `'discovery'`   | `<DiscoveryView />` | 探索页/监控/复盘                          |
| `'news-reader'` | `<NewsReader />`    | 新闻阅读覆盖视图；关闭后恢复 previousView |

新增主视图时通常需要同步：

1. `src/store/app-store.ts` 的 `MainView` 类型与状态方法。
2. `src/app.tsx` 的 ErrorBoundary 名称和组件分支。
3. 入口按钮/侧边栏逻辑。
4. 必要的埋点、测试和空状态。

---

## 3. 数据访问与 Provider 规则

### 3.1 标准数据流

```text
React Component
  ↓ getStocksenseApi().someMethod()
src/shared/stocksense-api.ts
  ↓ window.stocksense.someMethod() [Electron] / empty-or-error [Browser]
electron/preload.cjs
  ↓ ipcRenderer.invoke('channel:name')
electron/ipc.ts
  ↓ service function
electron/services/**
  ↓ stock-sdk / a-stock-data skill / DuckDB / SQLite / LLM
Data Source
```

要求：

- React 组件只调用 `getStocksenseApi()` 或已有 service/hook，不直接 `fetch` 东财、腾讯、Tushare 等第三方接口。
- 新增第三方数据访问必须放在 Electron service/provider 层。
- Browser/PWA fallback 只能返回空状态、错误状态、加载状态，或调用真实 API；不得展示预览行情/模拟 K 线/示例新闻。
- 图表必须有真实序列才渲染；没有真实 K 线/分时数据时显示“暂无图表数据”。
- 搜索/自动补全必须支持代码和名称部分匹配，优先 `stock-sdk`，其次 `a-stock-data skill`。

### 3.2 stock-sdk 使用原则

项目已依赖 `stock-sdk`，新增或修改股票数据接口时先查：

- API 文档：https://stock-sdk.linkdiary.cn/api/
- skills 文档：https://stock-sdk.linkdiary.cn/skills/catalog

常见能力：

| 能力            | 优先入口/说明                                  |
| --------------- | ---------------------------------------------- |
| A 股行情        | `sdk.quotes.cn(codes)`，批量优先               |
| 搜索            | `sdk.search(keyword)`                          |
| 历史 K 线       | `sdk.kline.cn(symbol, opts)`                   |
| 板块/行业       | `sdk.board.industry` / `sdk.board.concept`     |
| 资金流          | `sdk.fundFlow.*`                               |
| 市场异动/涨停池 | `sdk.marketEvent.*`                            |
| 筹码分布        | `sdk.chips.cn(symbol, opts)`                   |
| 交易日历        | `sdk.calendar.isTradingDay` / `prevTradingDay` |

实践要求：

- 批量接口优先，避免逐个请求。
- 远程请求必须有超时、错误暴露和用户可理解的错误/空状态。
- 同参数高频请求应复用缓存或 in-flight Promise。
- 如果 `stock-sdk` 不支持或返回空，再考虑 `a-stock-data skill`。
- 如果所有真实数据源都不可用，返回空/错误，不得合成假数据。

### 3.3 a-stock-data 使用原则

`a-stock-data` 是次级真实数据源能力，适用于 `stock-sdk` 无接口、不适合当前场景或暂不可用的情况。

- 使用前先确认 `stock-sdk` 是否已有能力。
- 不得把 a-stock-data 失败降级为 mock/fake 数据。
- 如果输出中存在 `warnings`/`source` 字段，应标明真实数据来源。
- 所有东财/腾讯等直接 HTTP 接入都必须封装在 service/provider 层，不能散落到 UI。

---

## 4. 本地数据库与缓存

### 4.1 市场数据 DuckDB

**文件**：`electron/services/market-data/market-data-store.ts`

| 表名                     | 用途               |
| ------------------------ | ------------------ |
| `securities`             | A 股证券主表       |
| `trade_calendar`         | 交易日历           |
| `daily_bars`             | 日线 K 线          |
| `sync_jobs`              | 同步任务记录       |
| `sync_failures`          | 同步失败详情       |
| `market_board_snapshots` | 板块/行情快照 JSON |
| `discovery_snapshots`    | 探索页快照缓存     |
| `stock_chips`            | 筹码分布缓存       |
| `stock_snapshots`        | 实时行情快照       |
| `market_board_details`   | 板块详情缓存       |
| `market_boards`          | 板块列表           |
| `board_constituents`     | 板块成分股         |

常用入口：

- `market-data-query.ts`：本地优先查询，例如历史 K 线/最新行情。
- `market-data-sync.ts`：同步状态、启动、取消、重试失败。
- `data-sync-handlers.ts`：UI 手动同步入口。
- `providers.ts`：市场数据 Provider。

### 4.2 异动与监控 DuckDB

| 文件                                               | 表名                 | 用途                         |
| -------------------------------------------------- | -------------------- | ---------------------------- |
| `electron/services/stock/surge-history-store.ts`   | `stock_surge_events` | 异动/涨停/跌停/炸板/强势历史 |
| `electron/services/stock/monitor-history-store.ts` | `ai_monitor_events`  | AI 监控事件历史              |

### 4.3 SQLite

| 文件                                      | 数据库/表                                              | 用途         |
| ----------------------------------------- | ------------------------------------------------------ | ------------ |
| `electron/services/conversation-store.ts` | `stocksense-chat.sqlite` / `conversations`, `messages` | 会话和消息   |
| `electron/services/stock/quote-store.ts`  | `stocksense-quotes.sqlite` / `stock_quote`             | 实时行情缓存 |

实时行情存储规则：

```text
Memory Cache → 15~30 秒批量写入 SQLite → UI 读取优先 Memory/本地，再远程补齐
```

禁止收到每条行情立即写库。

---

## 5. IPC 与 stocksenseApi 速查

### 5.1 新增 API 必改位置

新增渲染进程可调用能力时，按顺序同步：

1. `src/shared/types.ts`：共享类型与 `StocksenseApi` 接口。
2. `src/shared/stocksense-api.ts`：Electron 门面和 Browser fallback（空/错误状态，不造假数据）。
3. `electron/preload.cjs`：`contextBridge.exposeInMainWorld('stocksense', api)` 中暴露方法。
4. `electron/ipc.ts`：注册 `ipcMain.handle('channel:name', handler)`。
5. `electron/services/**`：真实数据 service/provider 实现。
6. 调用方组件/hook：通过 `getStocksenseApi()` 调用。
7. 测试或 selfcheck：覆盖关键成功/失败/空状态。

### 5.2 常用 IPC Channel

| 分类        | Channel                                                                                                                                  | 说明                               |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 配置/运行时 | `config:get`, `config:set`, `config:testModel`, `app:getRuntimeInfo`                                                                     | 应用配置、模型测试、版本信息       |
| 收藏        | `favorite:list`, `favorite:upsert`, `favorite:remove`, `favorite:togglePin`                                                              | 收藏股票                           |
| 会话        | `conversation:list/create/delete/rename`, `message:list/save`, `chat:send`                                                               | 会话、消息、AI 聊天                |
| 股票        | `stock:getDetail`, `stock:search`, `stock:getKline`, `stock:getChipDistribution`, `stock:getBatchQuotes`, `stock:getTimelines`           | 个股、搜索、K 线、筹码、行情、分时 |
| 板块/行情   | `board:getDetail`, `market:getPageSnapshot`                                                                                              | 板块详情、行情页快照               |
| 探索/监控   | `discovery:getSnapshot`, `monitor:getFeed`, `trading-advice:get`                                                                         | 探索页、AI 监控、交易建议          |
| 热点/异动   | `hot:list`, `hot:hintSource`, `hot:historyDates`, `hot:history`, `stock:surgeEvents`                                                     | 热点、异动历史、个股异动           |
| 新闻        | `news:list`, `news:stockList`, `news:stockFeed`, `news:stockPreferences`, `news:getSummary`, `news:getDetail`                            | 新闻和公告                         |
| 数据同步    | `marketData:getStatus`, `marketData:startSync`, `marketData:retryFailures`, `marketData:cancelSync`, `marketData:getStats`, `dataSync:*` | 市场数据同步                       |
| 存储/升级   | `storage:getStats`, `storage:clear`, `system:getDiskInfo`, `appUpdate:*`                                                                 | 存储管理、应用升级                 |
| 商店        | `store:list`, `store:installed`, `store:install`, `store:uninstall`                                                                      | 命令/扩展商店                      |

### 5.3 Push 事件

| Channel                      | 说明                                   |
| ---------------------------- | -------------------------------------- |
| `chat:token`                 | AI SSE token / runEvent 推送           |
| `notification:aiResponse`    | AI 回复完成的应用内兜底通知            |
| `market:pageSnapshotUpdated` | 行情页快照更新                         |
| `marketData:progress`        | 市场数据同步进度                       |
| `storage:clearProgress`      | 存储清理进度                           |
| `favorite:cleared`           | 收藏被清空                             |
| `appUpdate:stateChanged`     | 应用升级状态变化                       |
| `dataSync:taskProgress`      | 数据同步任务进度（preload 已暴露监听） |

---

## 6. 主要前端模块约定

### 6.1 组件组织

- React 组件文件原则上只维护一个主组件。
- 子组件放当前目录 `components/` 子目录。
- 单组件文件超过 400 行应拆分；超过 500 行必须拆分。
- 复杂逻辑提取 hook 或纯函数；单 hook 不超过 300 行。
- 大列表优先复用项目已有虚拟列表方案；当前依赖包含 `@tanstack/react-virtual`。
- 复杂组件外层应包 `ErrorBoundary`，现有主布局已对主区/右侧栏/弹层做保护。

### 6.2 重点模块

| 模块     | 入口                                          | 注意事项                                                                                    |
| -------- | --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 行情页   | `src/components/market-view/index.tsx`        | 子组件在 `market-view/components/`；数据来自 `getMarketPageSnapshot` 和 push 更新           |
| 探索页   | `src/components/discovery-view/index.tsx`     | 数据来自 `getDiscoverySnapshot`、`getMonitorFeed`、`getTradingAdvice`；不得在组件里拼假榜单 |
| 右侧栏   | `src/components/stock-detail-panel/index.tsx` | 面板子组件放 `components/`；右侧 tab 定义在 app-store                                       |
| K 线     | `src/components/kline-chart/`                 | 只能渲染真实序列；无数据展示空状态                                                          |
| 新闻阅读 | `src/components/news-reader/`                 | `news-reader` 是覆盖视图，关闭需恢复 previousView                                           |

---

## 7. AI Agent 与投研输出约定

主要入口：

- `electron/services/agent/orchestrator.ts`：聊天请求入口。
- `electron/services/agent/intent-routing.ts`：命令/意图识别。
- `electron/services/agent/dag-executor.ts`：多 Agent 流程执行。
- `electron/services/agent/evidence.ts`：证据链聚合。
- `electron/services/agent/compliance-critic.ts`：合规检查。
- `electron/services/tools/stock-tools.ts`：股票工具。

要求：

- 投研报告必须基于证据链和真实数据源；缺数据要明确“暂无数据/数据源暂不可用”。
- 不得输出确定性买卖指令；必须保留风险提示。
- Emoji 遵守 `.claude/rules/emoji.md`，保持专业金融风格；禁止娱乐化/炒作型 Emoji。
- Agent fallback 文案可以提示数据不可用，但不得生成虚假市场数值。

---

## 8. 新增功能 Checklist

开发全新页面、面板、数据展示、IPC/API 时按以下顺序：

1. **确认数据源**：先查 `stock-sdk` 文档和现有 service/provider；不支持再考虑 `a-stock-data skill`。
2. **确认类型**：优先复用 `src/shared/types.ts` 现有类型；新增类型遵守 `I*` interface / `T*` type 命名。
3. **Service/Provider**：在 `electron/services/**` 实现真实数据逻辑；异步失败路径要暴露并处理。
4. **IPC/Preload/API**：同步 `types.ts` → `stocksense-api.ts` → `preload.cjs` → `ipc.ts`。
5. **Browser fallback**：只能返回空状态/错误状态/加载状态，或真实 API 数据；不得造假。
6. **UI 组件**：放入对应 `src/components/<feature>/`；子组件放 `components/`；主组件加空/错/加载状态。
7. **状态管理**：如需全局状态，扩展 `src/store/app-store.ts`；不得新增状态管理库。
8. **验证**：运行针对性单测/selfcheck/typecheck；说明未运行项和原因。

---

## 9. Bug 修复 Checklist

修 Bug 必须优先定位根因，不得隐藏错误或删除业务逻辑。修改前先回答：

1. Bug 的根因是什么？
2. 为什么会发生？
3. 为什么当前实现失效？
4. 修复是否影响其他功能？
5. 是否引入新的性能问题？
6. 是否改动了需求之外的地方？
7. 是否引入新的问题？

完成后按以下格式说明：

```md
### Root Cause

### Fix

### Impact

### Risk

### Verification
```

修 Bug 优先使用 `stock-fix-bug` skill。

---

## 10. 编码规范速查

### 命名

- 文件/目录：`kebab-case`。
- Interface：`I` + PascalCase。
- Type：`T` + PascalCase。
- Enum：PascalCase。

### 禁止事项

- `any` / `as any` / `as unknown as` / `@ts-ignore` / 降低 tsconfig 严格度。
- React 组件直接请求第三方行情 API。
- 用 `catch { return [] }`、`catch { return null }`、`catch { return {} }` 隐藏错误。
- 用 fallback/mock/fake/preview/demo/sample 数据掩盖数据源失败。
- 为消除 Hook 警告删除依赖项。
- 收到每条行情立即写库。
- 关键列表使用 index/random/频繁变化值作为 key。
- 新增状态管理库。
- 改动需求之外的代码。

### 必须做到

- React Hook 依赖完整，分析闭包和状态同步。
- 异步函数处理失败路径并给出可理解错误/空状态。
- 类型表达业务含义，公共类型放共享位置。
- 未使用 import/变量/函数及时清理。
- 修改公共 API 类型时说明影响范围。

---

## 11. 常用命令

```bash
pnpm dev                         # 启动 Electron 开发模式
pnpm dev:web                     # 启动 Vite 浏览器预览（不得展示假行情）
pnpm test                        # 运行 Vitest
pnpm test:watch                  # Vitest watch
pnpm test:coverage               # 测试覆盖率
pnpm typecheck                   # TS 类型检查：renderer + node
pnpm build                       # typecheck + Vite + Electron build

pnpm selfcheck:market-data        # 市场数据库自检
pnpm selfcheck:market-page        # 行情页自检
pnpm selfcheck:index-kline        # 指数 K 线自检
pnpm selfcheck:board-detail       # 板块详情自检
pnpm selfcheck:chip-distribution  # 筹码分布自检
pnpm selfcheck:market-review      # 市场复盘自检
pnpm selfcheck:discovery-service  # 探索服务自检
pnpm selfcheck:orchestrator       # Agent 编排器自检
pnpm selfcheck:trade-date         # 交易日解析自检
pnpm selfcheck:surge-monitor      # 异动监控自检
pnpm selfcheck:monitor-service    # AI 监控服务自检
pnpm selfcheck:ai-monitor-history # AI 监控历史自检
pnpm selfcheck:news-summary       # 新闻摘要自检
pnpm selfcheck:hot-stock-hints    # 热点股票提示自检
pnpm selfcheck:trading-advice     # 交易建议自检
```

---

## 12. 相关技能

| 技能            | 用途                                                |
| --------------- | --------------------------------------------------- |
| `stock-fix-bug` | Stock Agents Bug 修复：根因定位、最小改动、验证闭环 |
| `a-stock-data`  | `stock-sdk` 不覆盖或不适合时的次级真实数据源能力    |
| `code-review`   | 代码审查                                            |
| `simplify`      | 对已改代码做复用、简化、效率和技术债清理            |
| `klinecharts`   | K 线图表相关实现参考                                |

---

## 13. 历史风险提醒

项目历史上存在过 preview/fallback/hardcoded 数据模式。后续触碰相关文件时不得扩展这些模式，应逐步替换为真实数据源或明确空/错状态：

- `src/shared/stocksense-api.ts`：Browser fallback 必须谨慎，不能加入假行情/假新闻/假榜单。
- `electron/services/stock/stock-client.ts`：不得新增合成行情、合成指数、伪造板块数据。
- `src/components/kline-chart/index.tsx`：不得根据单个价格或涨跌幅生成走势图。
- Agent fallback 文案只能表达数据不可用，不能伪造市场数值。

## 14. 单元测试

- 所写的重点逻辑代码必须有单元测试覆盖。
- 测试代码需放在`__tests__/`目录下`, 文件名以`\*.test.ts`结尾。
- 单元测试的describe和it 都需要使用中文来编写
