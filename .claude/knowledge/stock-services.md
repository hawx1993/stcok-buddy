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

## 聚合入口

`electron/services/stock/stock-client.ts` 是股票相关 IPC 的主要聚合入口：

| 能力 | 入口 |
| --- | --- |
| 股票解析 | `resolveASymbol()` |
| 非 A 股识别 | `isUnsupportedStockMarketQuery()` |
| 单股行情 | `getQuote()` / `getStockDetail()` |
| 批量行情 | `getBatchQuotes()`，优先批量 `sdk.quotes.cn()`，失败后按单股兜底。 |
| 分时 | `getStockTimelines()` |
| K 线 | `getKline()`，有 in-flight Promise；日线优先本地 DuckDB，后台刷新远程并回写。 |
| 筹码 | `getChipDistribution()`，含 worker / cache。 |
| 板块与行情页 | re-export `getBoardDetail()`、`getMarketPageSnapshot()`、`onMarketPageSnapshotUpdated()`。 |
| 热点/龙虎榜/异动 | `listHotFocus()`、`getDragonTigerSnapshot()`、`listStockSurgeEvents()` 等。 |

注意：K 线和行情回退只能使用真实远程数据或本地真实缓存；没有真实序列时返回空数据/错误状态，不生成合成走势图。

## 行情页

`electron/services/stock/market-page.ts`：

- 提供 `getMarketPageSnapshot(tab, period)`。
- 聚合指数、tab 股票列表、行情页更新时间。
- 通过 `onMarketPageSnapshotUpdated()` 给 `electron/ipc.ts` 转发 `market:pageSnapshotUpdated` push event。
- 前端 `src/components/market-view/index.tsx` 会接收快照并做排序、批量闪烁更新和滚动时延迟重排。

## 探索页

`electron/services/stock/discovery-service.ts`：

- 提供 `getDiscoverySnapshot(options)`。
- 支持 section 级加载：`trade-date-nav`、`hero`、`market-summary`、`opportunity-radar`、`sentiment`、`dragon-tiger`、`hot-rotation`、`limit-up`、`tomorrow`。
- 使用 `discovery_snapshots` 做缓存，区分默认快照、交易日快照、section 快照。
- 依赖市场复盘、涨跌停池、龙虎榜、板块、资金流、收藏股、监控 feed、LLM 摘要等真实数据。
- 历史交易日缺本地数据时应返回明确 loading/unavailable 信息，并触发后台同步；不能拼假榜单。

相关模块：

- `discovery-market-summary.ts`：市场摘要资金流/北向资金等聚合。
- `discovery-hot-themes.ts`：热点题材和本地板块校准。
- `discovery-monthly-themes.ts`：历史涨停池构造月度题材。

## 监控、异动与历史

| 文件 | 职责 |
| --- | --- |
| `monitor-service.ts` | AI 监控 feed、监控分类、看板数据。 |
| `monitor-history-store.ts` | DuckDB `ai_monitor_events` 历史事件存储。 |
| `monitor-history-scheduler.ts` | AI 监控历史采集调度。 |
| `surge-history-store.ts` | DuckDB `stock_surge_events` 异动历史；有队列、批量 flush、清理 marker。 |
| `surge-history-scheduler.ts` | 异动历史采集调度。 |
| `surge-history-service.ts` | `listSurgeHistoryWithBackfill()`，本地不足时回填。 |
| `quote-store.ts` | SQLite 实时行情缓存；应保持批量写入策略。 |

## 板块、新闻、复盘和建议

| 文件 | 职责 |
| --- | --- |
| `board-detail.ts` | 板块详情、成分股、板块 K 线、缓存。 |
| `board-dashboard.ts` / `board-dashboard-utils.ts` | 板块驾驶舱。 |
| `dragon-tiger.ts` | 龙虎榜数据解析/聚合。 |
| `fund-flow.ts` | 个股资金流。 |
| `hot-focus.ts` | 热点、异动、资金流榜。 |
| `market-review-service.ts` / `market-review-data.ts` | 市场复盘数据和情绪评分。 |
| `news-client.ts` | 市场新闻、个股新闻公告、新闻摘要状态。 |
| `northbound-flow.ts` | 沪深港通资金流。 |
| `trading-advice-service.ts` | 交易建议输入聚合与输出。 |
| `schemas.ts` | 数据 schema / 校验。 |
| `symbols.ts` | 股票/板块代码标准化。 |
| `format.ts` | 数值格式化。 |

## 修改注意事项

- 新增股票数据能力时先查 `stock-sdk`，再考虑 a-stock-data。
- UI 不直接请求第三方行情接口；必须走 service/provider。
- 不要在生产 service 中新增 fake/mock/preview/demo/sample 数据。
- 如果要修改公共返回类型，同步 `src/shared/types.ts`、IPC/preload、renderer 调用方和 Agent tool 输出。
- 涉及缓存/批量写库时检查性能：避免逐条写入 SQLite/DuckDB，优先批量和事务。