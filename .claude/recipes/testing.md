# Testing Recipe

适用于选择、补充和执行 StockBuddy 开发任务的验证。

## 验证顺序

1. 运行最小定向测试或 selfcheck，覆盖本次改动的成功路径和失败/空状态。
2. 运行受影响模块测试。
3. 运行类型检查。
4. 必要时运行 build。
5. 检查 diff 和空白问题。

## 基础命令

```bash
pnpm run typecheck
git diff --check
```

按影响范围选择：

```bash
pnpm run test -- <相关测试>
pnpm run selfcheck:<相关自检>
pnpm run build
```

## 选择规则

- React / hook / store：优先相邻 Vitest 或组件相关测试。
- IPC / preload / Electron service：优先对应 selfcheck，再考虑 build。
- stock service / market-data：覆盖真实数据状态、warning、empty、partial、stale 和错误路径。
- Agent / tool：覆盖 registry、白名单、工具状态、evidence、data gap 和最终输出。
- 类型或公共 API 改动：必须运行 typecheck，并搜索调用方。
- 样式、preload、主进程模块加载或打包边界：运行 build。

## 报告规则

- 写清每条命令的结果：通过、失败或未运行。
- 失败时报告首个相关失败和关键输出，不把失败包装成通过。
- 未运行时说明原因、风险和替代验证。
- 如果只有 `.claude` 文档改动，可用结构检查、行数检查、grep 指针检查和 `git diff --check` 替代生产代码验证。