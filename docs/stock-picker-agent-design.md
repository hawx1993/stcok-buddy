# StockBuddy 选股智能体（超短线技术选股）设计文档

> 适用范围：基于 `/Users/trigkit4/stock-agents`（Electron + React + Vite + 本地 DuckDB）的 StockBuddy 行情分析桌面应用。
> 状态：**MVP 已落地（代码已写入，待 `npm run build` 验证）**。

---

## 1. 目标与 MVP 使用场景

构建一个**自主识别用户意图的选股智能体**：用户用自然语言描述一个超短线（持仓 1–5 个交易日，博涨停 / 连板 / 题材轮动 / 平台突破）技术选股需求，**无需选择工具或写代码**，由大模型自主：

1. 拆解选股条件；
2. 决定调用哪些真实数据工具（先宽筛后精筛）；
3. 多轮取数；
4. 对全市场候选股做技术面筛选与排序；
5. 输出候选清单 + 技术面理由 + 风险提示。

**最简 MVP 场景（一句话触发）**：

> 「帮我选今天涨幅 3%–7%、换手率 >8%、MACD 金叉、90% 筹码集中度 <15%、非 ST、流通市值 30–100 亿的票」

智能体自主执行 `screenLocalAStocks`（宽筛）→ 对 Top N 逐个 `getTechnicalIndicators` / `getStockChipDistributionLocalFirst` / `getStockFundFlowLocalFirst`（精筛）→ 联网检索题材催化（可选）→ 输出候选表。

支持的自然语言入口：
- 直接对话：「帮我选股 / 技术选股 / 超短打板 / 选首板 / 选连板 / 龙头股 / 竞价高开 / 全市场选股」
- 斜杠命令：`/超短选股 找今天涨幅3%-7%、换手率>8%、MACD金叉、90%筹码集中度<15%、非ST、市值30-100亿的票`

---

## 2. 需要考虑的关键因素（已罗列）

### 2.1 超短线技术因子体系（筛选与排序依据）

| 维度 | 具体因子 |
| --- | --- |
| 量价 | 换手率、量比、成交额、涨跌幅、振幅 |
| 形态 | 涨停 / 首板 / 连板 / 炸板、上影 / 下影线、平台突破、跳空缺口 |
| 趋势 | 均线多头（5/10/20）、MACD 金叉 / 死叉、KDJ、BOLL 开口 |
| 筹码 | 90% / 70% 集中度、获利比例、成本单峰密集 |
| 资金 | 主力净流入、大单 / 特大单、龙虎榜游资、北向 |
| 情绪 / 题材 | 连板高度、板块效应、热点题材、消息催化（需联网） |

### 2.2 工程与合规因素

- **真实数据优先**：所有结论必须来自真实工具返回，严禁大模型编造股票 / 价格 / 指标 / 资金。
- **取数顺序**：本地 DuckDB → stock-sdk → a-stock-data；本地预查询已覆盖且时效满足则直接采用。
- **先宽筛后精筛**：全市场宽口径初筛拿候选池，再对 Top N 逐只精筛，避免一次性拉全市场明细导致上下文爆炸。
- **结果截断风险**：全市场筛选可能上百行，JSON 在 4000 字符处被截断会让模型只看到部分股票 → 改为「代码 名称 涨幅 换手 量比 筹码90% 主力净流入」逐行紧凑输出，并先给 matchedCount / returnedCount，上限 20000 字符。
- **工具调用预算**：最多 5 轮工具调用，避免死循环 / 失控成本。
- **能力缺口兜底**：联网搜索未配置 API Key 时返回「数据缺口提示」而非崩溃；候选为 0 时如实说明，禁止虚构。
- **合规红线**：A 股 T+1、超短线波动极大、不构成买卖建议；禁止确定性买卖指令；固定保留风险提示段；UI 文本禁用 🚀🔥💎🌙🤑🎉 等 emoji。
- **内部约束泄漏防护**：finalize 阶段正则清洗，防止模型把「工具调用上限 / 执行预算 / 系统约束」当成数据缺口原因暴露给用户。
- **UI 进度可见**：工具调用过程通过 `progress_updated` / `subagent_*` 事件在 AnalysisProgress 卡片与 Agent 协作区展示。

---

## 3. 架构与执行范式

复用既有 `a-stock-data-agent` 的 **ReAct 式 prompt 工具调用**范式（非原生 LangChain bindTools）：

```
用户自然语言 query
   ↓ 意图路由（intent-routing.ts）
intent = 'stock-picker'
   ↓ DAG 编排（agent-workflows.ts → orchestrator.ts → executeDag）
节点 stock-picker-agent.run(ctx) = agenticStockPickerAnswer(ctx)
   ↓ 多轮循环（MAX_TOOL_ROUNDS = 5）
LLM(system + user) → generateReport → parseToolCall（解析 {"tool","input"}）
   → runContextTool（自动 DuckDB 本地优先 + 写 toolCalls + emit 事件）
   → 结果 summarize 回灌 messages
   ↓ 预算耗尽或模型不再请求工具
finalizePickerAnswer → 输出 Markdown 候选清单
```

**关键文件（本次新增 / 修改）**：

| 文件 | 改动 |
| --- | --- |
| `electron/services/agents/stock-picker-agent.ts` | **新增**——核心智能体：system prompt、结果压缩、多轮 ReAct 循环、合规 finalize |
| `electron/services/agents/stock-picker-agent-tools.ts` | **新增**——选股工具白名单 `STOCK_PICKER_TOOLBOX`（11 个真实工具）+ 复用 `parseToolCall` |
| `electron/services/agents/tools/web-search.ts` | **新增**——`webSearch` 工具（Tavily / Serper，未配置 Key 优雅降级） |
| `electron/services/agents/tools/index.ts` | 导出 `webSearch` |
| `electron/services/agents/tool-registry.ts` | 注册 `webSearch` 到 `stockToolRegistry` 导入与 satisfies 对象 |
| `electron/services/agents/intent-routing.ts` | 新增 `/超短选股` 斜杠命令；`classifyIntent` 超短正则；`applyStockAgentRouting` 防覆盖；`intentLabel` 标签 |
| `electron/services/agents/agent-workflows.ts` | 新增 `stock-picker` 意图分支，挂载 `stock-picker-agent` 节点 |
| `electron/services/agents/orchestrator-types.ts` | `TAgentIntent` 联合类型加入 `'stock-picker'` |
| `src/shared/types.ts` | `TAgentPlanIntent` 联合类型加入 `'stock-picker'` |
| `src/components/chat-view/components/analysis-progress/derived.ts` | 4 处 `'a-stock-data-agent'` 判断同时兼容 `'stock-picker-agent'`（UI 进度卡兼容） |

---

## 4. 完整 Prompt（system prompt）

> 以下即 `buildStockPickerSystemPrompt()` 注入给模型的完整内容（含工具白名单，运行时由 `STOCK_PICKER_TOOLBOX` 拼接）。

```
你是 StockBuddy 的「超短线技术选股」智能体。用户用自然语言描述一个超短线（持仓 1–5 个交易日，博涨停/连板/题材轮动/平台突破）的技术选股需求，你必须：自主拆解条件 → 决定调用哪些真实数据工具 → 多轮取数 → 对全市场候选股做技术面筛选与排序 → 输出候选清单与理由。严禁编造任何股票、价格、指标或资金数据。

可调用工具（真实数据源，仅以下白名单）：
<由 STOCK_PICKER_TOOLBOX 拼接：每个工具一行 "- 名称：描述">

超短线技术因子体系（你筛选与排序的依据）：
- 量价：换手率、量比、成交额、涨跌幅、振幅
- 形态：涨停/首板/连板/炸板、上影/下影线、平台突破、跳空缺口
- 趋势：均线多头（5/10/20）、MACD 金叉/死叉、KDJ、BOLL 开口
- 筹码：90%/70% 集中度、获利比例、成本单峰密集
- 资金：主力净流入、大单/特大单、龙虎榜游资、北向
- 情绪/题材：连板高度、板块效应、热点题材、消息催化（需联网）

决策与工具调用协议（严格遵守）：
1. 先宽筛后精筛：第一步用 screenLocalAStocks 做全市场宽口径初筛（changePercent/turnoverRate/concentration90Max/includeST/limit）拿到候选池；再对候选池 Top N 逐只调用 getTechnicalIndicators / getStockChipDistributionLocalFirst / getStockFundFlowLocalFirst 验证，必要时 getStockSurgeEventsLocalFirst / getDragonTiger 看异动与游资。
2. 每轮只输出一行 JSON：{"tool":"工具名","input":{...}}，不要输出其他文字；input 为空写 {}。
3. 每轮最多一个工具；需要多个数据就连续多轮调用。
4. 取数顺序：本地 DuckDB → stock-sdk → a-stock-data；本地预查询已覆盖且时效满足则直接采用。
5. 工具返回"暂不可用/空"时明确标注数据缺口，不得脑补；候选为 0 时如实说明，禁止虚构。
6. 条件矛盾或数据不足时，返回空清单并说明原因。
7. 最多 5 轮工具调用预算，避免死循环。

输出格式（最终回答，Markdown）：
## 选股结论
- 一句话：今日符合条件约 N 只（数据缺口：…）
## 候选清单（按综合评分降序）
| 排名 | 代码 | 名称 | 涨幅% | 换手% | 量比 | MACD | 筹码90% | 主力净流入 | 评分 | 一句话理由 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
（评分 0–100，基于：量价健康、趋势多头、筹码集中、资金流入、题材/情绪共振；并标明置信度）
## 技术面理由（逐只 2–3 句）
## 风险提示
- 超短线波动极大，本结果仅基于历史技术面与公开数据，不构成任何买卖建议；A 股 T+1，当日买入次日方可卖出；需结合实时盘口、仓位管理与止损纪律独立决策。

遵守：禁止 🚀🔥💎🌙🤑🎉；每段至多 2 个 Emoji；不使用确定性买卖指令；必须保留风险提示。
```

---

## 5. 工具白名单（STOCK_PICKER_TOOLBOX，11 个真实工具）

| 工具 | 用途 | 关键输入 |
| --- | --- | --- |
| `screenLocalAStocks` | 全市场本地宽筛（DuckDB 行情快照 + 筹码缓存），初筛第一步必用 | changePercentMin/Max、turnoverRateMin/Max、concentration90Max、chipLookbackDays、chipMatchMode、includeST(默认 false)、limit、sortBy |
| `screenASharesByMarketCap` | 按市值区间全市场筛选（小盘超短思路） | minMarketCap/maxMarketCap、turnoverRateMin/Max、marketCapField、includeST |
| `getTechnicalIndicators` | 技术指标摘要（MACD/KDJ/均线/量比/BOLL），精筛验证 | `{symbol}` |
| `getStockChipDistributionLocalFirst` | 筹码分布（90%/70% 集中度、获利比例、成本单峰），本地优先 | `{symbol, days?}` |
| `getStockFundFlowLocalFirst` | 主力资金流（净流入、大单/特大单），本地优先 | `{symbol}` |
| `getStockSurgeEventsLocalFirst` | 异动/盘口大单（游资痕迹、快速拉盘跳水），本地优先 | `{symbol, days?, limit?, minHands?}` |
| `getDragonTiger` | 龙虎榜上榜与游资席位（买方营业部、机构专用） | `{symbol}` |
| `getHotConcepts` | 今日热门题材与概念归属（踩中热点判断） | 无 |
| `getMarketReview` | 全市场情绪、涨停梯队、热点板块（情绪周期/板块效应） | 无 |
| `readUrl` | 读取指定 URL 正文（消息催化核查） | `{url}` |
| `webSearch` | 联网搜索题材/消息催化（Tavily/Serper，需 API Key） | `{query, maxResults?}` |

---

## 6. 上网搜索能力（webSearch）

- 数据源：Tavily（`TAVILY_API_KEY`）或 Serper（`SERPER_API_KEY`），优先级 Tavily > Serper。
- 超时：15s `AbortController`。
- **优雅降级**：未配置 Key 时返回 `source:'unconfigured'` + 警告，提示改用 `getHotConcepts` / `getMarketReview` 或 `readUrl`，**不抛异常、不崩溃**。
- 失败兜底：网络错误返回 `source:'error'` + 原因，仍为空结果。`normalizeTavily` / `normalizeSerper` 统一为 `{title, url, snippet}`。
- 典型链路：用户提到题材消息 → `webSearch` 返回链接+摘要 → `readUrl` 读正文 → 评估催化强度。

---

## 7. 意图路由规则

`classifyIntent` 中（在 technical 分支之前）命中以下正则即路由到 `stock-picker`：

```regex
/超短|打板|首板|连板|龙头股?|竞价高开|技术选股|帮我选股|筛选股票|选出.*股票|找出.*符合.*股票|全市场.*选股|超短线选股/
```

- 斜杠命令：`/超短选股` → `intent: 'stock-picker'`。
- `applyStockAgentRouting` 增加保护：`if (intent === 'stock-picker') return 'stock-picker';` 防止被 `a-stock-data-agent` 兜底分支覆盖。
- 标签：`intentLabel['stock-picker'] = '超短线技术选股'`。

---

## 8. 验证清单（交付前必跑）

- [ ] `npm run build`（Electron 主进程 TS 编译 + 渲染进程 Vite 构建）
- [ ] TypeScript 类型检查通过（新增 `webSearch` 已注册到 `stockToolRegistry` 的 `satisfies Record<string, AgentTool>`，类型须闭合）
- [ ] 初始化联网搜索：若在 `.env` 配置 `TAVILY_API_KEY` / `SERPER_API_KEY`，验证 `webSearch` 返回真实结果；未配置时验证降级提示
- [ ] 触发一次自然语言选股（如「帮我选今天换手>8%、90%筹码集中度<15%、非ST 的票」），确认 AnalysisProgress 卡片展示工具调用进度、最终输出 Markdown 候选表

---

## 9. 已知限制与后续可扩展点

- 联网搜索依赖第三方 API Key；未配置时仅能做「本地数据 + readUrl（需用户给链接）」的选股。
- 宽筛结果上限受 `limit` 与 20000 字符压缩约束；超大规模全市场扫描可能需分页。
- 评分公式为模型自由裁量（基于描述因子），尚未固化为可单测的确定性打分函数；后续可沉淀 `scoring.ts` 做可复现评分。
- 可扩展：接入实时盘口（tick）数据做竞价高开强度排序、连板梯队自动归因、回测验证超短策略胜率。
