# Renderer API Recipe

适用于新增或修改 renderer 可调用能力、shared types、browser fallback、preload 暴露和 IPC 服务链路。

## 必读

- `.claude/rules/core.md`
- `.claude/rules/data.md`（股票、行情、新闻、图表相关）
- `.claude/knowledge/ipc-data-flow.md`

## 标准链路

```text
component / hook
  → getStocksenseApi()
  → src/shared/stocksense-api.ts
  → electron/preload.cjs
  → electron/ipc.ts
  → electron/services/**
```

## 实现步骤

1. 先确认是否已有 `StocksenseApi` 方法、IPC channel、service 方法或相近返回类型可复用。
2. 需要新增能力时按链路顺序同步：
   - `src/shared/types.ts`
   - `src/shared/stocksense-api.ts`
   - `electron/preload.cjs`
   - `electron/ipc.ts`
   - `electron/services/**`
   - component / hook
3. Browser fallback 只能返回真实可用 API、loading、empty、error 或 Electron-only 提示。
4. Push listener 必须提供取消订阅函数，并在 React effect 中清理。
5. 修改返回类型或 channel 名后，全局搜索定义、导入、调用方和测试。

## 验证

- 类型变更后运行 typecheck。
- 新 channel 或 service 逻辑优先补相邻测试或 selfcheck。
- 涉及 preload / IPC / 主进程模块加载时运行 build 或对应 Electron selfcheck。