import type { ComplianceReview, EvidenceItem, StructuredAgentFinding } from '../../../src/shared/types.js';

const disclaimer = '以上内容基于公开数据自动生成，仅供研究参考，不构成投资建议。';
const forbiddenEmoji: Record<string, string> = { '🚀': '📈', '🔥': '🌡️', '💎': '优质', '🌙': '长期', '🤑': '收益', '🎉': '提示' };
const advicePatterns = [
  /建议\s*(买入|卖出|加仓|清仓|满仓|重仓)/g,
  /(立即买入|立即卖出|马上买入|马上卖出|马上卖|立即买|马上买|目标买点)/g,
  /(满仓|重仓|清仓|必涨|稳赚|包赚|强烈推荐)/g,
];

export function reviewComplianceStructured(input: {
  text: string;
  evidence: EvidenceItem[];
  findings: StructuredAgentFinding[];
}): ComplianceReview {
  const issues: ComplianceReview['issues'] = [];
  let revisedText = input.text;

  for (const [emoji, replacement] of Object.entries(forbiddenEmoji)) {
    if (revisedText.includes(emoji)) {
      revisedText = revisedText.split(emoji).join(replacement);
      issues.push({ type: 'forbidden-emoji', severity: 'low', message: `已替换禁用 Emoji ${emoji}` });
    }
  }

  for (const pattern of advicePatterns) {
    if (pattern.test(revisedText)) {
      pattern.lastIndex = 0;
      revisedText = revisedText.replace(pattern, '可作为研究观察点');
      issues.push({ type: 'investment-advice', severity: 'high', message: '已替换直接投资建议措辞。' });
    }
  }

  if (revisedText.includes('操作建议')) {
    revisedText = revisedText.replace(/操作建议/g, '观察框架');
    issues.push({ type: 'investment-advice', severity: 'medium', message: '已将“操作建议”替换为“观察框架”。' });
  }

  const sources = new Set(input.evidence.map((item) => item.source));
  const sourceChecks: Array<[RegExp, EvidenceItem['source'], string]> = [
    [/行情|现价|涨跌幅|成交额/, 'quote', '文本包含行情结论但缺少 quote evidence。'],
    [/K线|均线|支撑|压力|技术/, 'kline', '文本包含K线/技术结论但缺少 kline evidence。'],
    [/新闻|舆情/, 'news', '文本包含新闻结论但缺少 news evidence。'],
    [/公告/, 'announcement', '文本包含公告结论但缺少 announcement evidence。'],
    [/龙虎榜|席位/, 'dragon-tiger', '文本包含龙虎榜结论但缺少 dragon-tiger evidence。'],
  ];
  for (const [pattern, source, message] of sourceChecks) {
    if (pattern.test(revisedText) && !sources.has(source) && !sources.has('fallback')) issues.push({ type: 'unsupported-claim', severity: 'medium', message });
  }

  if (!/风险|不确定|波动/.test(revisedText)) {
    revisedText = `${revisedText.trim()}\n\n### 🚨 风险提示\n- 数据源可能存在延迟、缺失或字段变动，短期波动会影响判断有效性。`;
    issues.push({ type: 'missing-risk', severity: 'medium', message: '已追加风险提示。' });
  }

  if (!revisedText.includes('不构成投资建议')) {
    revisedText = `${revisedText.trim()}\n\n${disclaimer}`;
    issues.push({ type: 'missing-risk', severity: 'medium', message: '已追加“不构成投资建议”声明。' });
  }

  void input.findings;
  return { passed: issues.every((issue) => issue.severity !== 'high'), issues, revisedText };
}
