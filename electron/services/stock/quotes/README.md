# Quotes Services

> 面向 AI 的快速导航：本目录负责行情页和基础行情能力，包括共享 `stock-sdk` 实例、指数、板块、全市场快照、行业映射、北向资金、板块驾驶舱和 a-stock-data runner。

## 文件职责

| 文件 | 作用 | 主要导出接口 |
| --- | --- | --- |
| `shared.ts` | 行情/板块共享工具：`stock-sdk` 实例、K 线聚合解析、板块缓存、远程板块刷新、东财/stock-sdk 行情行适配。 | `sdk`, `aggregateKline()`, `parseEastmoneyKline()`, `toKlinePoint()`, `getCachedMarketBoardRows()`, `refreshMarketBoardRows()`, `persistMarketBoardRows()`, `toMarketQuoteRow()`, `toMarketBoardRow()` |
| `market-page.ts` | 行情页快照主服务：按 tab/period 聚合指数、股票列表、行业补齐、缓存刷新和 push 订阅。 | `getMarketPageSnapshot()`, `onMarketPageSnapshotUpdated()`, `getMarketQuotes()`, `getAllMarketQuoteRows()`, `refreshQuoteCache()`, `resolveStockIndustry()`, `quoteMatchesTab()` |
| `market-indices.ts` | 市场指数行情和指数 K 线：指数代码标准化、缓存读取、腾讯分钟时间格式化。 | `getMarketIndices()`, `normalizeIndexSymbol()`, `isIndexKlinePeriod()`, `getCachedMarketIndices()`, `fetchMarketIndex()` |
| `market-state.ts` | 市场指数内存缓存状态。 | `marketIndexCache` |
| `industry-provider.ts` | 行业映射加载：Sina 行业映射和申万二级节点查询。 | `loadSinaIndustryMap()`, `findShenwanLevelTwoNodes()` |
| `board-dashboard.ts` | 板块驾驶舱聚合：板块走势、leader、资金/热度/强度评分和区间视图。 | `getBoardDashboard()` |
| `board-dashboard-utils.ts` | 板块驾驶舱纯工具：区间归一化、评分、leader 选择、指标排名和 bucket 分类。 | `normalizeDashboardRange()`, `pickBoardLeaders()`, `rankBoardMetrics()`, `classifyBoardBucket()` |
| `northbound-flow.ts` | 北向/沪深港通资金流摘要和披露状态文案。 | `listNorthboundFlow()`, `buildNorthboundSummary()`, `buildNorthboundNote()`, `isNorthboundNetBuyDisclosed()` |
| `a-stock-data-runner.ts` | Electron runtime 到 a-stock-data 能力的桥接；定义可调用函数名和返回行类型。 | `runAStockDataFn()`, `AStockDataFnName` 及多种 a-stock-data 返回类型 |
| `comlink-node-endpoint.ts` | Node 环境下 Comlink endpoint 适配，供 worker client 使用。 | `nodeEndpoint()` |

## 主要调用方

- `stock-detail/stock-client.ts` re-export 行情页、板块、指数和全市场行情能力。
- `anomaly/board-detail.ts`、`discovery/discovery-service.ts`、market-data 条件选股和 Agent tools 复用 `shared.ts` 的板块缓存/刷新能力。
- `electron/ipc.ts` 通过聚合入口暴露行情页和板块驾驶舱能力。

## AI 修改注意

- `shared.ts` 是高影响文件；修改板块/行情字段前先搜索行情页、探索页、条件选股、Agent 和 selfcheck 调用方。
- `market-indices.ts` 当前存在名为 `fallbackIndices` / `fallbackIndex` 的导出；触碰时必须确认它们只表达真实缓存/错误状态，不得扩展为伪造指数行情。
- 远程失败只能返回错误/空/partial/stale 信息；禁止硬编码领涨板块、假行情或合成指数走势。
