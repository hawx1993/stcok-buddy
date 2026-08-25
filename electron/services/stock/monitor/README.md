# Monitor Services

> 面向 AI 的快速导航：本目录负责 AI 监控 feed、监控事件捕获、分类、持久化和后台历史采集调度。

## 文件职责

| 文件 | 作用 | 主要导出接口 |
| --- | --- | --- |
| `monitor-service.ts` | 监控 feed 主服务：从市场快照、异动历史、个股行情、新闻等来源构造 AI 监控事件，分类并持久化。 | `getMonitorFeed()`, `captureMonitorEvents()`, `persistMonitorCapture()`, `CATEGORY_META` |
| `monitor-history-scheduler.ts` | 监控历史采集调度：交易时段定期捕获 feed，支持停止、状态查询和等待。 | `startMonitorHistoryScheduler()`, `stopMonitorHistoryScheduler()`, `isMonitorHistorySchedulerRunning()`, `waitForMonitorHistoryScheduler()` |

## 辅助导出

- `monitor-service.ts` 还导出 `isLargeOrderItem()`, `ratioPercent()`, `parseMarketCapYi()`, `isRecentLimitUpEvent()`, `isRecentLargeBuyEvent()` 供测试或相邻逻辑复用。

## 主要调用方

- `discovery/discovery-service.ts` 会读取监控 feed 作为机会雷达/事件来源之一。
- `stock-db/monitor-history-store.ts` 存储 `ai_monitor_events` 历史事件。
- `app-main.ts` 负责启动和退出前停止 scheduler。

## AI 修改注意

- 监控事件应保留真实来源、时间和分类依据；不要补假事件。
- scheduler 改动要确认停止路径和 `waitForMonitorHistoryScheduler()`，避免 app 退出被后台采集拖住。
- 写库必须走批量/事务或既有 store，避免逐条同步写入。
