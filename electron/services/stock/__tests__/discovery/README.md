# Discovery Tests

> 面向 AI 的快速导航：本目录测试探索页 `discovery` 服务的主快照、section 缓存、市场摘要、热点题材和月度题材构造。

## 测试文件

| 文件 | 覆盖内容 |
| --- | --- |
| `discovery-service.test.ts` | `getDiscoverySnapshot()` 主流程、section 级加载、缓存、历史交易日、等待/加载状态和大量测试导出。 |
| `discovery-hot-themes.test.ts` | 热点题材 leader 合并、本地板块校准。 |
| `discovery-market-summary.test.ts` | 主力资金流选择和北向资金汇总。 |
| `discovery-monthly-themes.test.ts` | 历史涨停池生成月度题材、板块名称归一化。 |

## 常用命令

```bash
pnpm run test -- electron/services/stock/__tests__/discovery/<file>.test.ts
```

## AI 修改注意

- 新增/调整 discovery section 时优先补 `discovery-service.test.ts` 的 section、缓存和历史交易日场景。
- 历史数据缺失应验证 loading/unavailable，而不是验证伪造榜单。
