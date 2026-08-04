# Electron 顶层 Services 知识

适用范围：`electron/services/*.ts`，不包含子目录。子目录分别见 Agent、market-data、stock、tools 的知识文档。

## 总体位置

顶层服务通常由 `electron/ipc.ts` 直接调用，负责应用级配置、会话、通知、命令商店、更新等非行情核心能力。它们为 renderer 提供基础状态和持久化能力。

## 关键文件

| 文件 | 职责 | 主要入口 |
| --- | --- | --- |
| `electron/services/config-store.ts` | `electron-store` 应用配置、收藏股票、新闻偏好、更新下载状态、命令商店安装状态、设备 ID | `getConfig()`、`setConfig()`、`listFavoriteStocks()`、`upsertFavoriteStock()`、`getStockNewsPreferences()`、`listInstalledStoreItems()` |
| `electron/services/conversation-store.ts` | SQLite 会话与消息持久化 | `listConversations()`、`createConversation()`、`deleteConversation()`、`renameConversation()`、`listMessages()`、`saveUserMessage()`、`saveAssistantMessage()` |
| `electron/services/desktop-notification.ts` | AI 回复完成通知、系统通知权限提示、通知内容摘要 | `notifyAiResponseCompleted()`、`notifyAiResponseTest()`、`getNotificationState()`、`summarizeResponse()` |
| `electron/services/store-service.ts` | 本地命令/技能/子代理商店读取与执行 | `listStoreItems()`、`runStoreCommand()` |
| `electron/services/update-service.ts` | 应用更新状态机、检查、下载、安装、发布说明 | `getAppUpdateState()`、`checkAppUpdate()`、`downloadAppUpdate()`、`installAppUpdate()`、`onAppUpdateStateChanged()` |

## 与 IPC 的关系

`electron/ipc.ts` 注册这些服务对应的 channel：

- 配置：`config:get`、`config:set`、`config:testModel`
- 收藏：`favorite:list`、`favorite:upsert`、`favorite:remove`、`favorite:togglePin`
- 会话/消息：`conversation:*`、`message:*`、`chat:send`
- 通知：`notification:testAiResponse`、`notification:openSettings`、`notification:aiResponse`
- 商店：`store:list`、`store:installed`、`store:install`、`store:uninstall`
- 更新：`appUpdate:*`
- 存储：`storage:*`、`system:getDiskInfo`

新增顶层服务能力时，必须同步 `src/shared/types.ts`、`src/shared/stocksense-api.ts`、`electron/preload.cjs`、`electron/ipc.ts`。

## 注意事项

- `runStoreCommand()` 在 `runOrchestrator()` 开始处优先执行；如果返回响应，会跳过后续 Agent DAG。
- `conversation-store.ts` 保存的是聊天业务数据，修改 message shape 前要检查 `src/shared/types.ts` 和 `src/store/app-data-store.ts`。
- `config-store.ts` 是用户偏好来源；不要把临时运行态塞进持久配置。
- 通知、更新、外部链接等外向行为需要谨慎处理用户确认和错误提示。