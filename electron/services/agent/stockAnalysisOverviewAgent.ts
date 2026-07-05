import { generateReport } from '../llm/index.js';
import type { StockAnalysisInput, StockAnalysisResult } from './stockAnalysisAgents.js';

export async function runStockAnalysisOverview(input: StockAnalysisInput, results: StockAnalysisResult[]): Promise<string> {
  try {
    return await generateReport([
      {
        role: 'system',
        content: `你是一位精通A股的资深投资顾问。请根据技术面、基本面、资金面、情绪面、龙虎榜五个维度的结果，输出综合投资报告。

输出要求：
1. 标题必须使用：## 📊 综合投资报告
2. 综合评分必须用 Markdown 表格渲染，紧跟在标题后，表头固定为：维度 | 权重 | 评分(0-100) | 加权得分 | 一句话总结。维度包含：技术面、基本面、资金面、情绪面、龙虎榜、总分。
   - 评分和加权得分必须用 HTML span 包裹：低分 <span class="score-low">46.5</span>，中等 <span class="score-mid">65</span>，高分/健康 <span class="score-high">82</span>。
   - 0-59 用 score-low，60-74 用 score-mid，75-100 用 score-high。
3. 关键价位标题必须使用：### 🎯 关键价位
   - 包含支撑位、压力位；没有足够数据就说明无法精确判断。
4. 操作建议标题必须使用：### 🧭 操作建议
   - 买入/观望/减仓/卖出中选一个，并给出触发条件。
5. 风险警示标题必须使用：### ⚠️ 风险警示
   - 列出最重要的2-3个风险点。
6. 各维度一句话总结标题必须使用：### 🧩 各维度一句话总结
7. 必须提示仅供研究参考，不构成投资建议。`,
      },
      {
        role: 'user',
        content: `股票：${input.stockLabel}（${input.symbol}）\n用户问题：${input.query}\n\n五维分析结果：\n${JSON.stringify(results, null, 2)}`,
      },
    ]);
  } catch {
    return fallbackOverview(input, results);
  }
}

function fallbackOverview(input: StockAnalysisInput, results: StockAnalysisResult[]) {
  const lines = [`## 📊 综合投资报告：${input.stockLabel}（${input.symbol}）`, ''];
  lines.push(`当前价格：${input.quote?.price ?? '--'}，涨跌幅：${input.quote?.changePercent ?? '--'}，成交额：${input.quote?.turnover ?? '--'}。`);
  lines.push('', '| 维度 | 权重 | 评分(0-100) | 加权得分 | 一句话总结 |');
  lines.push('|---|---:|---:|---:|---|');
  lines.push('| 技术面 | 30% | -- | -- | 技术指标与K线数据可用，需结合右侧图表确认支撑压力。 |');
  lines.push('| 基本面 | 15% | -- | -- | 当前仅有估值摘要，财报细项不足。 |');
  lines.push('| 资金面 | 25% | -- | -- | 成交量/成交额可参考，缺少逐笔资金流。 |');
  lines.push('| 情绪面 | 20% | -- | -- | 新闻样本有限，需结合板块热度验证。 |');
  lines.push('| 龙虎榜 | 10% | -- | -- | 未接入席位明细，无法确认游资/机构行为。 |');
  lines.push('| **总分** | **100%** | **--** | **--** | 数据不足，暂不输出硬评分。 |');
  lines.push('', '### 🎯 关键价位');
  lines.push('当前数据不足以精确判断支撑位/压力位，建议结合右侧 K 线近期高低点观察。');
  lines.push('', '### 🧭 操作建议');
  lines.push('建议先观望，等待价格、成交量和基本面信息进一步确认。');
  lines.push('', '### ⚠️ 风险警示');
  lines.push('- 资金流、龙虎榜和财报细项数据不完整，判断置信度有限。');
  lines.push('- 短期行情波动可能放大技术信号误判。');
  lines.push('', '### 🧩 各维度一句话总结');
  for (const result of results) lines.push(`- **${result.label}**：${result.content}`);
  lines.push('', '以上内容基于当前可用公开数据自动生成，仅供研究参考，不构成投资建议。');
  return lines.join('\n');
}
