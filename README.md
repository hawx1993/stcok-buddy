# StockBuddy

对话式 A 股投研助手桌面端 / PWA Demo。项目基于 Electron + React + TypeScript，数据层接入 `stock-sdk`，支持用户在系统设置中自由选择常用大模型厂商并填写自己的 API Key。

> 定位：研究辅助与信息聚合工具，不构成投资建议。

## 功能特性

- 三栏桌面端 UI：会话列表、对话式投研、股票详情面板
- 对话式 A 股分析：行情查询、技术指标、板块/资金流、持仓记忆预留
- `stock-sdk` 数据接入：A 股行情、K 线、技术指标、资金流等
- 多 Agent MVP：Orchestrator / DataAgent / AnalysisAgent / ReportAgent / RiskAgent
- 系统设置弹窗：大模型厂商、API 地址、API Key、模型名、交易风格、风险偏好、持仓周期
- 常用模型厂商预设：
  - DeepSeek（含 deepseek-chat / deepseek-reasoner / 自定义 DeepSeek v4 模型名）
  - OpenAI
  - 通义千问 Qwen
  - 文心一言 ERNIE
  - 智谱 GLM
  - 月之暗面 Moonshot
  - OpenAI Compatible
  - 自定义 API
- 深浅色主题切换
- PWA 支持：manifest + service worker + 浏览器 fallback API
- Electron 打包支持：macOS DMG

## 技术栈

- Electron
- React 18
- TypeScript
- Vite
- Zustand：跨组件状态管理
- GSAP：界面动效
- electron-store：本地配置与会话存储
- stock-sdk：股票行情与指标数据
- electron-builder：桌面端打包

## 安装

推荐使用 pnpm：

```bash
pnpm install
```

如果使用 npm：

```bash
npm install
```

## 开发

### Electron 桌面端开发

```bash
pnpm run dev
```

该命令会同时启动 Vite Renderer 与 Electron Main Process。

### 浏览器 / PWA 预览

```bash
pnpm run dev:web
```

浏览器环境没有 Electron preload，因此应用会启用 Web fallback API：

- 可体验 UI、主题、动效、系统设置、PWA
- 使用本地示例股票数据
- 实时 `stock-sdk` 与本机安全 API Key 存储在 Electron 桌面端中启用

## 系统设置

点击左下角用户菜单中的 **系统设置**：

1. 选择大模型厂商
2. 确认或修改 API 地址
3. 填写 API Key
4. 可选：填写模型名称，例如：
   - `deepseek-chat`
   - `deepseek-reasoner`
   - `deepseek-v4`
   - `qwen-plus`
   - `glm-4-plus`
   - `moonshot-v1-8k`
5. 配置交易风格、风险偏好、持仓周期
6. 点击保存

API Key 只存储在本地：

- Electron：`electron-store`
- Web/PWA 预览：`localStorage`

## 构建

```bash
pnpm run build
```

该命令会执行：

1. TypeScript 类型检查
2. Vite 前端构建
3. Electron Main/Preload 编译

## PWA 构建

```bash
pnpm run build:pwa
```

PWA 相关文件：

- `public/manifest.webmanifest`
- `public/sw.js`
- `public/icons/icon.svg`
- `src/registerServiceWorker.ts`

Service Worker 仅在生产构建中注册，开发环境不注册，避免缓存影响调试。

## macOS DMG 打包

```bash
pnpm run dist:mac
```

输出目录：

```text
release/
```

DMG 文件示例：

```text
StockBuddy-0.1.0-arm64.dmg
StockBuddy-0.1.0-x64.dmg
```

如果出现 `electron-builder` 未安装：

```bash
pnpm add -D electron-builder
pnpm run dist:mac
```

## 常用脚本

```bash
pnpm run dev        # Electron 桌面端开发
pnpm run dev:web    # 浏览器/PWA 预览
pnpm run typecheck  # TypeScript 检查
pnpm run build      # 构建 renderer + electron
pnpm run build:pwa  # PWA 构建
pnpm run pack       # Electron 目录打包
pnpm run dist       # Electron 分发包
pnpm run dist:mac   # macOS DMG
```

## 合规提示

StockBuddy 仅用于公开数据研究、信息聚合与辅助分析。所有输出均不构成投资建议，不应作为买卖股票、基金或其他金融产品的依据。
