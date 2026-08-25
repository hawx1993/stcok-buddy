# Stock Service Tests

> 面向 AI 的快速导航：本目录按 `electron/services/stock` 业务子域组织 Vitest 测试，用于验证真实数据适配、缓存策略、聚合逻辑和边界状态。

## 子目录职责

| 子目录 | 覆盖范围 |
| --- | --- |
| `stock-detail/` | 个股格式化、schema、搜索结果指标合并、交易建议输入聚合。 |
| `quotes/` | a-stock-data runner、行情页快照、板块驾驶舱纯工具、北向资金、共享行情工具。 |
| `anomaly/` | 板块详情、龙虎榜、热点、市场复盘、同花顺板块热度、异动历史。 |
| `discovery/` | 探索页主快照、市场摘要、热点题材、月度题材。 |
| `monitor/` | AI 监控 feed 与监控历史 scheduler。 |
| `chip-distribution/` | 筹码分布 provider 与缓存/刷新边界。 |

## AI 修改注意

- 生产代码改动后优先运行对应子目录测试，例如 `pnpm run test -- electron/services/stock/__tests__/quotes/market-page.test.ts`。
- 测试里可以 mock 外部真实数据源，但不要把 mock/fallback 模式迁移到生产 service。
- 新增 service/provider 能力时，在同业务子目录补最小定向测试。
