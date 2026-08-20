# Renderer UI Recipe

适用于 React 页面、组件、hook、Zustand store、worker 和 UI 状态改动。先读取 `.claude/rules/typescript-react.md`；涉及股票数据时同时读取 `.claude/rules/data.md`。

## 入口选择

按功能定位：

- 页面/组件：`src/components/<feature>/`
- 全局状态：`src/store/`
- 计算密集逻辑：`src/workers/`
- 共享 API：`src/shared/stocksense-api.ts`
- 相关知识：`.claude/knowledge/frontend-architecture.md`

## 实现步骤

1. 搜索现有组件、hook、store action、worker API 和相邻测试。
2. 读取入口组件、直接依赖、类型和相关测试；不要先展开整个组件树。
3. 组件只通过 `getStocksenseApi()`、已有 hook 或 store 获取数据。
4. 保持 UI 状态完整：success、loading、empty、error 都要可见。
5. 图表只渲染真实序列；无序列时展示空态。
6. 复杂逻辑优先提取 hook 或纯函数；过大组件拆到同级 `components/`。
7. 列表使用稳定 key；大列表优先复用现有虚拟列表方案。

## 修改检查

- 组件文件原则上一个主组件。
- Hook 依赖完整，不通过删依赖绕过闭包问题。
- 不新增状态管理库；全局状态优先扩展既有 Zustand store。
- 不硬编码行情、颜色或需求之外文案。
- 修改 shared type 或 store shape 时搜索所有调用方。