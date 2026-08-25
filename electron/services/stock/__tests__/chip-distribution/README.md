# Chip Distribution Tests

> 面向 AI 的快速导航：本目录测试筹码分布 provider 的真实缓存、刷新、错误和 data gap 边界。

## 测试文件

| 文件 | 覆盖内容 |
| --- | --- |
| `chip-distribution-provider.test.ts` | `getChipDistribution()` 的缓存读取、刷新、空态/错误态和返回结构。 |

## 常用命令

```bash
pnpm run test -- electron/services/stock/__tests__/chip-distribution/chip-distribution-provider.test.ts
```

## AI 修改注意

- 修改 worker API 时，除 provider 测试外还要人工检查 `chip-distribution-worker-client.ts`、`chip-distribution-worker-types.ts` 和 worker 实现接口一致。
- 测试可以 mock 数据源，但不要在生产筹码服务里合成假筹码。
