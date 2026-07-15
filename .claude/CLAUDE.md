# Stock Agents 项目规则

## 行情数据源规则

所有面向用户的接口/API 功能必须使用真实数据。**不得**在用户可见的股票、行情、板块、新闻、图表等响应中使用编造数据、mock 数据、preview 数据、demo 数据、sample 数据或硬编码行情数据。

股票/行情数据源优先级：

1. **优先使用 `stock-sdk`**
   - 已安装 `stock-sdk` 时，任何股票/行情接口都必须优先使用它。
   - 新增或修改接口前先参考文档：https://stock-sdk.linkdiary.cn/api/
   - stock-sdk skills 参考文档：https://stock-sdk.linkdiary.cn/skills/catalog
   - 行情、搜索、K 线、板块/行业、热点、筹码、新闻等能力，凡是 `stock-sdk` 支持的都优先走 `stock-sdk`。

2. **其次使用 `a-stock-data skills`**
   - 如果 `stock-sdk` 没有数据、没有对应接口，或接口不适合当前场景，再使用 `a-stock-data skills` 提供的接口。
   - 等待或降级到 `a-stock-data skills` 时，不得自行编造替代数据。

3. **禁止伪造 fallback 行情**
   - 如果 `stock-sdk` 和 `a-stock-data skills` 都失败或返回空，必须展示明确的空状态/错误状态/加载状态，例如“暂无数据 / 数据源暂不可用”。
   - 不得静默替换为假的股票、价格、指数、板块排行、新闻、K 线、分时线或合成走势图。
   - 仅测试、自检文件可以使用 mock，但必须明确限定在 test/selfcheck 场景，不能进入生产 UI 或生产 API 响应。

## 代码组织规则

1. **一个文件一个组件**
   - React 组件文件中原则上只维护一个主组件。
   - 多余组件必须拆到当前目录下的 `components/` 子目录维护。
   - 示例：`src/components/market-view/index.tsx` 中的子组件应拆到 `src/components/market-view/components/`。

2. **组件不得超过 500 行**
   - 单个组件文件超过 500 行时，必须拆分。
   - 拆分优先按 UI 区块、业务职责、列表项、弹层、图表等边界进行。
   - 不要为了绕过行数限制把多个无关组件塞进同一个文件。

3. **优先复用成熟实现**
   - 写代码前先查现有代码、已安装 npm 包、成熟开源 GitHub repo。
   - 能用已有 npm 包或可靠开源实现解决的，不要自己乱写一套。
   - 新增依赖前先确认项目里是否已有等价依赖；已有依赖能解决就复用已有依赖。
   - 自己实现只用于：业务胶水代码、很小的适配逻辑、或现有依赖无法覆盖的场景。

## 实现指导

- 新增行情 fallback 前，必须先搜索项目里已有真实数据 provider 并复用。
- 浏览器/PWA fallback 代码不得声称或展示假的实时行情；只能展示 UI 空状态、提示运行 Electron，或展示真实 API 数据。
- 图表 UI 不得根据单个价格或涨跌幅合成走势/K线/分时数据；有真实序列才画图，否则显示“暂无图表数据”。
- 搜索/自动补全必须支持股票代码和名称的部分匹配，数据源优先 `stock-sdk`，其次 `a-stock-data skills`。
- 领涨板块/行业展示必须使用真实板块/行业排行接口；失败时只能展示空状态或错误状态。

## 当前扫描记录

2026-07-13 扫描项目时发现以下历史硬编码或 fallback 数据模式。后续触碰相关文件时，不得继续扩展这些模式，应逐步替换为真实数据源：

- `src/shared/stocksense-api.ts`：浏览器预览 `stockMap`、`fallbackNews`、`fallbackHot`、`makePreview*` 数据。
- `electron/services/stock/stock-client.ts`：`fallbackMarketQuotes`、`fallbackMarketBoards`、`fallbackSectorHot`、合成指数辅助函数。
- `src/components/kline-chart/index.tsx`：无股票代码时的合成图表数据。
- Agent 的 fallback 文案/证据 helper 可以保留“数据不可用”提示，但不得伪造市场数值。
