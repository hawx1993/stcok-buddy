# Electron 顶层 Services 知识

适用范围：`electron/main.ts`、`electron/app-main.ts`、`electron/services/*.ts`，以及 `electron/services/stock-db/**` 的应用级持久化实现。业务领域服务分别见 Agent、market-data、stock 的知识文档。

## 服务与持久化归属

顶层服务通常由 `electron/ipc.ts` 调用，负责应用级通知、命令商店和更新等非行情能力。用户配置、会话与数据库 store 已收敛到 `stock-db/**`；该目录代表物理持久化归属，不表示同步、调度和业务逻辑也应从 `market-data/**`、`stock/**` 迁入。

| 文件 | 职责 | 主要入口 |
| --- | --- | --- |
| `electron/services/stock-db/config-store.ts` | `electron-store` 应用配置、收藏股票、新闻偏好、更新下载状态、命令商店安装状态、市场新闻摘要状态和设备 ID。 | `getConfig()`、`setConfig()`、`listFavoriteStocks()`、`upsertFavoriteStock()`、`getStockNewsPreferences()`、`addStockNewsSubscription()`、`listInstalledStoreItems()`、`getDeviceId()` |
| `electron/services/stock-db/conversation-store.ts` | SQLite 会话与消息持久化、会话/消息搜索和关闭。 | `listConversations()`、`createConversation()`、`deleteConversation()`、`renameConversation()`、`searchConversations()`、`listMessages()`、`saveUserMessage()`、`saveAssistantMessage()`、`closeConversationStore()` |
| `electron/services/stock-db/quote-store.ts` | SQLite 实时行情缓存的初始化、批量持久化和关闭。 | `initializeQuoteStore()`、`closeQuoteStore()` |
| `electron/services/stock-db/market-data-store.ts` | market-data 使用的 DuckDB 实例、表结构、串行写队列和关闭/重建。 | `initializeMarketDataStore()`、`closeMarketDataStore()`、`closeMarketDataInstance()` |
| `electron/services/stock-db/monitor-history-store.ts` / `electron/services/stock-db/surge-history-store.ts` | AI 监控与个股异动历史的 DuckDB 存储、队列与关闭。 | 各自的查询、批量写入和 close 入口。 |
| `electron/services/stock-db/user-data-migration.ts` | 旧 userData 目录迁移、备份与 marker 管理；必须在 store 打开前执行。 | `migrateLegacyUserData()`、`migrateUserDataDirectory()` |
| `electron/services/desktop-notification.ts` | AI 回复完成通知、系统通知权限提示和通知内容摘要。 | `notifyAiResponseCompleted()`、`notifyAiResponseTest()`、`getNotificationState()`、`summarizeResponse()` |
| `electron/services/store-service.ts` | 本地命令/技能/子代理商店读取与执行。 | `listStoreItems()`、`listInstalledStoreItems()`、`installStoreItem()`、`uninstallStoreItem()`、`runStoreCommand()` |
| `electron/services/update-service.ts` | 应用更新状态机、检查、下载、安装、发布说明和下载目录设置。 | `getAppUpdateState()`、`checkAppUpdate()`、`downloadAppUpdate()`、`installAppUpdate()`、`openAppReleaseNotes()`、`onAppUpdateStateChanged()` |

## Electron 启动与退出生命周期

启动入口分为两层：

1. `electron/main.ts` 仅执行 `migrateLegacyUserData()`，然后动态导入 `electron/app-main.ts`；迁移必须在任何本地 store 打开前完成。
2. `electron/app-main.ts` 负责 dotenv、About Panel、窗口、IPC、后台任务和退出清理。

`app-main.ts` 在 `app.whenReady()` 后的当前顺序：

1. 配置 About Panel，并以 `setInstallUpdateHandler(prepareForUpdateInstall)` 注册更新安装前清理。
2. `initializeQuoteStore()` 初始化 SQLite 实时行情缓存。
3. 异步 `ensureMarketDataRuntime()` 初始化 market-data DuckDB 和 scheduler；失败记录错误，不能提供假行情。
4. `startMonitorHistoryScheduler()` 与 `ensureSurgeHistoryCapture()` 启动监控和个股异动历史采集。
5. `registerIpcHandlers()` 注册 IPC，`createWindow()` 创建使用 `electron/preload.cjs` 的主窗口。
6. 后台执行 `syncSurgeHistoryIfNeeded()`；5 秒后静默 `checkAppUpdate({ silent: true })`，并记录 `captureEvent('app_started')`。

退出/更新安装前：

- 更新安装前 `prepareForUpdateInstall()` 会停止 market-data、Discovery、异动历史和监控历史 scheduler。
- 普通退出 `before-quit` 会阻止默认退出，停止 scheduler、销毁窗口并记录 `app_closing`，再执行 bounded cleanup。
- cleanup 关闭 quote SQLite、conversation SQLite、market-data DuckDB、surge DuckDB、monitor DuckDB，并 shutdown PostHog；market-data 清理会调用 `shutdownMarketDataScheduler()` 以 dispose worker，stock 清理会调用 `stock/chip-distribution/chip-distribution-worker-client.ts` 的 `disposeChipDistributionWorker()`。
- 新增后台任务时必须定义启动/停止点、队列等待和有界超时，避免在关闭的数据库上继续写入。

## 与 IPC 的关系

`electron/ipc.ts` 注册这些服务对应的 channel：

- 埋点/运行时：`analytics:capture`、`app:getRuntimeInfo`、`app:openFeedbackEmail`
- 配置：`config:get`、`config:set`、`config:testModel`
- 收藏：`favorite:list`、`favorite:upsert`、`favorite:remove`、`favorite:togglePin`
- 会话/消息：`conversation:list`、`conversation:create`、`conversation:delete`、`conversation:rename`、`conversation:search`、`message:list`、`message:save`、`chat:send`
- 通知：`notification:testAiResponse`、`notification:openSettings`、`notification:aiResponse`
- 商店：`store:list`、`store:installed`、`store:install`、`store:uninstall`
- 更新：`appUpdate:getState`、`appUpdate:check`、`appUpdate:download`、`appUpdate:install`、`appUpdate:openReleaseNotes`、`appUpdate:selectDownloadDirectory`、`appUpdate:stateChanged`
- 存储：`storage:getStats`、`storage:clear`、`storage:clearProgress`、`system:getDiskInfo`

新增顶层服务能力时，必须同步 `src/shared/types.ts`、`src/shared/stocksense-api.ts`、`electron/preload.cjs`、`electron/ipc.ts`。

## 存储统计与清理

`electron/ipc.ts` 的存储管理覆盖：

| key | 内容 |
| --- | --- |
| `chat` | `stocksense-chat.sqlite` 会话和消息。 |
| `config` | `stocksense-store.json` 应用配置、收藏、新闻偏好、安装状态等。 |
| `market` | `stocksense-market*.duckdb` 本地行情数据库。 |
| `surge` | `stocksense-surge*.duckdb` 异动/热点历史。 |
| `monitor` | `stocksense-monitor*.duckdb` AI 监控历史。 |

相关 channel：

- `storage:getStats`：返回各存储项大小。
- `storage:clear`：逐项清理并通过 `storage:clearProgress` 发送平滑进度。
- `system:getDiskInfo`：读取磁盘总量、剩余空间和应用使用空间。

清理市场/异动/监控库时要注意先停止或等待相关 scheduler，再关闭 DuckDB 实例，避免文件被占用或写入队列丢失。

## 注意事项

- `runStoreCommand()` 在 `runOrchestrator()` 开始处优先执行；如果返回响应，会跳过后续 Agent DAG。
- `conversation-store.ts` 保存的是聊天业务数据，修改 message shape 前要检查 `src/shared/types.ts` 和 `src/store/app-data-store.ts`。
- `config-store.ts` 是用户偏好来源；不要把短生命周期运行态塞进持久配置。
- 通知、更新、外部链接、反馈邮件等外向行为需要谨慎处理用户确认、权限和错误提示。
- 清理或重置本地存储是高影响操作；新增存储项时同步 `IStorageStats`、storage manager UI 和清理逻辑。
