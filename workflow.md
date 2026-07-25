# 任务：修复普通问答 Agent，使其能自动编排数据查询工作流并回答用户

## 背景与现象

StockBuddy 当前普通对话（`intent === 'chat'`）存在工作流空转问题：

- 用户输入示例：`帮我查找换手率大于 10% 的股票`
- 页面显示“普通问答”，但任务流程为 `0/1`，没有实际工具调用、没有结果内容。
- 当前根因位于 `electron/services/agent/agent-workflows.ts`：
  - 当 `context.intent === 'chat'` 且没有识别到股票代码时，只构造了一个空的 `chat` DAG 节点；
  - 节点没有调用任何数据工具；
  - `electron/services/agent/orchestrator.ts` 对 `chat` 不执行报告生成；
  - 最终 `draft` 为空，导致无法向用户输出有效回答。

## 目标

将“普通问答”升级为可自主决策的研究型 Agent：

1. 用户使用自然语言提出股票、市场、板块、选股、排行、筛选、资金流、技术指标、新闻等需求时：
   - Agent 必须理解意图；
   - 根据需求自动选择数据工具；
   - 自动构建并执行 DAG 工作流；
   - 汇总真实数据证据；
   - 输出清晰、专业、可审计的中文回答。

2. 用户示例：
   - “帮我查找换手率大于 10% 的股票”
   - “今天主力净流入最多的股票有哪些？”
   - “找出近期涨停且换手率较高的个股”
   - “半导体板块今天表现如何？”
   - “帮我筛选成交额较大的强势股票”
   - “今天市场有什么热点？”

3. 不应要求用户必须使用 `/复盘今日行情`、`/题材归因` 等斜杠命令；普通自然语言也必须能完成对应的数据查询和分析。

---

## 必须遵守的架构约束

### 数据调用链路

严格遵循：

```text
UI → IPC → Orchestrator → Agent Workflow → Tool Registry → Service / Provider → Data Source
```

禁止：

- React 组件直接请求第三方接口；
- 在 UI 中拼接、模拟或硬编码行情；
- 为普通问答新增 mock、preview、demo、sample、fake fallback 行情；
- 数据请求失败时返回伪造股票、伪造价格、伪造筛选结果或伪造图表。

### 数据源优先级

1. 优先复用已接入的 `stock-sdk`；
2. 当 `stock-sdk` 不支持、数据不足或不适合当前场景时，使用 `a-stock-data skills` / 已注册的 `a-stock-data` 工具；
3. 两者均无法获取时：
   - 返回明确的数据缺失或错误说明；
   - 保留已获得的真实证据；
   - 不得编造结果。

### 类型与代码质量

- 不新增 `any`、`as any`、`as unknown as`、`@ts-ignore`；
- 使用已有共享类型并补充必要的严格类型；
- 一个 React 组件文件只维护一个主组件；
- 不修改与本需求无关的 UI；
- 保持 `pnpm run typecheck` 通过。

---

## 现有代码与复用点

优先阅读并复用以下文件与能力：

### 路由与编排

- `electron/services/agent/intent-routing.ts`
  - `classifyIntent`
  - `intentLabel`
  - `extractBoardKeyword`

- `electron/services/agent/orchestrator.ts`
  - `runOrchestrator`
  - `emitPlanEvent`
  - `reviewComplianceStructured`
  - `streamContent`

- `electron/services/agent/agent-workflows.ts`
  - `buildAgentWorkflow`
  - 已有 `theme-attribution`、`daily-lhb`、`market-review`、`analysis` 的 DAG 节点模式
  - `runContextTool`

- `electron/services/agent/orchestrator-types.ts`
  - `IAgentContext`
  - `TAgentIntent`
  - 如需为普通问答保存任务规划、筛选参数、数据结果，应在这里以严格类型扩展上下文。

### 工具与数据能力

- `electron/services/tools/tool-registry.ts`
  - 先检查已有可调用工具；
  - 优先通过工具注册层暴露能力，而不是让 Agent 直接访问第三方接口。

- `electron/services/agent/agent-tool-runtime.ts`
  - 复用 `runContextTool`；
  - 确保工具调用记录、失败记录、证据收集链路完整。

- `electron/services/stock/stock-client.ts`
  - 已存在真实行情、市场行情、热点、资金流、K 线、技术指标等能力；
  - `stock-sdk` 已是现有优先数据源；
  - `a-stock-data` 已存在部分能力和降级实现，应通过统一工具层使用。

- `electron/services/agent/evidence.ts`
  - 复用或补充证据构造逻辑；
  - 最终回答必须能追溯到真实数据来源。

- `electron/services/agent/agent-result-cards.ts`
  - 复用已有卡片和市场摘要生成能力；
  - 必要时新增“条件选股结果”卡片，但不要把复杂 UI 逻辑塞进普通对话流程。

---

## 实现方案

### 1. 新增“普通问答任务规划”能力

不要把所有普通对话都简单归类为 `board` 或 `chat`。

建议新增明确的普通研究问答意图，例如：

```ts
type TAgentIntent =
  | ...
  | 'research-query';
```

或保留 `chat`，但为 `chat` 增加一个任务规划阶段。

任务规划应从自然语言中提取以下信息：

```ts
interface IResearchQueryPlan {
  category:
    | 'stock-screener'
    | 'market-ranking'
    | 'sector-analysis'
    | 'fund-flow'
    | 'hot-topic'
    | 'news-query'
    | 'general-market-question';
  filters: {
    turnoverRate?: {
      operator: 'gt' | 'gte' | 'lt' | 'lte' | 'between';
      value?: number;
      maxValue?: number;
    };
    changePercent?: ...;
    amount?: ...;
    volume?: ...;
    limit?: number;
  };
  sort?: {
    field: 'turnoverRate' | 'changePercent' | 'amount' | 'mainNetInflow' | ...;
    order: 'asc' | 'desc';
  };
  target?: {
    symbol?: string;
    boardKeyword?: string;
  };
  requiredData: Array<
    'market-quotes'
    | 'fund-flow'
    | 'hot-focus'
    | 'sector-ranking'
    | 'limit-up-pool'
    | 'stock-news'
    | 'technical-indicators'
  >;
}
```

要求：

- 不能只依赖正则覆盖所有表达；
- 简单高置信规则可直接解析；
- 复杂或模糊请求可使用当前已配置的 LLM 做结构化任务规划；
- LLM 仅负责“理解与计划”，不得虚构行情数据；
- 计划生成后，必须由程序根据白名单映射为可执行工具调用；
- 不允许 LLM 自由拼接 URL、执行 Shell 或调用未注册工具。

### 2. 为普通问答动态构造 DAG

在 `buildAgentWorkflow` 中，针对普通研究类问题构建真实节点，而非空节点。

以“换手率大于 10% 的股票”为例，建议 DAG：

```text
research-plan
  ↓
market-quote-data
  ↓
screen-by-turnover-rate
  ↓
research-answer
```

节点职责：

#### `research-plan`

- 解析用户自然语言；
- 明确筛选条件、排序方式和所需数据；
- 将计划写入 `IAgentContext`；
- 通过事件流向前端输出“已识别任务：筛选换手率大于 10% 的 A 股”。

#### `market-quote-data`

- 优先调用已注册的真实全市场行情工具；
- 返回必须包含股票代码、名称、最新价、涨跌幅、换手率、成交额等真实字段；
- 如现有 `stock-sdk` 工具无法获得覆盖全市场的换手率列表，再使用已注册的 `a-stock-data skills` 真实市场排行/行情 API；
- 记录数据源、数据时间、工具调用和证据。

#### `screen-by-turnover-rate`

- 在服务端基于真实返回行执行严格筛选；
- `turnoverRate > 10`；
- 默认按换手率降序排序；
- 默认限制前 20 条，避免普通对话输出过量数据；
- 保留总样本量、有效换手率样本数、命中数量；
- 不得把缺失换手率当作 0，也不得纳入命中结果。

#### `research-answer`

- 将结果转换为专业中文 Markdown；
- 明确数据时间、数据源、筛选口径与结果数量；
- 输出结构化表格；
- 数据不足时说明具体缺失字段或数据源状态；
- 通过 `reviewComplianceStructured` 做合规审查；
- 输出结束时附加投资风险提示。

### 3. 将已有专用能力纳入普通问答

普通自然语言应自动复用已有工作流，而不是要求用户记忆命令：

| 用户意图 | 应复用/映射能力 |
| --- | --- |
| 今日行情复盘 | `market-review` |
| 龙虎榜净买入排行 | `daily-lhb` |
| 热点/题材归因 | `theme-attribution` |
| 个股新闻与公告 | `news-announcements` |
| 个股五维分析 | `analysis` |
| 板块、行业、资金流 | `board` 或新增细分 research workflow |
| 条件选股、排序筛选 | 新增 `stock-screener` research workflow |

例如：

- “换手率大于 10% 的股票” → `stock-screener`
- “今天龙虎榜净买入最多的股票” → `daily-lhb`
- “今天哪些题材强势” → `theme-attribution`
- “帮我分析贵州茅台” → `analysis`
- “半导体板块今天资金流如何” → 板块数据 + 资金流数据 + 回答节点

### 4. 修复最终回答为空的问题

在 `electron/services/agent/orchestrator.ts` 中：

- 不再让 `chat` / `research-query` 因为 `hasReportStep === false` 而跳过结果生成；
- 普通问答工作流必须有明确的最终回答节点，写入：
  - `context.analysisOverview`，或
  - `context.board?.narrative`，或
  - 新增严格类型的 `context.researchAnswer`；
- `draft` 的优先级要包含普通研究回答；
- 如果全部数据工具失败，也必须输出可读错误回答，而不是空字符串；
- 事件进度必须和实际 DAG 节点数量一致，避免出现 `0/1` 无实际执行的状态。

### 5. 输出格式要求

对于筛选型问题，按以下风格输出：

```md
## 📰 查询结果

已按“换手率 > 10%”筛选最近一次可用 A 股行情数据。

- 数据时间：{真实时间或“数据源未返回时间”}
- 数据来源：{stock-sdk / a-stock-data}
- 有效样本：{真实数量} 只
- 命中结果：{真实数量} 只
- 排序方式：换手率从高到低

| 代码 | 名称 | 最新价 | 涨跌幅 | 换手率 | 成交额 |
| --- | --- | ---: | ---: | ---: | ---: |
| ...真实数据... |

## 📈 短期影响

换手率反映筹码交易活跃程度，不直接代表上涨确定性。高换手个股需结合涨跌幅、成交额、板块热度及资金流进一步判断。

## 🚨 风险提示

- 数据可能存在延迟、停牌、字段缺失或盘中变化。
- 高换手也可能对应分歧扩大、获利盘兑现或高波动。
- 以上内容仅供研究参考，不构成投资建议。
```

要求：

- 不使用娱乐化、炒作型 Emoji；
- 每段最多 1～2 个 Emoji；
- 不得把“高换手”表述为必然利好或买入建议；
- 所有表格数值必须来自真实工具返回。

---

## 错误与空状态要求

下列情况必须明确说明，不能伪造数据：

1. 数据源失败；
2. 真实结果为空；
3. 返回数据没有换手率字段；
4. 非交易日或盘前盘后数据无实时更新；
5. 筛选范围无法从当前数据能力覆盖全市场；
6. 用户条件表达歧义且无法可靠执行。

示例：

```md
## 🚨 数据状态

当前数据源未返回可用于全市场筛选的换手率字段，因此无法可靠列出“换手率大于 10%”的个股。请稍后重试，或改为查询指定股票的实时换手率。
```

---

## 验证要求

至少覆盖以下场景：

1. `帮我查找换手率大于10%的股票`
   - 有真实工具调用；
   - 有明确的计划、数据获取、筛选、回答步骤；
   - 结果包含真实换手率；
   - 不再出现 0/1 空转。

2. `今天主力资金净流入最多的股票有哪些？`
   - 自动路由到资金流或排行工作流；
   - 输出真实排序结果。

3. `今天市场有什么热点？`
   - 自动复用热点/题材数据工作流；
   - 有数据来源和风险提示。

4. `帮我分析 600519`
   - 不影响现有个股分析工作流。

5. 数据源异常、返回空数组、缺字段
   - 输出明确空/错误状态；
   - 不输出 fake data。

6. 运行：

   ```bash
   pnpm run typecheck
   pnpm run selfcheck:orchestrator
   ```

如当前 selfcheck 覆盖不足，请为普通问答任务规划与 DAG 构建增加最小必要的自检用例。

---

核心改动点会集中在：

- `electron/services/agent/intent-routing.ts`
- `electron/services/agent/orchestrator.ts`
- `electron/services/agent/agent-workflows.ts`
- `electron/services/agent/orchestrator-types.ts`
- `electron/services/tools/tool-registry.ts`（如当前没有全市场筛选所需工具）
- `electron/services/agent/orchestrator.selfcheck.ts`

这样实现后，“普通问答”不再是空流程，而会成为一个受工具白名单、真实数据源和证据链约束的动态任务编排 Agent。
