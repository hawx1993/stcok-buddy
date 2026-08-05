# IPC 与 Renderer API 数据流知识

适用范围：`electron/ipc.ts`、`electron/preload.cjs`、`src/shared/stocksense-api.ts`、`src/shared/types.ts`。

## 标准链路

```text
React Component / Hook
  ↓
getStocksenseApi()
  ↓
src/shared/stocksense-api.ts
  ↓
window.stocksense.method()
  ↓
electron/preload.cjs contextBridge
  ↓
ipcRenderer.invoke(channel, ...args) / ipcRenderer.on(channel)
  ↓
electron/ipc.ts ipcMain.handle / webContents.send
  ↓
electron/services/**
```

## 新增 API 必改顺序

新增 renderer 可调用能力时，按顺序同步：

1. `src/shared/types.ts`
   - 增加/复用业务类型。
   - 更新 `StocksenseApi` 接口。
2. `src/shared/stocksense-api.ts`
   - Electron 环境合并 `window.stocksense` 与 `webFallbackApi`。
   - Browser fallback 只能返回空态/错误态/加载态或真实可用 API，不能造假数据。
3. `electron/preload.cjs`
   - 在 `contextBridge.exposeInMainWorld('stocksense', api)` 暴露方法。
   - invoke 用 `ipcRenderer.invoke(channel, ...args)`。
   - push listener 必须返回取消订阅函数。
4. `electron/ipc.ts`
   - `ipcMain.handle(channel, handler)` 调用真实 service。
   - 如需 push event，用 `BrowserWindow.getAllWindows()` 或当前 `event.sender.send(...)`。
5. `electron/services/**`
   - 在 service/provider 层实现真实数据访问、缓存、错误处理。
6. React hook/component
   - 通过 `getStocksenseApi()` 使用。
7. 测试/selfcheck
   - 覆盖关键成功、空态、错误态或同步状态。

## 当前 IPC channel 快照

| 分类 | Channel |
| --- | --- |
| 埋点/运行时 | `analytics:capture`、`app:getRuntimeInfo`、`app:openFeedbackEmail` |
| 配置/模型 | `config:get`、`config:set`、`config:testModel` |
| 通知 | `notification:testAiResponse`、`notification:openSettings`、`notification:aiResponse` |
| 收藏 | `favorite:list`、`favorite:upsert`、`favorite:remove`、`favorite:togglePin`、`favorite:cleared` |
| 会话/聊天 | `conversation:list`、`conversation:create`、`conversation:delete`、`conversation:rename`、`conversation:search`、`message:list`、`message:save`、`chat:send`、`chat:token` |
| 股票 | `stock:getDetail`、`stock:search`、`stock:getKline`、`stock:getChipDistribution`、`stock:getBatchQuotes`、`stock:getTimelines`、`stock:surgeEvents` |
| 板块/行情 | `board:getDetail`、`board:getDashboard`、`market:getPageSnapshot`、`market:pageSnapshotUpdated` |
| 探索/监控/建议 | `dragonTiger:getSnapshot`、`discovery:getSnapshot`、`monitor:getFeed`、`trading-advice:get` |
| 热点/异动 | `hot:list`、`hot:hintSource`、`hot:historyDates`、`hot:history` |
| 新闻 | `news:list`、`news:stockList`、`news:stockFeed`、`news:stockPreferences`、`news:setFavoritesOnly`、`news:addStockSubscription`、`news:removeStockSubscription`、`news:getSummary`、`news:getDetail` |
| 市场数据同步 | `marketData:ensureReady`、`marketData:getStatus`、`marketData:startSync`、`marketData:retryFailures`、`marketData:cancelSync`、`marketData:getStats`、`marketData:progress` |
| 数据同步任务 | `dataSync:syncKlines`、`dataSync:syncSurgeHistory`、`dataSync:syncStockDetails`、`dataSync:syncSnapshot`、`dataSync:taskProgress` |
| 商店 | `store:list`、`store:installed`、`store:install`、`store:uninstall` |
| 更新 | `appUpdate:getState`、`appUpdate:check`、`appUpdate:download`、`appUpdate:install`、`appUpdate:openReleaseNotes`、`appUpdate:selectDownloadDirectory`、`appUpdate:stateChanged` |
| 存储/系统 | `storage:getStats`、`storage:clear`、`storage:clearProgress`、`system:getDiskInfo` |

## Push event 与 preload listener

`electron/preload.cjs` 当前暴露的 renderer listener：

| preload 方法 | Channel | 说明 |
| --- | --- | --- |
| `onFavoritesCleared()` | `favorite:cleared` | 收藏/配置清理后通知 UI 重新加载。 |
| `onChatToken()` | `chat:token` | AI token 和 `AgentRunEvent` 流式推送。 |
| `onAiResponseNotification()` | `notification:aiResponse` | 系统通知不可达时的应用内兜底提醒。 |
| `onMarketPageSnapshotUpdated()` | `market:pageSnapshotUpdated` | 行情页快照刷新。 |
| `onMarketDataProgress()` | `marketData:progress` | market-data 同步状态。 |
| `onStorageClearProgress()` | `storage:clearProgress` | 存储清理进度。 |
| `onAppUpdateStateChanged()` | `appUpdate:stateChanged` | 更新状态变化。 |
| `onDataSyncProgress()` | `dataSync:taskProgress` | 手动数据同步任务进度。 |

注意：`data-sync-handlers.ts` 内部还会发送 `surge:historyCleared`，但当前 `preload.cjs` 未暴露对应 listener；不要在 renderer 文档中把它当作公开 API。

## `marketData:*` 与 `dataSync:*` 边界

- `marketData:*`：负责 DuckDB 市场数据运行时、同步状态、启动/取消/重试、统计和 `marketData:progress`。
- `dataSync:syncKlines`：renderer 的“一键同步 K 线”入口，内部仍走 `startMarketDataSync()` 并返回 `MarketDataSyncStatus`。
- `dataSync:syncSurgeHistory`、`dataSync:syncStockDetails`、`dataSync:syncSnapshot`：手动同步异动历史、个股快照、行情页快照。
- `dataSync:taskProgress`：手动任务进度，当前 taskType 包括 `surge`、`stockDetail`、`marketSnapshot`。

## `stocksense-api.ts` 注意事项

- `getStocksenseApi()` 在 Electron 中返回 `window.stocksense` 与 `webFallbackApi` 的合并对象。
- 旧客户端缺少新 preload 方法时，部分方法会返回“功能不可用，请重启客户端”。
- Browser fallback 允许本地会话、收藏、配置、商店安装状态等非行情能力使用 localStorage。
- Browser fallback 中行情、新闻、榜单、K 线、图表能力必须是真实 API、空态、错态或 Electron-only 提示；不得继续扩展 preview/fake/demo/sample 数据。
- `hot-stock-hints-service` 可在浏览器使用真实可用的数据加载器，但不能把这个模式泛化为假行情 fallback。

## 修改影响检查

- 改 channel 名：必须全局搜索 preload、ipc、types、stocksense-api、组件调用。
- 改返回类型：同步 `src/shared/types.ts`、store、组件、Agent tool、测试。
- 加 push event：需要在 preload 暴露取消订阅函数，并在组件 effect 中清理 listener。
- 加 service：必须遵守 Provider → Service → UI 数据流，不在组件直接请求第三方接口。
