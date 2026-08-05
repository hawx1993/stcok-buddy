# Frontend Architecture 知识

适用范围：`src/workers`、`src/store`、`src/components`。

## Renderer 数据访问原则

React 组件和 hooks 必须通过 `getStocksenseApi()` 访问数据：

```text
Component / Hook
  ↓
src/shared/stocksense-api.ts
  ↓
window.stocksense [Electron] / browser fallback [空态或错误]
  ↓
preload + IPC + electron services
```

组件不得直接请求东方财富、腾讯、Tushare 等第三方行情接口。浏览器环境只能提供空状态、错误状态、加载状态，或真实可用接口；不能展示伪造行情或示例数据。

## Store

`src/store/app-store.ts` 是聚合导出，不直接保存状态：

- `src/store/app-ui-store.ts`：UI 状态。
- `src/store/app-data-store.ts`：业务数据状态。

### `app-ui-store.ts`

关键类型：

- `MainView = 'chat' | 'market' | 'news-reader' | 'discovery'`
- `RightPanelTab = 'favorites' | 'stock' | 'board' | 'surge' | 'news' | 'ai-monitor'`
- `SidebarTab`、`SidebarMainTab`、`HotSubTab`

关键状态：

- 主视图、右侧栏 tab、左右栏折叠、搜索词。
- 设置/关于/存储管理/数据同步弹层开关。
- `newsReader` 覆盖视图和 `previousView`。
- `syncProgress` 数据同步横幅状态。

### `app-data-store.ts`

关键状态：

- `config`、会话列表、当前会话、响应中的会话 id。
- `messages`、`messageDrafts`、`isSending`。
- 收藏股、`stockKlines`、`selectedStock`、`selectedBoard`。
- 右侧栏返回上下文 `stockReturnContext`、AI 监控返回状态。

关键行为：

- 切换会话时，如果当前会话仍在响应或含 thinking，会把消息草稿保存在 `messageDrafts`。
- `finalizeLastAssistant()` 会合并 runEvents、清除 thinking 并计算处理耗时。
- `applyRunEventToLastAssistant()` 会把 Agent runEvents、steps、toolCalls 合并到最后一条 assistant 消息。
- Agent runEvents 可能包含计划、数据缺口、反思、工具事件和最终结论；UI 层应展示真实状态，不要把缺口补成假结果。
- `setSelectedStock()` 会把缓存的 K 线补回 stock。

## Web Worker

`src/workers/stock-compute.worker.ts` 使用 Comlink 暴露 `IStockComputeApi`：

- `buildKlineData()`：把 `KlinePoint` 转为 klinecharts 的 `KLineData`。
- `mergeKlineData()`：按 timestamp 合并 older/current K 线。
- `parseKlineTimestamp()`：解析日/分钟/兜底 timestamp。
- `buildStockTimelinePath()`：构建个股分时 SVG path、均价线、昨收线、坐标标签。
- `buildFavoriteTimelinePath()`：构建收藏列表小分时 path。
- `prepareChipLayout()`：筹码分布布局宽度预计算。

这些计算放到 worker 是为了避免 K 线、分时、筹码图在 UI 主线程做重计算。修改 worker API 时同步 `stock-compute-types.ts` 和 `stock-compute-client.ts`。

## 主要组件

| 目录 | 职责 | 数据来源 |
| --- | --- | --- |
| `src/components/chat-view/` | AI 对话、slash command、runEvents、计划/反思/数据缺口、结果卡片、市场复盘卡片。 | `getStocksenseApi().sendChat()`、`onChatToken()`、store。 |
| `src/components/market-view/` | 行情页：指数卡片、A 股 tab 表格、龙虎榜、指数 K 线弹层。 | `getMarketPageSnapshot()`、`onMarketPageSnapshotUpdated()`、`getKline()`。 |
| `src/components/discovery-view/` | 探索页：市场摘要、情绪、机会雷达、龙虎榜、热点轮动、涨停复盘、明日关注、监控。 | `getDiscoverySnapshot()`、`getMonitorFeed()`、`getTradingAdvice()`。 |
| `src/components/stock-detail-panel/` | 右侧栏：收藏、个股详情、板块详情、新闻、异动、AI 监控。 | selected stock/board + stocksense API。 |
| `src/components/kline-chart/` | K 线、分时、筹码 overlay、加载更早数据。 | `getKline()`、worker、真实 K 线序列。 |
| `src/components/global-stock-search/` | 全局股票搜索。 | `searchStocks()`。 |
| `src/components/data-sync-modal/` | 数据同步任务启动与进度展示。 | `syncKlines()`、`syncSurgeHistory()`、`syncStockDetails()`、`syncMarketSnapshot()`、`onDataSyncProgress()`、`onMarketDataProgress()`。 |
| `src/components/storage-manager-modal/` | 本地存储统计和清理。 | `storage:*` IPC。 |
| `src/components/settings-modal/` | 设置、模型配置、更新状态。 | config/update IPC。 |
| `src/components/news-reader/` | 新闻阅读覆盖视图。 | `news:getDetail` / store 中的 newsReader。 |

## Discovery section 加载

`src/components/discovery-view/hooks/use-discovery-sections.ts`：

- 维护 section 状态：`idle | loading | loaded | error`。
- 有 4 小时内存缓存，避免页面切换后重复加载。
- `activateSection()` 懒加载 section。
- `selectTradeDate()` 会切换代际、清空请求 id、重置 section，只加载 hero 和 trade-date-nav。
- stale 请求通过 generation/requestId 丢弃，避免旧响应覆盖新状态。

## 数据同步 UI

- K 线同步入口是 `syncKlines()`，返回 `MarketDataSyncStatus`，进度主要来自 `onMarketDataProgress()` 的 `marketData:progress`。
- 异动、个股详情、行情页快照等手动任务入口来自 `dataSync:*`，进度来自 `onDataSyncProgress()` 的 `dataSync:taskProgress`。
- UI 应区分 market-data 同步状态和手动任务进度，不能把某个任务失败解释为所有数据不可用。

## 修改注意事项

- React 组件文件原则上一个主组件；超 400 行应考虑拆分，超 500 行必须拆分。
- 大列表优先复用现有虚拟列表方案或 `@tanstack/react-virtual`。
- Hook 依赖要完整，不要为消除警告删除依赖。
- 图表必须有真实序列才渲染；无数据展示“暂无图表数据”等空态。
- 修改 store 类型时同步测试和调用方，尤其是 chat 响应中 runEvents / thinking / selectedStock。
- 新增 renderer API 时先改 Electron service/IPC/preload/shared types，再在组件中通过 `getStocksenseApi()` 调用。
