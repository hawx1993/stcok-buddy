# Chip Distribution Services

> 面向 AI 的快速导航：本目录负责筹码分布真实数据获取、计算、缓存行转换和 worker 计算隔离。

## 文件职责

| 文件 | 作用 | 主要导出接口 |
| --- | --- | --- |
| `chip-distribution-provider.ts` | 对外 provider：按股票代码获取筹码分布，优先真实缓存，必要时走 a-stock-data / worker 刷新并回写。 | `getChipDistribution()` |
| `chip-distribution.ts` | 纯计算与结果转换：把 K 线/成交数据计算为筹码分布，将缓存行转换为展示结果。 | `calculateChipDistribution()`, `chipRowsToResult()` |
| `chip-distribution-worker-client.ts` | 主线程 worker client：调用 worker 加载 stock-sdk 筹码数据、执行计算、释放 worker。 | `loadStockSdkChipDistributionInWorker()`, `calculateChipDistributionInWorker()`, `disposeChipDistributionWorker()` |
| `chip-distribution-worker-types.ts` | worker 输入和 API 类型。 | `ICalculateChipDistributionInput`, `IChipDistributionWorkerApi` |
| `chip-distribution.worker.ts` | worker 实现：暴露筹码数据加载和计算方法，不作为普通 service 直接导入。 | Comlink worker API |

## 主要调用方

- `stock-detail/stock-client.ts` re-export `getChipDistribution()` 给 IPC 和 Agent 能力复用。
- `market-data/condition-screener-service.ts` 在条件选股中读取筹码指标。
- `agents/data-coverage-agent.ts` 会批量补齐真实筹码缓存。
- `app-main.ts` 退出清理时应调用 `disposeChipDistributionWorker()`。

## AI 修改注意

- 不要伪造筹码分布；没有真实数据时返回 warning/data gap/empty 状态。
- worker 相关改动要同时关注主线程 client、worker types 和 worker 实现的接口一致性。
- 计算逻辑应保持纯函数特征，避免在 `chip-distribution.ts` 内直接做 IO。
