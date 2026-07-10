import assert from 'node:assert/strict';
import { reviewComplianceStructured } from './compliance-critic.js';
import { parseStructuredAgentOutput } from './stock-analysis-agents.js';

const evidence = [{ id: 'quote:600519', source: 'quote' as const, title: '贵州茅台行情' }];
const output = parseStructuredAgentOutput('```json\n{"findings":[{"score":120,"confidence":2,"summary":"测试","evidenceIds":["quote:600519"]}],"markdown":"### 测试"}\n```', {
  name: 'technical',
  label: '📈 技术面分析',
  dimension: 'technical',
}, { query: '测试', symbol: '600519', stockLabel: '贵州茅台', evidence }, evidence);

assert.equal(output.findings[0].score, 100);
assert.equal(output.findings[0].confidence, 1);
assert.deepEqual(output.findings[0].evidenceIds, ['quote:600519']);

const review = reviewComplianceStructured({ text: '### 操作建议\n建议买入 🚀', evidence, findings: output.findings });
assert(!review.revisedText.includes('建议买入'));
assert(!review.revisedText.includes('🚀'));
assert(review.revisedText.includes('不构成投资建议'));

console.log('structured-output selfcheck passed');
