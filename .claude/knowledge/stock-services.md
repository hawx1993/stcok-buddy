# Stock Services 知识

适用范围：`electron/services/stock/**` 的业务服务、真实数据适配、调度和 worker，以及由其使用的 `electron/services/stock-db/**` 持久化实现。

## 当前目录分层

`electron/services/stock/**` 已按业务域拆分；不要再把新能力默认塞回旧的扁平根目录。

| 子目录 | 职责 | 代表文件 |
| --- | --- | --- |
| `stock-detail/` | 股票解析、个股行情详情、K 线、分时、指标、新闻、资金流、交易建议和展示字段整理。 | `stock-client.ts`、`symbols.ts`、`format.ts`、`indicators.ts`、`fund-flow.ts`、`news-client.ts`、`stock-rating.ts`、`trading-advice-service.ts` |
| `quotes/` | stock-sdk 实例、板块/指数/行情页快照、市场状态、行业映射、a-stock-data runner 和 worker endpoint。 | `shared.ts`、`market-page.ts`、`market-indices.ts`、`market-state.ts`、`industry-provider.ts`、`board-dashboard.ts`、`northbound-flow.ts`、`a-stock-data-runner.ts` |
| `anomaly/` | 龙虎榜、热点异动、市场复盘、同花顺板块热度、异动历史调度和特大单解析。 | `hot-focus.ts`、`dragon-tiger.ts`、`dragon-tiger-seat-detail.ts`、`market-review-service.ts`、`market-review-data.ts`、`surge-history-scheduler.ts`、`surge-history-service.ts`、`surge-large-order.ts`、`hithink-board-heat.ts` |
| `discovery/` | 探索页快照、热点题材、月度题材、市场摘要。 | `discovery-service.ts`、`discovery-hot-themes.ts`、`discovery-market-summary.ts`、`discovery-monthly-themes.ts` |
| `monitor/` | AI 监控 feed 与监控历史采集调度。 | `monitor-service.ts`、`monitor-history-scheduler.ts` |
| `chip-distribution/` | 筹码分布计算、provider、worker client 和 worker。 | `chip-distribution-provider.ts`、`chip-distribution.ts`、`chip-distribution-worker-client.ts`、`chip-distribution.worker.ts` |

stock 服务层聚合股票、行情页、探索页、板块、新闻、热点、异动、监控、交易建议等真实数据能力。它是 renderer API、Agent tools、market-data 本地库和 DataCoverage 补齐链路之间的主要业务层。

## 通用工具与 SDK

`electron/services/stock/quotes/shared.ts`：

- 创建共享 `stock-sdk` 实例：`new StockSDK({ timeout: 12_000, retry: { maxRetries: 1 } })`。
- 提供 K 线聚合：`aggregateKline()`、`aggregateKlineByWeek()`、`aggregateKlineByMonth()`。
- 提供 K 线解析：`parseEastmoneyKline()`、`parseMarketTime()`、`toKlinePoint()`。
- 维护板块缓存：`marketBoardsCache`、`boardKindCache`、`searchBoardNameCache`。
- 提供板块行缓存读取和刷新：`getCachedMarketBoardRows()`、`refreshMarketBoardRows()`。
- `refreshMarketBoardRows()` 是真实板块行情刷新入口，也被条件选股在本地板块目录为空时用作远程真实兜底。
- 修改这里会影响行情页、板块详情、探索页、条件选股、market-data 全市场快照和 Agent 工具。

相关辅助：

- `stock-detail/symbols.ts`：股票/板块代码标准化、市场推断。
- `stock-detail/format.ts`：数值格式化、字段读取和市值归一化。
- `stock-detail/schemas.ts`：数据 schema / 校验。
- `quotes/a-stock-data-runner.ts`：服务层调用 a-stock-data 能力的桥接入口。
- `stock-detail/stock-rating.ts`：将行情和派生数据整理为个股详情评级/展示字段。
- `quotes/comlink-node-endpoint.ts`：market-data worker / hydration worker 复用的 Node endpoint。

## 聚合入口

`electron/services/stock/stock-detail/stock-client.ts` 是股票相关 IPC 的主要聚合入口；`electron/ipc.ts` 仍主要从这里导入个股和部分聚合能力。

| 能力 | 入口 |
| --- | --- |
| 股票解析 | `resolveASymbol()` |
| 非 A 股识别 | `isUnsupportedStockMarketQuery()` |
| 单股行情 | `getQuote()` / `getStockDetail()`，底层走 `queryLatestQuote()`。 |
| 批量行情 | `getBatchQuotes()`，优先批量 `sdk.quotes.cn()`，失败后按单股兜底。 |
| 分时 | `getStockTimelines()`，按 `STOCK_TIMELINE_CONCURRENCY = 4` 分批请求 `stock-sdk`。 |
| K 线 | `getKline()`，有 in-flight Promise；日线优先本地 DuckDB，后台刷新远程并回写。 |
| 筹码 | `getChipDistribution()` 通过 `chip-distribution/` provider / worker / cache 获取；DataCoverage 和条件选股后台补齐也会复用此真实入口。 |
| 板块与行情页 | re-export `getBoardDetail()`、`getMarketPageSnapshot()`、`getAllMarketQuoteRows()`、`onMarketPageSnapshotUpdated()`。真实实现分别在 `anomaly/board-detail.ts` 与 `quotes/market-page.ts`。 |
| 热点/龙虎榜/异动 | `listHotFocus()`、`getDragonTigerSnapshot()`、`listStockSurgeEvents()`、`listDragonTigerByDate()`、`listEastmoneySurgeByDate()` 等聚合导出，底层在 `anomaly/**`。 |
| 本地缓存 | `clearSurgeCache()`；quote、market、monitor、surge 的物理读写由 `stock-db/**` 下层 store 处理。 |

注意：K 线和行情回退只能使用真实远程数据或本地真实缓存；没有真实序列时返回空数据/错误状态，不生成合成走势图。

## 行情页、指数与板块缓存

`electron/services/stock/quotes/market-page.ts`：

- 提供 `getMarketPageSnapshot(tab, period)`。
- 聚合指数、tab 股票列表、行情页更新时间。
- 通过 `onMarketPageSnapshotUpdated()` 给 `electron/ipc.ts` 转发 `market:pageSnapshotUpdated` push event。
- 行情行会结合本地 `securities` 行业、Sina/stock-sdk 行业成分、东财行业字段做行业补齐。
- `getAllMarketQuoteRows()`、`refreshQuoteCache()` 可被 stock service、Agent 或同步任务复用。
- 前端 `src/components/market-view/index.tsx` 会接收快照并做排序、批量闪烁更新和滚动时延迟重排。

相关模块：

- `quotes/market-indices.ts`：市场指数读取、指数代码标准化、指数 K 线时间处理。
- `quotes/market-state.ts`：市场状态/指数缓存。
- `quotes/industry-provider.ts`：行业映射加载。
- `quotes/board-dashboard.ts` / `quotes/board-dashboard-utils.ts`：板块驾驶舱，IPC 为 `board:getDashboard`。
- `quotes/northbound-flow.ts`：沪深港通资金流。

板块真实数据边界：

- `quotes/shared.ts` 的 `refreshMarketBoardRows()` 负责刷新 stock-sdk 真实板块行情，不应替换成硬编码领涨板块。
- `anomaly/board-detail.ts` 的 `getBoardDetail()` 是板块成分股和板块 K 线真实入口；条件选股缺少本地 `board_constituents` 时会复用它获取成分股。
- `anomaly/board-detail-kline.ts` 负责板块 K 线聚合与 a-stock-data / 本地 / 远程序列适配。
- `market-data/condition-screener-sina-board-provider.ts` 可通过 a-stock-data 新浪板块排行和成分股补齐领涨板块条件；这仍是 provider/service 层能力，不能在 UI 或 Agent 文案中伪造板块。
- 板块列表、板块详情、板块驾驶舱和条件选股共享板块缓存；改返回字段时要同步 market-data 条件选股类型和测试。

## 探索页

`electron/services/stock/discovery/discovery-service.ts`：

- 提供 `getDiscoverySnapshot(options)`。
- 支持 section 级加载：`trade-date-nav`、`hero`、`market-summary`、`opportunity-radar`、`sentiment`、`dragon-tiger`、`hot-rotation`、`limit-up`、`tomorrow`。
- 使用 `discovery_snapshots` 做缓存，区分默认快照、交易日快照、section 快照。
- 有内存级 promise 去重：默认快照、section 快照、交易日 review context 会复用进行中的 Promise。
- 依赖市场复盘、涨跌停池、龙虎榜、板块、资金流、收藏股、监控 feed、LLM 摘要等真实数据。
- 历史交易日缺本地数据时应返回明确 loading/unavailable 信息，并触发后台同步；不能拼假榜单。

相关模块：

- `discovery/discovery-market-summary.ts`：市场摘要资金流/北向资金等聚合。
- `discovery/discovery-hot-themes.ts`：热点题材 leader 合并和本地板块校准。
- `discovery/discovery-monthly-themes.ts`：基于历史涨停池构造月度题材。
- `anomaly/market-review-service.ts` / `anomaly/market-review-data.ts`：市场复盘数据和情绪评分。
- `anomaly/hot-stock-hints-service.ts`：热点股票提示来源。

## Discovery 生命周期

- `DISCOVERY_CACHE_TTL_MS` 控制默认快照短缓存。
- `DISCOVERY_HISTORICAL_SECTION_CACHE_TTL_MS` 控制历史 section 缓存。
- `DISCOVERY_WAITING_930_MESSAGE` 用于盘前等待 9:30 更新提示。
- `DISCOVERY_HISTORY_LOADING_MESSAGE` 用于历史交易日本地数据缺失、后台同步中的提示。
- `stopDiscoveryRefreshLoop()` 会在 `app-main.ts` 退出和更新安装前调用，避免后台刷新影响退出。

修改 Discovery 时要同步：

1. `src/shared/types.ts` 的 `TDiscoverySnapshotSection` / `IDiscoverySnapshotOptions`（如新增 section）。
2. `discovery/discovery-service.ts` 的 section 构建、缓存 key、fallback/unavailable 文案。
3. `src/components/discovery-view/**` 的 section UI、hooks、空态/错态。
4. `selfcheck:discovery-service` 或相关测试。

## 监控、异动与历史

| 文件 | 职责 |
| --- | --- |
| `monitor/monitor-service.ts` | AI 监控 feed、监控分类、看板数据。 |
| `stock-db/monitor-history-store.ts` | DuckDB `ai_monitor_events` 历史事件存储。 |
| `monitor/monitor-history-scheduler.ts` | AI 监控历史采集调度；`app-main.ts` 启动，退出前停止并等待。 |
| `stock-db/surge-history-store.ts` | DuckDB `stock_surge_events` 异动历史；有队列、批量 flush、清理 marker。 |
| `anomaly/surge-history-scheduler.ts` | 异动历史采集调度；热点/异动入口会确保采集启动。 |
| `anomaly/surge-history-service.ts` | `listSurgeHistoryWithBackfill()`，本地不足时回填。 |
| `anomaly/surge-large-order.ts` | 个股异动/特大单相关数据整理。 |
| `stock-db/quote-store.ts` | SQLite 实时行情缓存；应保持批量写入策略。 |

手动同步异动历史由 `market-data/data-sync-handlers.ts` 的 `syncSurgeHistory()` 触发：先清理 surge clear marker，再同步今日异动快照和近 7 日个股异动历史，最后恢复后台 scheduler。

## 板块、新闻、复盘和建议

| 文件 | 职责 |
| --- | --- |
| `anomaly/board-detail.ts` | 板块详情、成分股、板块 K 线、缓存。 |
| `anomaly/board-detail-kline.ts` | 板块 K 线本地/远程/a-stock-data 适配与聚合。 |
| `quotes/board-dashboard.ts` / `quotes/board-dashboard-utils.ts` | 板块驾驶舱，IPC 为 `board:getDashboard`。 |
| `anomaly/dragon-tiger.ts` / `anomaly/dragon-tiger-seat-detail.ts` / `anomaly/fuyao-dragon-tiger.ts` | 龙虎榜数据解析、席位详情和 Fuyao 数据适配。 |
| `stock-detail/fund-flow.ts` | 个股资金流。 |
| `anomaly/hot-focus.ts` | 热点、异动、资金流榜。 |
| `anomaly/hithink-board-heat.ts` | 同花顺板块热度和成分股补齐。 |
| `anomaly/market-review-service.ts` / `anomaly/market-review-data.ts` | 市场复盘数据和情绪评分。 |
| `stock-detail/news-client.ts` | 市场新闻、个股新闻公告、新闻摘要状态和新闻详情。 |
| `quotes/northbound-flow.ts` | 沪深港通资金流。 |
| `stock-detail/trading-advice-service.ts` | 交易建议输入聚合与输出。 |

## 筹码分布

`electron/services/stock/chip-distribution/**` 是当前筹码能力归属：

- `chip-distribution-provider.ts` 提供对外 `getChipDistribution()`，优先使用真实缓存，必要时刷新真实数据。
- `chip-distribution.ts` 负责筹码计算、缓存行和展示结果转换。
- `chip-distribution-worker-client.ts` / `chip-distribution.worker.ts` 负责 worker 计算与生命周期；`app-main.ts` 退出清理会调用 `disposeChipDistributionWorker()`。
- `market-data/condition-screener-service.ts` 和 `agents/data-coverage-agent.ts` 都会复用该 provider；失败只能形成 warnings / data gap，不能补假筹码。

## 与 market-data / Agent 的交叉点

- `market-data/market-snapshot-provider.ts` 复用 `stock/quotes/shared.ts` 的 `sdk` 获取全市场快照，并通过 `quotes/a-stock-data-runner.ts` 补齐缺失行情字段。
- `market-data/condition-screener-service.ts` 复用 `quotes/shared.ts` 的 `refreshMarketBoardRows()`、`anomaly/board-detail.ts` 的 `getBoardDetail()` 和 `chip-distribution/chip-distribution-provider.ts` 的 `getChipDistribution()`，但筛选结果仍由 market-data 层负责整合和返回。
- `agents/data-coverage-agent.ts` 复用 `chip-distribution/chip-distribution-provider.ts` 的 `getChipDistribution()` 批量补齐筹码缓存；该行为只允许补真实筹码，失败要返回 warnings 或日志。
- Agent 工具读取 stock service 结果时，必须保留 source、freshness、warnings、isComplete 等元信息，不能在 Agent 层改写成“实时已验证”。

## 修改注意事项

- 新增股票数据能力时先查 `stock-sdk`，再考虑 a-stock-data。
- UI 不直接请求第三方行情接口；必须走 service/provider。
- 不要在生产 service 中新增 fake/mock/preview/demo/sample 数据。
- 如果要修改公共返回类型，同步 `src/shared/types.ts`、IPC/preload、renderer 调用方和 Agent tool 输出。
- 涉及缓存/批量写库时检查性能：避免逐条写入 SQLite/DuckDB，优先批量和事务。
- 图表、分时、K 线、板块榜单、新闻摘要都必须基于真实序列/真实接口；失败时展示空态、错态或数据源不可用。
- 修改板块刷新、筹码分布或批量行情时，要检查条件选股、超短线选股、DataCoverage 和探索页是否共用该入口。
- 修改 stock 子目录之间的 re-export 时，要同步 `electron/ipc.ts`、Agent tools、market-data imports 和自检文件，避免旧 `stock/<file>.ts` 路径回流。
