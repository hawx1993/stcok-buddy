你是资深 TypeScript / Electron / AI Agent 架构工程师。请在当前项目 `/Users/trigkit4/stock-agents` 中，实现 StockBuddy 的 Agent 架构升级：结构化输出、证据链、合规审查、Tool Calling 抽象。

请先完整扫描项目，不要盲目重构。当前项目大致结构如下：

- `electron/services/agent/orchestrator.ts`：核心 Orchestrator，负责 intent 判断、DAG 构建、子 Agent 调度、最终报告。
- `electron/services/agent/dag-executor.ts`：DAG 执行器。
- `electron/services/agent/stock-analysis-agents.ts`：五维子 Agent：technical / fundamental / capital / sentiment / lhb。
- `electron/services/agent/stock-analysis-overview-agent.ts`：五维汇总 Agent。
- `electron/services/agent/report-agent.ts`：普通报告生成。
- `electron/services/agent/risk-agent.ts`：当前简单合规过滤。
- `electron/services/llm/index.ts` 和 `electron/services/llm/openai-compatible-client.ts`：LLM 调用层。
- `electron/services/stock/*`：现有股票数据能力。
- `src/shared/types.ts`：前后端共享类型。
- `src/components/chat-view/index.tsx`：聊天 UI 和 Agent step 展示。

目标不是大重构，而是在现有架构上做最小可用升级。

  Thought for 12s

下面这份可以直接丢给 Claude Code / 另一个 AI 编程助手执行。重点是：在你现有 Electron + Orchestrator + DAG 架构上最小改造，实现：

1. 结构化输出
2. 证据链 Evidence
3. 合规审查 Compliance Critic
4. Tool Calling 抽象
5. 数据来源优先使用 a-stock-data skill / 现有 A 股数据能力

▎ 注意：Claude Code 的 a-stock-data skill 是开发环境技能，App 运行时不能天然直接调用 Claude Code skill。实现时应该把它沉淀成项目内的 tools 抽象：开发时可参考/调用 a-stock-data 获取数据结构和逻辑，运行时仍走 Electron 主进程里的本地 tool adapter。

---
你是资深 TypeScript / Electron / AI Agent 架构工程师。请在当前项目 `/Users/trigkit4/stock-agents` 中，实现 StockBuddy 的 Agent
架构升级：结构化输出、证据链、合规审查、Tool Calling 抽象。

请先完整扫描项目，不要盲目重构。当前项目大致结构如下：

- `electron/services/agent/orchestrator.ts`：核心 Orchestrator，负责 intent 判断、DAG 构建、子 Agent 调度、最终报告。
- `electron/services/agent/dag-executor.ts`：DAG 执行器。
- `electron/services/agent/stock-analysis-agents.ts`：五维子 Agent：technical / fundamental / capital / sentiment / lhb。
- `electron/services/agent/stock-analysis-overview-agent.ts`：五维汇总 Agent。
- `electron/services/agent/report-agent.ts`：普通报告生成。
- `electron/services/agent/risk-agent.ts`：当前简单合规过滤。
- `electron/services/llm/index.ts` 和 `electron/services/llm/openai-compatible-client.ts`：LLM 调用层。
- `electron/services/stock/*`：现有股票数据能力。
- `src/shared/types.ts`：前后端共享类型。
- `src/components/chat-view/index.tsx`：聊天 UI 和 Agent step 展示。

目标不是大重构，而是在现有架构上做最小可用升级。

## 总目标

把当前“固定 DAG + prompt 文本 Agent”升级为：

1. 数据获取通过统一 Tool Calling 抽象完成；
2. 每个子 Agent 输出结构化 JSON；
3. 每条分析结论必须能关联 Evidence；
4. 最终报告生成前经过合规审查 Critic；
5. UI 仍然兼容现有 Markdown 展示，不要求大改界面；
6. 保持 Electron 本地 API Key 和数据访问模式，不把 API Key 暴露到前端。

## 数据来源要求

股票数据全部来自 A 股数据能力，优先参考 / 调用 `a-stock-data` skill 获取所需数据逻辑。

如果当前运行环境可以调用 Claude Code 的 `a-stock-data` skill，请先调用它了解可用数据项和返回结构。

但请注意：Claude Code skill 是开发期能力，不是 App 运行时 API。App 内部必须沉淀为项目代码里的 tool adapter，不能让 Electron App 运行时依赖 Claude Code
skill。

运行时工具应优先复用项目已有能力：

- `electron/services/stock/stock-client.ts`
- `electron/services/stock/news-client.ts`
- `electron/services/stock/indicators.ts`
- `electron/services/agent/data-agent.ts`

如果已有函数足够，不要重复实现数据抓取。

## 一、实现 Tool Calling 抽象

新增目录：

```txt
electron/services/tools/

建议文件：

electron/services/tools/types.ts
electron/services/tools/stock-tools.ts
electron/services/tools/tool-registry.ts

Tool 类型设计

在 electron/services/tools/types.ts 中定义最小工具协议：

```tsx
export interface AgentTool<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  inputSchema: unknown;
  run(input: Input): Promise<Output>;
}

export interface ToolCallRecord {
  id: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  error?: string;
  startedAt: string;
  endedAt?: string;
}
```

不要引入新依赖。如果项目已有 zod，可以用 zod 定义 schema；否

需要实现的工具

在 stock-tools.ts 中至少实现这些工具：

1. resolveStockSymbol
  - 输入：{ query: string }
  - 输出：{ symbol: string; name?: string }
2. getStockQuote
  - 输入：{ symbol: string }
  - 输出：项目现有 StockDetail
3. getStockKline
  - 输入：{ symbol: string; limit?: number; period?: string }
  - 输出：KlinePoint[]
4. getTechnicalIndicators
  - 输入：{ symbol: string }
  - 输出：AgentResultCard 或更结构化的技术指标摘要
5. getMarketNews
  - 输入：{ query: string; page?: number; pageSize?: number
  - 输出：MarketNewsItem[]
6. getStockNewsAnnouncements
  - 输入：{ symbol: string; limit?: number }
  - 输出：{ news: MarketNewsItem[]; announcements: AnnouncementItem[] }
7. getDragonTiger
  - 输入：{ symbol?: string; limit?: number }
  - 输出：龙虎榜相关数据。如果当前只有全市场龙虎榜，就先返回全市场数据并在 evidence 里说明局限。
8. getHotFocus
  - 输入：{ tab: HotFocusTab }
  - 输出：HotFocusItem[]

工具内部优先复用已有函数：

- resolveASymbol
- getQuote
- getKline
- listDailyDragonTiger
- listHotFocus
- listMarketNews
- listStockNewsAnnouncements
- runTechnicalAnalysis

Tool Registry

在 tool-registry.ts 中导出：

```tsx
export const stockToolRegistry = {
  resolveStockSymbol,
  getStockQuote,
  getStockKline,
  getTechnicalIndicators,
  getMarketNews,
  getStockNewsAnnouncements,
  getDragonTiger,
  getHotFocus,
};

export async function callTool(name: string, input: unknown): Promise<ToolCallRecord> {
  // 记录 startedAt / endedAt / output / error
}

```
要求：

- tool 不要吞错误；
- callTool 要把错误记录到 ToolCallRecord.error；
- Orchestrator 可以选择在数据失败时继续 fallback，但 Tool 层本身要忠实返回错误。

二、实现 Evidence 证据链

在 src/shared/types.ts 中新增共享类型：

```tsx
export type EvidenceSource =
  | 'quote'
  | 'kline'
  | 'technical'
  | 'news'
  | 'announcement'
  | 'dragon-tiger'
  | 'hot-focus'
  | 'model'
  | 'fallback';

export interface EvidenceItem {
  id: string;
  source: EvidenceSource;
  title: string;
  summary?: string;
  value?: string | number;
  url?: string;
  timestamp?: string;
  raw?: unknown;
}

export interface StructuredAgentFinding {
  id: string;
  dimension: 'technical' | 'fundamental' | 'capital' | 'sentiment' | 'lhb' | 'overview' | 'risk';
  stance: 'bullish' | 'neutral' | 'bearish' | 'unknown';
  score?: number;
  confidence: number;
  summary: string;
  evidenceIds: string[];
  risks: string[];
}

export interface StructuredAgentOutput {
  agentName: string;
  label: string;
  findings: StructuredAgentFinding[];
  evidence: EvidenceItem[];
  markdown: string;
}
```

如果 raw?: unknown 影响前端序列化或存储，可保留但不要展示。

Evidence 生成规则

新增文件：

electron/services/agent/evidence.ts

实现函数：

export function evidenceFromQuote(quote: StockDetail): Evide
export function evidenceFromKline(symbol: string, kline: KlinePoint[]): EvidenceItem[]
export function evidenceFromTechnical(card?: AgentResultCard
export function evidenceFromNews(news: MarketNewsItem[]): EvidenceItem[]
export function evidenceFromAnnouncements(items: AnnouncementItem[]): EvidenceItem[]
export function evidenceFromDragonTiger(items: DailyDragonTigerItem[]): EvidenceItem[]
export function evidenceFromHotFocus(items: HotFocusItem[]):

要求：

- Evidence id 稳定、可读，例如：
  - quote:600519
  - kline:600519:latest
  - news:600519:0
  - announcement:600519:0
  - lhb:daily:0
- 每条 Finding 必须引用至少一个 evidenceId；
- 如果数据不足，使用 source 为 fallback 的 evidence，并明确说明“数据不足”。

三、改造子 Agent 为结构化输出

改造：

electron/services/agent/stock-analysis-agents.ts

当前 StockAnalysisResult 是：

{
  name;
  label;
  content;
}

请改成兼容结构：

export type StockAnalysisResult = {
  name: StockAnalysisAgentName;
  label: string;
  output: StructuredAgentOutput;
  content: string; // 兼容旧 UI，等于 output.markdown
};

每个子 Agent 的输出要求

每个 Agent 调 LLM 时，不再只要求 Markdown，而是要求模型输出 JSON。

建议 prompt 明确要求返回：

{
  "findings": [
    {
      "id": "technical-1",
      "dimension": "technical",
      "stance": "bullish",
      "score": 72,
      "confidence": 0.68,
      "summary": "股价短期站上主要均线，但量能确认不足。",
      "evidenceIds": ["quote:600519", "kline:600519:latest", "technical:600519"],
      "risks": ["量能不足导致突破失败"]
    }
  ],
  "markdown": "### 📈 技术面\n..."
}

模型输出解析

新增一个安全解析函数，比如：

function parseStructuredAgentOutput(...)

要求：

- 模型返回 JSON 时正常解析；
- 如果模型包了 ```json 代码块，也能解析；
- 如果解析失败，走 fallback；
- fallback 也必须返回合法 StructuredAgentOutput；
- score 限制在 0-100；
- confidence 限制在 0-1；
- stance 只能是固定枚举。

不要为了这个引入新库。用普通 TypeScript 校验即可。

四、改造五维汇总 Agent

改造：

electron/services/agent/stock-analysis-overview-agent.ts

输入从 StockAnalysisResult[] 读取结构化 findings 和 evidence。

要求：

1. 汇总时必须只基于子 Agent 的 findings 和 evidence；
2. 不得编造不存在的数据；
3. 输出仍然是 Markdown，保证 UI 兼容；
4. 报告里新增“证据摘要”小节；
5. 最终评级使用：
  - 🟢 偏利好
  - 🟡 中性
  - 🔴 偏利空

注意项目规则禁止娱乐化 Emoji：不要使用 🔥 🚀 💎 🌙 🤑 🎉。

当前代码里有 🔥 情绪面，请替换为更专业的 🌡️ 情绪面 或 📊 情绪面。

当前代码里 🐉 龙虎榜 也偏娱乐化，建议替换为 📋 龙虎榜 或 💼 席位分析。

同时把“操作建议”改成“观察框架”或“交易观察条件”，避免直接买卖建议。

例如：

### 🧭 观察框架
- 偏强确认条件：
- 转弱风险条件：
- 需要继续跟踪的数据：

不要输出“建议买入 / 建议卖出 / 立即加仓 / 清仓”等措辞。

五、实现 Compliance Critic 合规审查
compliance-critic.ts

导出：

export interface ComplianceReview {
  passed: boolean;
  issues: Array<{
    type: 'investment-advice' | 'fabricated-data' | 'missing-risk' | 'unsupported-claim' | 'forbidden-emoji' | 'other';
    severity: 'low' | 'medium' | 'high';
    message: string;
  }>;
  revisedText: string;
}

export function reviewComplianceStructured(input: {
  text: string;
  evidence: EvidenceItem[];
  findings: StructuredAgentFinding[];
}): ComplianceReview;

合规规则

必须检查并修正：

1. 禁止直接投资建议：
  - 建议买入
  - 建议卖出
  - 立即买入
  - 马上卖出
  - 满仓
  - 重仓
  - 清仓
  - 必涨
  - 稳赚
  - 目标买点
2. 禁止编造数据：
  - 如果文本中出现明显数据结论，但没有对应 evidence，应标记 unsupported-claim。
  - 不要求 NLP 完美，先做简单关键词和 evidence source 检查即
3. 必须包含风险提示：
  - 如果没有“不构成投资建议”，自动追加。
  - 如果没有“风险”相关段落，自动追加简短风险提示。
4. 禁止娱乐化 Emoji：
  - 🚀🔥💎🌙🤑🎉
  - 自动替换成专业表达。
5. 将“操作建议”替换为“观察框架”或“交易观察条件”。

当前 reviewCompliance(text) 可以保留作为兼容包装，但内部调用新的结构化审查。

六、改造 Orchestrator 数据流

改造：

electron/services/agent/orchestrator.ts

要求：

1. 数据获取尽量通过 callTool()；
2. Tool call 结果转成 Evidence；
3. AgentContext 增加：
evidence: EvidenceItem[];
toolCalls: ToolCallRecord[];
findings: StructuredAgentFinding[];
4. 五维分析后，把每个子 Agent 的：
  - output.evidence
  - output.findings
合并进 context。
5. 最终输出前调用 Compliance Critic：
const review = reviewComplianceStructured({
  text: draft,
  evidence: context.evidence,
  findings: context.findings,
});
const content = review.revisedText;
6. events 中增加 tool result 事件：
  - 复用已有 AgentRunEventType 的 tool_result。
7. 保持现有前端不崩。如果前端暂时不展示 evidence，也没关系。

七、ChatResponse 兼容

不要破坏现有 UI。

ChatMessage.content 仍然是 Markdown 文本。

可以给 ChatMessage 增加可选字段：

evidence?: EvidenceItem[];
findings?: StructuredAgentFinding[];
toolCalls?: ToolCallRecord[];
compliance?: ComplianceReview;

但如果这样会引起前端类型改动过大，可以先只放在 events 或内部

优先最小改动。

八、报告输出风格

遵守项目现有专业投研风格。

一级标题建议使用：

📰 核心事件
✅ 利好因素
⚠️ 利空因素
📈 短期影响
🏛️ 中长期影响
🚨 风险提示
🎯 综合结论

二级内容每段最多 1-2 个 Emoji。

禁止：

🚀🔥💎🌙🤑🎉

综合结论必须输出一个最终评级：

🟢 偏利好
🟡 中性
🔴 偏利空

九、测试 / 验证要求

实现后至少运行：

pnpm run typecheck

如果有构建问题，修到通过。

再手动检查以下路径不报 TypeScript 错：

- electron/services/agent/orchestrator.ts
- electron/services/agent/stock-analysis-agents.ts
- electron/services/agent/stock-analysis-overview-agent.ts
- electron/services/agent/compliance-critic.ts
- electron/services/tools/*
- src/shared/types.ts

如果时间允许，增加一个最小自检文件或轻量测试函数，验证：

1. JSON code block 能被解析为结构化输出；
2. 非法 score 会被 clamp 到 0-100；
3. 非法 confidence 会被 clamp 到 0-1；
4. 禁止词会被合规审查替换；
5. 禁止 Emoji 会被替换；
6. 无风险提示时会自动追加“不构成投资建议”。

不要引入测试框架，能用简单函数/类型检查解决就不要加依赖。

十、实现原则

- 最小改动，不大重构。
- 不新增没必要的依赖。
- 优先复用现有 stock-client / news-client / indicators。
- 不破坏现有聊天 UI。
- 不破坏 Electron IPC。
- 不把 API Key 暴露到 renderer。
- 不让模型编造数据。
- 所有 fallback 也必须产生合法结构化输出。
- Tool Calling 先做项目内部抽象，不要求一步到位接 OpenAI function calling。
- 如果某个数据源暂时没有，就返回明确的 fallback evidence，不要假装有数据。

最终交付

请完成代码实现，并在最后汇报：

1. 新增/修改了哪些文件；
2. Tool Calling 抽象如何使用；
3. StructuredAgentOutput 数据结构说明；
4. Evidence 如何生成和传递；
5. Compliance Critic 做了哪些检查；
6. pnpm run typecheck 是否通过；
7. 如果有未完成项，明确列出，不要假装完成。