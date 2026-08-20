# 测试要求

目标：每个 Bug 修复都能用最小、相关、可复现的验证证明，不用“大概没问题”替代测试。

## 测试选择顺序

1. 原失败测试或用户给出的复现路径。
2. 与被改文件同目录或同功能的单元测试。
3. 对应 Electron service / provider / store / worker selfcheck。
4. 受影响 tsconfig 的 typecheck。
5. lint 或 build。

先跑最小定向测试；通过后再扩大验证范围。

## 必须补测试的情况

以下情况必须新增或修改测试，除非项目没有测试基础设施并说明原因：

- 修复纯函数、service、provider、store、worker 逻辑。
- 修复解析、过滤、排序、缓存、数据转换、错误处理。
- 修复 IPC/shared API 类型或通道映射。
- 修复曾经误吞异常、误返回空数据、误展示 fallback 的路径。
- 修复 React 状态同步、hook 依赖、事件处理或条件渲染。

## 可以不补测试的情况

仅当以下情况成立时可以不补测试，并在最终说明：

- 只改注释、文档或脚本说明。
- 只修已有测试快照外的拼写，且不影响逻辑。
- 当前项目没有对应测试环境，且已给出可执行替代验证。
- 用户明确要求只定位不修改。

## 测试边界

- 测试要覆盖原 bug 的失败输入和修复后的期望输出。
- 不为了通过测试引入生产 mock 行情。
- 测试或 selfcheck 中使用 mock 必须限定在测试文件内，不能进入生产 UI/API 响应。
- 不删测试、不降低断言、不跳过测试来制造通过。
- 不把错误路径断言成静默空数组、空对象或 null，除非业务类型明确要求并有错误态上抛。

## 命令建议

优先使用 skill 脚本：

```bash
bash .claude/skills/stock-fix-bug/scripts/test.sh path/to/test.ts
bash .claude/skills/stock-fix-bug/scripts/verify.sh
```

常用项目命令：

```bash
pnpm test -- path/to/test.ts
pnpm run typecheck
pnpm run lint
pnpm run build
```

如果是 Electron selfcheck：

```bash
pnpm run selfcheck:<name>
```

## 失败处理

测试失败时：

- 只摘录首个相关失败、断言差异、关键堆栈和文件位置。
- 判断失败是否由本次修改引入。
- 如果是本次引入，继续修复。
- 如果是既有失败，说明证据并给出未阻塞的验证项。
- 不重复运行同一失败命令，除非已做了相关修改。

## 最终报告

最终 `验证结果` 至少包含：

- 定向测试命令和结果。
- typecheck / lint / build 的执行结果或未运行原因。
- 如果未补测试，说明为什么没有补，以及替代验证是什么。
