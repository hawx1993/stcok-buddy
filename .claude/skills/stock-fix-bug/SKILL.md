---
name: stock-fix-bug
description: 渐进式上下文定位 Stock Agents Bug 根因，并做最小、安全、可验证修复。
argument-hint: '用户问题描述 / 报错 / 复现步骤 / 相关页面或功能'
---

# Stock Fix Bug Skill

目标：先定位真实调用链和根因，再做最小修复。禁止用大范围阅读、重构、mock、fallback 或关闭检查来“修好现象”。

## 必读规则

如果当前上下文没有加载这些规则，先读取对应片段：

- `../../rules/typescript-react.md`
- `../../rules/data.md`
- `../../rules/bug-fix.md`
- 本 skill 的 `rules/scope.md`
- 本 skill 的 `rules/testing.md`
- 本 skill 的 `rules/safety.md`

规则优先级高于实现习惯；如果规则缺失，说明缺失并遵守已加载项目规则。

## 四层架构

```text
用户 Bug
  ↓
Bug Fix Skill：核心流程、上下文预算、输出格式
  ↓
Context Engine：search / grep / symbol / dependency trace
  ↓
Project Rules：AGENTS / CLAUDE / architecture / testing / data rules
  ↓
Verification：unit test / typecheck / lint / build / git diff
```

## Context Budget

- 初始搜索：最多 20 个结果。
- 首轮读取：最多 5 个文件。
- 单次读取：优先读相关函数、类型、测试片段，不读整个大文件。
- 调用链追踪：最多向上 3 层、向下 3 层。
- 修改文件：默认不超过 3 个。
- 如果预计修改超过 5 个文件，必须先向用户确认修改范围。
- 每扩展一轮上下文，先说明缺少哪条证据，再搜索或读取。

## 核心流程

1. 理解用户描述的 Bug：提取症状、复现步骤、错误文本、功能入口、股票代码、IPC channel、函数名、组件名、测试名。
2. 定位相关代码：先搜索最精确线索，再扩大到相邻模块。
3. 建立最小调用链：UI/hook/store → API/IPC → service/provider/store → data source。
4. 确认根因：说明为什么会发生、当前实现为什么失效。
5. 制定最小修改方案：只改根因所在点和直接相关测试。
6. 只修改与 Bug 直接相关的代码，遵守 `rules/scope.md`。
7. 补充或修改单元测试，优先覆盖原始复现路径。
8. 执行相关测试：优先定向测试，再按影响范围扩大。
9. 执行类型检查 / lint，必要时执行 build。
10. 检查 git diff，确认没有格式化、重构、无关文件或未说明改动。
11. 确认没有修改用户未要求的功能。
12. 输出：Bug 根因、修改文件、修改内容、测试用例、验证结果。

## 渐进式上下文

按这个循环推进，禁止跳到“大量读取”：

```text
用户描述 → 搜索关键词 → 找到 3~10 个候选文件 → 读取必要片段
→ 分析调用关系 → 继续搜索直接依赖 → 确定根因
→ 只读取必要上下文 → 修改 + 测试
```

每轮只回答一个问题：现在缺少什么证据？下一步最小读取或搜索是什么？

## Context Engine 命令

从仓库根目录使用：

```bash
bash .claude/skills/stock-fix-bug/scripts/locate.sh "错误文本或函数名"
bash .claude/skills/stock-fix-bug/scripts/test.sh path/to/file.test.ts
bash .claude/skills/stock-fix-bug/scripts/verify.sh
```

脚本只是辅助，不替代判断；不要因为脚本输出很多就读取全部文件。

## 定位策略

优先级从高到低：

1. 精确错误文本、堆栈文件、失败测试名。
2. IPC channel、事件名、日志 key、状态枚举。
3. 函数名、组件名、store action、provider 方法。
4. 页面名、功能名、文案、股票代码相关链路。
5. 相邻测试、selfcheck、schema、共享类型。

搜索后只选最可能的 3~10 个文件，首轮最多读 5 个。

## 最小调用链

必须能解释输入如何走到错误输出：

- UI / Component / Hook / Store
- Shared API / IPC / Preload / Type
- Service / Provider / Store / Worker
- Data Source / SQLite / Cache / stock-sdk

如果链路断了，不要猜；继续搜索断点符号或调用方。

## 编辑前检查点

修改前必须形成简短判断：

- Root Cause：根因是什么？
- Why：为什么会发生？
- Failure：当前实现为什么失效？
- Fix Point：最小修改点在哪里？
- Impact：影响哪些调用方或用户路径？
- Tests：需要新增或修改哪些测试？
- Risk：是否可能引入性能、数据、类型或 UI 回归？

判断不成立时，不要编辑。

## 修改边界

遵守 `rules/scope.md`：

- 默认只改根因文件、直接调用方、直接测试。
- 不做顺手重构、目录整理、样式统一、依赖升级。
- 不改需求之外的功能、文案、颜色、数据流。
- 不通过删除逻辑、隐藏错误、空 catch、关闭 lint/typecheck 修复。
- 不新增 mock/fake/demo/sample/preview 行情数据。

## 项目红线

- 股票、行情、板块、新闻、K 线、分时图必须使用真实数据链路。
- 数据访问必须走 `UI → Service → Provider → Data Source`。
- stock-sdk 支持的能力优先使用 stock-sdk；不可用时展示 loading/empty/error。
- React 组件不得直接 fetch 第三方行情接口。
- TypeScript 禁止新增 `any`、`as any`、`as unknown as`、`@ts-ignore`。
- 不降低 tsconfig、lint、测试门禁。

## 测试与防回归

- 遵守 `rules/testing.md` 和 `rules/safety.md`。
- 优先补覆盖原 bug 的单元测试或 selfcheck。
- 先运行定向测试，再运行受影响范围的验证。
- 修改 shared type、IPC、service、provider、worker 时，至少运行对应 typecheck。
- 无法运行测试时，必须说明原因、缺失命令和替代验证。
- 错误路径必须可见：返回错误态、空态或 loading，不吞掉异常。
- 对数据修复，确认没有伪造用户可见行情。
- 对 React 修复，确认 hook 依赖、闭包、状态同步没有被绕过。
- 对 SQLite / 实时行情修复，确认没有逐条写库或阻塞主线程。

## 验证顺序

1. 运行最小定向测试。
2. 运行受影响模块测试或 selfcheck。
3. 运行 typecheck / lint。
4. 必要时运行 build。
5. 检查 `git diff`、`git diff --check`。

验证失败时，报告首个相关失败；不要把既有失败说成本次已通过。

## 最终输出格式

```markdown
### Bug 根因
- ...

### 修改文件
- `path:line` — ...

### 修改内容
- ...

### 测试用例
- 新增/修改：...
- 覆盖场景：...

### 验证结果
- `command`：通过/失败/未运行（原因）

### 影响与风险
- Impact：...
- Risk：...
```

如果没有改代码，也要说明定位结果、未修改原因和下一步需要的输入。
