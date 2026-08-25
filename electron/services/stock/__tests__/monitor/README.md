# Monitor Tests

> 面向 AI 的快速导航：本目录测试 AI 监控 feed 和监控历史 scheduler。

## 测试文件

| 文件 | 覆盖内容 |
| --- | --- |
| `monitor-service.test.ts` | 监控 feed 构造、事件分类、市场时间、行情/异动/新闻来源整合。 |
| `monitor-history-scheduler.test.ts` | 监控历史采集 scheduler 的启动、停止和运行状态。 |

## 常用命令

```bash
pnpm run test -- electron/services/stock/__tests__/monitor/<file>.test.ts
```

## AI 修改注意

- 修改监控采集频率、退出流程或持久化路径时，必须关注 scheduler 测试。
- 监控事件测试可 mock 输入源，但生产 feed 不能生成假异动或假新闻。
