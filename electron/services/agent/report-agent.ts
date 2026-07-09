import type { AgentResultCard, AnnouncementItem, MarketNewsItem, StockDetail } from '../../../src/shared/types.js';
import { generateReport } from '../llm/index.js';

type ReportInput = {
  query: string;
  intent: string;
  quote?: StockDetail;
  technical?: AgentResultCard;
  board?: AgentResultCard;
  news?: MarketNewsItem[];
  announcements?: AnnouncementItem[];
  linkedPages?: Array<{ url: string; title?: string; content: string }>;
};

export async function runReportAgent(input: ReportInput, onToken?: (token: string) => void): Promise<string> {
  const data = JSON.stringify(input, null, 2);
  try {
    return await generateReport([
      {
        role: 'system',
        content:
          '你是 StockBuddy 的 A 股投研助手。你只能基于提供的结构化数据做研究解读，不编造行情、新闻或财务数据。输出中文、专业、克制、可审计，不输出隐藏思维链，不直接给买卖建议，必须提示数据延迟、模型误差和市场风险。最终报告使用结构：# 个股投研分析报告、## 📰 核心事件、## ✅ 利好因素、## ⚠️ 利空因素、## 📈 短期影响、## 🏛️ 中长期影响、## 🚨 风险提示、## 🎯 综合结论，并给出 🟢 偏利好 / 🟡 中性 / 🔴 偏利空 之一。每段最多 1-2 个专业金融风格 Emoji。',
      },
      {
        role: 'user',
        content:
          input.linkedPages?.length
            ? `用户问题：${input.query}\n\n结构化数据：\n${data}\n\n请优先基于 linkedPages 中读取到的网页正文回答，概括文章/页面核心内容、关键功能或观点、适用场景与风险限制。不要声称未提供文章内容。`
            : input.intent === 'news-announcements'
              ? `用户问题：${input.query}\n\n结构化数据：\n${data}\n\n请基于 news 和 announcements 输出新闻公告投研解读，必须覆盖核心事件、利好因素、利空因素、短期影响、中长期影响、风险提示、综合结论。不要说未提供新闻内容、无法分析、缺少数据、仅包含查询意图。`
              : `用户问题：${input.query}\n\n结构化数据：\n${data}\n\n请用中文输出简洁、有条理的投研辅助回复。`,
      },
    ], onToken);
  } catch (error) {
    return fallbackReport(input, error instanceof Error ? error.message : '模型调用失败');
  }
}

function fallbackReport(input: ReportInput, reason: string): string {
  const lines = [`我已完成可用数据的结构化分析，但模型报告生成暂不可用：${reason}`];
  if (input.quote) {
    lines.push(`\n**行情摘要**：${input.quote.name}（${input.quote.code}）当前价格 ${input.quote.price ?? '--'}，涨跌幅 ${input.quote.changePercent ?? '--'}。`);
  }
  if (input.technical?.narrative) {
    lines.push(`\n**📈 技术面**：${input.technical.narrative}`);
  }
  if (input.board?.narrative) {
    lines.push(`\n**板块数据**：${input.board.narrative}`);
  }
  lines.push('\n请先在设置中配置可用 API Key，或稍后重试模型服务。');
  return lines.join('\n');
}
