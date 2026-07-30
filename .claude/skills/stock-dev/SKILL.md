---
name: stock-dev
description: StockBuddy 项目开发导航。覆盖 DuckDB 数据、stock-sdk 用法、a-stock-data 用法、项目 API、IPC 通道、编码规范。
argument-hint: '[开发任务描述]'
---

# StockBuddy 开发技能

> 本技能是项目的开发导航和速查手册。每次开发新功能、修改数据层、或接入数据源前，先查阅本技能。

---

## 1. 规则优先级

开始编码前必须阅读 `.claude/rules/` 下的规则文件，优先级从高到低：

| 优先级 | 规则文件 | 适用场景 |
|--------|---------|---------|
| 1 | `.claude/rules/typescript-react.md` | 所有 TS/TSX/React 代码 |
| 2 | `.claude/rules/data.md` | 行情、数据访问、存储 |
| 3 | `.claude/rules/emoji.md` | AI 投研输出、文案 |
| 4 | `.claude/rules/bug-fix.md` | 修 Bug |

核心原则：
- **禁止 any / @ts-ignore / as any** — 类型错误必须修正类型，不得绕过
- **禁止 Mock 数据** — 生产 UI/API 不得使用 fake/mock/preview/demo/sample 数据
- **数据流必须走 Provider 层** — UI → Service → Provider → Data Source，组件不得直接请求第三方接口
- **禁止浮点数做金融计算** — 金额计算必须用整数（分）或 Decimal
- **文件命名 kebab-case** — 目录和文件名小写+连字符

---

## 2. 项目架构

```
src/                              ← React 渲染进程
  app.tsx                         ← 主布局，view router
  store/app-store.ts              ← Zustand 全局状态
  shared/stocksense-api.ts        ← 数据访问门面（Electron: window.stocksense → IPC）
  shared/types.ts                 ← 全部共享类型定义
  components/
    sidebar/                      ← 左侧栏（会话列表、行情入口）
    chat-view/                    ← 聊天区（AI 对话）
    market-view/                  ← 行情区（指数卡片 + 股票表格）
    news-reader/                  ← 新闻阅读器
    stock-detail-panel/           ← 右侧栏（个股/板块/异动/新闻）
    kline-chart/                  ← K 线图表

electron/                         ← Electron 主进程
  ipc.ts                          ← 全部 IPC handler 注册
  services/
    stock/                        ← 股票数据服务
      stock-client.ts             ← 核心股票数据客户端（K线、行情、搜索、筹码）
      shared.ts                   ← 共享工具 + StockSDK 实例
      fund-flow.ts                ← 资金流数据
      hot-focus.ts                ← 热点/异动/龙虎榜
      market-page.ts              ← 行情页数据快照
      market-indices.ts           ← 指数行情
      market-review-service.ts    ← 市场复盘报告生成
      board-detail.ts             ← 板块详情
      chip-distribution.ts        ← 筹码分布计算
      indicators.ts               ← 技术指标分析
      symbols.ts                  ← 股票代码标准化
      format.ts                   ← 数值格式化
    market-data/                  ← DuckDB 市场数据持久层
      market-data-store.ts        ← DuckDB 表定义 + CRUD
      market-data-query.ts        ← 查询入口（本地优先 + 远程补齐）
      market-data-sync.ts         ← K线数据同步调度
      market-data-scheduler.ts    ← 同步计划
      trade-date-resolver.ts      ← 交易日判定
    agent/                        ← AI Agent 系统
      orchestrator.ts             ← Agent 编排器
      analysis-agent.ts           ← 技术分析 Agent
      data-agent.ts               ← 数据获取 Agent
      report-agent.ts             ← 报告生成 Agent
      news-analysis-agent.ts      ← 新闻分析 Agent
      stock-analysis-agents.ts    ← 股票分析 Agent 组
      agent-tool-runtime.ts       ← Agent 工具运行时
    tools/                        ← Agent Tools
      stock-tools.ts              ← 股票相关 Tools
      tool-registry.ts            ← Tool 注册表
    llm/                          ← LLM 客户端
```

### MainView 路由

`src/app.tsx:148` — 当前支持的 3 个主视图：

```tsx
{mainView === 'news-reader' ? <NewsReader /> : mainView === 'market' ? <MarketView /> : <ChatView />}
```

| MainView | 组件 | 说明 |
|----------|------|------|
| `'chat'` | `<ChatView />` | 默认视图，AI 对话 |
| `'market'` | `<MarketView />` | 行情表格 |
| `'news-reader'` | `<NewsReader />` | 新闻详情（覆盖层，退出时恢复 previousView） |

新增视图需要：修改 `MainView` 类型在 `app-store.ts:20`，在 `app.tsx:148` 添加分支。

---

## 3. DuckDB 数据库（15 张表）

### 3.1 行情市场库 `stocksense-market.duckdb`

**文件**: `electron/services/market-data/market-data-store.ts`

| 表名 | 用途 | 关键列 |
|------|------|--------|
| `securities` | A 股证券主表 | symbol(PK), name, exchange(SH/SZ/BJ), industry, is_st |
| `trade_calendar` | 交易日历 | market+trade_date(PK), is_open, previous/next_trade_date |
| `daily_bars` | 日线 K 线（最大表） | symbol+trade_date+adjust_type(PK), OHLCV, amount, turnover_rate |
| `sync_jobs` | 同步任务记录 | id(PK), job_type, status, progress counters |
| `sync_failures` | 同步失败详情 | job_id+symbol+stage(PK), error_message, retry_count |
| `market_board_snapshots` | 板块快照 JSON | snapshot_key(PK), rows_json |
| `stock_chips` | 筹码分布缓存 | symbol(PK), data_json |
| `stock_snapshots` | 实时行情快照 | symbol(PK), price/change/pe/pb/market_cap 等 |
| `market_board_details` | 板块详情缓存 | board_code(PK), detail_json |
| `market_boards` | 板块列表 | board_code(PK), name, kind(industry/concept), change_percent |
| `board_constituents` | 板块成分股 | board_code+stock_code(PK), stock_name, position |

### 3.2 异动库 `stocksense-surge.duckdb`

**文件**: `electron/services/stock/surge-history-store.ts`

| 表名 | 用途 | 关键列 |
|------|------|--------|
| `stock_surge_events` | 异动事件历史 | trade_date, code, name, title, tag(涨停/跌停/炸板/强势) |

### 3.3 聊天库 `stocksense-chat.sqlite` (SQLite)

| 表名 | 用途 | 关键列 |
|------|------|--------|
| `conversations` | 会话列表 | id(PK), title, preview, updated_at |
| `messages` | 聊天消息 | id(PK), conversation_id(FK), payload(JSON) |

### 3.4 行情缓存库 `stocksense-quotes.sqlite` (SQLite)

| 表名 | 用途 | 关键列 |
|------|------|--------|
| `stock_quote` | 实时行情缓存 | code(PK), price, change_percent, volume, amount 等 |

### 关键读写函数

```ts
// 从 market-data-store 导入
import { listDailyBars, upsertDailyBars, upsertSecurities,
         upsertStockSnapshots, readBoardSnapshot, writeBoardSnapshot,
         upsertMarketBoards, getStockChip, upsertStockChip } from './market-data-store.js';

// 查询入口（本地优先 + 远程补齐）
import { queryHistoricalBars, queryLatestQuote } from './market-data-query.js';
```

---

## 4. stock-sdk 用法

### 4.1 SDK 实例化

```ts
// Electron 主进程（shared.ts）
import StockSDK from 'stock-sdk';
export const sdk = new StockSDK({ timeout: 12_000, retry: { maxRetries: 1 } });
```

### 4.2 项目中实际使用的 14 个 SDK 方法

| SDK 方法 | 使用位置 | 用途 |
|----------|---------|------|
| `sdk.search(keyword)` | `stock-client.ts:64` | 股票/板块模糊搜索 |
| `sdk.quotes.cn(codes)` | `stock-client.ts:99` | A 股批量实时行情 |
| `sdk.kline.cn(symbol, opts)` | `stock-client.ts:246` | A 股 K 线（日/周/月，含复权） |
| `sdk.chips.cn(symbol, opts)` | `stock-client.ts:859` | 筹码分布 |
| `sdk.board.industry` | `shared.ts:169` | 行业板块列表 |
| `sdk.board.concept` | `shared.ts:169` | 概念板块列表 |
| `sdk.board.industry.getList()` | 板块扫描 | 行业板块成分股 |
| `sdk.board.concept.getList()` | 板块扫描 | 概念板块成分股 |
| `sdk.fundFlow.individual(symbol, opts)` | `fund-flow.ts:12` | 个股资金流 |
| `sdk.fundFlow.market(opts)` | `hot-focus.ts` | 市场资金流排名 |
| `sdk.fundFlow.rank(opts)` | `hot-focus.ts` | 资金流排名 |
| `sdk.fundFlow.sectorRank(opts)` | `hot-focus.ts`, `stocksense-api.ts` | 板块资金流排名 |
| `sdk.marketEvent.individualChanges(symbol, opts)` | `fund-flow.ts:29` | 个股异动事件 |
| `sdk.marketEvent.individualChangesHistory(symbol, date)` | `hot-focus.ts` | 个股异动历史 |
| `sdk.marketEvent.stockChanges(type)` | `hot-focus.ts`, `stocksense-api.ts` | 全市场异动 |
| `sdk.codes.cn()` | `stock-client.ts` | A 股代码列表 |
| `sdk.calendar.isTradingDay(date)` | `stocksense-api.ts:231` | 判定交易日 |
| `sdk.calendar.prevTradingDay(date)` | `stocksense-api.ts:232` | 上一个交易日 |

### 4.3 MCP 工具（stock-sdk MCP server）

通过 MCP 协议在 Claude Code 中可直接调用的工具（参数略有不同）：

| MCP Tool | 对应 SDK 方法 | 说明 |
|----------|-------------|------|
| `get_a_share_quotes` | `sdk.quotes.cn` | 批量行情 |
| `get_history_kline` | `sdk.kline.cn` | 历史 K 线 |
| `get_minute_kline` | — | 分钟 K 线/分时 |
| `get_chip_distribution` | `sdk.chips.cn` | 筹码分布 |
| `get_concept_list` | `sdk.board.concept` | 概念板块 |
| `get_industry_list` | `sdk.board.industry` | 行业板块 |
| `get_concept_constituents` | — | 概念板块成分股 |
| `get_industry_constituents` | — | 行业板块成分股 |
| `get_dragon_tiger_detail` | — | 龙虎榜 |
| `get_zt_pool` | — | 涨停池 |
| `get_fund_flow_rank` | `sdk.fundFlow.rank` | 资金流排名 |
| `get_individual_fund_flow` | `sdk.fundFlow.individual` | 个股资金流 |
| `get_market_status` | — | 市场状态（盘中/盘后/休市） |
| `get_northbound_flow_summary` | — | 北向资金汇总 |
| `get_kline_signals` | — | 技术信号（金叉/死叉等） |
| `get_kline_with_indicators` | — | 带技术指标的 K 线 |
| `get_today_timeline` | — | 当日分时 |
| `get_hk_quotes` | — | 港股行情 |
| `get_us_quotes` | — | 美股行情 |
| `search` | `sdk.search` | 搜索 |
| `is_trading_day` | `sdk.calendar.isTradingDay` | 交易日判定 |

### 4.4 最佳实践

- **批量优先**：`sdk.quotes.cn(codes[])` 一次传多只股票，比逐个查快得多
- **并发控制**：同一参数的 K 线请求会共享 Promise（`klineInFlight` Map）
- **超时处理**：SDK 自带 12s 超时 + 1 次重试；额外用 `withTimeoutReject` 做外层保护
- **Fallback 链**：腾讯 → stock-sdk → 东方财富，每层有超时兜底

---

## 5. a-stock-data 用法

### 5.1 定位

`a-stock-data` 是项目中作为 **降级 fallback 数据源** 使用的 skill。当 stock-sdk 不可用或数据为空时，使用 a-stock-data 的数据源补充。

### 5.2 实际使用场景

**场景 1: 资金流降级** (`fund-flow.ts`)
```
stock-sdk fundFlow.individual → 东财 push2his（a-stock-data 日级）→ 东财 push2（a-stock-data 分钟级）
```

**场景 2: 筹码分布降级** (`stock-client.ts:864`)
```
stock-sdk chips.cn → a-stock-data 百度日K（本地 CYQ 算法计算）
```

**场景 3: K 线降级** (`stock-client.ts:253`)
```
腾讯 → stock-sdk → 东财 push2his
```

**场景 4: 搜索降级** (`stock-client.ts:583`)
```
stock-sdk search → 板块/行情缓存 → 东财 suggest API
```

**场景 5: 异动/热点** (`hot-focus.ts`)
```
stock-sdk marketEvent → 东财异动接口 → local DB cache
```

### 5.3 使用原则

- a-stock-data **总是作为 fallback**，不优先于 stock-sdk
- 所有东财直接 HTTP 请求视为 a-stock-data 能力
- 降级获取的数据需在 `warnings` 字段中标明来源

---

## 6. IPC 通道速查

**文件**: `electron/ipc.ts`

### 6.1 配置与会话

| Channel | Handler |
|---------|---------|
| `config:get` | 获取配置 |
| `config:set` | 保存配置 |
| `config:testModel` | 测试 LLM 连接 |
| `conversation:list/create/delete/rename` | 会话 CRUD |
| `message:list/save` | 消息读写 |
| `chat:send` | 发送聊天消息（核心 AI 入口） |
| `chat:token` | SSE token 推送（main → renderer） |

### 6.2 股票数据（最常用）

| Channel | Handler | 说明 |
|---------|---------|------|
| `stock:getDetail` | `getStockDetail(symbol)` | 个股详情（含本地 K 线） |
| `stock:search` | `searchStocks(query)` | 搜索股票/板块 |
| `stock:getKline` | `getKline(symbol, limit, period)` | K 线（本地优先） |
| `stock:getChipDistribution` | `getChipDistribution(symbol)` | 筹码分布 |
| `stock:getBatchQuotes` | `getBatchQuotes(codes)` | 批量行情 |
| `board:getDetail` | `getBoardDetail(symbol)` | 板块详情 |
| `market:getPageSnapshot` | `getMarketPageSnapshot(tab, period)` | 行情页快照 |

### 6.3 热点/异动

| Channel | Handler |
|---------|---------|
| `hot:list` | `listHotFocus(tab)` — tab: 'sector'/'market'/'surge'/'strategy'/'diagnosis'/'flow' |
| `hot:hintSource` | `listHotStockHintSource()` |
| `hot:historyDates` | `listSurgeDates()` |
| `hot:history` | `listSurgeHistoryWithBackfill(date)` |
| `stock:surgeEvents` | `listStockSurgeEvents(code)` |

### 6.4 数据同步

| Channel | Handler |
|---------|---------|
| `marketData:getStatus` | 同步状态 |
| `marketData:startSync` | 启动 K 线同步 |
| `marketData:cancelSync` | 取消同步 |
| `marketData:getStats` | 数据库统计 |
| `dataSync:syncKlines` | 强制 K 线同步 |
| `dataSync:syncSurgeHistory` | 异动历史同步 |
| `dataSync:syncStockDetails` | 个股详情同步 |
| `dataSync:syncSnapshot` | 行情快照同步 |

### 6.5 Push 事件（main → renderer）

| Channel | 数据 |
|---------|------|
| `market:pageSnapshotUpdated` | 行情页实时更新 |
| `marketData:progress` | 同步进度 |
| `appUpdate:stateChanged` | 更新状态变更 |
| `notification:aiResponse` | AI 回复完成通知 |
| `storage:clearProgress` | 清理进度 |

---

## 7. stocksenseApi 接口速查

**文件**: `src/shared/stocksense-api.ts`
**类型**: `src/shared/types.ts` → `StocksenseApi`

### 配置与收藏
- `getConfig()` / `setConfig(config)`
- `listFavoriteStocks()` / `upsertFavoriteStock(stock)` / `removeFavoriteStock(code)`
- `toggleFavoriteStockPin(code)`

### 会话与消息
- `listConversations()` / `createConversation()` / `deleteConversation(id)` / `renameConversation(id, title)`
- `listMessages(conversationId)` / `saveMessage(conversationId, message)`
- `sendChat(request)` — 核心聊天接口

### 股票数据
- `getStockDetail(symbol)` → `StockDetail`
- `searchStocks(query)` → `MarketSearchResult[]`
- `getKline(symbol, limit?, period?, beforeTimestamp?)` → `KlinePoint[]`
- `getChipDistribution(symbol)` → `IChipDistributionResult`
- `getBatchQuotes(codes)` → `StockDetail[]`
- `getBoardDetail(symbol, forceRefresh?, boardName?)` → `BoardDetail`

### 行情页
- `getMarketPageSnapshot(tab, period?)` → `MarketPageSnapshot`
- `onMarketPageSnapshotUpdated(callback)` — 订阅实时更新

### 热点
- `listHotFocus(tab)` → `HotFocusItem[]`
- `listSurgeHistoryDates()` → `string[]`
- `listSurgeHistory(date, offset?, limit?)` → `StockSurgeEvent[]`
- `listStockSurgeEvents(code)` → `StockSurgeEvent[]`

### 新闻
- `listMarketNews(query?, page?, pageSize?)` → `PagedMarketNews`
- `getMarketNewsSummaryState()` → `IMarketNewsSummaryState`
- `getMarketNewsItem(item)` → `MarketNewsItem`
- `listStockNews(code, limit)` → `MarketNewsItem[]`
- `listStockNewsFeed()` → `StockNewsFeedItem[]`

---

## 8. 新增功能 Checklist

当开发一个全新的页面/面板/数据展示功能时，按以下步骤检查：

1. **类型定义** → `src/shared/types.ts` 新增接口/类型
2. **API 接口声明** → `stocksense-api.ts` 的 `StocksenseApi` 接口中新增方法声明
3. **浏览器 Fallback** → 同一文件 `webFallbackApi` 中实现返回空/错误状态的方法
4. **Electron 服务** → `electron/services/stock/` 实现真实数据获取逻辑
5. **IPC Handler** → `electron/ipc.ts` 注册 `ipcMain.handle('xxx:yyy', ...)` 通道
6. **渲染进程组件** → `src/components/<feature>/` 创建组件，通过 `getStocksenseApi()` 调用数据
7. **路由/入口** → 在 `app.tsx` 或 sidebar 中添加入口
8. **App Store** → 如需全局状态，在 `app-store.ts` 中扩展

### 数据流标准模式

```
React Component
  ↓ getStocksenseApi().someMethod()
stocksenseApi (门面)
  ↓ window.stocksense.someMethod()  [Electron] 或 fallback [Browser]
IPC (contextBridge)
  ↓ ipcMain.handle('channel:method', handler)
Electron Service
  ↓ stock-sdk / DuckDB / 东财 HTTP / LLM
Data Source
```

---

## 9. 编码规范速查

### 文件与命名
- 文件/目录: `kebab-case`
- Interface: `I` + PascalCase
- Type: `T` + PascalCase
- Enum: PascalCase

### 组件约束
- 单文件 ≤ 400 行
- 子组件放 `components/` 子目录
- 大列表用虚拟化（`react-virtualized`）
- 复杂逻辑抽 hook（≤ 300 行）

### 禁止事项
- `any` / `as any` / `as unknown as` / `@ts-ignore`
- 组件直接请求第三方 API
- 收到每条行情立刻写库（应批量 15-30s）
- 浮点数做金融计算
- mock/fake/preview/demo/sample 数据进入生产代码
- 新增状态管理库（只用 zustand）
- 改动需求之外的东西

### 必须遵守
- `pnpm typecheck` 通过（`tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json`）
- React Hook 依赖完整
- 异步函数处理失败路径
- 列表 key 稳定（非 index/random）

---

## 10. 常用命令

```bash
pnpm dev                    # 启动 Electron 开发模式
pnpm build                  # 构建（含 typecheck）
pnpm typecheck              # TS 类型检查
pnpm selfcheck:market-data  # 行情数据库自检
pnpm selfcheck:market-page  # 行情页自检
pnpm selfcheck:chip-distribution  # 筹码分布自检
pnpm selfcheck:surge-monitor     # 异动监控自检
```

---

## 11. 相关技能

| 技能 | 用途 |
|------|------|
| `stock-fix-bug` | Bug 修复（强制根因定位流程） |
| `stock-deep-analyzer:*` | 深度股票分析（22 维 + 评委面板 + Bloomberg 报告） |
| `code-review` | 代码审查 |
| `ponytail:*` | 简洁代码审查/技术债审计 |
