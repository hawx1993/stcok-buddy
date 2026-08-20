# Stock Data Recipe

适用于行情、搜索、K 线、分时、板块、行业、新闻、热点、龙虎榜、异动、资金流和探索页数据能力。

## 必读

- `.claude/rules/data.md`
- `.claude/knowledge/stock-services.md`
- `.claude/knowledge/market-data-services.md`（涉及本地市场库、同步、筛选时）

## 数据源顺序

```text
stock-sdk
  → a-stock-data skill / runner（仅 stock-sdk 不支持或不适合时）
  → loading / empty / error / partial / stale 状态
```

不得用 fake、mock、preview、demo、sample 或合成走势补用户可见数据。

## 实现步骤

1. 搜索现有 service、provider、缓存和 shared type；优先复用既有真实入口。
2. 新增数据能力放在 service/provider 层，不在 React 组件或 Agent 文案中直连第三方接口。
3. 批量数据优先使用批量接口、缓存、并发限制和超时控制。
4. 失败路径返回可理解的错误、warning、empty、partial 或 stale 元信息。
5. 进入 UI 或 Agent 前保留来源、时间、新鲜度、完整性和 warning。
6. 图表、K 线、分时、榜单必须有真实序列或真实接口结果；没有数据就展示空态。

## 影响检查

- 改板块、行情快照、筹码、条件选股时检查 market-data、Discovery、Agent 和 UI 是否共用入口。
- 改公共返回类型时同步 `src/shared/types.ts`、IPC、preload、renderer 调用方和 Agent tool。
- 涉及本地缓存时确认 stale 数据不会被展示为实时数据。