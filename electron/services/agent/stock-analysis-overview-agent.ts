import type { IStockFundFlowSnapshot } from '../../../src/shared/types.js';
import { generateReport } from '../llm/index.js';
import { isLlmRequestError } from '../llm/openai-compatible-client.js';
import type { StockAnalysisInput, StockAnalysisResult } from './stock-analysis-agents.js';

export async function runStockAnalysisOverview(input: StockAnalysisInput, results: StockAnalysisResult[], onToken?: (token: string) => void): Promise<string> {
  try {
    const report = await generateReport([
      {
        role: 'system',
        content: `你是一位精通A股的资深投研分析师。请只根据输入的 findings 和 evidence 输出综合投研报告，不得编造不存在的数据。

输出要求：
1. 标题：## 📊 ${input.stockLabel}（${input.symbol}）综合投研报告
2. 综合评分用 Markdown 表格：维度 | 权重 | 评分(0-100) | 加权得分 | 一句话总结。维度和权重固定为：📈 技术面 25%、📊 基本面 10%、💰 资金面 25%、🧩 筹码分析 25%、🌡️ 情绪面 15%、总分 100%。评分和加权得分必须用 HTML span 包裹：80-100 用 <span class="score-high">80</span>，60-79 用 <span class="score-mid">60</span>，低于60用 <span class="score-low">59</span>。
3. 新增：### 📄 证据摘要，列出最关键 evidence。
4. 标题使用：### 🎯 关键价位、### 💰 资金流向、### 🧭 观察框架、### 🚨 风险警示、### 🧩 各维度一句话总结。若输入中有 fundFlow 或资金流 evidence，必须输出”### 💰 资金流向”小节和超大单/大单/主力合计/中单/小单表格。资金流向正数用 <span class=”cn-up”>+X</span> 包裹，负数用 <span class=”cn-down”>-X</span> 包裹。
5. 禁止输出建议买入、建议卖出、立即加仓、清仓、满仓、必涨、稳赚等直接投资建议。
6. 禁止使用 🚀🔥💎🌙🤑🎉。
7. 必须输出最终评级：🟢 偏利好 / 🟡 中性 / 🔴 偏利空。
8. 必须提示仅供研究参考，不构成投资建议。`,
      },
      {
        role: 'user',
        content: `股票：${input.stockLabel}（${input.symbol}）\n用户问题：${input.query}\n\n资金流数据：\n${JSON.stringify(input.fundFlow ?? null, null, 2)}\n\n结构化 findings/evidence：\n${JSON.stringify(toOverviewInput(results), null, 2)}`,
      },
    ], onToken);
    return ensureFundFlowSection(ensureScoredOverview(report, input, results), input);
  } catch (error) {
    if (isLlmRequestError(error)) throw error;
    return fallbackOverview(input, results);
  }
}

function toOverviewInput(results: StockAnalysisResult[]) {
  return results.map((result) => ({
    name: result.name,
    label: result.label,
    findings: result.output.findings,
    evidence: result.output.evidence.map((item) => ({ id: item.id, source: item.source, title: item.title, summary: item.summary, value: item.value, timestamp: item.timestamp })),
  }));
}

function ensureFundFlowSection(report: string, input: StockAnalysisInput) {
  if (!input.fundFlow) return report;
  const section = fundFlowSection(input.fundFlow);
  if (/###\s*💰\s*资金流向/.test(report)) {
    return report.replace(/###\s*💰\s*资金流向[\s\S]*?(?=\n###\s|\n##\s|$)/, section);
  }
  if (/###\s*🧭\s*观察框架/.test(report)) return report.replace(/\n###\s*🧭\s*观察框架/, `\n${section}\n\n### 🧭 观察框架`);
  if (/###\s*🚨\s*风险警示/.test(report)) return report.replace(/\n###\s*🚨\s*风险警示/, `\n${section}\n\n### 🚨 风险警示`);
  return `${report.trim()}\n\n${section}`;
}

function fundFlowSection(flow: IStockFundFlowSnapshot) {
  const active = flow.activeSampleCount
    ? `主动买占比：${formatPercentValue(flow.activeBuyRatio)}，主动卖占比：${formatPercentValue(flow.activeSellRatio)}（口径：${flow.activeRatioSource ?? '盘口异动样本'}，样本 ${flow.activeSampleCount} 条）`
    : `主动买/主动卖比例：--（${flow.warnings?.find((item) => item.includes('主动买卖')) ?? '暂无盘口异动样本'}）`;
  return [`### 💰 资金流向`, `今日主力资金 ${flow.mainNetInflow === null ? '暂无净流入数据' : `${Number(flow.mainNetInflow) >= 0 ? '净流入' : '净流出'}约 ${formatMoneyInYi(flow.mainNetInflow)} 亿`}（截至 ${flow.date}），分结构看：`, '', '| 类型 | 净流入（亿元） | 净占比 |', '|---|---:|---:|', `| 超大单 | ${formatMoneyInYi(flow.superLargeNetInflow)} | ${formatPercentValue(flow.superLargeNetInflowPercent)} |`, `| 大单 | ${formatMoneyInYi(flow.largeNetInflow)} | ${formatPercentValue(flow.largeNetInflowPercent)} |`, `| 主力合计 | **${formatMoneyInYi(flow.mainNetInflow)}** | **${formatPercentValue(flow.mainNetInflowPercent)}** |`, `| 中单 | ${formatMoneyInYi(flow.mediumNetInflow)} | ${formatPercentValue(flow.mediumNetInflowPercent)} |`, `| 小单 | ${formatMoneyInYi(flow.smallNetInflow)} | ${formatPercentValue(flow.smallNetInflowPercent)} |`, '', active, `口径：资金净流入来自 ${flow.source === 'a-stock-data' ? 'a-stock-data 东财资金流接口' : 'stock-sdk 个股资金流日线'}；主动买/卖比例来自盘口异动样本，不等同于全量逐笔成交主动买卖金额。`].join('\n');
}

function formatMoneyInYi(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  const display = `${num >= 0 ? '+' : '-'}${(Math.abs(num) / 100000000).toFixed(2)}`;
  const cls = num > 0 ? 'cn-up' : num < 0 ? 'cn-down' : '';
  return cls ? `<span class="${cls}">${display}</span>` : display;
}

function formatPercentValue(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  const display = `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
  const cls = num > 0 ? 'cn-up' : num < 0 ? 'cn-down' : '';
  return cls ? `<span class="${cls}">${display}</span>` : display;
}

async function streamText(text: string, onToken: (token: string) => void) {
  for (const chunk of text.match(/[\s\S]{1,16}/g) ?? [text]) {
    onToken(chunk);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return text;
}

function ensureScoredOverview(report: string, input: StockAnalysisInput, results: StockAnalysisResult[]) {
  if (!/\|\s*维度\s*\|\s*权重\s*\|/.test(report) || !/\|[^\n]*\s--\s*\|[^\n]*\s--\s*\|/.test(report)) return report;
  const fallbackTable = fallbackOverview(input, results).match(/\|\s*维度\s*\|[\s\S]*?(?=\n\n###|$)/)?.[0];
  if (!fallbackTable) return report;
  return report.replace(/\|\s*维度\s*\|[\s\S]*?(?=\n\n###|$)/, fallbackTable);
}

const overviewWeights: Record<string, number> = {
  technical: 0.25,
  fundamental: 0.10,
  capital: 0.25,
  chip: 0.25,
  sentiment: 0.15,
};

function fallbackOverview(input: StockAnalysisInput, results: StockAnalysisResult[]) {
  const findings = results.flatMap((result) => result.output.findings);
  const weighted = results.reduce((sum, result) => {
    const score = result.output.findings[0]?.score ?? 50;
    return sum + score * (overviewWeights[result.name] ?? 0);
  }, 0);
  const totalWeight = results.reduce((sum, result) => sum + (overviewWeights[result.name] ?? 0), 0);
  const avg = findings.length && totalWeight ? weighted / totalWeight : undefined;
  const conclusion = avg === undefined ? '🟡 中性' : avg >= 65 ? '🟢 偏利好' : avg <= 45 ? '🔴 偏利空' : '🟡 中性';
  const evidence = results.flatMap((result) => result.output.evidence).filter((item, index, arr) => arr.findIndex((other) => other.id === item.id) === index);
  const lines = [`## 📊 ${input.stockLabel}（${input.symbol}）综合投研报告`, ''];
  lines.push(`当前价格：${input.quote?.price ?? '--'}，涨跌幅：${input.quote?.changePercent ?? '--'}，成交额：${input.quote?.turnover ?? '--'}。`);
  lines.push('', '| 维度 | 权重 | 评分(0-100) | 加权得分 | 一句话总结 |');
  lines.push('|---|---:|---:|---:|---|');
  for (const result of results) {
    const finding = result.output.findings[0];
    const score = finding?.score;
    const weight = overviewWeights[result.name] ?? 0;
    lines.push(`| ${result.label} | ${formatWeight(weight)} | ${formatScore(score)} | ${formatScore(score === undefined ? undefined : score * weight)} | ${summaryForResult(result)} |`);
  }
  lines.push(`| **总分** | **100%** | **${formatScore(avg)}** | **--** | ${conclusion} |`);
  lines.push('', '### 📄 证据摘要');
  lines.push(evidence.length ? evidence.slice(0, 8).map((item) => `- ${item.title}：${item.summary ?? item.value ?? '已纳入分析。'}`).join('\n') : '- 数据不足，当前仅保留 fallback evidence。');
  lines.push('', '### 🎯 关键价位');
  lines.push('当前数据不足以精确判断支撑位/压力位，可结合右侧 K 线近期高低点观察。');
  if (input.fundFlow) lines.push('', fundFlowSection(input.fundFlow));
  lines.push('', '### 🧭 观察框架');
  lines.push('- 偏强确认条件：价格、成交额与关键证据继续共振。');
  lines.push('- 转弱风险条件：放量下跌、新闻/公告出现负面变化或特大单流出占比升高。');
  lines.push('- 需要继续跟踪的数据：K线、成交额、公告、新闻与特大单流向。');
  lines.push('', '### 🚨 风险警示');
  lines.push('- 资金流、特大单和财报细项数据可能不完整，判断置信度有限。');
  lines.push('- 短期行情波动可能放大技术信号误判。');
  lines.push('', '### 🧩 各维度一句话总结');
  for (const result of results) lines.push(`- **${result.label}**：${summaryForResult(result)}`);
  lines.push('', `### 🎯 综合结论：${conclusion}\n以上内容基于当前可用公开数据自动生成，仅供研究参考，不构成投资建议。`);
  return lines.join('\n');
}

function formatWeight(weight: number) {
  return `${Math.round(weight * 100)}%`;
}

function summaryForResult(result: StockAnalysisResult) {
  const summary = result.output.findings[0]?.summary;
  const text = summary && !/当前可用数据不足|数据不足，暂不形成强结论/.test(summary) ? summary : oneLine(result.content) ?? summary;
  return stripRepeatedLabel(text, result.label) ?? '数据不足，暂不输出硬评分。';
}

function stripRepeatedLabel(text: string | undefined, label: string) {
  if (!text) return undefined;
  const plainLabel = label.replace(/^\S+\s*/, '').trim();
  const emoji = label.match(/^\S+/)?.[0] ?? '';
  return text
    .replace(new RegExp(`^${escapeRegExp(label)}[：:\s]*`), '')
    .replace(new RegExp(`^${escapeRegExp(emoji)}\\s*${escapeRegExp(plainLabel.replace(/分析$/, ''))}(?:分析)?[：:\s]*`), '')
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function oneLine(markdown?: string) {
  const text = markdown
    ?.replace(/#{1,6}\s*/g, '')
    .replace(/[|`*_>\-]/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return undefined;
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

function formatScore(score?: number) {
  if (score === undefined || !Number.isFinite(score)) return '--';
  const value = Number(score.toFixed(1));
  const cls = value >= 80 ? 'score-high' : value >= 60 ? 'score-mid' : 'score-low';
  return `<span class="${cls}">${value}</span>`;
}
