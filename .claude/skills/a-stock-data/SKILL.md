---
name: a-stock-data
description: 当任务必须编写或调试真实 A 股数据取数、且 stock-sdk 不支持或不适合时使用；入口只做路由，按需读取 references 分片，禁止一次性加载全部数据手册。
origin: custom
version: 3.6.0
---

# A Stock Data

用于 **真实 A 股数据取数代码** 的兜底资料库。此 skill 只作为轻量入口；旧版 3000+ 行数据手册已拆到 `references/`，必须按任务读取对应分片，避免 Agent prompt too long。

## 什么时候使用

仅在同时满足以下条件时使用：

1. 当前任务需要写代码、调试接口或核对真实 A 股数据取数路径；
2. 项目首选的 `stock-sdk` 没有对应能力、返回不适合当前场景，或需要 a-stock-data 中记录的备用源 / 防封细节；
3. 需要的数据属于行情、K 线、研报、龙虎榜、资金流、财报、公告、涨停池、ETF 期权、互动易、热榜等 A 股真实数据。

## 什么时候不要使用

- 普通投资观点、概念解释、策略讨论，不需要实际取数时不要加载。
- `stock-sdk` 已支持且足够完成任务时，不要加载本 skill 的参考分片。
- 不要为了寻找示例代码而通读全部 references。
- 不要把本 skill 的 HTTP 示例直接接到 React UI；项目生产链路仍必须走 `UI → Service → Provider → Data Source`。

## 加载策略（强制）

1. 先确认 `stock-sdk` 是否已有能力；只有缺口明确时才继续。
2. 先读 `references/endpoint-index.md` 判断端点归属。
3. 涉及东财、批量请求、ticker 归一化、mootdx 初始化时，再读 `references/source-policy-and-setup.md`。
4. 只读取命中的一个或少数几个业务分片；**禁止一次性读取 `references/**`**。
5. 需要多个数据域时，逐个读取分片，读完一个再判断下一个是否必要。
6. 所有数据源失败时只能返回明确 empty / failed / partial / stale / data gap，不得构造 mock、fake、demo、sample、preview 行情。

## 分片索引

| 任务 / 数据域 | 读取文件 |
| --- | --- |
| 端点总览、函数定位 | `references/endpoint-index.md` |
| 数据源优先级、东财防封、依赖安装、ticker 归一化、mootdx / em_get helper | `references/source-policy-and-setup.md` |
| 实时行情、盘口、PE/PB/市值、涨跌停价、日 K / 分钟 K | `references/quotes-and-kline.md` |
| 个股/行业研报、研报 PDF、一致预期 EPS、iwencai 语义搜索 | `references/reports.md` |
| 同花顺热点、北向资金、个股所属板块 / 概念归属 | `references/signals-hot-concepts-northbound.md` |
| 个股资金流、龙虎榜、全市场龙虎榜、限售解禁、行业排名、板块资金流 | `references/signals-flow-dragon-industry.md` |
| 融资融券、大宗交易、股东户数、分红送转、120 日资金流 | `references/capital-and-chip.md` |
| 个股新闻、财联社快讯、东财全球资讯 | `references/news.md` |
| 财务快照、F10、个股基本面、财报三表 | `references/financials-and-f10.md` |
| 巨潮公告、F10 公告摘要 | `references/announcements.md` |
| 涨停池、炸板池、跌停池、昨涨停、涨停原因、连板梯队、重点监控、日内异动 | `references/limit-up-and-anomaly.md` |
| ETF 期权合约、T 型报价、希腊字母、IV | `references/options.md` |
| 互动易问答、同花顺热榜、东财人气榜、个股概念命中 | `references/sentiment-and-hot-rank.md` |
| 前向 PE、PE 消化、PEG、单票 / 批量 / 主题调研流程 | `references/valuation-and-workflows.md` |
| 备用源速查、降级策略、FAQ | `references/fallback-and-faq.md` |
| 安装说明 | `references/install.md` |
| 架构图、版本变更记录 | `references/architecture-and-changelog.md` |

## 项目内使用约束

- 生产功能优先复用现有 service / provider / `stock-sdk`；本 skill 是补充资料，不替代项目架构。
- 批量调用东财必须串行限流，避免触发风控。
- 北交所老号段、ticker 格式、指数/个股歧义要显式处理，不能静默返回空数据或错票数据。
- 面向用户的股票、行情、新闻、图表输出必须是真实数据或明确不可用状态。
