# Persistence Recipe

适用于 SQLite、DuckDB、cache、batch flush、同步任务、scheduler 和退出清理。

## 必读

- `.claude/rules/data.md`
- `.claude/knowledge/market-data-services.md`（市场 DuckDB / 同步）
- `.claude/knowledge/electron-services-overview.md`（应用级 store、启动退出、存储清理）

## 实现步骤

1. 先判断职责归属：业务查询在 service/provider，物理持久化在 `stock-db/**`，同步调度在对应 scheduler。
2. 实时或批量数据写库使用 memory cache、队列、批量 flush 或 transaction。
3. 不在 websocket/message/单条回调中逐条同步写 SQLite/DuckDB。
4. 新增后台任务时定义启动点、停止点、取消/等待逻辑和退出清理。
5. 本地数据过期或不完整时标记 `stale`、`partial` 或 warnings；不要展示为实时完整数据。
6. 清理、重建或迁移存储前确认 scheduler、worker 和数据库实例生命周期。

## Schema / Store 改动

- 表结构修改要考虑已有本地库兼容，优先使用幂等迁移方式。
- 修改持久化 shape 时同步 shared types、service 查询、UI 和测试。
- 存储清理新增项时同步 storage stats、UI 展示和实际清理逻辑。

## 验证

- 批量写入、队列、取消和关闭路径需要测试或 selfcheck。
- 同步任务要验证进度事件、失败记录、重试和取消。
- 清理或迁移属于高影响操作，执行前需要用户明确确认。