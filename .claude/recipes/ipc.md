# IPC Recipe

适用于 Electron IPC channel、preload listener、主进程服务调用和 push event。

## 必读

- `.claude/knowledge/ipc-data-flow.md`
- `.claude/recipes/renderer-api.md`

## Channel 改动步骤

1. 搜索 channel 字符串、preload 方法名、`StocksenseApi` 类型和组件调用方。
2. 新增 invoke channel 时同步：shared type → stocksense API → preload → ipc handler → service。
3. 新增 push event 时同步：事件类型 → preload listener → ipc send 点 → UI cleanup。
4. handler 只调用真实 service/provider，不在 IPC 层拼业务数据。
5. IPC 错误应转换为调用方可见的失败状态或抛给上层处理，不静默吞掉。

## Listener 规则

- `ipcRenderer.on()` 暴露给 renderer 的方法必须返回 unsubscribe。
- React effect 中必须调用 unsubscribe，避免重复 listener 和内存泄漏。
- 不公开的内部 event 不要写入 renderer API 文档或当作可用能力。

## 验证

- channel 名、方法名和返回类型全局搜索确认一致。
- 涉及 preload 或主进程加载时运行 build 或对应 selfcheck。
- 对 push event 至少验证订阅、触发、取消订阅路径。