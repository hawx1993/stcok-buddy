# 板块详情 Dashboard 功能规划与开发 Prompt

> 目标：在右侧栏“板块详情”独立入口中新增一个板块 Dashboard，用真实数据识别“有潜力、风头正盛、不能碰、板块龙头”。当用户点击具体板块名称/板块卡片时，继续沿用现有板块详情逻辑，不破坏原有 K 线 + 成分股列表体验。

## 一、必须遵守的项目规则

请在 `stock-agents` 项目中实现本功能，严格遵守：

- `.claude/rules/typescript-react.md`
- `.claude/rules/data.md`
- `.claude/rules/emoji.md`
- `.claude/rules/bug-fix.md`
- `.claude/skills/stock-dev/SKILL.md`

强制要求：

1. 面向用户展示的股票、行情、板块、排行、图表、资金流必须来自真实数据源或本地真实缓存。
2. 禁止使用 fake/mock/preview/demo/sample/hardcoded 行情或合成走势图。
3. React 组件不得直接请求东方财富、腾讯、同花顺等第三方接口，必须走：

```text
UI → getStocksenseApi() → preload → IPC → Service → Provider / DuckDB / stock-sdk
```

4. 数据源优先级：
   - 本地 DuckDB 真实缓存
   - `stock-sdk`
   - `a-stock-data` 能力中已有真实接口
   - 全部失败时展示空状态/错误状态，不得造假
5. TypeScript 禁止新增 `any`、`as any`、`as unknown as`、`@ts-ignore`。
6. 单个 React 组件文件超过 400 行应拆分，超过 500 行必须拆分。
7. 重点计算逻辑必须有单元测试；测试文件放到 `__tests__/`，`describe` / `it` 使用中文。

---

## 二、现有代码现状

### 1. 右侧栏板块详情入口

当前右侧栏状态在：

- `src/store/app-store.ts`

关键状态：

```ts
export type RightPanelTab = 'favorites' | 'stock' | 'board' | 'surge' | 'news' | 'ai-monitor';
selectedBoard?: BoardDetail;
openBoardPanel(): void;
setSelectedBoard(board?: BoardDetail): void;
```

右侧栏渲染入口在：

- `src/components/stock-detail-panel/index.tsx`

当前逻辑：

```tsx
{rightPanelTab === 'board' ? (
  selectedBoard ? <BoardDetailPanel /> : <Empty ... />
) : null}
```

因此可以利用 `selectedBoard` 是否存在区分：

- `selectedBoard` 存在：用户点击了某个板块名称/板块卡片，应保持原有详情逻辑。
- `selectedBoard` 不存在但 `rightPanelTab === 'board'`：用户点击右侧栏“板块详情”独立入口，应展示新的板块 Dashboard。

### 2. 当前板块详情组件

当前组件：

- `src/components/stock-detail-panel/components/board-detail-panel.tsx`

现有能力：

- 展示板块名称、代码、涨跌幅。
- 展示板块真实 K 线，没数据时显示“暂无图表数据”。
- 展示成分股列表。
- 成分股点击后打开个股详情。
- 盘中按 15 秒批量刷新成分股报价。

要求：保留该组件作为“点击板块名称/板块卡片”的旧逻辑，不要直接改造成 Dashboard。

### 3. 当前板块 Service / IPC

共享类型：

- `src/shared/types.ts`

现有类型：

```ts
export interface BoardConstituent {
  code: string;
  name: string;
  price?: string | number;
  changePercent?: string;
  turnover?: string;
  amount?: string;
}

export interface BoardDetail {
  code: string;
  name: string;
  changePercent?: string;
  kline?: KlinePoint[];
  constituents?: BoardConstituent[];
}
```

现有 API：

```ts
getBoardDetail(symbol: string, forceRefresh?: boolean, boardName?: string): Promise<BoardDetail>;
```

IPC：

- `electron/ipc.ts`

```ts
ipcMain.handle('board:getDetail', (_event, symbol, forceRefresh, boardName) =>
  getBoardDetail(symbol, forceRefresh, boardName),
);
```

Service：

- `electron/services/stock/board-detail.ts`

现有能力：

- 优先从 `market_board_details` 读取板块详情缓存。
- 通过 `stock-sdk` 获取板块 K 线与成分股。
- 缺失时可使用 `a-stock-data` 风格的东财板块 K 线/成分股真实接口。
- 将 `market_boards`、`board_constituents`、`market_board_details` 持久化到 DuckDB。

### 4. 当前 DuckDB 可复用表

位置：

- `electron/services/market-data/market-data-store.ts`
- `electron/services/market-data/types.ts`
- `electron/services/market-data/market-data-query.ts`
- `electron/services/market-data/providers.ts`

已有表：

```text
securities
trade_calendar
daily_bars
stock_snapshots
market_board_snapshots
discovery_snapshots
stock_chips
stock_fund_flow_daily
market_board_details
market_boards
board_constituents
```

Dashboard 优先复用：

- `market_boards`：板块代码、名称、类型、涨跌幅、更新时间。
- `board_constituents`：板块成分股。
- `market_board_details`：板块详情 JSON 缓存。
- `daily_bars`：个股历史日线，计算涨跌、换手率、成交额、振幅。
- `stock_snapshots`：最新个股行情快照。
- `stock_fund_flow_daily`：个股日级主力净流入。
- `market_board_snapshots` / `discovery_snapshots`：已有快照缓存可作为读取参考，但不要塞入不可查询的大块新业务数据。

---

## 三、产品目标

新增“板块 Dashboard”用于回答四类问题：

1. 哪些板块有潜力？
2. 哪些板块风头正盛？
3. 哪些板块不能碰？
4. 每个板块里哪些个股是真正龙头？

Dashboard 只在“右侧栏板块详情独立入口”展示；点击具体板块名称仍展示现有 `BoardDetailPanel`。

---

## 四、入口与交互规划

### 1. 独立入口：展示 Dashboard

触发方式：

- 用户点击右侧 rail 的“板块详情”。
- 当前没有 `selectedBoard`。

实现建议：

在 `src/components/stock-detail-panel/index.tsx` 中改为：

```tsx
{rightPanelTab === 'board' ? (
  selectedBoard ? <BoardDetailPanel /> : <BoardDashboardPanel isActive={!isRightPanelCollapsed} />
) : null}
```

### 2. 点击板块名称：保持旧逻辑

已有逻辑位于：

- `src/components/discovery-view/components/market-summary.tsx`
- `src/components/discovery-view/components/hot-rotation.tsx`
- `src/components/discovery-view/components/trading-advice.tsx`

这些入口会：

```ts
setSelectedBoard(snapshot);
openBoardPanel();
getStocksenseApi().getBoardDetail(...);
```

要求：不改变这些旧入口语义。它们继续展示 `BoardDetailPanel`。

### 3. Dashboard 内点击某个板块

Dashboard 中的板块卡片、排行榜行、象限图点位点击后：

1. 先设置 `selectedBoard` 为 `{ code, name }` 快照。
2. `openBoardPanel()`。
3. 调用 `getBoardDetail(code, false, name)` 补齐详情。
4. 展示旧的 `BoardDetailPanel`。

这样 Dashboard 是入口总览，旧详情是单板块 drill-down。

---

## 五、Dashboard 信息架构

建议新增组件：

```text
src/components/stock-detail-panel/components/board-dashboard-panel.tsx
src/components/stock-detail-panel/components/board-dashboard-summary.tsx
src/components/stock-detail-panel/components/board-dashboard-quadrant.tsx
src/components/stock-detail-panel/components/board-dashboard-ranking.tsx
src/components/stock-detail-panel/components/board-dashboard-leaders.tsx
src/components/stock-detail-panel/components/board-dashboard-tabs.tsx
```

每个文件只维护一个主组件。

### 1. 顶部摘要区

展示 4 个核心 KPI：

- 热度最强板块
- 潜力最高板块
- 风险最高板块
- 龙头最强板块

每个 KPI 显示：

- 板块名称
- 综合评分
- 排名
- 关键原因，例如：`5 日资金净流入领先 / 成分股上涨占比高 / 龙头股强度突出`

### 2. 时间维度切换

支持：

```ts
export type TBoardDashboardRange = 'today' | 'five-days' | 'twenty-days';
```

文案：

- 今日
- 近 5 日
- 近 20 日

所有排行榜、象限、龙头股都跟随该时间维度刷新。

### 3. 四类榜单

#### A. 有潜力

用于找“尚未完全爆发但资金/结构正在改善”的板块。

参考指标：

- 近 5/20 日主力净流入为正。
- 最新涨幅不极端，避免已经过热。
- 成分股上涨占比提升。
- 成交额或换手率温和放大。
- 龙头股有资金净流入或相对强度。

#### B. 风头正盛

用于找“当前最强主线”。

参考指标：

- 板块涨跌幅排名靠前。
- 涨停数量多。
- 成分股上涨占比高。
- 主力净流入高。
- 龙头股涨幅、成交额、资金流同时靠前。

#### C. 不能碰

用于识别高风险板块。

参考指标：

- 近 5/20 日主力净流出明显。
- 成分股下跌占比高。
- 板块连续弱于全市场。
- 资金流出但换手/成交额放大，可能是出货。
- 龙头股破位或板块无有效龙头。

#### D. 龙头股

用于回答“这个板块谁是真龙头”。

每个板块选 3-5 只龙头候选：

- 主力净流入排名靠前。
- 成交额排名靠前。
- 涨幅强于板块均值。
- 换手率合理，不是纯缩量一字或异常无量。
- 在涨停/异动历史中出现频率更高时加分。

### 4. 象限图

建议展示“资金强度 × 价格强度”四象限：

```text
高价格强度 / 低资金强度：情绪冲高，谨慎追高
高价格强度 / 高资金强度：风头正盛
低价格强度 / 高资金强度：潜力蓄势
低价格强度 / 低资金强度：回避观察
```

数据不足时显示空状态，不得生成点位。

### 5. 板块排行榜表格

字段建议：

- 排名
- 板块名称
- 分类：行业 / 概念 / 未知
- 综合评分
- 涨跌幅
- 主力净流入
- 涨停数
- 上涨占比
- 平均换手率
- 平均振幅
- 龙头股
- 更新时间

大列表使用 `@tanstack/react-virtual` 或项目已有虚拟列表方案。

---

## 六、数据模型设计

在 `src/shared/types.ts` 新增类型，命名遵守 `I*` / `T*`：

```ts
export type TBoardDashboardRange = 'today' | 'five-days' | 'twenty-days';
export type TBoardDashboardBucket = 'potential' | 'hot' | 'avoid' | 'leader';
export type TBoardDashboardSource = 'duckdb' | 'stock-sdk' | 'a-stock-data' | 'merged' | 'constituent-aggregate';

export interface IBoardLeaderCandidate {
  code: string;
  name: string;
  price?: number | null;
  changePercent?: number | null;
  mainNetInflow?: number | null;
  amount?: number | null;
  turnoverRate?: number | null;
  amplitude?: number | null;
  leaderScore: number | null;
  reason: string;
}

export interface IBoardDashboardMetric {
  boardCode: string;
  boardName: string;
  boardKind?: 'industry' | 'concept' | 'unknown';
  range: TBoardDashboardRange;
  tradeDate: string;

  changePercent: number | null;
  maxDailyChangePercent: number | null;
  mainNetInflow: number | null;
  amount: number | null;
  limitUpCount: number | null;
  upCount: number | null;
  downCount: number | null;
  constituentCount: number;
  upRatio: number | null;
  averageTurnoverRate: number | null;
  averageAmplitude: number | null;

  momentumScore: number | null;
  fundScore: number | null;
  breadthScore: number | null;
  leaderScore: number | null;
  riskScore: number | null;
  rawScore: number | null;
  heatScore: number | null;
  heatRank: number | null;

  bucket: TBoardDashboardBucket;
  leaders: IBoardLeaderCandidate[];
  reason: string;
  source: TBoardDashboardSource;
  updatedAt: string;
  warnings?: string[];
}

export interface IBoardDashboardSnapshot {
  range: TBoardDashboardRange;
  tradeDate: string;
  updatedAt: string;
  summary: {
    hottest?: IBoardDashboardMetric;
    potential?: IBoardDashboardMetric;
    avoid?: IBoardDashboardMetric;
    strongestLeader?: IBoardDashboardMetric;
  };
  rankings: IBoardDashboardMetric[];
  potential: IBoardDashboardMetric[];
  hot: IBoardDashboardMetric[];
  avoid: IBoardDashboardMetric[];
  leaders: IBoardDashboardMetric[];
  warnings?: string[];
}
```

Browser fallback：返回空列表 + `warnings: ['板块 Dashboard 仅在 Electron 桌面端可用']`，不要造假数据。

---

## 七、IPC / API 设计

需要同步修改：

1. `src/shared/types.ts`
2. `src/shared/stocksense-api.ts`
3. `electron/preload.cjs`
4. `electron/ipc.ts`
5. `electron/services/stock/board-dashboard.ts`
6. UI 组件

新增 API：

```ts
getBoardDashboard(range?: TBoardDashboardRange, forceRefresh?: boolean): Promise<IBoardDashboardSnapshot>;
```

IPC Channel：

```ts
ipcMain.handle('board:getDashboard', (_event, range?: TBoardDashboardRange, forceRefresh?: boolean) =>
  getBoardDashboard(range, forceRefresh),
);
```

preload 暴露：

```js
getBoardDashboard: (range, forceRefresh) => ipcRenderer.invoke('board:getDashboard', range, forceRefresh),
```

---

## 八、Service 设计

建议新增：

```text
electron/services/stock/board-dashboard.ts
electron/services/stock/board-dashboard-utils.ts
electron/services/stock/__tests__/board-dashboard-utils.test.ts
```

### 1. `board-dashboard.ts`

职责：

- 对外提供 `getBoardDashboard(range, forceRefresh)`。
- 优先读取本地 DuckDB 缓存。
- 缓存不足或 `forceRefresh=true` 时使用 `stock-sdk` / 现有 Service 补齐真实数据。
- 合并本地与远程真实数据。
- 调用纯函数计算分数、分桶、排名、龙头股。
- 批量写入 DuckDB。
- 维护 in-flight Promise，避免同参数重复请求。

### 2. `board-dashboard-utils.ts`

只放纯计算：

- 时间窗口归一化。
- 数值解析与格式化前的标准化。
- 板块维度聚合。
- 龙头股评分。
- 综合评分。
- 风险评分。
- 分桶逻辑。
- 排名逻辑。
- 0.5 分粒度热度评分。

### 3. 推荐数据读取顺序

```text
getBoardDashboard(range)
  ↓
读取 board_dashboard_snapshots 或已有缓存
  ↓
读取 market_boards
  ↓
读取 board_constituents
  ↓
读取 daily_bars / stock_snapshots / stock_fund_flow_daily
  ↓
本地数据足够：直接计算并返回
  ↓
本地不足：通过 stock-sdk 获取板块列表、板块资金流、成分股、行情、资金流
  ↓
必要时参考 a-stock-data 中的真实板块/涨停池/资金流接口
  ↓
批量持久化
  ↓
返回 Dashboard Snapshot
```

### 4. 远程数据建议

优先使用 `stock-sdk` 已有能力：

- 板块列表：`sdk.board.industry.list()` / `sdk.board.concept.list()`
- 成分股：`sdk.board.industry.constituents(code)` / `sdk.board.concept.constituents(code)`
- 板块资金流：`sdk.fundFlow.sectorRank({ indicator })`
- 个股资金流：`sdk.fundFlow.rank({ indicator })` 或项目已有 `stock_fund_flow_daily`
- 涨停池：优先项目已有异动/涨停历史；不足时参考 stock-sdk marketEvent 能力或 a-stock-data 涨停池真实接口
- 历史 K 线：优先 DuckDB `daily_bars`，缺失时走 `market-data-query.ts` 的本地优先查询

注意：板块全量计算时不要对每个板块并发拉东财接口。需要批量优先、限流、缓存、降级为空/错误状态。

---

## 九、DuckDB 存储设计

已有表能复用的必须复用。为了 Dashboard 查询效率，建议新增快照表，而不是每次实时全量重算。

在 `electron/services/market-data/market-data-store.ts` 的 schema 中新增：

```sql
CREATE TABLE IF NOT EXISTS board_dashboard_snapshots (
  snapshot_key TEXT PRIMARY KEY,
  range TEXT NOT NULL,
  trade_date DATE NOT NULL,
  snapshot_json TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
```

如果后续需要按 SQL 查询单个板块排名，再新增明细表：

```sql
CREATE TABLE IF NOT EXISTS board_dashboard_metrics (
  board_code TEXT NOT NULL,
  range TEXT NOT NULL,
  trade_date DATE NOT NULL,
  board_name TEXT NOT NULL,
  bucket TEXT NOT NULL,
  heat_rank INTEGER,
  heat_score DOUBLE,
  raw_score DOUBLE,
  main_net_inflow DOUBLE,
  change_percent DOUBLE,
  limit_up_count INTEGER,
  up_ratio DOUBLE,
  average_turnover_rate DOUBLE,
  average_amplitude DOUBLE,
  source TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  PRIMARY KEY (board_code, range, trade_date)
);
```

第一阶段建议只做 `board_dashboard_snapshots`，简单、低风险、符合 Dashboard 快照读取场景。

新增 store 方法：

```ts
readBoardDashboardSnapshot(range: TBoardDashboardRange, tradeDate: string): Promise<IBoardDashboardSnapshot | undefined>;
writeBoardDashboardSnapshot(snapshot: IBoardDashboardSnapshot): Promise<void>;
```

写库要求：一次写入完整 snapshot，不要每个板块单独写。

---

## 十、评分与分桶规则

### 1. 标准化原则

每个指标先做分位归一化，避免不同量纲直接相加。

建议使用 0-100 分：

```text
momentumScore：涨跌幅、最大单日涨幅、相对强度
fundScore：主力净流入、成交额变化
breadthScore：上涨占比、涨停数、成分股扩散程度
leaderScore：板块 Top 龙头股综合强度
riskScore：资金流出、下跌占比、放量下跌、过热回落
```

### 2. 综合热度 rawScore

建议：

```text
rawScore = momentumScore * 0.30
         + fundScore * 0.30
         + breadthScore * 0.20
         + leaderScore * 0.20
         - riskScore * 0.25
```

可根据数据质量微调，但必须写在纯函数中并测试。

### 3. 热度评分 heatScore

范围 1-10，0.5 粒度：

```ts
function toHalfStepScore(rank: number, total: number): number {
  if (total <= 1) return 10;
  const percentileScore = 10 - ((rank - 1) / (total - 1)) * 9;
  return Math.min(10, Math.max(1, Math.round(percentileScore * 2) / 2));
}
```

无真实数据时：

- `rawScore = null`
- `heatScore = null`
- `heatRank = null`
- UI 展示“暂无评分数据”

不得生成默认分数。

### 4. 分桶逻辑

```text
hot：rawScore 高，momentumScore 高，fundScore 不弱，riskScore 可控
potential：fundScore 高，breadthScore 改善，momentumScore 中等，riskScore 低
avoid：riskScore 高，fundScore 弱或净流出，breadthScore 弱
leader：leaderScore 排名靠前，且至少有一个龙头候选数据完整
```

一个板块可主分类一个 `bucket`，同时可出现在不同榜单中；UI 榜单可按各自评分排序。

---

## 十一、图表设计约束

遵守 `dataviz` 方法：

1. 先确认数据用途，再选图表。
2. 不使用双 Y 轴。
3. 颜色表示明确语义，状态色只用于状态。
4. 多序列必须有图例或直接标注。
5. 没有真实序列时显示“暂无图表数据”。

第一阶段建议：

- 顶部 KPI：Stat tiles，不需要图表。
- 四象限：散点图，x=资金强度，y=价格强度。
- 排名：虚拟列表/表格，不做花哨图。
- 单板块趋势先不做，避免为了趋势去合成数据。

---

## 十二、加载与状态策略

### 1. 初次打开 Dashboard

```text
用户点击右侧栏“板块详情”
  ↓
BoardDashboardPanel mount
  ↓
getBoardDashboard(range='today')
  ↓
先读 DuckDB 快照
  ↓
有缓存：立即展示 + 后台刷新
  ↓
无缓存：展示 loading
  ↓
远程真实数据补齐
  ↓
计算并写入 DuckDB
  ↓
刷新 UI
```

### 2. 切换时间范围

- 优先读对应 range 的缓存。
- 如果缓存不存在或过期，再远程刷新。
- 切换时保留当前旧数据区域，顶部显示局部 loading，避免整个面板闪烁。

### 3. 错误策略

- 本地有缓存，远程失败：展示缓存 + warning，例如“最新数据刷新失败，当前为本地缓存”。
- 本地无缓存，远程失败：展示错误状态。
- 单个板块数据不完整：该板块对应字段为 `null`，不参与对应榜单评分。
- 不得 `catch { return [] }` 静默吞错；需要记录 warning 或抛出可理解错误。

---

## 十三、实现步骤

### Step 1：类型与 API

修改：

- `src/shared/types.ts`
- `src/shared/stocksense-api.ts`
- `electron/preload.cjs`
- `electron/ipc.ts`

新增：

```ts
getBoardDashboard(range?: TBoardDashboardRange, forceRefresh?: boolean): Promise<IBoardDashboardSnapshot>;
```

Browser fallback 返回空状态，不造数据。

### Step 2：DuckDB 快照读写

修改：

- `electron/services/market-data/market-data-store.ts`
- `electron/services/market-data/types.ts`

新增表与读写函数：

- `board_dashboard_snapshots`
- `readBoardDashboardSnapshot`
- `writeBoardDashboardSnapshot`

### Step 3：纯计算工具

新增：

- `electron/services/stock/board-dashboard-utils.ts`

包含：

- `normalizeDashboardRange`
- `calculateBoardMetric`
- `rankBoardMetrics`
- `toHalfStepScore`
- `classifyBoardBucket`
- `pickBoardLeaders`

### Step 4：Service 聚合

新增：

- `electron/services/stock/board-dashboard.ts`

职责：

- 本地读取。
- 远程补齐。
- 聚合计算。
- 批量写快照。
- 暴露 `getBoardDashboard`。

### Step 5：UI Dashboard

新增组件：

- `board-dashboard-panel.tsx`
- `board-dashboard-summary.tsx`
- `board-dashboard-quadrant.tsx`
- `board-dashboard-ranking.tsx`
- `board-dashboard-leaders.tsx`

修改：

- `src/components/stock-detail-panel/index.tsx`
- `src/components/stock-detail-panel/index.module.scss`

要求：

- loading / error / empty 状态完整。
- 点击 Dashboard 中板块行进入旧 `BoardDetailPanel`。
- 不直接请求第三方接口。
- 大列表虚拟化。

### Step 6：测试

新增：

- `electron/services/stock/__tests__/board-dashboard-utils.test.ts`
- 如有 store 读写逻辑，补 `electron/services/market-data/__tests__/...test.ts`
- 如已有组件测试框架适合，补 Dashboard 入口逻辑测试

重点测试：

1. `heatScore` 只出现 0.5 粒度。
2. 排名越靠前评分越高。
3. 无真实数据时不生成评分。
4. 风险高的板块进入 `avoid`。
5. 资金强但涨幅未过热的板块进入 `potential`。
6. 龙头股排序按资金、涨幅、成交额综合排序。
7. 点击右侧栏独立入口显示 Dashboard；点击板块名称仍显示旧详情。

---

## 十四、验收标准

### 功能验收

- [ ] 点击右侧栏“板块详情”且未选中具体板块时，展示板块 Dashboard。
- [ ] 点击任意板块名称/板块卡片时，继续展示旧 `BoardDetailPanel`。
- [ ] Dashboard 能展示“有潜力、风头正盛、不能碰、龙头股”四类信息。
- [ ] 支持今日 / 近 5 日 / 近 20 日切换。
- [ ] 点击 Dashboard 中任意板块可进入旧板块详情。
- [ ] 数据不足时展示空状态，不展示假排行/假评分/假图表。

### 数据验收

- [ ] 优先读取 DuckDB 真实缓存。
- [ ] 远程真实数据刷新后能批量写入 DuckDB。
- [ ] 使用 `stock-sdk` 优先；不足时才参考 `a-stock-data` 真实接口。
- [ ] 不存在 mock/fake/preview/demo/sample/hardcoded 行情数据。
- [ ] 不根据单个涨跌幅合成趋势图。

### 工程验收

- [ ] 无新增 `any`、`as any`、`as unknown as`、`@ts-ignore`。
- [ ] React Hook 依赖完整。
- [ ] 单组件文件不超过 500 行。
- [ ] 重点计算逻辑有中文单元测试。
- [ ] 通过针对性测试与 `pnpm typecheck`。

---

## 十五、建议验证命令

至少运行：

```bash
pnpm test -- electron/services/stock/__tests__/board-dashboard-utils.test.ts
pnpm typecheck
```

如果改动 DuckDB store：

```bash
pnpm test -- electron/services/market-data/__tests__
pnpm selfcheck:market-data
```

如果改动右侧栏 UI：

```bash
pnpm dev
```

并手动验证：

1. 直接点击右侧栏“板块详情”：看到 Dashboard。
2. 在探索页点击具体板块名称：仍看到旧板块详情。
3. Dashboard 点击某个板块：进入旧板块详情。
4. 断网或远程失败：显示缓存/错误，不出现假数据。

---

## 十六、最终汇报格式

实现完成后按以下格式输出：

```md
### Requirement Understanding

说明 Dashboard 与旧板块详情的入口区分，以及四类榜单目标。

### Implementation

说明新增/修改的类型、IPC、Service、DuckDB、UI 组件。

### Data Flow

说明 DuckDB 本地缓存、stock-sdk、a-stock-data、批量写库和错误状态链路。

### Impact

说明影响范围，尤其是右侧栏板块详情入口、板块点击旧逻辑、DuckDB schema。

### Risk

说明潜在风险：板块全量刷新耗时、远程字段缺失、历史资金流不完整、数据源限流。

### Verification

列出已运行测试、typecheck、自检和手动验证项；未运行需说明原因。
```
