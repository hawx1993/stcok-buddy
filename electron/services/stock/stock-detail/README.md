# Stock Detail Services

> 面向 AI 的快速导航：本目录负责个股层能力，是许多 IPC 和 Agent 股票查询的聚合入口。涵盖代码解析、行情详情、批量行情、分时、K 线、技术指标、新闻、资金流、评级和交易建议。

## 文件职责

| 文件 | 作用 | 主要导出接口 |
| --- | --- | --- |
| `stock-client.ts` | 个股服务主聚合入口：解析股票、单股/批量行情、分时、K 线、搜索、详情、技术分析，并 re-export 板块、行情页、热点、龙虎榜和筹码能力。 | `resolveASymbol()`, `getQuote()`, `getBatchQuotes()`, `getStockTimelines()`, `getKline()`, `searchStocks()`, `getStockDetail()`, `analyzeTechnical()` |
| `symbols.ts` | 股票代码候选提取、A 股代码标准化、quote symbol 转换和交易所推断。 | `extractSymbolCandidate()`, `normalizeASymbol()`, `toQuoteSymbol()`, `inferExchange()` |
| `format.ts` | 通用数值/百分比/金额格式化与字段读取。 | `formatNumber()`, `formatPercent()`, `pickNumber()`, `pickString()`, `formatMoney()`, `formatMoneyFromWan()`, `formatPercentPoints()`, `normalizeMarketCap()` |
| `schemas.ts` | zod 输入 schema。 | `SymbolInputSchema`, `KlineOptionsSchema` |
| `indicators.ts` | 基于 K 线指标结果生成技术分析摘要。 | `analyzeIndicators()` |
| `stock-rating.ts` | 将行情和派生数据整理为个股详情展示字段和评级。 | `toStockDetail()`, `deriveStockRating()`, `StockRating` |
| `search-result-enrichment.ts` | 搜索结果与行情指标合并，判断搜索行指标完整性。 | `hasCompleteSearchStockMetrics()`, `mergeSearchStockQuoteMetrics()`, `TStockSearchRow` |
| `fund-flow.ts` | 个股资金流快照与周度主力净流入。 | `getStockFundFlowSnapshot()`, `getStockWeeklyMainNetInflow()` |
| `news-client.ts` | 市场新闻、个股新闻/公告、新闻详情、新闻摘要刷新和文章转文本。 | `listMarketNews()`, `getMarketNewsItem()`, `getMarketNewsDetail()`, `getMarketNewsSummaryState()`, `ensureMarketNewsSummaryState()`, `refreshMarketNewsSummary()`, `listStockNewsFeed()`, `listStockNewsAnnouncements()`, `articleToText()` |
| `trading-advice-service.ts` | 交易建议聚合服务：整合市场复盘、探索页、个股数据、板块 leader，并调用 LLM 生成建议。 | `getTradingAdvice()`, `reconcileAdviceLeaderStocks()` |

## Re-export 能力

`stock-client.ts` 还向外转发这些子域能力，便于 IPC / Agent 使用统一入口：

- 板块与行情页：`getBoardDetail()`, `getMarketPageSnapshot()`, `getAllMarketQuoteRows()`, `onMarketPageSnapshotUpdated()`
- 资金流与筹码：`getStockFundFlowSnapshot()`, `getChipDistribution()`
- 热点/异动/龙虎榜：`listHotFocus()`, `listStockSurgeEvents()`, `listEastmoneySurgeByDate()`, `getBoardSnapshot()`, `getDragonTigerSnapshot()`, `listDailyDragonTiger()`, `listDragonTigerByDate()`, `listRecentDragonTigerDays()`

## AI 修改注意

- `stock-client.ts` 是高影响入口；修改返回类型时同步 `src/shared/types.ts`、IPC/preload、renderer、Agent tools 和测试。
- K 线优先真实本地 DuckDB 或真实远程刷新；不要根据单个价格合成走势图。
- 交易建议可以使用 LLM 生成文案，但输入数据必须来自真实 service/provider，并保留数据不可用状态。
