# Anomaly Stock Services

> 面向 AI 的快速导航：本目录负责 A 股热点异动、龙虎榜、板块详情、市场复盘、板块热度和异动历史采集。

## 文件职责

| 文件 | 作用 | 主要导出接口 |
| --- | --- | --- |
| `board-detail.ts` | 板块详情聚合入口：解析板块 lookup key、获取成分股、板块 K 线、板块缓存，并为热度板块刷新详情。 | `getBoardDetail()`, `refreshBoardDetailForHeat()`, `resolveBoardDetailLookupKey()`, `getStockBoardMembership()` |
| `board-detail-kline.ts` | 板块/个股 K 线适配与聚合：a-stock-data、百度、远程板块序列、本地成分股聚合。 | `getAStockBoardKline()`, `aggregateRemoteBoardKline()`, `aggregateBaiduBoardKline()`, `aggregateLocalBoardKline()`, `getBaiduStockKline()` |
| `dragon-tiger.ts` | 龙虎榜快照、按日列表、近期交易日和 Fuyao/stock-sdk 数据解析。 | `getDragonTigerSnapshot()`, `listDailyDragonTiger()`, `listDragonTigerByDate()`, `listRecentDragonTigerDays()` |
| `dragon-tiger-seat-detail.ts` | 查询单股指定日期龙虎榜席位明细。 | `getDragonTigerSeatDetails()` |
| `fuyao-dragon-tiger.ts` | Fuyao MCP 龙虎榜适配层，将 Fuyao 结果转换为项目共享类型。 | `loadFuyaoDragonTigerRange()`, `resolveFuyaoMcpConnection()`, `toFuyaoDragonTigerRows()`, `toFuyaoInstitutionRows()` |
| `hithink-board-heat.ts` | 同花顺板块热度、板块目录、行情行和成分股适配。 | `getHithinkBoardHeatSnapshot()`, `toBoardCatalogItems()`, `toMarketBoardRows()`, `getHithinkBoardConstituents()`, `toBoardConstituentRows()` |
| `hot-focus.ts` | 热点关注聚合：热股、异动、资金流、板块快照、东财异动历史和缓存清理。 | `listHotFocus()`, `listStockSurgeEvents()`, `listEastmoneySurgeByDate()`, `getBoardSnapshot()`, `clearSurgeCache()` |
| `hot-stock-hints-service.ts` | 从行情缓存、市场库、涨停/异动历史等来源生成热点股票提示。 | `getHotStockHintSource()`, `listHotStockHintSource()` |
| `market-review-data.ts` | 市场复盘数据小工具。 | `uniqueRowsByCode()` |
| `market-review-service.ts` | 市场复盘与情绪评分，汇总指数、涨跌停、龙虎榜、热点等上下文。 | `getMarketReview()`, `scoreSentiment()` |
| `surge-history-scheduler.ts` | 异动历史后台采集调度、停止和等待。 | `ensureSurgeHistoryCapture()`, `stopSurgeHistoryScheduler()`, `shutdownSurgeHistoryScheduler()`, `isSurgeHistorySchedulerRunning()`, `waitForSurgeHistoryScheduler()` |
| `surge-history-service.ts` | 异动历史查询与缺口回填，本地不足时补真实历史数据。 | `listSurgeHistoryWithBackfill()` |
| `surge-large-order.ts` | 特大单/大单异动过滤和手数解析工具。 | `LARGE_ORDER_MIN_HANDS`, `isLargeOrderLabel()`, `largeOrderHands()`, `isLargeOrderItem()`, `shouldKeepSurgeItem()` |

## 主要调用方

- `stock-detail/stock-client.ts` re-export 热点、龙虎榜、板块详情和异动能力给 IPC / Agent 复用。
- `discovery/discovery-service.ts` 复用市场复盘、龙虎榜、涨跌停、热点题材和异动历史。
- `quotes/board-dashboard.ts` 和 market-data 条件选股会复用板块详情、板块成分股和板块缓存。

## AI 修改注意

- 这里的数据必须来自真实 provider、`stock-sdk`、a-stock-data 或本地真实缓存；禁止用假榜单、假异动或合成板块走势兜底。
- 调整板块字段会影响行情页、探索页、条件选股、Agent 结果卡片和相关测试。
- 调整 scheduler 时同步检查 `app-main.ts` 启停路径，避免后台任务阻塞退出。
