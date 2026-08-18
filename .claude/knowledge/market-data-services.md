# Market Data Services 知识

适用范围：`electron/services/market-data/**`。

## 职责

market-data 层负责 A 股基础市场数据的本地持久化、查询、同步、质量检查、交易日解析、全市场快照和条件筛选。它是行情页、K 线、探索页、Agent 本地数据查询、条件选股和超短线选股的重要底座。

## 数据库

`electron/services/market-data/market-data-store.ts` 使用 DuckDB：

- 默认路径来自 `app.getPath('userData')`，开发环境为 `stocksense-market-dev.duckdb`，打包环境为 `stocksense-market.duckdb`。
- 可通过 `STOCKSENSE_MARKET_DB_PATH` 覆盖。
- `writeQueue` 串行化写操作，避免并发写库冲突。
- `resetMarketDataStore()` / `closeMarketDataStore()` / `closeMarketDataInstance()` 需要正确处理 DuckDB 实例生命周期。
- 存储管理清空本地行情库后，`dbReady` 会重新创建，避免继续指向已关闭实例。

代表表：

| 表 | 用途 |
| --- | --- |
| `securities` | A 股证券主表，含交易所、上市状态、行业、ST 标记。 |
| `trade_calendar` | 交易日历。 |
| `daily_bars` | 日线 K 线，主键为 `symbol + trade_date + adjust_type`。 |
| `sync_jobs` | 同步任务状态、目标交易日、处理数量和 checkpoint。 |
| `sync_failures` | 同步失败明细和重试信息。 |
| `market_board_snapshots` | 行情/板块快照 JSON。 |
| `discovery_snapshots` | 探索页默认、交易日、section 快照缓存。 |
| `board_dashboard_snapshots` | 板块驾驶舱快照缓存。 |
| `stock_chips` | 筹码分布缓存。 |
| `stock_snapshots` | 个股行情快照，含价格、成交、PE/PB、市值、振幅等字段。 |
| `market_board_details` | 板块详情缓存。 |
| `stock_fund_flow_daily` | 个股日资金流。 |
| `market_boards` | 板块列表和板块成交额。 |
| `board_constituents` | 板块成分股。 |

## 常用查询与统计 helper

`market-data-store.ts` 中常用能力：

- `listDailyBars(symbol, options)` / `getLatestDailyBar(symbol)`：读取单只股票日 K。
- `getLatestDailyBarsBySymbols(symbols, adjustType)`：批量读取每只股票最新日 K 交易日；用于同步 worker 避免逐只串行查 DuckDB。
- `listLatestMarketRows()` / `listAShareMarketCapSnapshotRows()`：读取全市场最新行情快照或市值筛选候选行。
- `listStockSnapshots(limit)` / `upsertStockSnapshots(records)`：读取和写入 `stock_snapshots`。
- `listStockChips(limit)` / `upsertStockChip(symbol, data)`：读取和写入筹码缓存。
- `getMarketDataStats()`：证券数、日 K 总数、最新交易日、最新同步失败数和数据库大小。
- `countDistinctDailyBarSymbols(daysBack)`：统计最近 N 天内有 qfq 日 K 的 symbol 数，默认最近 60 天。
- `countStockSnapshots()` / `countStockChips()`：统计快照和筹码缓存覆盖度。

这些统计用于 DataCoverage 和同步状态，不代表数据实时性；报告中需要结合 `freshness`、`latestTradeDate` 和 warnings 判断。

## 查询层

`electron/services/market-data/market-data-query.ts`：

- `queryHistoricalBars(symbol, options)`：先查 DuckDB；不完整时计算缺失区间，调用 `historicalProviders`（默认 `stockSdkHistoricalProvider`）补齐，过滤无效日线后写回本地。
- `queryLatestQuote(symbol)`：优先远程真实行情；远程失败时只允许回退到本地最近真实行情/收盘数据，并在 meta 中标记 `storage: 'local'`、`freshness: 'stale'`、`isComplete: false` 和 warnings。
- `setHistoricalProvidersForTest()` 仅用于测试替换 provider。

## Provider 与全市场快照

| 文件 | 职责 |
| --- | --- |
| `providers.ts` | 封装 stock-sdk provider、远程行情状态、交易日/日线/完整行情读取；历史请求并发由 `HISTORICAL_REQUEST_CONCURRENCY` 控制。 |
| `market-snapshot-provider.ts` | 获取全市场或指定代码行情快照；优先 `stock-sdk`，缺字段时可用 a-stock-data 补齐。 |
| `quality.ts` | 如 `partitionValidDailyBars()`，把 provider 返回的日线分成 valid/invalid。 |
| `trade-date-resolver.ts` | 按交易日和时间阈值解析目标交易日。 |

`market-snapshot-provider.ts` 注意：

- `fetchStockSdkAllMarketSnapshotQuotes()` 走 `sdk.batch.cn({ batchSize: 500, concurrency: 6 })`。
- `fetchStockSdkMarketSnapshotQuotes(codes)` 走 `sdk.batch.byCodes()`。
- `fetchAStockDataMarketSnapshotQuotes(codes)` 通过 `runAStockDataFn('tencent_quote')` 按 100 只一批补齐。
- `IMarketSnapshotQuoteRecord.amount` 单位为“万”，`totalMarketCap` / `circulatingMarketCap` 单位为“亿”；进入条件筛选时再转换为元。
- provider 失败必须返回 warnings 或抛错给调用方处理，不能提供假快照。

## 同步层

| 文件 | 职责 |
| --- | --- |
| `market-data-sync.ts` | 同步状态机、当前任务、强制同步冷却、取消、失败重试、历史 backfill 排队；提供 Agent 专用的立即同步入口。 |
| `market-data-sync-worker-client.ts` | 主线程到 worker 的桥接；退出时需要 `disposeMarketDataSyncWorker()`。 |
| `market-data-sync-worker-types.ts` | worker 输入输出类型。 |
| `market-data-sync.worker.ts` | 实际执行 recent/historical/repair 同步。 |
| `market-data-sync-plan.ts` | 同步计划构建。 |
| `data-sync-handlers.ts` | UI 手动触发的数据同步任务，如 K 线、异动历史、个股详情、市场快照。 |
| `market-data-scheduler.ts` | Electron 运行时启动同步、停止同步和 worker shutdown。 |
| `market-cap-screener.ts` | 基于本地行情/市值快照做 A 股筛选。 |
| `condition-screener-service.ts` | 条件选股真实数据服务，供 Agent 工具 `screenASharesByConditions` 使用。 |
| `condition-screener-board-provider.ts` | 条件选股的今日领涨板块范围：本地板块优先，stock-sdk 真实板块其次，a-stock-data 新浪板块兜底。 |
| `condition-screener-sina-board-provider.ts` | a-stock-data 新浪板块排行和成分股适配，用于补齐领涨板块条件。 |
| `condition-screener-types.ts` | 条件选股输入、输出、候选和数据源类型。 |
| `market-news-summary-scheduler.ts` | 市场新闻摘要调度状态相关能力。 |

`startMarketDataSync(force)` 的注意点：

- 手动强制同步有 12 小时冷却，避免上游限频。
- 已有同步进行时，非 force 复用当前 Promise；force 会等待当前同步结束后再排队。
- 失败会更新 memory status 并继续抛错，调用方需要处理。
- `onMarketDataProgress()` 会把状态转发到 `marketData:progress`。

`runImmediateMarketDataSync(onProgress?)` 的注意点：

- 仅用于 Agent DataCoverage 在本地日 K 覆盖度不足时自动补齐。
- 不检查 12 小时强制同步冷却，但仍复用/等待当前 `currentSync`，避免并发同步和并发写 DuckDB。
- 会把 `onMarketDataProgress()` 转成调用方传入的进度回调，用完必须取消订阅。
- 不能从 UI 手动入口随意调用，避免绕过限频保护。

`market-data-sync.worker.ts` 当前同步策略：

- 日 K 同步并发为 `SYNC_CONCURRENCY = 20`，批次大小为 `SYNC_BATCH_SIZE = 10`。
- 同步窗口开始时用 `getLatestDailyBarsBySymbols()` 一次性预取目标股票的本地最新交易日，减少逐只读取 DuckDB。
- 每批内并发拉取真实日 K，使用 `partitionValidDailyBars()` 过滤无效记录，再整批 `upsertDailyBars()`，减少事务次数。
- 批量写入失败时，该批相关 symbol 记录到 `sync_failures`，不能把失败写入算作成功。
- repair 流程也会批量读取 latest local bars，再对失败 symbol 增量补齐。

## 条件选股服务

`screenASharesByConditions(input)` 位于 `condition-screener-service.ts`，用于 `/condition-screener` 的确定性筛选：

1. `normalizeInput()` 规整市值、换手率、成交额、涨幅、筹码、领涨板块、排序和 limit。
2. 先读取本地 DuckDB 候选：`listAShareMarketCapSnapshotRows()`。
3. 调用 `fetchStockSdkAllMarketSnapshotQuotes()` 获取全市场当前行情；若本地候选为空，用 stock-sdk 快照创建候选并回写 `stock_snapshots` / `securities`。
4. 对缺少必要行情字段的候选，用 `fetchAStockDataMarketSnapshotQuotes()` 补齐，结果仍会尝试回写 DuckDB。
5. 如启用 `leadingBoards`，调用 `loadConditionScreenerLeadingBoardScope()`：先读 `market_boards`；本地无可用领涨板块时调用 `refreshMarketBoardRows()` 获取 stock-sdk 真实板块；仍无有效板块时再走 `fetchConditionScreenerSinaBoards()` 的 a-stock-data 新浪板块排行；取涨幅 Top 5。
6. 领涨板块成分股优先读本地 `board_constituents`，其次 `getBoardDetail()`；若板块来源为 a-stock-data 新浪，则调用 `fetchConditionScreenerSinaConstituents()` 批量获取成分股。
7. 如启用筹码条件，仅读取本地 `stock_chips` 完成本轮筛选；缺筹码的股票不纳入当前命中，并后台补齐前 20 只缺失候选。
7. 输出 `sourceStats`、`warnings`、`isComplete`、`freshness`、`storage`、`leadingBoards` 和命中行，供 Agent 数据状态和证据使用。

注意：

- `rows.length === 0` 不一定是数据缺口；当 `isComplete === true` 且无 warnings 时表示真实条件交集为空。
- 含筹码条件时，本轮只基于已落库真实筹码判断；后台补齐不能改变当前结果，只供下次查询使用。
- 板块条件缺本地/远程真实板块或成分股时应返回 warnings，不能扩大到全市场假装已筛选。

## Agent 本地筛选工具关联

- `screenASharesByConditions`：调用 `condition-screener-service.ts`，用于 slash 命令的确定性条件选股。
- `screenASharesByMarketCap`：调用 `market-cap-screener.ts`，支持总市值/流通市值和换手率范围。
- `screenLocalAStocks`：位于 `electron/services/agent/tools/screen-local-a-stocks.ts`，只读本地 `listLatestMarketRows()`、`listStockChips()`、`getMarketDataStats()` 做超短线宽筛。
- `data-coverage-agent.ts` 会在相关 Agent 节点前调用覆盖度统计与补齐，避免选股时只覆盖少量股票。

## 运行时与调度

`electron/services/market-data/market-data-scheduler.ts`：

- `ensureMarketDataRuntime()` 先 `initializeMarketDataStore()`，再 `startMarketDataScheduler()`。
- 初始自动同步延迟为 `INITIAL_SYNC_DELAY_MS = 15_000`。
- `shouldAutoSyncMarketData()` 在最新成功目标交易日缺失、成功数量为 0、日期无效，或超过 `STALE_DAILY_BAR_DAYS = 31` 天时返回 true。
- `stopMarketDataScheduler()` 会设置 stopped、请求同步停止并清理 timer。
- `shutdownMarketDataScheduler()` 会停止 scheduler，并调用 `disposeMarketDataSyncWorker()`。
- `main.ts` 启动时会异步 `ensureMarketDataRuntime()`，退出/更新安装前会停止或 shutdown scheduler。

## `marketData:*` 与 `dataSync:*`

- `marketData:ensureReady`：确保 DuckDB 和运行时就绪。
- `marketData:getStatus` / `marketData:startSync` / `marketData:retryFailures` / `marketData:cancelSync` / `marketData:getStats`：市场数据同步和统计 API。
- `marketData:progress`：`MarketDataSyncStatus` push event。
- `dataSync:syncKlines`：renderer 手动同步 K 线入口，内部根据当前状态调用 `startMarketDataSync(false/true)`。
- `dataSync:syncSurgeHistory`：同步今日异动快照和近 7 日个股异动历史，个股历史并发为 2。
- `dataSync:syncStockDetails`：读取 `securities` 中 listed 股票，按 80 只一批调用 `stock-sdk` 批量行情并写入 `stock_snapshots`。
- `dataSync:syncSnapshot`：同步行情页快照，覆盖 `sh-main`、`sz-main`、`bj`、`gem`、`star`。
- `dataSync:taskProgress`：手动任务进度；当前 taskType 包括 `surge`、`stockDetail`、`marketSnapshot`。

## 修改注意事项

- 禁止收到每条行情立即写库；优先批量、事务、队列、worker。
- 生产查询不能用假数据补齐。远程和本地都没有数据时，返回空状态/错误状态或带 warnings 的不完整结果。
- 本地 stale 数据只能标记为过期/不完整，不能在 UI 或 Agent 报告里当作实时行情。
- 修改表结构时要考虑已有本地库的兼容迁移，优先使用 `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 风格。
- 修改同步状态类型时同步 `src/shared/types.ts`、IPC、前端 data sync UI。
- 涉及 provider 时先确认 `stock-sdk` 能力；不支持时再考虑 a-stock-data。
- 调整同步并发、批次大小或立即同步入口时，要同时检查上游限频、DuckDB 写入队列和 UI/Agent 进度事件。
- 条件选股或本地筛选新增字段时，同步 `condition-screener-types.ts`、Agent tool schema、解析器、结果卡片和测试。
