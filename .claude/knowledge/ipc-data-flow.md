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
   - Electron 环境合并 `window.stocksense`。
   - Browser fallback 只能返回空态/错误态/加载态或真实可用 API，不能造假数据。
3. `electron/preload.cjs`
   - 在 `contextBridge.exposeInMainWorld('stocksense', api)` 暴露方法。
   - 使用 `ipcRenderer.invoke(channel, ...args)` 或注册 push listener。
4. `electron/ipc.ts`
   - `ipcMain.handle(channel, handler)` 调用真实 service。
   - 如需 push event，用 `BrowserWindow.getAllWindows().forEach(win => win.webContents.send(...))`。
5. `electron/services/**`
   - 在 service/provider 层实现真实数据访问、缓存、错误处理。
6. React hook/component
   - 通过 `getStocksenseApi()` 使用。
7. 测试/selfcheck
   - 覆盖关键成功、空态、错误态或同步状态。

## 代表 IPC channel

| 分类 | Channel |
| --- | --- |
| 配置/运行时 | `config:get`、`config:set`、`config:testModel`、`app:getRuntimeInfo`、`app:openFeedbackEmail` |
| 通知 | `notification:testAiResponse`、`notification:openSettings`、`notification:aiResponse` |
| 收藏 | `favorite:list`、`favorite:upsert`、`favorite:remove`、`favorite:togglePin`、`favorite:cleared` |
| 会话/聊天 | `conversation:list/create/delete/rename`、`message:list/save`、`chat:send`、`chat:token` |
| 股票 | `stock:getDetail`、`stock:search`、`stock:getKline`、`stock:getChipDistribution`、`stock:getBatchQuotes`、`stock:getTimelines`、`stock:surgeEvents` |
| 板块/行情 | `board:getDetail`、`board:getDashboard`、`market:getPageSnapshot`、`market:pageSnapshotUpdated` |
| 探索/监控/建议 | `discovery:getSnapshot`、`monitor:getFeed`、`trading-advice:get` |
| 热点/异动 | `hot:list`、`hot:hintSource`、`hot:historyDates`、`hot:history` |
| 新闻 | `news:list`、`news:stockList`、`news:stockFeed`、`news:stockPreferences`、`news:getSummary`、`news:getDetail` |
| 市场数据同步 | `marketData:ensureReady`、`marketData:getStatus`、`marketData:startSync`、`marketData:retryFailures`、`marketData:cancelSync`、`marketData:getStats`、`marketData:progress` |
| 数据同步任务 | `dataSync:syncKlines`、`dataSync:syncSurgeHistory`、`dataSync:syncStockDetails`、`dataSync:syncSnapshot`、`dataSync:taskProgress` |
| 商店 | `store:list`、`store:installed`、`store:install`、`store:uninstall` |
| 更新/存储 | `appUpdate:*`、`storage:getStats`、`storage:clear`、`storage:clearProgress`、`system:getDiskInfo` |

## `stocksense-api.ts` 注意事项

- `getStocksenseApi()` 在 Electron 中返回 `window.stocksense` 与 `webFallbackApi` 的合并对象。
- 旧客户端缺少新 preload 方法时，部分方法会返回“功能不可用，请重启客户端”。
- Browser fallback 中历史存在 preview/fallback 风险；新增功能不得继续扩展伪造行情、新闻、榜单或图表数据。
- 浏览器允许本地会话、收藏、配置等非行情能力使用 localStorage；行情类能力必须真实或明确不可用。

## 修改影响检查

- 改 channel 名：必须全局搜索 preload、ipc、types、stocksense-api、组件调用。
- 改返回类型：同步 `src/shared/types.ts`、store、组件、Agent tool、测试。
- 加 push event：需要在 preload 暴露取消订阅函数，并在组件 effect 中清理 listener。
- 加 service：必须遵守 Provider → Service → UI 数据流，不在组件直接请求第三方接口。