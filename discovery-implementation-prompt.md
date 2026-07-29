# 探索（Discovery）功能实现 Prompt

## 概述

在左侧栏「行情」入口下方新增「探索」入口，点击后在中间主区域展示"今日机会"内容面板。参考 `discovery-prd.html` 的中间栏内容设计，但不改动左侧栏结构（左侧栏只新增一个入口按钮）。

---

## 1. 架构变更

### 1.1 MainView 类型扩展

**文件**: `src/store/app-store.ts`

```ts
// 第 20 行，新增 'discovery'
export type MainView = 'chat' | 'market' | 'news-reader' | 'discovery';
```

`setMainView` 的签名已是 `Exclude<MainView, 'news-reader'>`，discovery 会自动纳入，无需改动。

### 1.2 主布局视图路由

**文件**: `src/app.tsx` 第 147-149 行

当前：
```tsx
{mainView === 'news-reader' ? <NewsReader /> : mainView === 'market' ? <MarketView /> : <ChatView />}
```

改为：
```tsx
{mainView === 'news-reader' ? <NewsReader /> : mainView === 'market' ? <MarketView /> : mainView === 'discovery' ? <DiscoveryView /> : <ChatView />}
```

同时新增 import：
```ts
import { DiscoveryView } from './components/discovery-view';
```

ErrorBoundary name 也需扩展：
```tsx
<ErrorBoundary name={
  mainView === 'market' ? '行情区' :
  mainView === 'news-reader' ? '新闻阅读区' :
  mainView === 'discovery' ? '探索区' :
  '聊天区'
}>
```

### 1.3 左侧栏入口

**文件**: `src/components/sidebar/index.tsx`

在行情按钮（第 237-250 行）下方新增探索入口按钮：

```tsx
<button
  className={cx(styles['market-entry'], mainView === 'discovery' && styles.active)}
  onMouseMove={moveGlow}
  onClick={() => {
    trackButtonClick('open_discovery');
    trackPageView('discovery');
    setConversationMenuId(undefined);
    setMainView('discovery');
  }}
  type='button'
>
  <Compass size={17} />
  探索
</button>
```

需要从 `lucide-react` 引入 `Compass` 图标。

**SCSS**: `src/components/sidebar/index.module.scss` — `.market-entry` 样式已存在且适用于探索按钮（相同的尺寸、hover 效果、active 状态），无需新增样式类，直接复用 `.market-entry`。

---

## 2. DiscoveryView 组件

### 2.1 目录结构

```
src/components/discovery-view/
├── index.tsx                    # 主组件：顶部栏 + pill 导航 + 内容区
├── index.module.scss            # 样式
├── discovery-api.ts             # 数据获取层（调用 stocksenseApi）
└── components/
    ├── hero-gauge.tsx           # 今日机会分仪表盘
    ├── market-summary.tsx       # AI 市场总结
    ├── watchlist-radar.tsx      # 自选股机会雷达
    ├── sentiment-index.tsx      # 情绪指数
    ├── dragon-tiger.tsx         # 龙虎榜
    ├── hot-rotation.tsx         # 热点轮动
    ├── limit-up-review.tsx      # 涨停复盘
    ├── tomorrow-preview.tsx     # 明日预判
    └── subscribe-footer.tsx     # 订阅推送
```

### 2.2 主组件结构

`index.tsx` 参考 PRD 的 takeover 视图结构：

```
┌──────────────────────────────────────────────┐
│ ← 返回 │ 今日机会 │ 日期 │ 盘中/盘前 pill  │ 连续查看 streak │  ← topbar
├──────────────────────────────────────────────┤
│ 机会分 │ 市场总结 │ 为你雷达 │ 情绪 │ ...    │  ← pill nav (sticky)
├──────────────────────────────────────────────┤
│                                              │
│  🎯 Hero Gauge (今日机会分)                  │  ← scrollable content
│                                              │
│  ── Timeline ──                              │
│  📰 市场总结                                 │
│  👀 自选机会雷达                             │
│  🌡️ 情绪指数                                │
│  🐉 龙虎榜                                   │
│  🔥 热点轮动                                 │
│  🚀 涨停复盘                                 │
│  🔮 明日预判                                 │
│                                              │
│  📬 订阅推送                                 │
└──────────────────────────────────────────────┘
```

**Topbar**:
- 返回按钮：调用 `setMainView('chat')`
- 标题："今日机会"
- 日期：当日日期（如 `2026-07-29 星期三`）
- 阶段 pill：根据 `getMarketStatus('A')` 显示"盘中"（带绿点动画）/ "盘前" / "盘后" / "休市"
- 连续查看 streak：从 localStorage 读取（记录用户查看天数）

**Pill Nav**（sticky，水平滚动）:
- 今日机会分、市场总结、为你雷达、情绪指数、龙虎榜、热点轮动、涨停复盘、明日预判
- 点击 pill 滚动到对应 section（`scrollIntoView({ behavior: 'smooth' })`）
- 滚动内容时高亮当前可见 section（IntersectionObserver）

**内容区**: 纵向滚动，各 section 按 timeline 排列

### 2.3 关键交互

- **Pill 点击 → 锚点滚动**：纯前端，无需路由
- **返回按钮** → 回到聊天视图（`setMainView('chat')`）
- **龙虎榜 Tab 切换**：机构 / 游资 / 北向
- **热点轮动 chip 点击**：展开下方归因详情
- **明日预判 switch 开关**：订阅/取消订阅某条预判
- **订阅按钮**：底部 subscribe CTA

---

## 3. 各 Section 数据需求与数据源

> **数据原则**：遵循项目 `data.md` 规则，所有数据通过 `stocksenseApi` provider 层获取，禁止组件直接调 stock-sdk MCP 或第三方 API。Electron 端从 stock-client 提供真实数据；浏览器端返回空/错误状态。

### 3.1 今日机会分（Hero Gauge）

**数据**：综合评分 0-100，一句话研判，近 7 日分数走势

**数据源**：
- 综合评分由后端计算：基于指数涨跌、成交额变化、涨跌家数比、北向资金、连板高度、情绪指标等
- 需要新增 API：`getDiscoveryScore()` → `{ score, verdict, trend: number[], updatedAt }`

**UI**：
- SVG 半圆仪表盘，渐变色（绿→金→红）
- 分数大数字 + 评级标签（积极/谨慎/消极）
- AI 一句话研判文案
- 近 7 日走势 sparkline

### 3.2 AI 市场总结

**数据**：三大指数行情、市场要点列表

**数据源**：
- 指数行情：已有 `getMarketPageSnapshot` 的 indices 字段，或复用 stock-sdk `get_a_share_quotes`（sh000001, sz399001, sz399006）
- AI 总结文案：需要后端生成，新增 API `getDiscoverySummary()` → `{ indices, bullets: string[], updatedAt }`
- 阶段标记（盘前/盘中/盘后）：`getMarketStatus('A')`

### 3.3 自选股机会雷达

**数据**：基于用户自选股的实时机会检测

**数据源**：
- 自选股列表：已有 `listFavoriteStocks()`
- 实时行情：已有 `getBatchQuotes(codes)`
- 技术信号：stock-sdk `get_kline_signals`（通过 provider 封装）
- 资金流向：stock-sdk `get_individual_fund_flow`（通过 provider 封装）
- 需要新增 API：`getDiscoveryWatchlist()` → `{ opportunities: WatchlistOpportunity[] }`

**WatchlistOpportunity** 类型：
```ts
interface WatchlistOpportunity {
  code: string;
  name: string;
  changePercent: number;
  signals: Array<{ label: string; type: 'signal' | 'normal' }>;
}
```

### 3.4 情绪指数

**数据**：市场情绪 0-100（恐慌←中性→贪婪），分项因子

**数据源**：
- 涨跌家数比：需要全市场涨跌统计
- 最高连板数：从涨停池 `get_zt_pool` 推导
- 成交额环比：从指数行情计算
- 60 日新高家数：需要市场宽度数据
- 需要新增 API：`getDiscoverySentiment()` → `{ score, factors: SentimentFactor[] }`

### 3.5 龙虎榜

**数据**：今日龙虎榜净买入排行，按机构/游资/北向分 tab

**数据源**：
- stock-sdk `get_dragon_tiger_detail(startDate, endDate)` — 返回上榜个股明细
- 按上榜原因/席位类型分 tab
- 需要新增 API：`getDiscoveryDragonTiger()` → `{ inst: DTItem[], hot: DTItem[], north: DTItem[] }`

### 3.6 热点轮动

**数据**：当日热点概念/行业板块，含热度值和归因

**数据源**：
- stock-sdk `get_concept_list()` — 概念板块列表（有涨跌幅、成交额）
- stock-sdk `get_industry_list()` — 行业板块列表
- 归因文案：AI 生成
- 需要新增 API：`getDiscoveryHotRotation()` → `{ chips: HotChip[] }`

### 3.7 涨停复盘

**数据**：今日涨停个股，含连板数、涨停原因

**数据源**：
- stock-sdk `get_zt_pool(type)` — type: 'zt' 涨停, 'yesterday' 昨日涨停, 'strong' 强势
- 需要新增 API：`getDiscoveryLimitUp()` → `{ stocks: LimitUpStock[] }`

### 3.8 明日预判

**数据**：AI 预判次日值得关注的方向/个股

**数据源**：
- AI 生成（基于收盘数据 + 消息面），需要后端支持
- 需要新增 API：`getDiscoveryTomorrowPreview()` → `{ items: TomorrowItem[] }`
- 订阅状态存储：`getDiscoverySubscription()` / `setDiscoverySubscription(id, enabled)`

---

## 4. 数据层实现指南

### 4.1 新增 API 接口

**文件**: `src/shared/stocksense-api.ts`

在 `IStocksenseApi` 接口中新增：

```ts
// Discovery
getDiscoveryScore(): Promise<IDiscoveryScore>;
getDiscoverySummary(): Promise<IDiscoverySummary>;
getDiscoveryWatchlist(): Promise<IDiscoveryWatchlist>;
getDiscoverySentiment(): Promise<IDiscoverySentiment>;
getDiscoveryDragonTiger(): Promise<IDiscoveryDragonTiger>;
getDiscoveryHotRotation(): Promise<IDiscoveryHotRotation>;
getDiscoveryLimitUp(): Promise<IDiscoveryLimitUp>;
getDiscoveryTomorrowPreview(): Promise<IDiscoveryTomorrow>;
getDiscoverySubscription(): Promise<Record<string, boolean>>;
setDiscoverySubscription(id: string, enabled: boolean): Promise<Record<string, boolean>>;
```

浏览器端 fallback 返回空/错误状态（参考现有 browserApi 模式）。

### 4.2 新增类型

**文件**: `src/shared/types.ts`

新增所有 Discovery 相关接口类型（`IDiscoveryScore`, `IDiscoverySummary`, `WatchlistOpportunity` 等）。

### 4.3 Electron 端实现

**文件**: `electron/services/stock/stock-client.ts` 或新建 `electron/services/stock/discovery-service.ts`

- 使用 stock-sdk MCP 工具获取底层数据
- 通过 IPC 暴露给渲染进程
- 部分 AI 文案可由 main process 调用 LLM 生成

---

## 5. 样式规范

**参考 PRD 的 CSS 变量体系**，但映射到项目现有变量：

| PRD 变量 | 项目变量 | 用途 |
|----------|---------|------|
| `--bg-void` | `--bg` | 主背景 |
| `--bg-panel` | `--sidebar-bg` | 面板背景 |
| `--bg-raised` | `--surface-hover` | 悬浮卡片 |
| `--line` | `--glass-border` | 分割线 |
| `--ink-1` | `--fg` | 主文字 |
| `--ink-2` | `--fg-secondary` | 次文字 |
| `--ink-3` | `--muted` | 三级文字 |
| `--gold` | 需新增 `--gold` (#E8B84B) | 强调色 |
| `--up` / `--down` | 项目现有涨跌色 | 涨跌色 |

**SCSS 文件**: `src/components/discovery-view/index.module.scss`

- 使用 CSS Modules（与项目一致）
- 响应式：内容区 `max-width: 980px; margin: 0 auto;`
- 暗色主题为首要目标（项目默认 dark mode）
- 遵循现有 border-radius、spacing 惯例

---

## 6. 组件状态覆盖

每个 section 需要覆盖的状态：

| Section | Loading | Empty | Error | Normal |
|---------|---------|-------|-------|--------|
| Hero Gauge | 骨架屏 | "暂无机会评分" | "评分计算失败" | 仪表盘 |
| 市场总结 | 骨架屏 | "等待开盘" | "数据获取失败" | 指数卡片+列表 |
| 自选雷达 | 骨架屏 | "添加自选股以启用机会雷达" | "扫描失败" | 机会卡片网格 |
| 情绪指数 | 骨架屏 | "暂无情绪数据" | "数据获取失败" | 情绪条+因子 |
| 龙虎榜 | 骨架屏 | "今日暂无龙虎榜数据" | "数据获取失败" | 表格 |
| 热点轮动 | 骨架屏 | "暂无热点数据" | "数据获取失败" | chip 云 |
| 涨停复盘 | 骨架屏 | "今日暂无涨停数据" | "数据获取失败" | 涨停卡片网格 |
| 明日预判 | 骨架屏 | "收盘后生成明日预判" | "预判生成失败" | 预判卡片列表 |

**Loading 骨架**：使用简单的 pulse 动画占位块（灰色圆角矩形），不用额外骨架屏库。

**Empty 状态**：居中显示图标 + 文案，灰色文字。

**Error 状态**：居中显示错误图标 + 文案 + 重试按钮。

---

## 7. 实现顺序（推荐）

1. **类型定义**：`src/shared/types.ts` 新增所有 Discovery 类型
2. **API 接口声明 + 浏览器 fallback**：`src/shared/stocksense-api.ts`
3. **App Store 类型扩展**：`src/store/app-store.ts` 加 `'discovery'`
4. **主布局路由**：`src/app.tsx` 加 DiscoveryView 分支
5. **侧边栏入口**：`src/components/sidebar/index.tsx` 加探索按钮
6. **DiscoveryView 骨架**：创建目录 + index.tsx 主框架（topbar + pillnav + 空内容区）
7. **逐 section 实现**：先 Hero Gauge → 市场总结 → 情绪指数 → 自选雷达 → 龙虎榜 → 热点轮动 → 涨停复盘 → 明日预判 → 订阅 footer
8. **Electron 端数据接入**：`electron/services/stock/` 实现真实数据获取
9. **边缘状态完善**：loading/empty/error 状态 + 浏览器兼容提示

---

## 8. 参考文件

| 用途 | 文件 |
|------|------|
| PRD 原型 | `discovery-prd.html` |
| MainView 路由模式 | `src/app.tsx` 第 147-149 行 |
| App Store | `src/store/app-store.ts` |
| 侧边栏入口模式 | `src/components/sidebar/index.tsx` 第 237-250 行（行情按钮） |
| 主视图参考 | `src/components/market-view/index.tsx`（数据获取 + tab 切换模式） |
| 类型定义 | `src/shared/types.ts` |
| API 接口 | `src/shared/stocksense-api.ts` |
| 侧边栏 SCSS | `src/components/sidebar/index.module.scss`（`.market-entry` 样式） |

---

## 9. 注意事项

- **禁止 mock 数据**：遵循 `data.md` 规则，浏览器端返回空状态/错误提示，不得编造行情数据
- **emoji 规范**：遵循 `emoji.md` 规则，使用专业金融风格 emoji（📰📈📉🏢🤝🌐📜📄📅🗓️⚡），禁止 🚀🔥💎🌙🤑🎉
- **TypeScript 规范**：遵循 `typescript-react.md`，禁止 any/ts-ignore，文件命名 kebab-case
- **组件拆分**：单文件不超过 400 行，子组件放 `components/` 目录
- **数据流**：UI → discovery-api → stocksenseApi → IPC → stock-client → stock-sdk MCP / 外部数据源
- **不实现左侧栏子菜单**：PRD 中侧边栏的"今日机会"展开组（opp-group）不需要实现，左侧栏仅需要一个探索入口按钮
