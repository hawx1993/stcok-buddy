# Electron 顶层 Services 知识

适用范围：`electron/services/*.ts`，不包含子目录。子目录分别见 Agent、market-data、stock、tools 的知识文档。

## 总体位置

顶层服务通常由 `electron/ipc.ts` 直接调用，负责应用级配置、会话、通知、命令商店、更新等非行情核心能力。它们为 renderer 提供基础状态和持久化能力。

## 关键文件

| 文件 | 职责 | 主要入口 |
| --- | --- | --- |
| `electron/services/config-store.ts` | `electron-store` 应用配置、收藏股票、新闻偏好、更新下载状态、命令商店安装状态、市场新闻摘要状态、设备 ID | `getConfig()`、`setConfig()`、`listFavoriteStocks()`、`upsertFavoriteStock()`、`getStockNewsPreferences()`、`addStockNewsSubscription()`、`listInstalledStoreItems()`、`getDeviceId()` |
| `electron/services/conversation-store.ts` | SQLite 会话与消息持久化、会话/消息搜索 | `listConversations()`、`createConversation()`、`deleteConversation()`、`renameConversation()`、`searchConversations()`、`listMessages()`、`saveUserMessage()`、`saveAssistantMessage()` |
| `electron/services/desktop-notification.ts` | AI 回复完成通知、系统通知权限提示、通知内容摘要 | `notifyAiResponseCompleted()`、`notifyAiResponseTest()`、`getNotificationState()`、`summarizeResponse()` |
| `electron/services/store-service.ts` | 本地命令/技能/子代理商店读取与执行 | `listStoreItems()`、`listInstalledStoreItems()`、`installStoreItem()`、`uninstallStoreItem()`、`runStoreCommand()` |
| `electron/services/update-service.ts` | 应用更新状态机、检查、下载、安装、发布说明、下载目录设置 | `getAppUpdateState()`、`checkAppUpdate()`、`downloadAppUpdate()`、`installAppUpdate()`、`openAppReleaseNotes()`、`onAppUpdateStateChanged()` |

## Electron 启动与退出生命周期

`electron/main.ts` 当前启动顺序：

1. 读取 `.env.local`。
2. 配置 About Panel，展示应用版本、git hash、Electron/Chrome/Node 版本。
3. `setInstallUpdateHandler(prepareForUpdateInstall)` 注册更新安装前清理。
4. `initializeQuoteStore()` 初始化 SQLite 实时行情缓存。
5. 异步 `ensureMarketDataRuntime()` 初始化 market-data DuckDB 和 scheduler。
6. `startMonitorHistoryScheduler()` 启动 AI 监控历史调度。
7. `registerIpcHandlers()` 注册 IPC。
8. `createWindow()` 创建主窗口，preload 使用 `electron/preload.cjs`。
9. 5 秒后静默 `checkAppUpdate({ silent: true })`。
10. `captureEvent('app_started')` 记录启动埋点。

退出/更新安装前：

- 更新安装前 `prepareForUpdateInstall()` 会停止 market-data、Discovery、异动历史、监控历史 scheduler。
- 普通退出 `before-quit` 会阻止默认退出，停止 scheduler，销毁窗口，记录 `app_closing`，再执行 bounded cleanup。
- cleanup 会关闭 quote SQLite、conversation SQLite、market-data DuckDB、surge DuckDB、monitor DuckDB，并 shutdown PostHog。
- market-data cleanup 会调用 `shutdownMarketDataScheduler()`，其中会 dispose worker。

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
