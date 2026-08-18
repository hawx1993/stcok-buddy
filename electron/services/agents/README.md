# `electron/services/agents` AI 导读

> **目的**：本文件是进入本目录的 AI 的导航与约束。它说明每个生产文件、工具文件和测试文件的职责，以及应在什么场景复用或修改它们。源码与测试是最终事实来源；本文不能替代对目标文件、调用方和现有测试的阅读。

## 先遵守这些边界

1. **从入口向下追踪，不绕过分层**：聊天请求从 `orchestrator.ts` 进入，依次经过意图识别、计划、DAG、工具运行时、真实数据服务与报告/合规环节。不要在 UI 或 Agent 中直接请求第三方行情接口。
2. **真实数据优先**：本地 DuckDB/真实缓存 → `stock-sdk` → `a-stock-data`；数据不足时返回 `empty`、`failed`、`partial`、`stale` 或 warning/data gap，绝不合成行情、K 线、新闻、板块或筛选结果。
3. **工具必须走统一运行面**：工作流节点默认用 `runContextTool()`，以记录 `toolCalls`、`dataStatuses`、`runEvents`、evidence 与 data gap；不要把普通 `callTool()` 当作有上下文事件的替代品。
4. **注册不代表模型可自由调用**：工具文件被 registry 注册，只说明它可执行；只有被 `a-stock-data-agent-tools.ts` 或 `stock-picker-agent-tools.ts` 的白名单和协议明确暴露时，模型才能自主选择它。
5. **修改前先定位调用面**：先回答“这是路由、计划、DAG 节点、数据工具、报告、合规、展示卡片还是测试？”再选文件。不要为了加一个能力而同时改动无关层。
6. **工具失败必须可见**：`callTool()` 会把异常写入调用记录；调用方必须检查错误和输出。fallback 仅用于表达数据缺口或降低置信度，不能伪造数据。

## 首选阅读路径

```text
chat:send IPC
  → orchestrator.ts
  → intent-routing.ts / resolve-stock-symbol
  → agent-planning.ts
  → agent-workflows.ts
  → dag-executor.ts
  → agent-tool-runtime.ts
  → tool-registry.ts → tools/*.ts → service / provider / DuckDB / stock-sdk
  → evidence.ts / agent-reflection.ts / compliance-critic.ts
  → ChatResponse、AgentResultCard 与 runEvents
```

- 想**新增用户意图**：先读 `intent-routing.ts`、`agent-planning.ts`、`agent-workflows.ts`，再检查报告、卡片与测试。
- 想**新增真实数据工具**：先确认已有 service/provider，再读 `tools/input.ts`、`tools/index.ts`、`tool-registry.ts`、`agent-tool-runtime.ts` 和工具白名单文件。
- 想**增加确定性选股条件**：优先读 `condition-screener-compiler.ts`、`condition-screener-session.ts`、`condition-screener-agent.ts` 与 `tools/screen-a-shares-by-conditions.ts`。
- 想**调整投研结论/提示词**：根据维度阅读对应子 Agent、`evidence.ts`、`agent-reflection.ts`、`compliance-critic.ts`，不能只改最终文案掩盖数据问题。
- 想**排查一次聊天失败**：按“`orchestrator` → 路由 → 计划 → workflow/DAG → tool runtime/工具 → data status/reflection → evidence/compliance”的顺序追踪。

---

## 生产编排、计划与运行时

| 文件 | 负责什么 | 何时使用 / 修改 |
| --- | --- | --- |
| `orchestrator.ts` | 聊天 Agent 的总入口 `runOrchestrator()`：先处理本地命令，再识别意图、解析标的、创建计划、执行 DAG、合规复核、最终反思并返回 `ChatResponse`。 | 新增顶层聊天处理顺序、上下文装配或最终响应生命周期时使用；不要把具体行情查询直接塞进这里。 |
| `orchestrator-types.ts` | 编排器共享上下文、意图、事件回调及与工作流协作的类型。 | 跨 orchestrator、DAG、Agent 节点新增稳定上下文字段时使用；先确认 `src/shared/types.ts` 是否已有可复用类型。 |
| `intent-routing.ts` | 解析 slash command，分类股票/板块/普通对话等意图，并决定单 Agent 或工作流路由。 | 新增或修正用户输入路由、命令语义、标的/板块识别规则时使用；变更后必须覆盖边界输入。 |
| `agent-planning.ts` | 创建和维护 `IAgentPlan`、计划项、依赖数据、假设和 fallback 策略；将计划项关联 DAG 节点，并依据数据缺口更新状态。 | 变更“先取什么数据、缺数据时如何降级、节点如何映射到计划”时使用。 |
| `agent-workflows.ts` | 按意图构建 DAG，定义数据、分析、报告节点及其依赖；为全市场任务插入数据覆盖检查。 | 新增意图的执行链、节点依赖或全市场前置条件时使用；避免循环依赖与重复全量同步。 |
| `dag-executor.ts` | 根据依赖和并发限制运行 DAG，将节点进度/错误转换为 Agent step。 | 新增通用 DAG 执行行为、并发/依赖语义或错误传播策略时使用；业务逻辑应放在节点而非执行器。 |
| `agent-tool-runtime.ts` | `runContextTool()` 的上下文包装：发送工具事件、保存调用记录、推断数据状态、添加证据并产生 data gap/fallback。 | 新工具需要进入工作流、工具输出状态被误判、或要新增通用状态/事件映射时使用；workflow 默认从这里调用工具。 |
| `agent-reflection.ts` | 根据 `dataStatuses`、fallback evidence 与计划执行结果生成数据缺口、计划修订和最终报告前复核。 | 改变数据不足时的结论降级、计划阻塞/跳过策略或最终反思规则时使用。 |
| `data-coverage-agent.ts` | 为全市场问答、条件选股、超短线选股检查并补齐本地证券、行情、日线及按需筹码覆盖度。 | 需要全市场真实数据、调整覆盖阈值或同步顺序时使用；只可补真实数据或 warnings，不能产生模拟补齐。 |
| `tool-registry.ts` | 本目录的工具聚合注册与调用面；将工具名映射为工具实现，并返回带成功/失败记录的工具调用结果。 | 新增、改名、下线 `tools/*.ts` 工具或排查“工具未注册/错误未被检查”时使用；注册后还要判断是否应进模型白名单。 |
| `types.ts` | 本目录的 Agent 专用共享类型与结构化结果约定。 | 多个 Agent 文件确实需要共享的领域类型时使用；不把一次性局部类型提升为全局。 |

## 分析、报告、证据与合规

| 文件 | 负责什么 | 何时使用 / 修改 |
| --- | --- | --- |
| `data-agent.ts` | 对 `stock-client` 的 `getQuote()` 与 `getBoardSnapshot()` 做极薄的 Agent 数据入口封装。 | 既有调用方需要基础个股行情或板块快照时使用；新增复杂取数应优先写为 registry 工具，而不是继续堆叠到此文件。 |
| `analysis-agent.ts` | 对 `stock-client` 的 `analyzeTechnical()` 做极薄的技术分析入口封装。 | `getTechnicalIndicators` 或既有调用方需要技术指标分析时使用；技术指标计算与数据源逻辑应留在 stock 服务层。 |
| `report-agent.ts` | 将已取得的结构化行情、技术、板块、新闻、公告和链接正文交给报告模型，并在模型调用失败时基于现有输入生成提示。 | 修改通用报告提示、输入字段或模型不可用时的可审计表达时使用；不得在这里补造未取到的市场事实。 |
| `risk-agent.ts` | 保留的简化合规入口：把文本交给 `reviewComplianceStructured()`，返回修订后的文本。 | 旧调用方只需要文本级合规修订时使用；新增合规规则应修改 `compliance-critic.ts`。 |
| `news-analysis-agent.ts` | 对已读取的新闻、公告等消息面数据进行归纳与影响分析，并在非请求错误时基于已有条目生成结构化降级报告。 | 调整消息面分析输入、来源约束或输出格式时使用；新闻原文必须来自工具的真实结果。 |
| `stock-analysis-agents.ts` | 技术、基本面、资金面、消息面、筹码等专项子 Agent 的输入、调用和结果组织。 | 增加或调整个股分析维度、子 Agent 提示或结构化 finding 时使用；同步检查 evidence、overview 与测试。 |
| `stock-analysis-overview-agent.ts` | 聚合多个专项发现，生成股票分析总览。 | 修改跨维度汇总、冲突处理、结论强度或总览格式时使用；不要忽略某维度的数据缺口。 |
| `evidence.ts` | 将行情、K 线、新闻、资金、筹码、选股等工具输出转换成可追溯证据项。 | 新工具/新分析维度的输出需要支撑结论，或证据缺失/引用错误时使用。 |
| `compliance-critic.ts` | 审查投研输出中的伪造数据、过度确定性建议、风险遗漏和不合规表达。 | 增补合规规则、修复报告越界或修改输出审查策略时使用；它是最后一道保护，不替代前置取数与证据链。 |
| `agent-data-mappers.ts` | 将腾讯行情、DuckDB 日线、百度 K 线、东财分钟资金流等外部/本地原始数据映射为共享的行情、K 线和资金流类型。 | 数据源原始字段变动，或本地/远程数据需要适配为 `StockDetail`、`KlinePoint`、资金流快照时使用。 |
| `agent-result-cards.ts` | 将工具和分析结果转换为渲染端使用的结构化结果卡片。 | 新增/调整前端可展示卡片、字段映射或卡片优先级时使用；展示值必须来自真实工具输出。 |

## 特定意图与提示词

| 文件 | 负责什么 | 何时使用 / 修改 |
| --- | --- | --- |
| `a-stock-data-agent.ts` | 执行 a-stock-data 风格的多轮数据问答：解析模型文本 JSON 工具请求、校验白名单、运行工具并把结果反馈给模型。 | 修改模型自主取数轮次、文本 JSON 协议、工具调用循环或该意图的问答行为时使用；每轮只处理受控工具请求。 |
| `a-stock-data-agent-tools.ts` | 定义 a-stock-data Agent 可自由选择的工具说明、输入描述、白名单与 JSON 工具调用解析规则。 | 新工具**确实需要由该模型自由选择**时使用；先确认已在 registry 注册，描述输入、适用条件和数据优先级，避免暴露内部工具。 |
| `stock-picker-agent.ts` | 超短线技术选股流程：先宽筛再精筛，压缩候选上下文并在受控工具集合内生成候选清单。 | 变更超短线选股工作流、候选压缩、精筛顺序或结果呈现时使用；需要全市场数据覆盖作为前置。 |
| `stock-picker-agent-tools.ts` | 超短线选股 Agent 的意图模板、可调用工具白名单和工具使用约束。 | 调整自然语言选股触发条件、允许工具或筛选提示时使用；不要把未注册/不适合自由调用的工具加入。 |
| `condition-screener-agent.ts` | `/condition-screener` 的确定性业务入口：执行已校验条件，生成筛选结果、Markdown、卡片与证据。 | 调整命令型条件选股结果流程时使用；不要交给模型猜测筛选参数。 |
| `condition-screener-compiler.ts` | 将用户/命令条件编译为可执行、受限且类型化的筛选约束。 | 新增筛选字段、范围、排序或参数校验时使用；它是防止自由文本直接进入查询的关键边界。 |
| `condition-screener-session.ts` | 保存和恢复条件选股会话状态，支持后续查看、排序或交互。 | 调整筛选会话生命周期、关联结果或重复访问行为时使用。 |
| `market-review-prompt.ts` | 集中维护市场复盘场景的提示词与输出约束。 | 只改市场复盘表达/结构而不改数据链时使用；数据事实仍由 `get-market-review` 等工具提供。 |
| `plain-question-prompt.ts` | 集中维护普通问题/非专门命令的提示词和答复约束。 | 调整普通问答的系统指令、数据缺口提示或格式要求时使用；不能在提示词中要求模型虚构数据。 |

---

## `tools/`：数据工具与帮助文件

> 工具文件应各自封装一个明确的 `AgentTool` 能力；它们不是 UI API。添加工具前先寻找已有 service/provider，遵循真实数据链路，并在 `tools/index.ts`、`tool-registry.ts` 和**按需**的模型白名单中完成接入。
>
> 下表的“调用面”表示应优先在哪类路径使用：**工作流** = 经 `runContextTool()`；**模型白名单候选** = 仅在已明确放入模型工具说明后允许模型选；**内部/既有契约** = registry/workflow 可用，但默认不应直接赋予模型自由调用权。

| 文件 | 工具 / 职责 | 调用面与何时使用 |
| --- | --- | --- |
| `tools/index.ts` | 汇总导出本目录的工具实现，供 registry 集中注册。 | 新增/删除工具文件后维护此出口；不在业务节点中绕过聚合入口导入未注册工具。 |
| `tools/input.ts` | 工具输入的解析、校验、限幅等共享 helper。 | 多个工具需要一致地处理 symbol、日期、数量、分页等输入时复用；不要把不受限模型文本直接传给下游。 |
| `tools/resolve-stock-symbol.ts` | `resolveStockSymbol`：将名称、简称或模糊代码解析为标准证券标识。 | 任何需要个股标的但输入未标准化时优先调用；通常是个股工作流的前置。 |
| `tools/get-stock-quote.ts` | `getStockQuote`：既有基础个股行情输出契约。 | 既有确定性 workflow 需要兼容的基础行情形状时使用。 |
| `tools/get-stock-quote-local-first.ts` | `getStockQuoteLocalFirst`：优先本地真实数据，再按既有真实远程链路获取行情。 | 需要强调本地优先、同时允许真实数据回补的个股行情场景；需保留来源、存储和新鲜度。 |
| `tools/get-stock-kline.ts` | `getStockKline`：既有基础 K 线输出路径。 | 依赖既有 K 线返回契约的工作流使用。 |
| `tools/get-stock-kline-local-first.ts` | `getStockKlineLocalFirst`：优先本地日线并按真实链路回补。 | 个股技术分析需要真实日 K 序列、且应先使用落库数据时使用。 |
| `tools/get-historical-daily-bars.ts` | `getHistoricalDailyBars`：获取历史日线，支持本地读取与真实远端补齐。 | 确定性技术/历史分析需要较完整日线时使用。 |
| `tools/get-technical-indicators.ts` | `getTechnicalIndicators`：提供均线、MACD、KDJ 等技术指标摘要。 | 需要技术面指标而非自行从单一价格合成走势时使用。 |
| `tools/get-stock-fund-flow-snapshot.ts` | `getStockFundFlowSnapshot`：既有的个股资金流快照契约。 | workflow 需要该稳定输出结构时使用。 |
| `tools/get-stock-fund-flow-local-first.ts` | `getStockFundFlowLocalFirst`：本地优先获取个股资金流，复用真实数据降级链。 | 需要个股资金面且应优先缓存/落库真实数据时使用。 |
| `tools/get-stock-chip-distribution.ts` | `getStockChipDistribution`：通用个股筹码分布输出。 | 既有流程需要通用筹码契约时使用。 |
| `tools/get-stock-chip-distribution-local-first.ts` | `getStockChipDistributionLocalFirst`：本地优先的筹码、成本区间与集中度能力。 | 筹码集中度、获利比例等分析或选股需要真实缓存优先、过期时按真实链路刷新时使用。 |
| `tools/get-stock-surge-events-local-first.ts` | `getStockSurgeEventsLocalFirst`：本地优先获取个股异动、盘口和大单事件。 | 个股异动追踪、右侧栏同源数据或超短线精筛需要事件历史时使用。 |
| `tools/get-stock-news-announcements.ts` | `getStockNewsAnnouncements`：获取个股新闻与公告。 | 消息面/公告分析需要原始真实材料时使用；报告必须标识来源和数据缺口。 |
| `tools/get-holder-number-change.ts` | `getHolderNumberChange`：获取股东户数变化及筹码集中信号。 | 分析持有人结构或户数变化时使用；作为补充维度，不把缺失解释成无变化。 |
| `tools/get-dividend-history.ts` | `getDividendHistory`：获取分红、送转和相关历史记录。 | 基本面中需要分红回报或送转历史时使用。 |
| `tools/get-dragon-tiger.ts` | `getDragonTiger`：取得每日龙虎榜数据。 | 复盘或个股资金/席位异动需要龙虎榜事实时使用。 |
| `tools/get-industry-ranking.ts` | `getIndustryRanking`：获取行业涨幅排名及行业资金流。 | 需要行业景气、相对强弱或行业资金面时使用；不能用静态排行代替。 |
| `tools/get-hot-concepts.ts` | `getHotConcepts`：获取热门股票与概念。 | 题材、热点、市场关注度分析时使用；失败时输出数据状态而非伪造热点。 |
| `tools/get-hot-focus.ts` | `getHotFocus`：按 `tab` 获取热点、异动或板块资金流等焦点数据。 | 市场热点/异动复盘需要选择明确维度时使用；调用方须传递正确 tab。 |
| `tools/get-market-data-status.ts` | `getMarketDataStatus`：查询本地市场数据同步与可用状态。 | 在大范围查询前判断本地数据是否可用、解释数据新鲜度或生成同步提示时使用。 |
| `tools/get-market-news.ts` | `getMarketNews`：获取既有市场新闻列表输出。 | 市场级消息面、复盘或新闻摘要需要新闻列表时使用。 |
| `tools/get-market-review.ts` | `getMarketReview`：提供指数、涨停、情绪、热点等市场复盘原始数据。 | 市场复盘工作流取数时使用，并交给 `market-review-prompt.ts`/报告层解释。 |
| `tools/get-northbound-flow.ts` | `getNorthboundFlow`：获取北向、南向及沪深港通资金汇总。 | 需要跨境资金流向维度时使用；不要用旧缓存伪装实时流向。 |
| `tools/query-local-duckdb-data.ts` | `queryLocalDuckDBData`：通用本地 DuckDB 数据预查询能力。 | workflow 预取或内部本地上下文读取时使用；不可让模型输入拼接为任意 SQL。 |
| `tools/query-local-market-duckdb.ts` | `queryLocalMarketDuckDB`：受白名单保护的市场 DuckDB 数据集查询。 | 查询证券、日线、交易日、市场快照、板块、成分股、筹码等本地数据集时使用；选择 dataset/参数而不是传原始 SQL。 |
| `tools/query-local-monitor-duckdb.ts` | `queryLocalMonitorDuckDB`：查询 AI 监控历史及分类统计。 | 需要监控记录、趋势或统计时使用；仅表达真实落库数据。 |
| `tools/query-local-surge-duckdb.ts` | `queryLocalSurgeDuckDB`：查询异动、大单、买卖方向和手数的本地历史。 | 复盘个股异动历史、并要求本地记录可追溯时使用。 |
| `tools/screen-a-shares-by-conditions.ts` | `screenASharesByConditions`：确定性条件选股工具。 | 仅供已由条件编译器校验的 `/condition-screener` 参数使用；真实“0 命中”是有效结果，不应误报数据缺口。 |
| `tools/screen-a-shares-by-market-cap.ts` | `screenASharesByMarketCap`：按总/流通市值及换手率范围筛选 A 股。 | 需要市值区间选股时使用；遵循本地 → `stock-sdk` → `a-stock-data` 的真实链路。 |
| `tools/screen-local-a-stocks.ts` | `screenLocalAStocks`：基于本地市场快照和筹码缓存的全市场宽筛。 | 超短线或 a-stock-data Agent 的宽筛阶段使用；本地覆盖不足必须通过 warnings 暴露。 |
| `tools/read-url.ts` | `readUrl`：读取用户提供 URL 的正文，按既有真实读取器顺序尝试。 | 用户明确给出链接且需要正文分析时使用；超时/失败要保留错误状态与来源。 |
| `tools/web-search.ts` | `webSearch`：执行受控联网搜索并返回来源结果。 | 仅在需要外部公开信息且工具白名单允许时使用；搜索不可用时不能让模型补写“搜索结果”。 |

---

## 测试文件

> 修改对应生产文件、协议、工具输出或数据状态映射时，先更新同名/同域测试。通常可运行 `pnpm test -- electron/services/agents/__tests__/<file>`；提交前按影响范围运行 `pnpm typecheck` 和相关 Vitest 测试。

| 文件 | 覆盖对象 | 何时运行 / 更新 |
| --- | --- | --- |
| `__tests__/a-stock-data-agent.test.ts` | a-stock-data Agent 的文本 JSON 工具调用循环、白名单和工具结果处理。 | 修改 `a-stock-data-agent.ts` 或其工具协议/白名单时。 |
| `__tests__/agent-data-mappers.test.ts` | Agent 数据映射的字段归一化与结果兼容性。 | 修改 `agent-data-mappers.ts`、上游工具返回字段或卡片消费字段时。 |
| `__tests__/agent-data-tools.test.ts` | 本地优先筹码分布与个股异动工具：缓存新鲜度、真实远程回补、右侧栏同源数据和逐笔成交兜底。 | 修改 `get-stock-chip-distribution-local-first.ts`、`get-stock-surge-events-local-first.ts` 或其 service 链路时。 |
| `__tests__/agent-local-duckdb-tools.test.ts` | 本地全市场筛选、DuckDB 白名单数据集、监控/异动历史、手数聚合与筹码/换手过滤。 | 修改 `query-local-*`、`screen-local-a-stocks` 或本地数据约束时。 |
| `__tests__/agent-planning.test.ts` | 初始计划、计划项绑定与数据缺口导致的计划状态更新。 | 修改 `agent-planning.ts` 或计划与 DAG 的映射时。 |
| `__tests__/agent-reflection.test.ts` | 数据状态、data gap、降级和最终反思规则。 | 修改 `agent-reflection.ts`、数据状态含义或 fallback 策略时。 |
| `__tests__/agent-tool-runtime.test.ts` | `runContextTool()` 的调用记录、runEvent、证据和状态推断。 | 修改运行时、注册工具输出约定或 evidence/data gap 映射时。 |
| `__tests__/agent-workflows.test.ts` | 意图到 DAG 节点、依赖和数据覆盖前置的构建规则。 | 修改 `agent-workflows.ts`、新增意图或调整依赖时。 |
| `__tests__/compliance-critic.test.ts` | 投研合规审查：伪造数据、风险提示、建议强度和表达限制。 | 修改 `compliance-critic.ts` 或报告输出规范时。 |
| `__tests__/condition-screener-agent.test.ts` | 条件选股命令参数解析、预设/自然语言条件、别名与错别字纠正、歧义拒绝、会话内追加/修改/删除。 | 修改 `condition-screener-agent.ts`、编译器或 session 的参数语义时。 |
| `__tests__/data-coverage-agent.test.ts` | 全市场数据覆盖检查、真实同步顺序、筹码补齐与 warning。 | 修改 `data-coverage-agent.ts`、覆盖阈值或同步逻辑时。 |
| `__tests__/intent-routing.test.ts` | slash command、意图分类、股票/板块与普通聊天路由。 | 修改 `intent-routing.ts` 或新增用户可见命令/意图时。 |
| `__tests__/market-review-prompt.test.ts` | 市场复盘提示词的结构、关键约束和输出稳定性。 | 修改 `market-review-prompt.ts` 或市场复盘报告格式时。 |
| `__tests__/stock-analysis-agents.test.ts` | 个股专项子 Agent 的输入、维度、工具数据与结构化发现。 | 修改 `stock-analysis-agents.ts` 或任一专项分析维度时。 |
| `__tests__/stock-analysis-overview-agent.test.ts` | 多维发现的总览聚合、冲突/缺口表达与结论格式。 | 修改 `stock-analysis-overview-agent.ts` 时。 |
| `__tests__/stock-picker-agent.test.ts` | 超短线选股的宽筛、精筛、工具约束、上下文压缩与候选输出。 | 修改 `stock-picker-agent.ts` 或 `stock-picker-agent-tools.ts` 时。 |

## 新增或修改能力的最小清单

### 新增工具

1. 在已有 `electron/services/stock/**`、`electron/services/market-data/**`、provider 或 DuckDB 能力中寻找真实数据实现；不要从 Agent/UI 直连第三方。
2. 在 `tools/<kebab-case>.ts` 中实现一个职责单一的工具，并保持来源、存储、新鲜度、warning、完整性与证据所需字段。
3. 在 `tools/index.ts` 导出，并在 `tool-registry.ts` 注册唯一工具名。
4. 只有模型必须自行选择时，才同步改相应 Agent 的白名单/工具描述；registry-only 工具默认不暴露。
5. 在 workflow 中通过 `runContextTool()` 调用，检查 `ToolCallRecord.error`，补齐 data status/evidence 映射与测试。

### 新增意图或工作流节点

1. 在 `intent-routing.ts` 定义明确入口和边界。
2. 在 `agent-planning.ts` 增加可验证的计划项、数据依赖及缺数据策略。
3. 在 `agent-workflows.ts` 定义 DAG 节点和 `dependsOn`；全市场任务复用数据覆盖节点，避免重复同步。
4. 将真实数据转为 evidence，数据不足交给 reflection/compliance 以明确降级。
5. 覆盖路由、计划、workflow、runtime 和最终结果的相关测试。

## 验证建议

```bash
pnpm test -- electron/services/agents/__tests__
pnpm typecheck
```

对于工具变更，额外确认：工具名无重复、每个模型白名单工具均已注册、工具成功/空/失败/部分/过期结果都能产生正确的数据状态、事件和证据或数据缺口。
