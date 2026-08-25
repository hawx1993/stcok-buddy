# Quotes Tests

> 面向 AI 的快速导航：本目录测试行情页、板块驾驶舱、北向资金、a-stock-data runner 和共享行情工具。

## 测试文件

| 文件 | 覆盖内容 |
| --- | --- |
| `a-stock-data-runner.test.ts` | `runAStockDataFn()` 的 Electron runtime 桥接和错误边界。 |
| `board-dashboard-utils.test.ts` | 板块驾驶舱区间、评分、leader 选择、指标排名和 bucket 分类纯逻辑。 |
| `market-page.test.ts` | `getMarketPageSnapshot()`、行情行、tab 过滤和快照缓存交互。 |
| `northbound-flow.test.ts` | 北向资金披露状态、摘要和提示文案。 |
| `shared.test.ts` | K 线聚合/解析、行情行转换、板块缓存/刷新相关工具。 |

## 常用命令

```bash
pnpm run test -- electron/services/stock/__tests__/quotes/<file>.test.ts
```

## AI 修改注意

- 触碰 `quotes/shared.ts`、`market-page.ts` 或板块字段时，优先运行 `shared.test.ts` 和 `market-page.test.ts`。
- 板块驾驶舱算法调整应优先覆盖 `board-dashboard-utils.test.ts`，避免把展示评分逻辑散落到 service 外。
