import type { EvidenceItem, IAgentDataGap, IStockFundFlowSnapshot } from '../../../src/shared/types.js';
import { generateReport } from '../llm/index.js';
import { isLlmRequestError } from '../llm/openai-compatible-client.js';
import { formatDataGapsForPrompt, formatPlanRevisionsForPrompt } from './agent-reflection.js';
import type { StockAnalysisAgentName, StockAnalysisInput, StockAnalysisResult } from './stock-analysis-agents.js';

export async function runStockAnalysisOverview(
  input: StockAnalysisInput,
  results: StockAnalysisResult[],
  onToken?: (token: string) => void,
): Promise<string> {
  try {
    const report = await generateReport(
      [
        {
          role: 'system',
          content: `你是一位精通A股的资深投研分析师。请只根据输入的 findings 和 evidence 输出最终综合投研报告，不得编造不存在的数据或用缺失数据外推。

输出要求：
1. 标题：## 📊 ${input.stockLabel}（${input.symbol}）综合投研报告
2. 综合评分用 Markdown 表格：维度 | 权重 | 评分(0-100) | 加权得分 | 一句话总结。维度和权重固定为：📈 技术面 25%、📊 基本面 10%、💰 资金面 25%、🧩 筹码分析 25%、📰 消息面 15%、总分 100%。评分和加权得分必须用 HTML span 包裹：80-100 用 <span class="score-high">80</span>，60-79 用 <span class="score-mid">60</span>，低于60用 <span class="score-low">59</span>。
3. 正文必须结果导向，优先使用以下结构：### 🎯 综合结论、### 📈 技术面分析、### 📊 基本面分析、### 💰 资金面分析、### 🧩 筹码分析、### 📰 消息面分析（仅当输入包含消息面结果或 evidence 时输出）、### 📄 证据摘要、### 🚨 风险提示。
4. 技术面、基本面、资金面、筹码分析必须输出分析结果；若某维度受 dataGaps 影响，在该维度内用一句“数据状态/置信度”说明，写明暂不硬判断，不要单独成节。
5. 若输入中有 fundFlow 或资金流 evidence，资金面分析需基于真实资金字段输出；缺失或不可用字段用 -- 或“暂无真实资金流数据”，不得把缺失展示为 +0.00 / +0.00%。
6. 最终正文禁止输出以下过程型标题或同义独立小节：### 🧭 分析计划回顾、### ⚠️ 数据缺口与影响、### 🚨 风险排除、### 🧭 观察框架。
7. 禁止输出建议买入、建议卖出、立即加仓、清仓、满仓、必涨、稳赚等直接投资建议。
8. 禁止使用 🚀🔥💎🌙🤑🎉。
9. 必须输出最终评级：🟢 偏利好 / 🟡 中性 / 🔴 偏利空。
10. 必须提示仅供研究参考，不构成投资建议。`,
        },
        {
          role: 'user',
          content: `股票：${input.stockLabel}（${input.symbol}）\n用户问题：${input.query}\n\n分析计划：\n${JSON.stringify(input.plan ?? null, null, 2)}\n\n数据缺口：\n${formatDataGapsForPrompt(input.dataGaps)}\n\n计划调整：\n${formatPlanRevisionsForPrompt(input.planRevisions)}\n\n资金流数据：\n${JSON.stringify(input.fundFlow ?? null, null, 2)}\n\n结构化 findings/evidence：\n${JSON.stringify(toOverviewInput(results), null, 2)}`,
        },
      ],
      onToken,
    );
    return ensureResultOrientedOverview(ensureScoredOverview(report, input, results), input, results);
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
    evidence: result.output.evidence.map((item) => ({
      id: item.id,
      source: item.source,
      title: item.title,
      summary: item.summary,
      value: item.value,
      timestamp: item.timestamp,
    })),
  }));
}

function ensureResultOrientedOverview(report: string, input: StockAnalysisInput, results: StockAnalysisResult[]) {
  let next = ensureOverviewTitle(normalizeRiskHeading(stripProcessSections(report)), input);
  next = replaceFundFlowSection(next, input, results);

  const missingSections: string[] = [];
  for (const dimension of overviewDimensions) {
    if (dimension.name === 'sentiment' && !shouldIncludeSentimentSection(input, results)) continue;
    if (!hasSection(next, dimension.sectionTitle))
      missingSections.push(buildDimensionSection(dimension.name, input, results));
  }
  if (missingSections.length) next = insertBeforeLateSections(next, missingSections.join('\n\n'));
  if (!hasSection(next, '证据摘要')) next = insertBeforeRiskSection(next, evidenceSection(input, results));
  if (!hasSection(next, '风险提示')) next = `${next.trim()}\n\n${riskSection(input)}`;
  if (!hasFinalRating(next)) next = `${next.trim()}\n\n最终评级：${overviewConclusion(input, results)}`;
  if (!next.includes('不构成投资建议')) {
    next = `${next.trim()}\n\n以上内容基于当前可用公开数据自动生成，仅供研究参考，不构成投资建议。`;
  }
  return stripProcessSections(next).trim();
}

function stripProcessSections(report: string) {
  return ['分析计划回顾', '数据缺口与影响', '风险排除', '观察框架'].reduce(
    (next, title) =>
      next.replace(new RegExp(`\n?#{3,6}\\s*(?:\\S+\\s+)?${escapeRegExp(title)}[\\s\\S]*?(?=\n#{2,6}\\s|$)`, 'g'), ''),
    report,
  );
}

function normalizeRiskHeading(report: string) {
  return report.replace(/^###\s*(?:\S+\s+)?风险警示\s*$/gm, '### 🚨 风险提示');
}

function ensureOverviewTitle(report: string, input: StockAnalysisInput) {
  if (/^##\s*(?:\S+\s+)?[^\n]*综合投研报告/m.test(report)) return report;
  return `## 📊 ${input.stockLabel}（${input.symbol}）综合投研报告\n\n${report.trim()}`;
}

function replaceFundFlowSection(report: string, input: StockAnalysisInput, results: StockAnalysisResult[]) {
  const replacement = buildDimensionSection('capital', input, results);
  const pattern = /###\s*(?:\S+\s+)?资金(?:流向|面分析)\s*[\s\S]*?(?=\n###\s|\n##\s|$)/;
  return pattern.test(report) ? report.replace(pattern, replacement) : report;
}

function hasSection(report: string, title: string) {
  return new RegExp(`^###\\s*(?:\\S+\\s+)?${escapeRegExp(title)}\\s*$`, 'm').test(report);
}

function insertBeforeLateSections(report: string, section: string) {
  const indexes = ['证据摘要', '风险提示']
    .map((title) => report.search(new RegExp(`\n###\\s*(?:\\S+\\s+)?${escapeRegExp(title)}\\s*$`, 'm')))
    .filter((index) => index >= 0);
  if (!indexes.length) return `${report.trim()}\n\n${section}`;
  const index = Math.min(...indexes);
  return `${report.slice(0, index).trim()}\n\n${section}\n${report.slice(index)}`;
}

function insertBeforeRiskSection(report: string, section: string) {
  const index = report.search(/\n###\s*(?:\S+\s+)?风险提示\s*$/m);
  if (index < 0) return `${report.trim()}\n\n${section}`;
  return `${report.slice(0, index).trim()}\n\n${section}\n${report.slice(index)}`;
}

function evidenceSection(input: StockAnalysisInput, results: StockAnalysisResult[]) {
  const evidence = collectEvidence(input, results);
  const lines = ['### 📄 证据摘要'];
  lines.push(
    evidence.length
      ? evidence
          .slice(0, 8)
          .map((item) => `- ${item.title}：${item.summary ?? item.value ?? '已纳入分析。'}`)
          .join('\n')
      : '- 当前仅基于可用真实证据生成报告；缺失数据不用于外推。',
  );
  return lines.join('\n');
}

function collectEvidence(input: StockAnalysisInput, results: StockAnalysisResult[]) {
  const seen = new Set<string>();
  const evidence: EvidenceItem[] = [];
  const allEvidence = [...(input.evidence ?? []), ...results.flatMap((result) => result.output.evidence)];
  for (const item of allEvidence) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    evidence.push(item);
  }
  return evidence;
}

function riskSection(input: StockAnalysisInput) {
  const lines = ['### 🚨 风险提示'];
  if (input.dataGaps?.length) lines.push('- 部分维度存在真实数据缺口，相关结论置信度降低，不能据此作单向判断。');
  lines.push('- 资金流、筹码、新闻和公告数据可能存在延迟、字段缺失或口径差异。');
  lines.push('- 短期行情波动会放大技术信号误判，需结合后续公开数据持续验证。');
  return lines.join('\n');
}

function hasFinalRating(report: string) {
  return /🟢\s*偏利好|🟡\s*中性|🔴\s*偏利空/.test(report);
}

function shouldIncludeSentimentSection(input: StockAnalysisInput, results: StockAnalysisResult[]) {
  return Boolean(
    findResult(results, 'sentiment') ||
    input.news?.length ||
    input.evidence?.some((item) => item.source === 'news' || item.source === 'announcement'),
  );
}

const overviewWeights: Record<StockAnalysisAgentName, number> = {
  technical: 0.25,
  fundamental: 0.1,
  capital: 0.25,
  chip: 0.25,
  sentiment: 0.15,
};

const overviewDimensions: Array<{ name: StockAnalysisAgentName; label: string; sectionTitle: string }> = [
  { name: 'technical', label: '📈 技术面分析', sectionTitle: '技术面分析' },
  { name: 'fundamental', label: '📊 基本面分析', sectionTitle: '基本面分析' },
  { name: 'capital', label: '💰 资金面分析', sectionTitle: '资金面分析' },
  { name: 'chip', label: '🧩 筹码分析', sectionTitle: '筹码分析' },
  { name: 'sentiment', label: '📰 消息面分析', sectionTitle: '消息面分析' },
];

function buildDimensionSection(
  resultName: StockAnalysisAgentName,
  input: StockAnalysisInput,
  results: StockAnalysisResult[],
) {
  const result = findResult(results, resultName);
  if (resultName === 'capital') return fundFlowSection(input.fundFlow, input, result);
  const lines = [`### ${sectionLabel(resultName)}`, summaryForDimension(resultName, result, input)];
  const dataStatus = dataStatusLine(input.dataGaps, resultName);
  if (dataStatus) lines.push(dataStatus);
  return lines.join('\n');
}

function sectionLabel(resultName: StockAnalysisAgentName) {
  return overviewDimensions.find((dimension) => dimension.name === resultName)?.label ?? resultName;
}

function summaryForDimension(
  resultName: StockAnalysisAgentName,
  result: StockAnalysisResult | undefined,
  input: StockAnalysisInput,
) {
  if (result) return summaryForResult(result);
  switch (resultName) {
    case 'technical':
      return 'K线/指标真实数据不足，暂不硬判断技术趋势。';
    case 'fundamental':
      return `当前可用估值指标 PE=${input.quote?.pe ?? '--'}，PB=${input.quote?.pb ?? '--'}；财报细项不足，暂不硬判断基本面变化。`;
    case 'capital':
      return '资金流细项暂不可用，不能判断超大单/大单/中小单净流向。';
    case 'chip':
      return '真实筹码分布数据不足，暂不判断筹码结构和成本压力。';
    case 'sentiment':
      return '消息面样本不足，暂不判断事件驱动方向。';
  }
}

function fundFlowSection(
  flow: IStockFundFlowSnapshot | undefined,
  input: StockAnalysisInput,
  result: StockAnalysisResult | undefined,
) {
  const lines = ['### 💰 资金面分析'];
  if (flow && hasUsableFundFlow(flow, input.dataGaps)) {
    lines.push(formatFundFlowSummary(flow), '', '| 类型 | 净流入（亿元） | 净占比 |', '|---|---:|---:|');
    for (const row of fundFlowRows(flow)) lines.push(`| ${row.label} | ${row.amount} | ${row.percent} |`);
    lines.push('', activeFundFlowText(flow));
    lines.push(
      `口径：资金净流入来自 ${flow.source === 'a-stock-data' ? 'a-stock-data 东财资金流接口' : 'stock-sdk 个股资金流日线'}；主动买/卖比例来自盘口异动样本，不等同于全量逐笔成交主动买卖金额。`,
    );
  } else {
    lines.push(
      `暂无真实资金流数据，不能判断超大单/大单/中小单净流向。${fundFlowUnavailableReason(flow, input.dataGaps)}`,
    );
  }
  const summary = result ? summaryForResult(result) : summaryForDimension('capital', undefined, input);
  lines.push(`资金解读：${summary}`);
  const dataStatus = dataStatusLine(input.dataGaps, 'capital');
  if (dataStatus) lines.push(dataStatus);
  return lines.join('\n');
}

function hasUsableFundFlow(flow: IStockFundFlowSnapshot, gaps: IAgentDataGap[] = []) {
  const amounts = [
    flow.mainNetInflow,
    flow.superLargeNetInflow,
    flow.largeNetInflow,
    flow.mediumNetInflow,
    flow.smallNetInflow,
  ];
  const finiteAmounts = amounts.filter(isFiniteNumber);
  if (!finiteAmounts.length) return false;
  const allZero = finiteAmounts.length === amounts.length && finiteAmounts.every((value) => value === 0);
  if (!allZero) return true;
  return !hasFundFlowUnavailableSignal(flow, gaps);
}

function hasFundFlowUnavailableSignal(flow: IStockFundFlowSnapshot, gaps: IAgentDataGap[] = []) {
  return Boolean(
    flow.warnings?.some((item) => /所有资金流数据源|未返回有效|暂无可用个股资金流|获取失败/.test(item)) ||
    gaps.some(
      (gap) => /资金流/.test(gap.dataName) && ['empty', 'failed', 'stale', 'partial', 'skipped'].includes(gap.status),
    ),
  );
}

function fundFlowUnavailableReason(flow: IStockFundFlowSnapshot | undefined, gaps: IAgentDataGap[] = []) {
  const gap = gaps.find((item) => /资金流/.test(item.dataName));
  const warning = flow?.warnings?.find((item) => /所有资金流数据源|未返回有效|暂无可用个股资金流|获取失败/.test(item));
  const reason = warning ?? gap?.userMessage;
  return reason ? `（${ensureChinesePeriod(reason)}）` : '';
}

function formatFundFlowSummary(flow: IStockFundFlowSnapshot) {
  if (!isFiniteNumber(flow.mainNetInflow)) return `主力合计净流向：--（截至 ${flow.date}），分结构看：`;
  const direction = flow.mainNetInflow > 0 ? '净流入' : flow.mainNetInflow < 0 ? '净流出' : '净流向持平';
  return `今日主力资金 ${direction}约 ${formatMoneyInYi(flow.mainNetInflow)} 亿（截至 ${flow.date}），分结构看：`;
}

function fundFlowRows(flow: IStockFundFlowSnapshot) {
  return [
    {
      label: '超大单',
      amount: formatMoneyInYi(flow.superLargeNetInflow),
      percent: formatPercentValue(flow.superLargeNetInflowPercent),
    },
    {
      label: '大单',
      amount: formatMoneyInYi(flow.largeNetInflow),
      percent: formatPercentValue(flow.largeNetInflowPercent),
    },
    {
      label: '主力合计',
      amount: `**${formatMoneyInYi(flow.mainNetInflow)}**`,
      percent: `**${formatPercentValue(flow.mainNetInflowPercent)}**`,
    },
    {
      label: '中单',
      amount: formatMoneyInYi(flow.mediumNetInflow),
      percent: formatPercentValue(flow.mediumNetInflowPercent),
    },
    {
      label: '小单',
      amount: formatMoneyInYi(flow.smallNetInflow),
      percent: formatPercentValue(flow.smallNetInflowPercent),
    },
  ];
}

function activeFundFlowText(flow: IStockFundFlowSnapshot) {
  if (flow.activeSampleCount && flow.activeSampleCount > 0) {
    return `主动买占比：${formatPercentValue(flow.activeBuyRatio)}，主动卖占比：${formatPercentValue(flow.activeSellRatio)}（口径：${flow.activeRatioSource ?? '盘口异动样本'}，样本 ${flow.activeSampleCount} 条）`;
  }
  return `主动买/主动卖比例：--（${flow.warnings?.find((item) => item.includes('主动买卖')) ?? '暂无盘口异动样本'}）`;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatMoneyInYi(value: number | null | undefined) {
  if (!isFiniteNumber(value)) return '--';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  const display = `${sign}${(Math.abs(value) / 100000000).toFixed(2)}`;
  const cls = value > 0 ? 'cn-up' : value < 0 ? 'cn-down' : '';
  return cls ? `<span class="${cls}">${display}</span>` : display;
}

function formatPercentValue(value: number | null | undefined) {
  if (!isFiniteNumber(value)) return '--';
  const display = `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
  const cls = value > 0 ? 'cn-up' : value < 0 ? 'cn-down' : '';
  return cls ? `<span class="${cls}">${display}</span>` : display;
}

function ensureScoredOverview(report: string, input: StockAnalysisInput, results: StockAnalysisResult[]) {
  if (!/\|\s*维度\s*\|\s*权重\s*\|/.test(report) || !/\|[^\n]*\s--\s*\|[^\n]*\s--\s*\|/.test(report)) return report;
  const fallbackTable = fallbackOverview(input, results).match(/\|\s*维度\s*\|[\s\S]*?(?=\n\n###|$)/)?.[0];
  if (!fallbackTable) return report;
  return report.replace(/\|\s*维度\s*\|[\s\S]*?(?=\n\n###|$)/, fallbackTable);
}

function fallbackOverview(input: StockAnalysisInput, results: StockAnalysisResult[]) {
  const avg = overviewScore(input, results);
  const conclusion = overviewConclusion(input, results);
  const lines = [`## 📊 ${input.stockLabel}（${input.symbol}）综合投研报告`, ''];
  lines.push(
    `当前价格：${input.quote?.price ?? '--'}，涨跌幅：${input.quote?.changePercent ?? '--'}，成交额：${input.quote?.turnover ?? '--'}。`,
  );
  lines.push('', '| 维度 | 权重 | 评分(0-100) | 加权得分 | 一句话总结 |');
  lines.push('|---|---:|---:|---:|---|');
  for (const dimension of overviewDimensions) {
    const result = findResult(results, dimension.name);
    const hasGap = gapAffectsResult(input.dataGaps, dimension.name);
    const score = hasGap ? undefined : result?.output.findings[0]?.score;
    const weight = overviewWeights[dimension.name];
    lines.push(
      `| ${dimension.label} | ${formatWeight(weight)} | ${formatScore(score)} | ${formatScore(score === undefined ? undefined : score * weight)} | ${hasGap ? '存在数据缺口，暂不硬评分。' : summaryForDimension(dimension.name, result, input)} |`,
    );
  }
  lines.push(`| **总分** | **100%** | **${formatScore(avg)}** | **--** | ${conclusion} |`);
  lines.push('', `### 🎯 综合结论\n最终评级：${conclusion}。当前结论仅基于已取得的真实证据，缺失维度不做外推。`);
  lines.push('', buildDimensionSection('technical', input, results));
  lines.push('', buildDimensionSection('fundamental', input, results));
  lines.push('', buildDimensionSection('capital', input, results));
  lines.push('', buildDimensionSection('chip', input, results));
  if (shouldIncludeSentimentSection(input, results)) lines.push('', buildDimensionSection('sentiment', input, results));
  lines.push('', evidenceSection(input, results));
  lines.push('', riskSection(input));
  lines.push('', '以上内容基于当前可用公开数据自动生成，仅供研究参考，不构成投资建议。');
  return lines.join('\n');
}

function overviewScore(input: StockAnalysisInput, results: StockAnalysisResult[]) {
  let findingCount = 0;
  let weighted = 0;
  let totalWeight = 0;
  for (const dimension of overviewDimensions) {
    const result = findResult(results, dimension.name);
    if (!result) continue;
    findingCount += result.output.findings.length;
    if (gapAffectsResult(input.dataGaps, dimension.name)) continue;
    const score = result.output.findings[0]?.score ?? 50;
    const weight = overviewWeights[dimension.name];
    weighted += score * weight;
    totalWeight += weight;
  }
  return findingCount && totalWeight ? weighted / totalWeight : undefined;
}

function overviewConclusion(input: StockAnalysisInput, results: StockAnalysisResult[]) {
  const avg = overviewScore(input, results);
  if (avg === undefined) return '🟡 中性';
  if (avg >= 65) return '🟢 偏利好';
  if (avg <= 45) return '🔴 偏利空';
  return '🟡 中性';
}

function findResult(results: StockAnalysisResult[], resultName: StockAnalysisAgentName) {
  return results.find((result) => result.name === resultName);
}

function gapAffectsResult(gaps: IAgentDataGap[] = [], resultName: StockAnalysisAgentName) {
  return gapsForResult(gaps, resultName).length > 0;
}

function gapsForResult(gaps: IAgentDataGap[] = [], resultName: StockAnalysisAgentName) {
  const namesByResult: Record<StockAnalysisAgentName, string[]> = {
    technical: ['K线', '技术指标'],
    fundamental: ['行情'],
    capital: ['资金流', '热点/特大单'],
    sentiment: ['新闻', '公告'],
    chip: ['筹码集中度'],
  };
  const names = namesByResult[resultName];
  return gaps.filter((gap) => names.some((name) => gap.dataName.includes(name) || name.includes(gap.dataName)));
}

function dataStatusLine(gaps: IAgentDataGap[] = [], resultName: StockAnalysisAgentName) {
  const relatedGaps = gapsForResult(gaps, resultName);
  if (!relatedGaps.length) return undefined;
  const messages = relatedGaps
    .slice(0, 2)
    .map((gap) => ensureChinesePeriod(gap.userMessage || `${gap.dataName}数据暂不可用。`))
    .join('');
  return `数据状态：${messages}该维度结论置信度降低，暂不硬判断。`;
}

function ensureChinesePeriod(value: string) {
  const trimmed = value.trim();
  return /[。！？.!?]$/.test(trimmed) ? trimmed : `${trimmed}。`;
}

function formatWeight(weight: number) {
  return `${Math.round(weight * 100)}%`;
}

function summaryForResult(result: StockAnalysisResult) {
  const summary = result.output.findings[0]?.summary;
  const text =
    summary && !/当前可用数据不足|数据不足，暂不形成强结论/.test(summary)
      ? summary
      : (oneLine(result.content) ?? summary);
  return stripRepeatedLabel(text, result.label) ?? '数据不足，暂不输出硬评分。';
}

function stripRepeatedLabel(text: string | undefined, label: string) {
  if (!text) return undefined;
  const plainLabel = label.replace(/^\S+\s*/, '').trim();
  const emoji = label.match(/^\S+/)?.[0] ?? '';
  return text
    .replace(new RegExp(`^${escapeRegExp(label)}[：:\\s]*`), '')
    .replace(
      new RegExp(`^${escapeRegExp(emoji)}\\s*${escapeRegExp(plainLabel.replace(/分析$/, ''))}(?:分析)?[：:\\s]*`),
      '',
    )
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
