# Knowledge Index

本索引用于按任务分类加载项目知识。先判断领域，再读取对应文件；不要一次性加载整个 `knowledge/` 目录。

## Frontend

适用于：React 页面、组件、hook、Zustand store、worker、K 线/分时/筹码 UI、探索页、行情页、右侧栏。

加载：

- `.claude/knowledge/frontend-architecture.md`

## Renderer API / IPC

适用于：`getStocksenseApi()`、`src/shared/types.ts`、browser fallback、preload、IPC channel、push event、renderer listener。

加载：

- `.claude/knowledge/ipc-data-flow.md`

## Stock Services

适用于：个股行情、搜索、K 线、分时、板块、行业、新闻、热点、龙虎榜、异动、监控、交易建议。

加载：

- `.claude/knowledge/stock-services.md`

## Market Data

适用于：DuckDB 市场库、同步任务、交易日、全市场快照、条件选股、本地优先查询、DataCoverage。

加载：

- `.claude/knowledge/market-data-services.md`

## Agent

适用于：聊天编排、intent、DAG、DataCoverage、Agent tool、投研报告、证据链、data gap、结果卡片。

加载：

- `.claude/knowledge/agent-services.md`
- `.claude/knowledge/agent-tools.md`（新增或修改工具时）

## Electron Services

适用于：Electron 启动/退出、配置、会话、通知、命令商店、更新、存储统计与清理。

加载：

- `.claude/knowledge/electron-services-overview.md`

## API Guide

适用于：需要查项目已整理的 API 使用说明、命令能力或集成说明时。

加载：

- `.claude/knowledge/api-guide.md`

## 选择规则

- 只加载与当前任务直接相关的条目。
- 跨领域任务按调用链逐步加载：UI → Renderer API / IPC → Service / Provider → Persistence / Agent。
- 读取 Knowledge 后仍以源码、类型和测试为事实来源；Knowledge 是导航，不替代代码确认。