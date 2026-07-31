import { describe, expect, it } from 'vitest';

import { reviewComplianceStructured } from '../compliance-critic.js';
import type { EvidenceItem, StructuredAgentFinding } from '../../../../src/shared/types.js';

const finding: StructuredAgentFinding = {
  id: 'finding-1',
  dimension: 'overview',
  stance: 'neutral',
  confidence: 0.5,
  summary: '测试结论',
  evidenceIds: ['quote-1'],
  risks: ['样本有限'],
};

function evidence(source: EvidenceItem['source']): EvidenceItem {
  return { id: `${source}-1`, source, title: `${source} 证据` };
}

describe('结构化合规审查', () => {
  it('替换禁用 Emoji 和直接投资建议措辞', () => {
    const result = reviewComplianceStructured({
      text: '🚀 建议买入，满仓必涨。',
      evidence: [],
      findings: [finding],
    });

    expect(result.passed).toBe(false);
    expect(result.revisedText).not.toContain('🚀');
    expect(result.revisedText).not.toContain('建议买入');
    expect(result.revisedText).toContain('可作为研究观察点');
    expect(result.issues.map((item) => item.type)).toContain('forbidden-emoji');
    expect(result.issues.map((item) => item.type)).toContain('investment-advice');
  });

  it('将操作建议替换为观察框架', () => {
    const result = reviewComplianceStructured({
      text: '## 操作建议\n需要关注波动。不构成投资建议。',
      evidence: [],
      findings: [finding],
    });

    expect(result.revisedText).toContain('观察框架');
    expect(result.revisedText).not.toContain('操作建议');
  });

  it('在缺少风险提示和免责声明时自动追加', () => {
    const result = reviewComplianceStructured({ text: '行情表现较强', evidence: [evidence('quote')], findings: [finding] });

    expect(result.revisedText).toContain('风险提示');
    expect(result.revisedText).toContain('不构成投资建议');
    expect(result.issues.filter((item) => item.type === 'missing-risk')).toHaveLength(2);
  });

  it('识别缺少 evidence 的行情和技术结论', () => {
    const result = reviewComplianceStructured({
      text: '现价上涨，K线突破压力位，存在波动风险。不构成投资建议。',
      evidence: [],
      findings: [finding],
    });

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'unsupported-claim', message: '文本包含行情结论但缺少 quote evidence。' }),
      expect.objectContaining({ type: 'unsupported-claim', message: '文本包含K线/技术结论但缺少 kline evidence。' }),
    ]));
  });

  it('存在 fallback 证据时不报 unsupported claim', () => {
    const result = reviewComplianceStructured({
      text: '行情和新闻均提示需要观察波动。不构成投资建议。',
      evidence: [evidence('fallback')],
      findings: [finding],
    });

    expect(result.issues.some((item) => item.type === 'unsupported-claim')).toBe(false);
  });
});
