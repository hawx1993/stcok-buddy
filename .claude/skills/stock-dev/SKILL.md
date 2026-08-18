---
name: stock-dev
description: 以最小上下文定位既有边界、复用实现并交付可验证的 StockBuddy 功能。
argument-hint: '[开发任务描述]'
---

# StockBuddy 高质量开发

用于**新增或扩展功能**。纯 Bug 修复优先使用 `stock-fix-bug`；不要把本技能当作项目百科全书。

目标：只读取完成当前任务所需的代码和文档，沿真实调用链实现最小变更，并以定向验证证明功能可用。

## 强制规则

开始前必须读取并遵守：

- `.claude/rules/typescript-react.md`
- `.claude/rules/data.md`
- `.claude/rules/bug-fix.md`（任务包含 Bug 修复时）

规则文件优先于本技能。以下红线不可突破：

- 面向用户的股票、行情、板块、新闻、图表和投研结果必须来自真实数据。
- 数据源顺序固定为：`stock-sdk` → `a-stock-data` → 明确的 loading / empty / error 状态；不得伪造 fallback。
- 数据访问必须遵循 `UI → Service → Provider → Data Source`；React 组件不得直接请求第三方行情接口。
- 禁止新增 `any`、`as any`、`as unknown as`、`@ts-ignore`、静默 `catch` 返回空值、关闭检查或为通过编译降低类型安全。
- 金额、收益等金融计算不得使用浮点数。
- 不修改需求以外的逻辑、公共 API 或架构；需要新增依赖前先确认已有依赖不能解决。

## 最小上下文工作流

### 1. 明确交付边界

编辑前先用简短计划确认：

1. 用户可观察到的目标、成功状态及失败/空状态。
2. 最小数据、UI、IPC 或持久化边界，以及预计受影响的文件。
3. 能证明功能有效的定向测试、自检或 Electron 场景。

需求、数据源或交互存在无法从代码判断的歧义时，先向用户澄清；不要自行编造前提。

### 2. 按需定位，不批量阅读

1. 从下表选择最接近的入口，先读取入口、直接依赖和同目录测试。
2. 搜索入口导出的函数、类型、IPC channel、store action 或组件；仅沿实际调用链继续阅读。
3. 当直接代码不足以决定设计时，按需读取对应 Knowledge。跨进程或跨数据层任务可以读多份，但每一份都必须与当前问题直接相关。
4. 实现前搜索是否已有同类 service、provider、shared type、组件、hook、测试和已安装依赖可复用。

| 任务领域                                 | 优先入口                                                                                         | 按需 Knowledge                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Renderer UI、组件、store、worker         | `src/components/<feature>/`、`src/store/`、`src/workers/`                                        | `.claude/knowledge/frontend-architecture.md`                              |
| Renderer API、preload、IPC               | `src/shared/stocksense-api.ts`、`src/shared/types.ts`、`electron/preload.cjs`、`electron/ipc.ts` | `.claude/knowledge/ipc-data-flow.md`                                      |
| 行情、搜索、K 线、板块、新闻、探索、监控 | `electron/services/stock/stock-client.ts` 与对应专项 service                                     | `.claude/knowledge/stock-services.md`                                     |
| 市场同步、交易日、本地优先查询、DuckDB   | `electron/services/market-data/`                                                                 | `.claude/knowledge/market-data-services.md`                               |
| Agent、投研报告、工具调用                | `electron/services/agent/orchestrator.ts`、`electron/services/agent/tools/`                      | `.claude/knowledge/agent-services.md`、`.claude/knowledge/agent-tools.md` |
| 配置、会话、通知、升级                   | `electron/services/` 对应 service                                                                | `.claude/knowledge/electron-services-overview.md`                         |

## 实现配方

### 新增真实数据或 Renderer API

1. 确认 `stock-sdk` 是否支持；不支持或不适合时才检查 `electron/services/stock/a-stock-data-runner.ts` 的既有能力。
2. 在现有 Electron service/provider 中实现真实数据访问、输入校验、超时和可理解的失败路径；批量接口优先。
3. Renderer 确需新增主进程能力时，同步更新：

   ```text
   src/shared/types.ts
   → src/shared/stocksense-api.ts
   → electron/preload.cjs
   → electron/ipc.ts
   → electron/services/**
   → component / hook
   ```

4. UI 必须正确呈现 success、loading、empty、error；浏览器环境只允许真实 API 或明确空/错态。
5. 图表仅渲染真实时间序列；无序列时展示“暂无图表数据”。

### 新增或调整 UI

- 主组件放在 `src/components/<feature>/index.tsx`；子组件放入同级 `components/`，一个文件只维护一个主组件。
- 优先复用当前 feature 的 hook、纯函数、样式、Ant Design 和已安装依赖；复杂逻辑拆为 hook 或纯函数。
- 全局状态优先扩展既有 Zustand store；不得新增状态管理库。
- 通过 `getStocksenseApi()`、已有 hook 或 service 获取数据，不能在组件中直接访问第三方数据源。
- 复杂组件使用既有 ErrorBoundary 边界或补充适当边界；关键列表使用稳定 key。

### Agent、投研输出与持久化

- Agent 逻辑从 `electron/services/agent/orchestrator.ts` 和现有 agent/tool 边界接入，保留真实数据证据链、数据缺口和风险提示。
- 实时数据写入遵循 `Memory Cache → batch / queue / transaction → SQLite 或 DuckDB`；禁止每条行情即时写库。
- 修改 schema、共享类型、IPC channel、service 方法、store action 或组件 props 时，必须搜索定义、导入、调用方和测试，逐一确认兼容性。

## 质量门槛

1. 对非平凡业务逻辑，新增或更新最小的定向 Vitest 测试；测试放在相邻 `__tests__/`，`describe` 与 `it` 使用中文。
2. 当功能需要 Electron、IPC、同步、worker 或持久化链路时，优先复用或新增对应 `electron/selfchecks/` 自检。
3. 完成后必须运行：

   ```bash
   pnpm run typecheck
   git diff --check
   ```

4. 还要按影响范围运行，不要机械全量执行：

   ```bash
   pnpm run test -- <相关测试>
   pnpm run selfcheck:<相关自检>
   pnpm run build
   ```

   - 测试或自检覆盖新行为及失败/空状态。
   - 涉及 Vite 构建、preload、IPC、主进程模块加载或样式编译时运行 `pnpm run build`。
   - 需要桌面运行时才能证明的交互，应在 Electron 中复验原始场景。
   - 若任何检查未运行或存在既有失败，必须说明原因与完整结论。

## 完成报告

完成后简要说明：

- **Implementation**：实现了什么，复用了哪些边界。
- **Impact**：改动文件、调用方和公共接口影响。
- **Data & States**：真实数据来源，以及 loading / empty / error 的处理。
- **Verification**：执行的命令、结果和未执行项。

不要输出泛泛的“已完成”；报告必须能让审阅者复现和判断交付质量。
