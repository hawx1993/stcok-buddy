import type { AnnouncementItem, MarketNewsItem, StockDetail } from '../../../src/shared/types.js';
import { generateReport } from '../llm/index.js';
import { isLlmRequestError } from '../llm/openai-compatible-client.js';

export type NewsAnalysisInput = {
  stock?: StockDetail;
  news?: MarketNewsItem[];
  announcements?: AnnouncementItem[];
};

export async function runNewsAnalysisAgent(input: NewsAnalysisInput, onToken?: (token: string) => void): Promise<string> {
  const news = input.news ?? [];
  const announcements = input.announcements ?? [];
  const stockName = input.stock?.name ?? input.stock?.code ?? '新闻公告';

  if (news.length === 0 && announcements.length === 0) {
    return '# 新闻公告分析\n最近未检索到相关新闻或公告。\n建议关注：\n- 公司公告\n- 定期报告\n- 行业动态';
  }

  try {
    const report = await generateReport([
      {
        role: 'system',
        content: `你是一名专业A股投研分析师。你将获得股票信息、最近新闻、最近公告。

任务：
第一部分：事件总结
总结最近发生了什么，要求不超过200字，按时间顺序整理。

第二部分：利好分析
分析哪些新闻属于利好、为什么属于利好、对公司有哪些积极影响。

第三部分：利空分析
分析哪些新闻属于利空、为什么属于利空、对公司有哪些负面影响。

第四部分：短期影响
判断未来1天、1周、1个月可能影响。

第五部分：中长期影响
判断未来3个月、6个月、1年可能影响。

第六部分：风险提示
列出政策风险、业绩风险、行业风险、市场风险。

输出格式：
# ${stockName} 新闻公告解读
## 📰 核心事件
...
## ✅ 利好因素
...
## ⚠️ 利空因素
...
## 📈 短期影响
...
## 🏛️ 中长期影响
...
## 🚨 风险提示
...
## 🎯 综合结论
...

Emoji 规则：采用专业金融风格；禁止娱乐化、炒作型 Emoji（🚀🔥💎🌙🤑🎉）；每段最多1~2个 Emoji；二级内容按语义少量使用：资金流入💰、上涨📈、下跌📉、治理🏢、合作🤝、行业🌐、亏损❌、风险⚡、政策📜、公告📄、新闻📰、周期📅、长期🗓️。综合结论必须给出 🟢 偏利好 / 🟡 中性 / 🔴 偏利空 之一。

禁止输出：未提供新闻内容、无法分析、缺少数据、没有结构化信息、仅包含查询意图。只基于输入数据，不要编造内容。`,
      },
      {
        role: 'user',
        content: `结构化数据：\n${JSON.stringify({ stock: input.stock, news, announcements }, null, 2)}`,
      },
    ], onToken);
    return ensureNewsEmoji(report, stockName, news, announcements);
  } catch (error) {
    if (isLlmRequestError(error)) throw error;
    return fallbackNewsAnalysis(stockName, news, announcements);
  }
}

function ensureNewsEmoji(report: string, stockName: string, news: MarketNewsItem[], announcements: AnnouncementItem[]) {
  let text = report.trim() || fallbackNewsAnalysis(stockName, news, announcements);
  text = text.replace(/^##\s*(?:📰\s*)?核心事件/gm, '## 📰 核心事件');
  text = text.replace(/^##\s*(?:✅\s*)?利好因素/gm, '## ✅ 利好因素');
  text = text.replace(/^##\s*(?:⚠️\s*)?利空因素/gm, '## ⚠️ 利空因素');
  text = text.replace(/^##\s*(?:📈\s*)?短期影响/gm, '## 📈 短期影响');
  text = text.replace(/^##\s*(?:🏛️\s*)?中长期影响/gm, '## 🏛️ 中长期影响');
  text = text.replace(/^##\s*(?:🚨\s*)?风险提示/gm, '## 🚨 风险提示');
  text = text.replace(/^##\s*(?:🎯\s*)?综合结论/gm, '## 🎯 综合结论');
  if (!/##\s*📰\s*核心事件/.test(text)) text = `# ${stockName} 新闻公告解读\n## 📰 核心事件\n${text}`;
  if (!/🟢 偏利好|🟡 中性|🔴 偏利空/.test(text)) text = text.replace(/(## 🎯 综合结论\s*)/m, `$1\n${scoreConclusion(news.filter((item) => item.tagType === 'positive').length, news.filter((item) => item.tagType === 'impact').length)}：`);
  return text;
}

function fallbackNewsAnalysis(stockName: string, news: MarketNewsItem[], announcements: AnnouncementItem[]) {
  const latestNews = news.slice(0, 8);
  const latestAnnouncements = announcements.slice(0, 8);
  const positive = latestNews.filter((item) => item.tagType === 'positive');
  const negative = latestNews.filter((item) => item.tagType === 'impact');

  return [
    `# ${stockName} 新闻公告解读`,
    '',
    '## 📰 核心事件',
    ...latestNews.map((item) => `- 📰 ${item.time || '--'}｜新闻｜${item.title}${item.content ? `：${item.content}` : ''}${item.url ? ` [查看](${item.url})` : ''}`),
    ...latestAnnouncements.map((item) => `- 📄 ${item.date || '--'}｜${item.type || '公告'}｜${item.title}${item.content && item.content !== item.title ? `：${item.content}` : ''}${item.url ? ` [查看](${item.url})` : ''}`),
    '',
    '## ✅ 利好因素',
    positive.length ? positive.map((item) => `- 📈 ${item.title}：标题/摘要呈现偏积极信号，需结合公告正文和后续经营数据验证。`).join('\n') : '- 🟡 暂未从标题和摘要中识别到明确利好事项。',
    '',
    '## ⚠️ 利空因素',
    negative.length ? negative.map((item) => `- 📉 ${item.title}：标题/摘要呈现偏负面或扰动信号，需关注对订单、盈利和估值预期的影响。`).join('\n') : '- 🟡 暂未从标题和摘要中识别到明确利空事项。',
    '',
    '## 📈 短期影响',
    '- 📅 1天：更可能受新闻热度、公告标题和市场风险偏好影响。\n- 📅 1周：关注事件是否被资金持续交易，以及公司是否有进一步澄清或补充公告。\n- 📅 1个月：若事件关联订单、产能、融资、监管或业绩预期，影响可能继续发酵。',
    '',
    '## 🏛️ 中长期影响',
    '- 🗓️ 3个月：重点观察事件是否转化为经营数据或财务指标。\n- 🗓️ 6个月：关注行业景气、竞争格局和公司战略执行。\n- 🗓️ 1年：仍需回到盈利能力、现金流、产能利用率和估值消化。',
    '',
    '## 🚨 风险提示',
    '- 📜 政策风险：产业政策、监管规则或国际贸易环境变化。\n- ⚡ 业绩风险：订单兑现、毛利率、费用和减值不及预期。\n- 🌐 行业风险：竞争加剧、价格下行或需求波动。\n- ⚡ 市场风险：估值波动、流动性变化和情绪回撤。',
    '',
    '## 🎯 综合结论',
    `${scoreConclusion(positive.length, negative.length)}：本次共检索到新闻 ${news.length} 条、公告 ${announcements.length} 条。当前解读基于已拉取的新闻标题、摘要和公告列表，后续应结合公告 PDF 正文、财报和行情资金面继续验证。`,
  ].join('\n');
}

function scoreConclusion(positiveCount: number, negativeCount: number) {
  if (positiveCount > negativeCount) return '🟢 偏利好';
  if (negativeCount > positiveCount) return '🔴 偏利空';
  return '🟡 中性';
}
