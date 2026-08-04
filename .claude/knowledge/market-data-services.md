# Market Data Services 知识

适用范围：`electron/services/market-data/**`。

## 职责

market-data 层负责 A 股基础市场数据的本地持久化、查询、同步、质量检查和交易日解析。它是行情页、K 线、探索页、Agent 本地数据查询的重要底座。

## 数据库

`electron/services/market-data/market-data-store.ts` 使用 DuckDB：

- 默认路径来自 `app.getPath('userData')`，开发环境为 `stocksense-market-dev.duckdb`，打包环境为 `stocksense-market.duckdb`。
- 可通过 `STOCKSENSE_MARKET_DB_PATH` 覆盖。
- `writeQueue` 串行化写操作，避免并发写库冲突。
- `resetMarketDataStore()` / `closeMarketDataStore()` 需要正确处理 DuckDB 实例生命周期。

代表表：

| 表 | 用途 |
| --- | --- |
| `securities` | A 股证券主表。 |
| `trade_calendar` | 交易日历。 |
| `daily_bars` | 日线 K 线，主键为 `symbol + trade_date + adjust_type`。 |
| `sync_jobs` | 同步任务状态。 |
| `sync_failures` | 同步失败明细和重试信息。 |
| `market_board_snapshots` | 行情/板块快照 JSON。 |
| `discovery_snapshots` | 探索页快照缓存。 |
| `board_dashboard_snapshots` | 板块驾驶舱快照缓存。 |
| `stock_chips` | 筹码分布缓存。 |
| `stock_snapshots` | 个股行情快照。 |
| `market_board_details` | 板块详情缓存。 |
| `stock_fund_flow_daily` | 个股日资金流。 |
| `market_boards` | 板块列表。 |
| `board_constituents` | 板块成分股。 |

## 查询层

`electron/services/market-data/market-data-query.ts`：

- `queryHistoricalBars(symbol, options)`：先查 DuckDB；不完整时计算缺失区间，调用 `historicalProviders`（默认 `stockSdkHistoricalProvider`）补齐，过滤无效日线后写回本地。
- `queryLatestQuote(symbol)`：优先远程真实行情；远程失败时只允许回退到本地最近交易日收盘价，并在 meta 中标记 `storage: 'local'`、`freshness: 'stale'`、`isComplete: false` 和 warnings。
- `setHistoricalProvidersForTest()` 仅用于测试替换 provider。

## 同步层

| 文件 | 职责 |
| --- | --- |
| `market-data-sync.ts` | 同步状态机、当前任务、强制同步冷却、取消、失败重试、历史 backfill 排队。 |
| `market-data-sync-worker-client.ts` | 主线程到 worker 的桥接。 |
| `market-data-sync-worker-types.ts` | worker 输入输出类型。 |
| `market-data-sync.worker.ts` | 实际执行 recent/historical/repair 同步。 |
| `market-data-sync-plan.ts` | 同步计划构建。 |
| `data-sync-handlers.ts` | UI 手动触发的数据同步任务，如 K 线、异动历史、个股详情、市场快照。 |
| `market-data-scheduler.ts` | Electron 运行时定时/启动同步。 |

`startMarketDataSync(force)` 的注意点：

- 手动强制同步有 12 小时冷却，避免上游限频。
- 已有同步进行时，非 force 复用当前 Promise；force 会等待当前同步结束后再排队。
- 失败会更新 memory status 并继续抛错，调用方需要处理。

## Provider、质量与交易日

- `providers.ts`：封装 stock-sdk provider、远程行情状态、交易日/日线/完整行情读取。
- `quality.ts`：如 `partitionValidDailyBars()`，把 provider 返回的日线分成 valid/invalid。
- `trade-date-resolver.ts`：按交易日和时间阈值解析目标交易日。

## 修改注意事项

- 禁止收到每条行情立即写库；优先批量、事务、队列、worker。
- 生产查询不能用假数据补齐。远程和本地都没有数据时，返回空状态/错误状态或带 warnings 的不完整结果。
- 修改表结构时要考虑已有本地库的兼容迁移，优先使用 `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 风格。
- 修改同步状态类型时同步 `src/shared/types.ts`、IPC、前端 data sync UI。
- 涉及 provider 时先确认 `stock-sdk` 能力；不支持时再考虑 a-stock-data。