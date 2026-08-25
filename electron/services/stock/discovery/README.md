# Discovery Services

> 面向 AI 的快速导航：本目录负责探索页数据快照，包括交易日导航、市场摘要、机会雷达、情绪、龙虎榜、热点轮动、涨停池和次日/下周方向。

## 文件职责

| 文件 | 作用 | 主要导出接口 |
| --- | --- | --- |
| `discovery-service.ts` | 探索页主聚合服务：section 级加载、交易日快照缓存、历史快照、等待 9:30 状态、后台刷新和测试导出。 | `getDiscoverySnapshot()`, `ensureRecentDiscoverySnapshots()`, `stopDiscoveryRefreshLoop()`, `DISCOVERY_CACHE_TTL_MS`, `DISCOVERY_WAITING_930_MESSAGE` |
| `discovery-hot-themes.ts` | 热点题材 leader 合并，并用本地板块目录校准题材名称/代码。 | `mergeHotThemeLeaders()`, `reconcileHotThemeWithLocalBoard()` |
| `discovery-market-summary.ts` | 市场摘要资金流工具：选择最新主力资金流、汇总北向资金。 | `selectLatestMainFundFlowYi()`, `sumNorthFundFlowYi()` |
| `discovery-monthly-themes.ts` | 基于历史涨停池构建月度题材，统一板块 lookup 名称。 | `normalizeBoardLookupName()`, `buildMonthlyThemesFromHistoricalPools()` |

## 主要接口与类型

- `getDiscoverySnapshot(options)`：探索页主入口，支持 section 级加载和历史交易日。
- `IDiscoverySnapshotOptions` / `IDiscoverySnapshot`：探索页请求参数与返回快照类型。
- `IOpportunityRadar`, `IMarketSummary`, `ISectorSummary`, `IMonthlyThemeItem`, `INextWeekSector`：探索页内部/共享结果结构。

## 数据来源

- 复用 `anomaly/market-review-service.ts`、龙虎榜、异动历史、涨跌停池、板块缓存、资金流、收藏股和监控 feed。
- 使用 `discovery_snapshots` 做缓存；历史交易日本地数据不足时返回 loading/unavailable，并触发后台同步。

## AI 修改注意

- 新增 section 时同步 `src/shared/types.ts`、renderer discovery UI、缓存 key 和 selfcheck/test。
- 历史交易日缺数据时不能拼假榜单或假题材，只能返回明确状态。
- `discovery-service.ts` 很大，优先把新增纯逻辑放入相邻 helper 文件并补定向测试。
