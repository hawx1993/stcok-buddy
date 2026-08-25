# Stock Detail Tests

> 面向 AI 的快速导航：本目录测试个股详情相关的格式化、输入 schema、搜索结果补全和交易建议聚合。

## 测试文件

| 文件 | 覆盖内容 |
| --- | --- |
| `format.test.ts` | 个股评级/格式化相关数值展示边界。 |
| `schemas.test.ts` | `SymbolInputSchema`、`KlineOptionsSchema` 输入校验。 |
| `search-result-enrichment.test.ts` | 搜索结果与行情指标合并、指标完整性判断。 |
| `trading-advice-service.test.ts` | 交易建议上下文构造、leader 股票调和、LLM 输入边界。 |

## 常用命令

```bash
pnpm run test -- electron/services/stock/__tests__/stock-detail/<file>.test.ts
```

## AI 修改注意

- 修改 `stock-client.ts` 主入口时还要按实际能力选择 `quotes/`、`anomaly/`、`chip-distribution/` 等相邻测试。
- 交易建议测试可 mock LLM，但输入行情/板块/市场上下文在生产中必须来自真实 service。
