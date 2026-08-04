import type { LlmChatMessage } from '../llm/openai-compatible-client.js';
import type { IAgentContext } from './orchestrator-types.js';

/**
 * 普通问题（非 slash 命令）的结论汇总提示词。
 * 取数节点把真实数据整理进 ctx.board（AgentResultCard）后调用 generateReport(createPlainQuestionMessages(ctx))，
 * LLM 基于卡片中的真实数据生成 Markdown 结论写入 ctx.analysisOverview。
 */
export function createPlainQuestionMessages(ctx: IAgentContext): LlmChatMessage[] {
  const cardJson = JSON.stringify(ctx.board, null, 2);
  return [
    {
      role: 'system',
      content:
        '你是专业的 A 股投研助手。只能基于用户消息中的结构化真实数据回答，严禁编造、补齐或臆测任何数值、股票、板块、涨跌、资金或概念数据。' +
        '字段为 null、数组为空或数据缺口时，必须明确写"暂无数据"或"数据源暂不可用"。' +
        '遵守 emoji 规则：使用专业金融风格 Emoji，禁止 🚀🔥💎🌙🤑🎉，每段至多 2 个 Emoji。' +
        '输出 Markdown，观点与事实分段，不使用确定性买卖指令，保留风险提示。',
    },
    {
      role: 'user',
      content: `原始问题：${ctx.query}

以下是基于真实数据源获取的结构化数据（缺失的字段表示该数据源暂不可用，不得脑补）：

${cardJson}`,
    },
  ];
}

/** 非股票相关问题的通用直接回答提示词（大模型直接回答，不调用行情工具）。 */
export function createDirectAnswerMessages(query: string): LlmChatMessage[] {
  return [
    {
      role: 'system',
      content:
        '你是 StockBuddy 的通用 AI 助手。简洁、准确、专业地回答用户问题，输出 Markdown。' +
        '涉及股票、金融、宏观概念时基于公开知识作答，并说明具体行情数值以实时数据接口为准。' +
        '遵守 emoji 规则：专业金融风格，禁止 🚀🔥💎🌙🤑🎉，每段至多 2 个 Emoji。不编造事实。',
    },
    { role: 'user', content: query },
  ];
}
