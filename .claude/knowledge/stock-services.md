# Stock Services 知识

适用范围：`electron/services/stock/**`。

## 职责

stock 服务层聚合股票、行情页、探索页、板块、新闻、热点、异动、监控、交易建议等真实数据能力。它是 renderer API、Agent tools 和 market-data 本地库之间的主要业务层。

## 通用工具与 SDK

`electron/services/stock/shared.ts`：

- 创建 `stock-sdk` 实例：`new StockSDK({ timeout: 12_000, retry: { maxRetries: 1 } })`。
- 提供 K 线聚合：`aggregateKline()`、`aggregateKlineByWeek()`、`aggregateKlineByMonth()`。
- 提供 K 线解析：`parseEastmoneyKline()`、`parseMarketTime()`、`toKlinePoint()`。
- 维护板块缓存：`marketBoardsCache`、`boardKindCache`、`searchBoardNameCache`。
- 提供板块行缓存读取和刷新：`getCachedMarketBoardRows()`、`refreshMarketBoardRows()`。
- 修改这里会影响行情页、板块详情、探索页和 Agent 工具。

相关辅助：

- `symbols.ts`：股票/板块代码标准化、市场推断。
- `format.ts`：数值格式化。
- `schemas.ts`：数据 schema / 校验。
- `a-stock-data-runner.ts`：服务层调用 a-stock-data 能力的桥接入口。
- `stock-rating.ts`：将行情和派生数据整理为个股详情评级/展示字段。

## 聚合入口

`electron/services/stock/stock-client.ts` 是股票相关 IPC 的主要聚合入口：

| 能力 | 入口 |
| --- | --- |
| 股票解析 | `resolveASymbol()` |
| 非 A 股识别 | `isUnsupportedStockMarketQuery()` |
| 单股行情 | `getQuote()` / `getStockDetail()`，底层走 `queryLatestQuote()`。 |
| 批量行情 | `getBatchQuotes()`，优先批量 `sdk.quotes.cn()`，失败后按单股兜底。 |
| 分时 | `getStockTimelines()`，按 `STOCK_TIMELINE_CONCURRENCY = 4` 分批请求 `stock-sdk`。 |
| K 线 | `getKline()`，有 in-flight Promise；日线优先本地 DuckDB，后台刷新远程并回写。 |
| 筹码 | `getChipDistribution()`，含 worker / cache。 |
| 板块与行情页 | re-export `getBoardDetail()`、`getMarketPageSnapshot()`、`getAllMarketQuoteRows()`、`onMarketPageSnapshotUpdated()`。 |
| 热点/龙虎榜/异动 | `listHotFocus()`、`getDragonTigerSnapshot()`、`listStockSurgeEvents()`、`listDragonTigerByDate()`、`listEastmoneySurgeByDate()` 等。 |
| 本地缓存 | `clearSurgeCache()`、quote-store / DuckDB 读写由下层 service 处理。 |

注意：K 线和行情回退只能使用真实远程数据或本地真实缓存；没有真实序列时返回空数据/错误状态，不生成合成走势图。

## 行情页

`electron/services/stock/market-page.ts`：

- 提供 `getMarketPageSnapshot(tab, period)`。
- 聚合指数、tab 股票列表、行情页更新时间。
- 通过 `onMarketPageSnapshotUpdated()` 给 `electron/ipc.ts` 转发 `market:pageSnapshotUpdated` push event。
- 行情行会结合本地 `securities` 行业、Sina/stock-sdk 行业成分、东财行业字段做行业补齐。
- `getAllMarketQuoteRows()`、`refreshQuoteCache()` 可被 stock service、Agent 或同步任务复用。
- 前端 `src/components/market-view/index.tsx` 会接收快照并做排序、批量闪烁更新和滚动时延迟重排。

相关模块：

- `market-indices.ts`：市场指数读取、指数代码标准化、指数 K 线时间处理。
- `market-state.ts`：市场状态/指数缓存。
- `industry-provider.ts`：行业映射加载。

## 探索页

`electron/services/stock/discovery-service.ts`：

- 提供 `getDiscoverySnapshot(options)`。
- 支持 section 级加载：`trade-date-nav`、`hero`、`market-summary`、`opportunity-radar`、`sentiment`、`dragon-tiger`、`hot-rotation`、`limit-up`、`tomorrow`。
- 使用 `discovery_snapshots` 做缓存，区分默认快照、交易日快照、section 快照。
- 有内存级 promise 去重：默认快照、section 快照、交易日 review context 会复用进行中的 Promise。
- 依赖市场复盘、涨跌停池、龙虎榜、板块、资金流、收藏股、监控 feed、LLM 摘要等真实数据。
- 历史交易日缺本地数据时应返回明确 loading/unavailable 信息，并触发后台同步；不能拼假榜单。

相关模块：

- `discovery-market-summary.ts`：市场摘要资金流/北向资金等聚合。
- `discovery-hot-themes.ts`：热点题材 leader 合并和本地板块校准。
- `discovery-monthly-themes.ts`：基于历史涨停池构造月度题材。
- `market-review-service.ts` / `market-review-data.ts`：市场复盘数据和情绪评分。
- `hot-stock-hints-service.ts`：热点股票提示来源。

## Discovery 生命周期

- `DISCOVERY_CACHE_TTL_MS` 控制默认快照短缓存。
- `DISCOVERY_HISTORICAL_SECTION_CACHE_TTL_MS` 控制历史 section 缓存。
- `DISCOVERY_WAITING_930_MESSAGE` 用于盘前等待 9:30 更新提示。
- `DISCOVERY_HISTORY_LOADING_MESSAGE` 用于历史交易日本地数据缺失、后台同步中的提示。
- `stopDiscoveryRefreshLoop()` 会在 `main.ts` 退出和更新安装前调用，避免后台刷新影响退出。

修改 Discovery 时要同步：

1. `src/shared/types.ts` 的 `TDiscoverySnapshotSection` / `IDiscoverySnapshotOptions`（如新增 section）。
2. `discovery-service.ts` 的 section 构建、缓存 key、fallback/unavailable 文案。
3. `src/components/discovery-view/**` 的 section UI、hooks、空态/错态。
4. `selfcheck:discovery-service` 或相关测试。

## 监控、异动与历史

| 文件 | 职责 |
| --- | --- |
| `monitor-service.ts` | AI 监控 feed、监控分类、看板数据。 |
| `monitor-history-store.ts` | DuckDB `ai_monitor_events` 历史事件存储。 |
| `monitor-history-scheduler.ts` | AI 监控历史采集调度；`main.ts` 启动，退出前停止并等待。 |
| `surge-history-store.ts` | DuckDB `stock_surge_events` 异动历史；有队列、批量 flush、清理 marker。 |
| `surge-history-scheduler.ts` | 异动历史采集调度；热点/异动入口会确保采集启动。 |
| `surge-history-service.ts` | `listSurgeHistoryWithBackfill()`，本地不足时回填。 |
| `surge-large-order.ts` | 个股异动/特大单相关数据整理。 |
| `quote-store.ts` | SQLite 实时行情缓存；应保持批量写入策略。 |

手动同步异动历史由 `market-data/data-sync-handlers.ts` 的 `syncSurgeHistory()` 触发：先清理 surge clear marker，再同步今日异动快照和近 7 日个股异动历史，最后恢复后台 scheduler。

## 板块、新闻、复盘和建议

| 文件 | 职责 |
| --- | --- |
| `board-detail.ts` | 板块详情、成分股、板块 K 线、缓存。 |
| `board-dashboard.ts` / `board-dashboard-utils.ts` | 板块驾驶舱，IPC 为 `board:getDashboard`。 |
| `dragon-tiger.ts` | 龙虎榜数据解析/聚合，IPC 为 `dragonTiger:getSnapshot`。 |
| `fund-flow.ts` | 个股资金流。 |
| `hot-focus.ts` | 热点、异动、资金流榜。 |
| `market-review-service.ts` / `market-review-data.ts` | 市场复盘数据和情绪评分。 |
| `news-client.ts` | 市场新闻、个股新闻公告、新闻摘要状态和新闻详情。 |
| `northbound-flow.ts` | 沪深港通资金流。 |
| `trading-advice-service.ts` | 交易建议输入聚合与输出。 |

## 修改注意事项

- 新增股票数据能力时先查 `stock-sdk`，再考虑 a-stock-data。
- UI 不直接请求第三方行情接口；必须走 service/provider。
- 不要在生产 service 中新增 fake/mock/preview/demo/sample 数据。
- 如果要修改公共返回类型，同步 `src/shared/types.ts`、IPC/preload、renderer 调用方和 Agent tool 输出。
- 涉及缓存/批量写库时检查性能：避免逐条写入 SQLite/DuckDB，优先批量和事务。
- 图表、分时、K 线、板块榜单、新闻摘要都必须基于真实序列/真实接口；失败时展示空态、错态或数据源不可用。
