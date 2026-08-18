import { describe, expect, it } from 'vitest';
import type { AgentRunEvent } from '../../../../../shared/types';
import { deriveSteps } from '../derived';
import { normalizeProgressLabel } from '../presentation';

describe('normalizeProgressLabel', () => {
  it.each([
    ['📈 技术面分析', '技术面分析'],
    ['📊 🤝 Agent 协作', 'Agent 协作'],
    ['👨‍💻 任务执行', '任务执行'],
    ['👨🏻‍💻 任务执行', '任务执行'],
    ['🇨🇳 市场概览', '市场概览'],
  ])('移除开头的装饰 Emoji：%s', (label, expected) => {
    expect(normalizeProgressLabel(label)).toBe(expected);
  });

  it('保留普通标签、中间 Emoji 和仅含 Emoji 的标签', () => {
    expect(normalizeProgressLabel('技术面 📈 分析')).toBe('技术面 📈 分析');
    expect(normalizeProgressLabel('📈')).toBe('📈');
  });

  it('仅在展示边界规范化，不修改推导出的事件标签', () => {
    const events: AgentRunEvent[] = [
      {
        type: 'plan_created',
        progress: { current: 0, total: 1 },
        plan: { agents: [{ id: 'custom', agent: '自定义分析', description: '📈 自定义分析' }] },
      },
    ];

    const [step] = deriveSteps(events);

    expect(step.label).toBe('📈 自定义分析');
    expect(normalizeProgressLabel(step.label)).toBe('自定义分析');
  });
});
