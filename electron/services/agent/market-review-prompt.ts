import type { TMarketReviewReport } from '../../../src/shared/types.js';
import type { LlmChatMessage } from '../llm/openai-compatible-client.js';

export function createMarketReviewMessages(report: TMarketReviewReport): LlmChatMessage[] {
  return [
    {
      role: 'system',
      content: `你是专业 A 股盘后复盘分析师。仅可使用用户消息中的结构化真实数据；严禁补齐、估算、臆测或编造任何数值、股票、板块、涨跌、资金、原因或连板数据。字段为 null、数组为空或 dataGaps 命中时，必须写“暂无数据”或“数据源暂不可用”。观点与事实分段，观点使用“可能”“需观察”等条件表述；不提供买卖建议或收益承诺。输出 Markdown，保持专业金融风格，每段至多两个 Emoji。`,
    },
    {
      role: 'user',
      content: `请基于以下 ${report.tradeDate} 的结构化市场数据，严格按此顺序输出：

## 📰 AI 一句话总结
一段一句话，必须引用输入中可见的市场事实。

## 📈 市场情绪
写情绪评分和涨停、跌停、炸板、连板、最高板、昨日涨停指数、昨日连板指数；缺失字段明确写暂无数据。

## 💰 赚钱效应
写五星强度、平均涨幅、上涨/下跌股票、涨跌幅中位数、赚钱方向和亏钱方向。

## 🌐 热点轮动
按热点列出强度、涨停数、龙头和高度；只依据输入说明上涨原因、资金流、板块成交额、涨停名单与核心股。每个热点最后写一条条件式跟踪观察。

## 🏢 龙头股复盘
逐只写所属概念、成交额、换手、封单和结构性点评；字段缺失不得推断。

## 📅 明日重点关注
先写“明天开盘以后，请优先观察：”，再严格按 nextDayFocus 顺序列出六项条件：龙头封板/承接、热点接力、成交额是否超过今日基准、涨停是否超过70家、炸板率是否低于今日基准、北向资金是否净流入。仅可引用 nextDayFocus 提供的名称和数值；字段缺失必须写暂无数据，不能自行补充阈值或判断。

## 🚨 风险提示
说明数据源、数据缺口与短线波动风险。

## 🎯 综合结论
只以“🟢 偏利好”“🟡 中性”或“🔴 偏利空”开头，给出条件式结论。

结构化数据：
${JSON.stringify(report)}`,
    },
  ];
}
