# A股智能投研 Agent —— 产品设计 PRD

> 定位：一个融合 Tool Use / Function Calling / Multi-Agent 协作 / 工作流编排 / Browser Automation / RAG / Memory 的全栈 AI Agent 练手项目，数据层基于 [stock-sdk](https://github.com/chengzuopeng/stock-sdk)（已内置只读 MCP Server）。
> 目标：作为你从前端转 AI Agent 方向的作品集项目，覆盖面试中会被高频考察的架构决策点。

---

## 0. 产品一句话

**"股察"（StockSense）**：对话式 A 股投研助手。用户用自然语言提问（选股、诊股、盯盘、复盘），Agent 自主编排多个子 Agent 完成数据取数、指标计算、舆情抓取、风险核查、报告生成的全链路，并具备跨会话记忆（持仓、偏好、历史结论）。

---

## 1. 用户与场景

| 场景 | 示例 Query | 涉及能力 |
|---|---|---|
| 个股诊断 | "帮我分析一下贵州茅台最近走势，有没有金叉信号" | kline + indicators/signals，单 Agent 即可 |
| 板块选股 | "半导体板块里，近5日主力资金净流入且MACD金叉的票有哪些" | board + fundFlow + signals，需要批量+过滤，DAG 编排 |
| 消息面核查 | "这只票最近有没有利空公告或负面新闻" | SDK 无法覆盖 → Browser Automation 抓公告/新闻 + RAG 检索历史类似事件 |
| 盯盘提醒 | "603xxx 涨停/异动了提醒我" | marketEvent 轮询 + 长时运行 workflow + memory 存监控清单 |
| 复盘/持仓管理 | "我上周买的票现在什么情况，跟我说的逻辑还成立吗" | Memory（长期）+ 重新取数 + 对比历史结论 |
| 组合诊断报告 | "给我出一份本周持仓周报" | Multi-agent 协作 + 模板化报告生成 |

**关键产品原则**：Agent 只做研究辅助与信息聚合，**不做买卖建议**（合规红线，PRD 第 9 节展开）。

---

## 2. 系统总览架构

```
┌─────────────────────────────────────────────────────────────┐
│                        用户交互层（Chat UI）                    │
└───────────────────────────┬───────────────────────────────────┘
                             │
                    ┌────────▼─────────┐
                    │  Orchestrator      │  ← 意图识别 + 任务规划 + 编排调度
                    │  (Supervisor Agent)│
                    └────────┬─────────┘
        ┌───────────┬────────┼────────┬────────────┬─────────────┐
        ▼           ▼        ▼        ▼            ▼             ▼
   DataAgent   AnalysisAgent NewsAgent RiskAgent  ReportAgent  MemoryAgent
   (取数)      (指标/信号)   (舆情/浏览器) (合规/风控) (归纳输出)  (记忆读写)
        │           │           │          │             │
        ▼           ▼           ▼          ▼             │
   stock-sdk    indicators/  Browser    Rule Engine       │
   (MCP Tools)  signals       Automation  + LLM Judge      │
                (纯函数)      (Playwright)                 │
                                                            ▼
                                                    Vector DB + SQL/KV
                                                 (RAG 知识库 + Memory 存储)
```

这是典型的 **Supervisor-Worker 多 Agent 模式**（区别于 Peer-to-Peer 协作），理由见第 5 节。

---

## 3. Tool Use / Function Calling 设计

### 3.1 工具分层

工具不是拍脑袋定义，而是**按数据来源的确定性分层**，这直接决定了后面的 error handling 策略：

| 层级 | 工具类型 | 特点 | 示例 |
|---|---|---|---|
| L1 结构化数据工具 | stock-sdk 命名空间方法（经 MCP 暴露） | Schema 确定、幂等、可重试 | `quotes.cn`、`kline.cn`、`fundFlow.stock`、`board.concept.list`、`dragonTiger.detail`、`marketEvent.limitUp` |
| L2 纯计算工具 | `stock-sdk/indicators`、`stock-sdk/signals` | 无网络调用，本地执行，零延迟 | `calcMACD`、`calcKDJ`、`calcSignals` |
| L3 半结构化/非结构化工具 | Browser Automation | 无固定 Schema，需要页面理解 | 抓取交易所公告、股吧情绪、研报摘要 |
| L4 内部工具 | Memory / RAG 检索 | 面向 Agent 自身状态 | `memory.get_watchlist`、`rag.search_similar_case` |

**关键设计决策**：L1 直接复用 stock-sdk 自带的 MCP Server（`stock-sdk mcp`），不用重新包装 —— 它已经是「只读命名空间方法 → tool manifest（name/description/inputSchema/invoke）」的 SSOT 设计，Orchestrator 作为 MCP Client 接入即可。这一点在面试里是加分项：**知道什么时候不需要重新造轮子**。L2/L3/L4 是你自己包装的 Function Calling 工具，走标准 Anthropic tool_use 协议。

### 3.2 Function Calling 处理流程

1. **意图识别**：Orchestrator 用一次轻量 LLM 调用做 query classification（选股 / 诊股 / 盯盘 / 复盘 / 闲聊），决定要不要进入 Agent 编排流程（闲聊直接短路返回，节省 token）。
2. **符号归一化前置**：所有涉及标的的请求，先过 `normalizeSymbol`（stock-sdk/symbols）把用户输入的"茅台"/"600519"/"贵州茅台"统一成标准 symbol，**不要让 LLM 去猜代码** —— 这是最容易出幻觉的地方，必须用确定性代码兜底，LLM 只做公司名→代码的模糊匹配（可配合 `sdk.search()`）。
3. **工具选择**：用 Anthropic tool_use，把 L1/L2/L4 工具的 JSON Schema 作为 `tools` 参数传入。**为什么不用一个大 tool 而是多个细粒度 tool**：细粒度工具让模型的参数生成错误率更低，且方便按 Agent 角色做工具白名单隔离（AnalysisAgent 看不到 DataAgent 的取数工具，只能看到指标计算工具，减少误用）。
4. **参数校验层**：LLM 生成的 tool_use.input 不直接扔给 SDK，中间加一层 schema validate + 业务规则校验（如日期范围、K线 period 枚举值），校验失败**不是直接报错给用户**，而是把错误信息作为 tool_result 返回给模型，让模型自我修正（self-correction loop），最多重试 2 次后降级为向用户提问。
5. **并行调用**：多标的批量场景（选股类）用 stock-sdk 的 `batch` 命名空间做一次批量取数，而不是让模型对每只票分别发起 tool call —— 这是**成本与延迟优化点**，也是常被问到的"你怎么控制 tool calling 的调用次数"。
6. **结果压缩再回填**：K线原始数据（如 250 个交易日 OHLCV）绝不整段塞回 context，只回填 `indicators/signals` 计算后的结构化摘要（如"MACD 金叉发生于 3 个交易日前，当前 DIF/DEA 值…"），原始数据落盘/存 Redis，Agent 需要时再按需 fetch 具体区间。

### 3.3 错误处理与降级

| 故障类型 | 处理策略 |
|---|---|
| SDK 数据源超时/限流 | 指数退避重试 2 次 → 切换该命名空间下的备用 provider（如果 SDK 底层有多数据源）→ 仍失败则告知用户该数据暂不可用，不编造数据 |
| 参数校验失败 | 反馈给模型自纠正，而非直接抛异常给用户 |
| 停牌/无数据股票 | 识别为业务正常状态，不算 error，直接在回复中说明"该股当前停牌" |
| Browser Automation 抓取失败 | 降级为"仅结构化数据结论 + 提示消息面信息未能获取"，绝不用 LLM 编造新闻内容 |

---

## 4. 工作流编排（Workflow Orchestration）

### 4.1 编排模型：DAG + 有限状态机混合

不用单一线性 pipeline，因为不同 query 类型的任务图差别很大。设计为：

- **Plan 阶段**：Orchestrator 先生成一个任务 DAG（哪些子任务可并行、哪些有依赖），而不是硬编码流程。例如"半导体选股"的 DAG：
  ```
  [板块成分股列表] ─┬→ [批量行情+指标] ─┐
                    └→ [批量资金流向]  ─┴→ [过滤+排序] → [报告生成]
  ```
- **Execute 阶段**：按 DAG 拓扑序执行，无依赖节点并行 fan-out（如上面"批量指标"和"批量资金流向"可同时发起）。
- **状态机兜底**：对于"盯盘"这类长时运行任务，DAG 不适用，改用状态机（`WATCHING → TRIGGERED → NOTIFIED → WATCHING`），由定时任务驱动轮询 `marketEvent`。

### 4.2 编排引擎选型建议

- 手写一个轻量 DAG executor（几十行状态管理）即可覆盖 MVP，能讲清楚"节点/边/依赖解析/并行调度"的原理，比直接套 LangGraph 更能体现你对编排本质的理解。
- 若想对齐主流框架话术，可以类比说明：你的 Supervisor = LangGraph 的 `StateGraph` 概念，子 Agent = `node`，DAG 依赖 = `edge`，共享状态 = `state`。面试时能双向映射说明你不依赖框架也理解底层模型。

### 4.3 中断与人工介入点（Human-in-the-loop）

- 涉及"是否要执行 Browser Automation 抓取第三方网站"这类有一定成本/风险的步骤，设计一个可配置的 confirm gate（默认关闭，高级模式可开启，类似 Claude Code 的 permission 机制，这块你已经很熟）。

---

## 5. Multi-Agent 协作设计

### 5.1 为什么选 Supervisor 模式而不是 Peer-to-Peer

- A股投研任务的子任务边界清晰（取数/计算/舆情/风控/输出各自独立），不需要 Agent 之间自由协商，**Supervisor 集中调度 + 结果汇总**更可控、更易调试、成本也更低（避免 Agent 之间来回对话消耗 token）。
- Peer-to-Peer（Agent 互相发消息协商）更适合目标不确定、需要博弈/辩论的场景（比如"多空辩论"这种可以作为二期扩展，见第 8 节）。

### 5.2 Agent 角色与边界

| Agent | 职责 | 可用工具 | 输出契约 |
|---|---|---|---|
| **Supervisor / Orchestrator** | 意图识别、任务分解生成 DAG、调度子 Agent、汇总结果、维护对话状态 | 无直接数据工具，只调子 Agent | 最终自然语言回复 |
| **DataAgent** | 结构化数据获取（行情/K线/资金流/龙虎榜等） | stock-sdk MCP 全部只读工具 | 标准化 JSON（统一数据契约，字段：symbol/market/timestamp/...） |
| **AnalysisAgent** | 技术指标计算、信号识别、多指标交叉验证 | `indicators`/`signals` 纯函数工具 | 结构化信号摘要（如"金叉/死叉/超买/超卖 + 触发时间 + 置信度"） |
| **NewsAgent** | 舆情/公告/研报抓取与摘要 | Browser Automation + RAG 检索历史相似事件 | 摘要 + 情绪标签（正面/负面/中性）+ 来源链接 |
| **RiskAgent** | 合规审查（防止输出变成投资建议）、风险提示注入、数据置信度标注 | Rule Engine + LLM Judge（对 ReportAgent 草稿做二次审查） | 通过/驳回 + 修改建议 |
| **ReportAgent** | 将各 Agent 结果整合为最终结构化输出（表格/结论/风险提示） | 无外部工具，纯生成 | Markdown/结构化卡片 |
| **MemoryAgent** | 记忆读写仲裁（见第 7 节），决定什么该存、什么该忘 | Vector DB + KV Store | 无对用户直接输出 |

### 5.3 协作协议

- **通信介质**：共享黑板（Blackboard）模式 —— 所有子 Agent 读写同一个 `TaskContext` 对象（而不是互相发消息），Supervisor 负责按依赖顺序触发和收集，降低协作复杂度，也方便做单元测试（每个 Agent 输入输出可独立 mock）。
- **Hand-off 触发条件**：显式定义，不靠 LLM "感觉"该不该移交。例如 NewsAgent 只在 DataAgent 返回结果中检测到"该股票today有异动/涨停/龙虎榜上榜"时才被 Supervisor 触发（省 token，也更符合真实分析师的行为逻辑：有异动才查消息面）。
- **冲突解决**：RiskAgent 拥有对 ReportAgent 草稿的一票否决权（如草稿出现"建议买入"字样，直接打回重写为"仅供参考，需结合自身判断"表述）。

---

## 6. Browser Automation 设计

### 6.1 使用边界（这是最容易被问"为什么需要"的点）

stock-sdk 覆盖的是**结构化行情类数据**；Browser Automation 只用于 SDK 无法覆盖的**非结构化/半结构化信息**：

- 交易所官网公告全文（巨潮资讯网等）
- 股吧/雪球等情绪类文本
- 券商研报摘要页
- 极端情况下的补充验证（SDK 数据源异常时的交叉核对）

### 6.2 技术方案

- 工具选型：Playwright（headless，可截图辅助 LLM 视觉判断页面结构）或直接接入 Claude 的 Computer Use / Claude in Chrome 能力做原型验证。
- **Agent 操作 = 一组受限的原子工具**，不要让 LLM 直接自由操控浏览器裸 API：`navigate(url)`、`extract_text(selector)`、`search(keyword)`、`screenshot()`。限制工具集本身就是一种安全设计。
- **缓存层**：同一公告/URL 24 小时内不重复抓取，抓取结果落地到 RAG 知识库（第 7 节），既降本又是 RAG 的数据来源之一。
- **合规与礼貌性**：遵守 robots.txt、限速、只读不做任何提交操作、User-Agent 声明真实身份，不用来绕过登录墙或验证码。

### 6.3 失败兜底

浏览器自动化是全流程中最不稳定的一环（页面结构变化会直接断），所以：
- 每个站点单独定义 extraction schema + 版本号，抓取前先做"页面结构校验"，结构不匹配就直接判定失败而不是硬解析出错误数据。
- 失败不阻塞主流程，NewsAgent 返回"消息面暂不可用"，Supervisor 照常汇总其余 Agent 结果。

---

## 7. RAG 设计

### 7.1 知识库构成

| 数据来源 | 更新频率 | 用途 |
|---|---|---|
| 历史公告/研报全文（Browser Automation 抓取沉淀） | 增量，随抓取写入 | 消息面语义检索 |
| 财务报表关键数据（stock-sdk reference/财务相关接口） | 季度 | 基本面问答 |
| 历史技术信号+后续走势对照案例 | 每日批处理生成 | "历史上出现过类似金叉后，后续大概率怎么走"这类相似案例检索（这是把你的 signals 计算结果反哺成 RAG 语料的巧妙点，值得在面试里重点讲） |
| A股政策/监管文件 | 低频 | 合规问答、RiskAgent 判断依据 |

### 7.2 检索策略

- **Chunking**：公告类按段落+标题层级切分（保留公司/日期/公告类型 metadata，绝不裸文本切分丢 metadata）；财务数据不走 embedding，走结构化 SQL 查询（数字类数据用向量检索是反模式，容易被问到这点，务必答对）。
- **混合检索**：BM25（关键词，如股票代码、专有名词精确匹配）+ 向量语义检索（相似案例、模糊问法）两路召回后 RRF 融合排序，而不是单纯 vector search。
- **Query 改写**：用户口语化问题（"这票是不是要暴雷"）先经过 LLM 改写为结构化检索 query（"重大风险提示 违规 立案调查 <公司名>"）再检索，提升召回。
- **引用溯源**：所有 RAG 召回内容进入 ReportAgent 输出时必须带来源（公告标题+日期+链接），不允许模型脱离检索内容自由发挥（防幻觉是金融场景的硬要求）。

### 7.3 向量库选型建议

个人项目规模用 pgvector（复用你已经会的 SQL 生态，无需额外运维）或轻量的本地 Chroma 即可，不必上 Milvus/Pinecone 这类重型方案 —— 面试里也应该展示"按场景规模做技术选型"的判断力，而不是堆技术栈。

---

## 8. Memory 设计

这是本项目区分"聊天机器人"和"Agent 产品"的核心。设计四层记忆，对应不同生命周期和存储介质：

| 记忆层 | 内容 | 生命周期 | 存储 | 读写时机 |
|---|---|---|---|---|
| **短期记忆（Working Memory）** | 当前对话的上下文、当前任务 DAG 执行状态 | 单次会话 | 内存/Redis | 每轮对话读写 |
| **会话记忆（Session State）** | 当前正在讨论的标的、上一轮的分析结论（供"那它现在呢"这类指代消解使用） | 会话级，可跨天恢复 | Redis/KV，带 TTL | 每轮更新，会话开始时加载 |
| **长期记忆（User Profile Memory）** | 用户自选股/持仓、风险偏好、常问的板块、历史查询模式 | 永久，用户可查看/编辑/删除 | 结构化 DB（不是塞进 prompt 里的裸文本） | 显式指令触发（"记住我买了xxx"）或行为推断（谨慎，需用户确认） |
| **情景记忆（Episodic / Reflection Memory）** | 历史分析结论 vs 实际后续走势的对照（"上次说金叉，后来涨了/跌了"），用于日后类似信号的置信度校准 | 永久 | 向量库（供第7节相似案例检索复用） | 定时任务批量生成，非实时 |

### 8.1 关键设计原则

- **记忆不等于把历史消息塞进 context**：长期记忆是结构化字段（持仓表、偏好表），不是纯文本堆叠，检索时按需拼接，而不是无脑全量注入，这直接影响 context 处理效率（第 9 节）。
- **写入需要仲裁**：不是每句话都值得记住。MemoryAgent 用一个轻量分类器判断"这条信息是否值得长期存储"（如"我觉得今天天气不错"不存，"我持有600519从2900成本"要存）。
- **用户可控**：所有长期记忆用户可查看、可编辑、可删除（对齐你在 memory 系统提示词里见过的 memory_user_edits 设计思路 —— 这也是一个很好的向面试官展示"你理解真实生产级 memory 系统长什么样"的点）。
- **隐私与合规**：持仓/资金相关信息属于敏感数据，本地加密存储，不用于模型训练语料，不跨用户共享。

---

## 9. 上下文处理（Context Management）

- **Context 预算分层**：System Prompt（角色+工具定义，固定开销）+ 长期记忆摘要（按需检索片段，非全量）+ 会话记忆（当前标的/结论，几十 token）+ 当前轮 tool_result（压缩后的结构化摘要，见 3.2）+ 原始对话历史（超过阈值后滚动摘要）。
- **滚动摘要**：对话超过 N 轮后，用一次 LLM 调用把早期对话压缩为摘要（保留结论性信息，丢弃过程性 tool 调用细节），避免 K线原始数据、中间 DAG 调度日志这类"过程噪音"占用 context。
- **按 Agent 隔离 Context**：每个子 Agent 只拿到 Supervisor 精心裁剪过的、与自己任务相关的上下文切片，而不是共享整个对话历史 —— 既省 token 也降低"某个 Agent 被无关信息带偏"的风险。
- **多标的场景的上下文防污染**：批量选股场景中，每只股票的分析必须在独立的上下文槽位里处理（哪怕是同一次 LLM 调用内也要用结构化分隔），防止模型把不同股票的指标数值混淆（这是选股类任务实测中最容易出错的地方）。

---

## 10. 合规与安全边界（金融场景硬约束）

- **明确定位为"信息聚合与研究辅助工具"**，所有输出末尾统一注入风险提示模板："以上内容基于公开数据自动生成，不构成投资建议"。
- RiskAgent 对最终输出做关键词红线检测（"建议买入/卖出/加仓/清仓"等表述一律拦截重写）。
- 不做实盘交易接口对接（本项目边界内不接入交易 API，只做研究，规避金融牌照/资质问题）。
- Browser Automation 严格只读，不涉及登录态、不涉及任何形式的自动下单。

---

## 11. MVP 范围建议（分阶段，便于你按 2-4 周节奏迭代出 Demo）

| 阶段 | 范围 | 对应能力覆盖 |
|---|---|---|
| **P0（1周）** | 单 Agent + Function Calling：接入 stock-sdk MCP，支持"查行情/查K线/算指标"单轮问答 | Tool Use、Function Calling |
| **P1（1周）** | 引入 Orchestrator + DataAgent/AnalysisAgent 拆分，DAG 编排批量选股场景 | Multi-Agent、工作流编排 |
| **P2（1周）** | 接入长期 Memory（持仓/偏好）+ 会话记忆，支持"我上次说的那只票"类指代 | Memory |
| **P3（1-2周）** | Browser Automation 抓公告/舆情 + RAG 知识库检索 + NewsAgent + RiskAgent 合规审查 | Browser Automation、RAG、多Agent协作完整闭环 |

每个阶段都是一个可独立演示、可独立讲清楚架构决策的里程碑，适合直接搬到面试作品集里逐层展开讲。

---

## 12. 技术栈建议（贴合你现有技能栈，降低学习成本）

- **前端**：Next.js（你的强项）+ SSE/WebSocket 做 Agent 执行过程的流式可视化（把 DAG 执行状态实时画出来，这本身就是一个很好的展示层亮点，正好用上你熟悉的实时数据经验）。
- **编排层**：Node.js 自研轻量 DAG executor（或按需引入 LangGraph.js 对比学习）。
- **工具层**：直接 spawn `stock-sdk mcp` 作为子进程，Orchestrator 作为 MCP Client 通过 stdio JSON-RPC 通信（不用额外造 HTTP 封装）。
- **向量库**：pgvector（复用 Postgres）或 Chroma。
- **Memory 存储**：Postgres（长期结构化记忆）+ Redis（会话/短期记忆）。
- **Browser Automation**：Playwright。
- **模型**：Claude（Sonnet 承担 Orchestrator/AnalysisAgent 推理，Haiku 承担意图分类/RiskAgent 关键词审查这类轻量任务，做成本分层）。

---



