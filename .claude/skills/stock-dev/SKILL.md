---
name: stock-dev
description: 以渐进式上下文完成 StockBuddy 功能开发，按任务分类加载规则、知识和配方。
argument-hint: '[开发任务描述]'
---

# Stock Dev

用于新增或扩展功能。纯 Bug 修复优先使用 `stock-fix-bug`；本技能只负责开发工作流调度，不承载项目百科。

## 目标

用最少必要上下文完成可验证改动：先分类，再加载相关规则、Knowledge 和 Recipe，沿真实调用链实现最小变更。

## 任务分类

开始后先判断任务属于哪些领域，可多选但必须说明原因：

| 领域 | 触发线索 | 按需 Recipe |
| --- | --- | --- |
| UI | 页面、组件、弹层、样式、图表展示 | `.claude/recipes/renderer-ui.md` |
| State | Zustand、hook、worker、前端状态同步 | `.claude/recipes/renderer-ui.md` |
| Renderer API | `getStocksenseApi()`、shared types、browser fallback | `.claude/recipes/renderer-api.md` |
| IPC | preload、ipc channel、push event、主进程调用 | `.claude/recipes/ipc.md` |
| Stock Service | 行情、搜索、K 线、分时、筹码、板块、指数、新闻、热点、龙虎榜、异动、探索页、监控 | `.claude/recipes/stock-data.md` |
| Market Data | DuckDB、同步、条件选股、本地查询 | `.claude/recipes/stock-data.md`、`.claude/recipes/persistence.md` |
| Agent | 投研、orchestrator、tool、evidence、data gap | `.claude/recipes/agent.md` |
| Persistence | SQLite、DuckDB、cache、scheduler、批量写入 | `.claude/recipes/persistence.md` |
| Testing / Build | 测试、自检、类型检查、构建失败 | `.claude/recipes/testing.md` |

## 加载策略

1. 先读取已缺失的通用规则：
   - `.claude/rules/core.md`
   - `.claude/rules/typescript-react.md`（涉及 TS / React 时）
   - `.claude/rules/data.md`（涉及股票、行情、板块、新闻、图表、Agent 数据时）
   - `.claude/rules/bug-fix.md`（开发任务中包含 Bug 修复时）
2. 读取 `.claude/knowledge/index.md`，只根据分类加载相关 Knowledge。
3. Stock Service 任务优先按当前子域定位：`stock-detail/`、`quotes/`、`anomaly/`、`discovery/`、`monitor/`、`chip-distribution/`；不要恢复旧 `stock/<file>.ts` 扁平路径。
4. 只读取命中的 Recipe；不要一次性读取 `.claude/knowledge/**` 或 `.claude/recipes/**`。
5. 如果分类不确定，先搜索最精确线索；仍无法判断时向用户澄清。

## 工作流

```text
Task
  → Classify
  → Load Rules
  → Load Knowledge Index
  → Load selected Knowledge + Recipe
  → Search → Narrow → Read → Trace
  → Implement minimal change
  → Verify targeted scope
  → Report
```

### 1. 明确交付边界

编辑前形成简短判断：用户可见目标、成功状态、失败/空状态、最小影响边界、验证方式。需求或数据来源不清楚时先问，不猜。

### 2. 渐进式定位

- 先搜索精确线索：组件名、函数名、IPC channel、store action、类型名、测试名、文案。
- 首轮只读入口、直接依赖和相邻测试。
- 调用链必须能连接到实际修改点；链路断开时继续搜索断点符号。
- 实现前搜索现有 service、provider、hook、组件、shared type、测试和已安装依赖，优先复用。

### 3. 最小实现

- 只改当前任务必需文件，默认不超过 5 个。
- 需要改公共 API、依赖、配置、schema 或超过 5 个文件时，先暂停并说明原因、影响和替代方案。
- 保持真实数据链路和现有架构边界；具体做法以命中的 Rules / Knowledge / Recipe 为准。

### 4. 验证

基础验证：

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

无法运行或失败时，报告原因、关键输出和剩余风险；不要把未验证说成通过。

## 完成报告

使用以下结构：

```markdown
### Implementation
- ...

### Impact
- `path` — ...

### Data & States
- 数据来源：...
- Loading / Empty / Error：...

### Verification
- `command`：通过 / 失败 / 未运行（原因）
```

报告必须能让审阅者复现验证结果，并说明未覆盖项。