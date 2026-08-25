# Anomaly Tests

> 面向 AI 的快速导航：本目录测试 `electron/services/stock/anomaly` 下热点异动、龙虎榜、板块详情、同花顺板块热度和市场复盘逻辑。

## 测试文件

| 文件 | 覆盖内容 |
| --- | --- |
| `board-detail.test.ts` | 板块详情、成分股、缓存和行情行转换边界。 |
| `dragon-tiger.test.ts` | 龙虎榜列表、分组、快照和解析逻辑。 |
| `hithink-board-heat.test.ts` | 同花顺板块热度响应转换、板块目录/成分股适配。 |
| `hot-focus.test.ts` | 热点关注、异动、资金流榜等聚合输出。 |
| `hot-stock-hints-service.test.ts` | 热点股票提示来源的合并与优先级。 |
| `market-review-data.test.ts` | 市场复盘数据去重工具。 |
| `market-review-service.test.ts` | 市场复盘和情绪评分关键路径。 |
| `surge-history-scheduler.test.ts` | 异动历史 scheduler 启停行为。 |
| `surge-history-service.test.ts` | 异动历史查询、回填和数据源边界。 |

## 常用命令

```bash
pnpm run test -- electron/services/stock/__tests__/anomaly/<file>.test.ts
```

## AI 修改注意

- 触碰 `anomaly/**` 后优先选择同名或相邻测试。
- 测试 mock 只用于隔离外部数据源；生产代码仍必须返回真实数据或明确不可用状态。
