import type { AgentResultCard, StockDetail } from '../../../src/shared/types.js';
import { generateReport } from '../llm/index.js';

type ReportInput = {
  query: string;
  intent: string;
  quote?: StockDetail;
  technical?: AgentResultCard;
  board?: AgentResultCard;
};

export async function runReportAgent(input: ReportInput): Promise<string> {
  const data = JSON.stringify(input, null, 2);
  try {
    return await generateReport([
      {
        role: 'system',
        content:
          '你是股察 StockSense 的 A 股投研助手。你只能基于提供的结构化数据做研究解读，不编造行情、新闻或财务数据。避免直接买卖建议，输出要包含风险提示。',
      },
      {
        role: 'user',
        content: `用户问题：${input.query}\n\n结构化数据：\n${data}\n\n请用中文输出简洁、有条理的投研辅助回复。`,
      },
    ]);
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
    lines.push(`\n**技术面**：${input.technical.narrative}`);
  }
  if (input.board?.narrative) {
    lines.push(`\n**板块数据**：${input.board.narrative}`);
  }
  lines.push('\n请先在设置中配置可用 API Key，或稍后重试模型服务。');
  return lines.join('\n');
}
