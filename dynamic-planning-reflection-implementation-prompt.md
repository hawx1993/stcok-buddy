# Stock Agents 动态规划与反思实现 Prompt

## 背景

当前 StockBuddy 的 Agent 编排已经具备多 Agent DAG 和真实数据工具链，但计划生成仍偏固定模板：

- `electron/services/agent/orchestrator.ts:200` 的 `emitPlanEvent` 输出固定 5 步：识别意图、解析标的、调用工具、分配子 Agent、汇总结论。
- `electron/services/agent/agent-workflows.ts` 按 `intent` 构造固定 DAG，尤其 `analysis` 意图默认走 `quote -> market-data -> 五维子 Agent -> analysis-report`。
- `electron/services/agent/dag-executor.ts` 在节点失败时会发出 error step，但仍将节点加入 completed 并继续后续节点。
- `electron/services/agent/agent-tool-runtime.ts` 的 `runContextTool` 目前在工具失败时使用调用方传入 fallback，UI 文案会提示“已使用兜底策略继续分析”，但股票行情规则要求不得用伪造数据掩盖缺口，只能明确数据不可用、空状态或错误状态。

这套流程可以稳定跑通固定任务，但还不是真正的“动态规划 + 执行后反思”。目标是让 Agent 在回答选股、个股分析、板块/题材、新闻公告、市场复盘等问题时，能先根据用户问题生成可解释的分析计划，再根据实际数据完整性调整计划，最后在出报告前做反思检查和风险排除。

## 用户期望示例

当用户问：“帮我看看今天 XX 股票是否值得关注？”

Agent 不应只展示固定模板，而应先输出类似：

```md
为了回答这个选股问题，我需要检查：
1. 今日涨幅、成交额和换手率是否异常；
2. 筹码集中度和获利盘结构；
3. 所属行业/概念板块强度；
4. 近期新闻、公告、监管或减持风险；
5. 过去相似形态后的短期表现；
6. 最后做数据缺口检查和风险排除。
```

如果执行中发现“筹码数据不可用”或“公告接口为空”，Agent 应该发出计划调整事件，例如：

```md
计划调整：筹码集中度数据暂不可用，本轮不再给出筹码强弱判断，改为加强资金流、K 线结构和公告风险检查；最终结论会降低置信度并标注数据缺口。
```

而不是直接输出一个看似完整的固定结论。

## 必读项目规则

实现前必须阅读并遵守：

- `.claude/rules/typescript-react.md`
- `.claude/rules/data.md`
- `.claude/rules/emoji.md`
- `.claude/rules/bug-fix.md`
- `.claude/skills/stock-dev/SKILL.md` 或通过 `/stock-dev` 规则确认项目结构

关键红线：

- 面向用户的股票、行情、板块、新闻、图表、投研响应必须基于真实数据。
- 数据源优先级：`stock-sdk` -> `a-stock-data skill` -> 明确空状态/错误状态/加载状态。
- 禁止 fake/mock/preview/demo/sample/fallback 行情或合成图表数据。
- React 组件不得直接请求第三方行情接口，必须走 `UI -> Service -> Provider -> Data Source`。
- 禁止新增 `any`、`as any`、`as unknown as`、`@ts-ignore`。
- 修复问题必须定位根因，不得通过隐藏错误、删除逻辑或伪造数据绕过。
- 单元测试的 `describe` 和 `it` 使用中文。

## 实现目标

实现“动态规划 + 反思”能力，要求做到：

1. **动态计划不是固定模板**
   - 根据 `query`、`intent`、`symbol`、`boardKeyword`、链接、是否单 Agent 等上下文生成计划。
   - 计划项应表达“为什么需要这项检查”“依赖哪些数据”“缺失时如何降级”。
   - 选股/个股分析问题至少覆盖：行情强度、成交额/换手、K 线/技术、资金流、筹码、行业/概念强度、新闻公告/监管风险、相似形态或历史表现、最终风险排除。
   - 不同 intent 应有不同计划，不要所有问题都输出同一套 5 步。

2. **计划要能驱动执行**
   - 计划不能只是 UI 文案，必须映射到实际 DAG 节点或工具需求。
   - 现有固定 DAG 可作为默认执行骨架，但要引入计划层，让 DAG 的节点选择、可选数据项和后续分析说明来自计划。
   - 对于已有 intent 的稳定路径，保持兼容，不要破坏 `/quote`、`technical`、`news-announcements`、`market-review`、`theme-attribution` 等行为。

3. **执行中识别数据缺口**
   - 统一识别数据状态：available / empty / failed / stale / partial / skipped。
   - 区分“工具失败”“真实返回空”“本地数据过旧”“因为计划调整跳过”。
   - 数据缺口要写入 `context`，并能在 `summary_completed` 和最终报告中体现。
   - 不允许把缺失数据包装成正常证据，不允许使用伪造 fallback 数据。

4. **执行后反思并调整计划**
   - 在关键数据节点后运行 reflection：检查计划项是否有足够证据支持。
   - 如果发现关键数据缺失，应能：
     - 增加替代检查节点，例如缺筹码时加强资金流/技术/公告检查；
     - 标记某些分析维度为低置信度或不可判断；
     - 发出 `plan_updated` 或等价事件，让前端能展示“计划调整”。
   - 在最终报告前再做一次 reflection：检查未支撑结论、缺风险提示、伪造数据风险、投资建议措辞。

5. **输出透明化**
   - 前端 run events 里应能看到：初始计划、计划项执行状态、数据缺口、计划调整、反思结果、最终结论。
   - 不要求本次实现完整 UI 改版，但 `AgentRunEvent` 类型和事件数据结构要能承载这些信息。
   - 现有 `runEvents` / `steps` 兼容保留。

6. **保持最小可维护实现**
   - 不要引入新的状态管理库。
   - 不要大改 UI 或重写整个 Agent 系统。
   - 优先在 `electron/services/agent/` 内新增小模块，复用现有工具、证据链和 compliance critic。
   - 代码简洁，避免过度抽象。

## 建议架构

优先采用“规则计划器 + 反思器 + DAG 适配”的混合方案，先做稳定可测试版本，不要一开始完全依赖 LLM 生成执行 DAG。

### 1. 新增动态计划类型

建议新增：`electron/services/agent/agent-planning.ts`

可定义类似类型，命名需遵守项目 TypeScript 规则：

```ts
export type TPlanItemStatus = 'pending' | 'running' | 'completed' | 'skipped' | 'blocked' | 'failed';
export type TPlanDataStatus = 'required' | 'optional' | 'available' | 'empty' | 'failed' | 'stale' | 'partial' | 'skipped';

export interface IAgentPlanItem {
  id: string;
  title: string;
  reason: string;
  dataNeeds: string[];
  dependsOn?: string[];
  optional?: boolean;
  fallbackStrategy?: string;
  status: TPlanItemStatus;
  relatedNodeIds: string[];
}

export interface IAgentPlan {
  id: string;
  intent: IAgentContext['intent'];
  target?: string;
  summary: string;
  items: IAgentPlanItem[];
  assumptions: string[];
  dataGaps: IAgentDataGap[];
  revisions: IAgentPlanRevision[];
}

export interface IAgentDataGap {
  id: string;
  dataName: string;
  status: Exclude<TPlanDataStatus, 'required' | 'optional' | 'available'>;
  reason: string;
  affectedPlanItemIds: string[];
  impact: 'low' | 'medium' | 'high';
  userMessage: string;
}

export interface IAgentPlanRevision {
  id: string;
  reason: string;
  changes: string[];
  createdAt: string;
}
```

注意：不要使用 `any`。如果需要传 raw 值，使用 `unknown` 并做类型收窄。

### 2. 生成初始计划

在 `agent-planning.ts` 增加：

```ts
export function createInitialAgentPlan(context: IAgentContext): IAgentPlan
```

要求：

- 根据 intent 生成不同计划。
- `analysis` 意图中，根据 query 关键词细化计划：
  - 问“能不能买/是否值得关注/选股”：强调行情强度、成交额、板块强度、筹码、公告风险、相似形态、风险排除。
  - 问“为什么涨/异动”：强调涨幅成交、资金流、龙虎榜/大单、新闻公告、题材归因。
  - 问“技术面”：强调 K 线、均线、MACD/KDJ/RSI、量价、支撑压力。
  - 问“风险”：强调公告、监管、跌破关键位、资金流出、筹码松动。
- `news-announcements` 意图应计划新闻、公告、利好利空、证据引用和风险。
- `market-review` 意图应计划指数、涨跌家数、板块、资金流、涨跌停池、风险。
- `board` / `industry-ranking` / `hot-concepts` 应计划板块强度、成分股、资金流、持续性和风险。
- `chat` 非股票问题可以输出简化计划或不输出动态投研计划。

### 3. 计划事件替换固定模板

修改 `orchestrator.ts`：

- 在 `buildAgentWorkflow` 前或后创建 `context.plan`。
- 将 `emitPlanEvent(nodes, emitEvent)` 改为基于 `IAgentPlan` 输出。
- 初始计划 message 应由 plan items 生成，而不是固定 5 步。
- `AgentRunEvent.plan.agents` 当前只有 `{ id, agent, description }`，需要扩展类型或新增字段承载：
  - plan item title/reason/dataNeeds/status
  - relatedNodeIds
  - revisions/dataGaps
- 保持旧前端兼容：`plan.agents` 可以继续填充，但新增字段不要破坏旧逻辑。

建议新增事件类型：

```ts
'plan_updated' | 'reflection_completed' | 'data_gap_detected'
```

如果不想改太多前端，可以先通过现有 `progress_updated` / `summary_completed` 承载，但类型上最好明确新增，便于后续 UI 展示。

### 4. 将数据工具结果同步到计划

在 `agent-tool-runtime.ts` 或新模块中增加数据状态记录能力。

当前 `runContextTool` 会在 record.error 时返回调用方 fallback。需要改进：

- 保留函数签名兼容，但新增记录数据状态的逻辑。
- 工具失败时不要表述为“已使用兜底策略继续分析”，建议改为：
  - `${name} 失败，已记录数据缺口，后续结论将降低置信度`
- 对返回空数组、空对象、无关键字段的情况，调用方或工具运行时应记录 empty/partial。
- 不要把 fallback 视为真实数据，只能作为 TypeScript 流程继续执行的空状态对象。
- `EvidenceSource` 中现有 `'fallback'` 不应继续新增用于生产投研证据；如历史 meta 仍存在，要在反思中标记为数据缺口或低置信度。

建议给 `IAgentContext` 增加字段：

```ts
plan?: IAgentPlan;
dataStatuses?: IAgentDataStatus[];
```

`IAgentDataStatus` 可记录 toolName、dataName、status、reason、relatedPlanItemIds、recordId。

### 5. 反思器

建议新增：`electron/services/agent/agent-reflection.ts`

核心函数：

```ts
export function reflectOnPlanAfterData(context: IAgentContext): IAgentPlanRevision[]
export function reflectBeforeFinalReport(context: IAgentContext): IAgentReflectionResult
```

要求：

- 根据 `context.plan.items`、`context.evidence`、`context.toolCalls`、`context.quote`、`context.kline`、`context.news`、`context.announcements`、`context.chip`、`context.fundFlow`、`context.largeOrders` 等判断证据是否足够。
- 如果 `analysis` 问题需要筹码但 `ctx.chip` 缺失，生成数据缺口：
  - `dataName: '筹码集中度'`
  - `impact: 'medium'` 或视问题高低
  - 用户文案：`筹码集中度数据暂不可用，本轮不输出筹码强弱判断。`
- 如果新闻/公告为空：不能写“无利空”，只能写“新闻/公告数据源未返回可用样本，无法据此排除事件风险”。
- 如果 K 线为空：技术分析维度应 skipped/blocked，不能生成技术形态结论。
- 如果资金流为空：资金面维度低置信度。
- 最终 reflection 要检查：
  - 是否存在没有 evidenceIds 支撑的 findings；
  - 是否缺少风险提示；
  - 是否出现确定性买卖指令；
  - 是否引用了缺失维度做结论；
  - 是否使用禁止 emoji 或娱乐化表述。
- 可复用 `reviewComplianceStructured`，但 reflection 侧重点是“计划执行完整性和证据充分性”。

### 6. DAG 动态调整

不要一次性重写 `executeDag`。建议分两阶段最小改造：

第一阶段：

- `buildAgentWorkflow(context, onToken)` 仍返回 DAG。
- DAG 节点根据 `context.plan` 的 plan items 决定是否加入可选工具，如筹码、资金流、大单、新闻公告。
- `market-data` 节点执行后调用 `reflectOnPlanAfterData(context)`，记录 revisions 和 gaps。
- 分析子 Agent 输入中带上 plan、dataGaps、revisions，让子 Agent 不要对缺失维度下结论。
- `analysis-report` 前调用 `reflectBeforeFinalReport(context)`。

第二阶段（如果改动可控）：

- 支持在数据节点后追加轻量替代节点，例如：
  - 筹码缺失 -> 保留资金流/技术/公告风险检查，不再跑 chip 子 Agent 或将 chip Agent 标为 skipped。
  - 新闻公告为空 -> 增加风险声明，不生成新闻利好利空判断。
- 如果 `executeDag` 支持运行中新增节点，必须保证依赖关系清晰，并补单元测试。否则本次可以先用“计划项状态 + 子 Agent 输入约束 + 最终反思”实现动态调整，不强行做运行时 DAG mutation。

### 7. 子 Agent 输入改造

检查并修改：

- `electron/services/agent/stock-analysis-agents.ts`
- `electron/services/agent/stock-analysis-overview-agent.ts`
- `electron/services/agent/analysis-agent.ts`（如涉及）

要求：

- `buildStockAnalysisInput` 或 `buildStockAnalysisInputForAgent` 加入：
  - `plan`
  - `dataGaps`
  - `planRevisions`
- Prompt 中明确：
  - 只能基于已有证据输出结论。
  - 缺失数据必须标注“无法判断/数据暂不可用”。
  - 不得把空新闻解释为“没有风险”。
  - 不得输出确定性买卖指令。
  - 结论要反映置信度。

### 8. 报告输出要求

最终报告建议包含：

```md
### 分析计划回顾
- 已完成：...
- 跳过/缺失：...
- 计划调整：...

### 关键证据
...

### 数据缺口与影响
...

### 风险排除
...

### 综合结论
...
```

注意遵守 `.claude/rules/emoji.md`：投研标题可用专业金融风格 emoji，但不要使用娱乐化/炒作型 emoji。尤其禁用：`🚀🔥💎🌙🤑🎉`。如果现有规则里二级内容提到业绩增长可用火箭，但本项目全局禁止娱乐化/炒作时，最终投研报告应优先专业克制，避免火箭。

## 关键文件清单

优先修改或新增：

- `electron/services/agent/orchestrator.ts`
  - 创建动态计划、发出计划事件、执行后发出反思事件、最终 summary 展示缺口。

- `electron/services/agent/orchestrator-types.ts`
  - 为 `IAgentContext` 增加 `plan`、`dataStatuses` 或等价字段。

- `electron/services/agent/agent-workflows.ts`
  - 用 plan 指导 DAG 节点描述、可选数据项、数据后反思、最终报告前反思。
  - 修正历史日线失败时的 fallback meta 表述，不要把 fallback 作为真实数据证据。

- `electron/services/agent/agent-tool-runtime.ts`
  - 改进工具失败文案和数据状态记录。
  - `dataGaps(ctx)` 从硬编码少量字段升级为读取 plan/dataStatuses，同时保持旧行为兼容。

- `electron/services/agent/agent-planning.ts`（新增）
  - 初始计划生成、计划项状态更新、plan event message 格式化。

- `electron/services/agent/agent-reflection.ts`（新增）
  - 数据后反思、最终报告前反思、缺口生成、计划修订。

- `src/shared/types.ts`
  - 扩展 `AgentRunEventType`、`AgentRunEvent.plan`，新增共享计划类型时要注意主/渲染进程兼容。

- `electron/services/agent/__tests__/`（新增/修改测试）
  - 测试动态计划、数据缺口、反思、orchestrator 事件。

可能需要检查但尽量少改：

- `src/components/chat-view/**`
  - 如果现有 UI 对 `plan.agents` 有强假设，保持兼容或做最小展示增强。
- `src/styles/rich-content.scss`
  - 不做样式大改，除非新增 markdown 区块显示异常。

## 测试要求

必须新增或更新单元测试，测试文件放在 `__tests__/` 目录，文件名以 `.test.ts` 结尾，`describe` / `it` 使用中文。

建议测试：

1. `agent-planning.test.ts`
   - “选股问题会生成行情、成交额、筹码、板块、公告风险、相似形态、风险排除计划”。
   - “技术面问题会生成技术指标和量价计划，而不是固定五步模板”。
   - “新闻公告意图会生成新闻、公告、利好利空和风险计划”。

2. `agent-reflection.test.ts`
   - “筹码缺失时会生成数据缺口并调整计划”。
   - “新闻公告为空时不会判定无风险，只标注无法排除事件风险”。
   - “K 线为空时技术计划项被标记为 skipped 或 blocked”。

3. `orchestrator` 相关测试
   - `plan_created` message 不再是固定 5 步模板。
   - 数据工具失败时会发出数据缺口/反思事件。
   - `summary_completed` 包含动态 dataGaps。

4. `dag-executor` 如有改动
   - 失败节点不会被误认为成功。
   - 如果保留“失败后继续”，必须在 context/step 里明确失败状态，后续报告知道该依赖不可用。

运行验证：

```bash
pnpm test -- electron/services/agent
pnpm typecheck
```

如果项目测试命令不支持路径参数，使用现有等价 Vitest 命令，并在最终说明里写清楚。

## 验收标准

实现完成后，以下场景应满足：

1. 用户问个股选股/是否值得关注时，`plan_created.message` 展示针对该问题的动态检查清单，不是固定 5 步。
2. `plan_created.plan` 中包含可机器读取的计划项、原因、数据需求和关联节点。
3. 工具失败或返回空时，系统记录明确数据缺口，不伪造行情/新闻/K 线/筹码。
4. 出现关键数据缺失时，系统发出计划调整/反思事件，并在最终总结中说明影响。
5. 子 Agent 和最终报告不会基于缺失数据输出确定性判断。
6. 最终报告包含风险提示和数据缺口说明，不输出“必须买入/卖出”等确定性建议。
7. 现有 `quote`、`technical`、`news-announcements`、`market-review`、`board`、`hot-concepts` 等 intent 不被破坏。
8. TypeScript 编译通过，无新增 `any`、`as any`、`as unknown as`、`@ts-ignore`。
9. 新增关键逻辑有中文单元测试覆盖。

## 实现边界

本次不要做：

- 不要重写整个 Agent 系统。
- 不要把 DAG 执行器改成复杂工作流引擎，除非确有必要且测试充分。
- 不要新增 mock/fake/preview 数据。
- 不要新增状态管理库。
- 不要大规模改动 UI 样式。
- 不要接入新的第三方数据源，除非现有 `stock-sdk` 和 `a-stock-data` 都无法满足且经过确认。
- 不要为了让测试通过降低类型安全或隐藏错误。

## 建议实施步骤

1. 先新增 `agent-planning.ts`，实现纯函数动态计划生成和 plan message 格式化。
2. 扩展 `orchestrator-types.ts` 和 `src/shared/types.ts`，让 context/event 能承载 plan、data gaps、revisions。
3. 修改 `orchestrator.ts`，用动态计划替换固定 `emitPlanEvent` 文案，同时保持旧 `plan.agents` 兼容。
4. 新增 `agent-reflection.ts`，实现数据缺口识别、计划项状态更新、计划修订文案。
5. 修改 `agent-tool-runtime.ts`，记录工具失败/空数据状态，修正“兜底策略”文案。
6. 修改 `agent-workflows.ts` 的 `analysis` 路径：
   - 根据 plan 决定可选数据项；
   - `market-data` 后执行 reflection；
   - 子 Agent 输入携带 plan/gaps；
   - `analysis-report` 前执行最终 reflection。
7. 修改子 Agent prompt/input，让它们尊重数据缺口和计划修订。
8. 增加中文单元测试。
9. 运行针对性测试和 typecheck。
10. 最终说明按项目 bug-fix 风格输出 Root Cause / Fix / Impact / Risk / Verification。

## 额外注意

- 当前 `agent-workflows.ts` 的 `getHistoricalDailyBars` fallback meta 包含 `source: 'fallback'`、`freshness: 'fallback'`。实现时要确保这类数据不会被当作真实证据写入投研结论；应作为数据缺口处理。
- 当前 `runContextTool` 对工具失败统一返回 fallback。可以保留空对象/空数组以避免流程崩溃，但必须在 context 中记录“这是缺口，不是证据”。
- 当前 `executeDag` catch 后把失败节点加入 completed。若不改执行器，至少要让后续 reflection 能从 step/tool status 识别失败依赖，避免下游误判。
- 如果增加新的 `AgentRunEventType`，检查渲染端是否有 exhaustive switch；如果没有，也要保证未知事件不会导致 UI 崩溃。
- 所有新增文案保持专业投研语气，不要夸大，不要娱乐化。
