# Market Data Services 知识

适用范围：`electron/services/market-data/**`。

## 职责

market-data 层负责 A 股基础市场数据的本地持久化、查询、同步、质量检查和交易日解析。它是行情页、K 线、探索页、Agent 本地数据查询的重要底座。

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

## 查询层

`electron/services/market-data/market-data-query.ts`：

- `queryHistoricalBars(symbol, options)`：先查 DuckDB；不完整时计算缺失区间，调用 `historicalProviders`（默认 `stockSdkHistoricalProvider`）补齐，过滤无效日线后写回本地。
- `queryLatestQuote(symbol)`：优先远程真实行情；远程失败时只允许回退到本地最近真实行情/收盘数据，并在 meta 中标记 `storage: 'local'`、`freshness: 'stale'`、`isComplete: false` 和 warnings。
- `setHistoricalProvidersForTest()` 仅用于测试替换 provider。

## 同步层

| 文件 | 职责 |
| --- | --- |
| `market-data-sync.ts` | 同步状态机、当前任务、强制同步冷却、取消、失败重试、历史 backfill 排队。 |
| `market-data-sync-worker-client.ts` | 主线程到 worker 的桥接；退出时需要 `disposeMarketDataSyncWorker()`。 |
| `market-data-sync-worker-types.ts` | worker 输入输出类型。 |
| `market-data-sync.worker.ts` | 实际执行 recent/historical/repair 同步。 |
| `market-data-sync-plan.ts` | 同步计划构建。 |
| `data-sync-handlers.ts` | UI 手动触发的数据同步任务，如 K 线、异动历史、个股详情、市场快照。 |
| `market-data-scheduler.ts` | Electron 运行时启动同步、停止同步和 worker shutdown。 |
| `market-cap-screener.ts` | 基于本地行情/市值快照做 A 股筛选。 |
| `market-news-summary-scheduler.ts` | 市场新闻摘要调度状态相关能力。 |

`startMarketDataSync(force)` 的注意点：

- 手动强制同步有 12 小时冷却，避免上游限频。
- 已有同步进行时，非 force 复用当前 Promise；force 会等待当前同步结束后再排队。
- 失败会更新 memory status 并继续抛错，调用方需要处理。
- `onMarketDataProgress()` 会把状态转发到 `marketData:progress`。

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

## Provider、质量与交易日

- `providers.ts`：封装 stock-sdk provider、远程行情状态、交易日/日线/完整行情读取。
- `quality.ts`：如 `partitionValidDailyBars()`，把 provider 返回的日线分成 valid/invalid。
- `trade-date-resolver.ts`：按交易日和时间阈值解析目标交易日。

## 修改注意事项

- 禁止收到每条行情立即写库；优先批量、事务、队列、worker。
- 生产查询不能用假数据补齐。远程和本地都没有数据时，返回空状态/错误状态或带 warnings 的不完整结果。
- 本地 stale 数据只能标记为过期/不完整，不能在 UI 或 Agent 报告里当作实时行情。
- 修改表结构时要考虑已有本地库的兼容迁移，优先使用 `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 风格。
- 修改同步状态类型时同步 `src/shared/types.ts`、IPC、前端 data sync UI。
- 涉及 provider 时先确认 `stock-sdk` 能力；不支持时再考虑 a-stock-data。
