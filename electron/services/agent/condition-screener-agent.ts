import type { AgentResultCard, EvidenceItem } from '../../../src/shared/types.js';
import { CONDITION_SCREENER_COMMAND } from '../../../src/shared/condition-screener.js';
import { formatMoney, formatPercentPoints } from '../stock/format.js';
import {
  type IConditionScreenerInput,
  type IConditionScreenerResult,
  type IConditionScreenerRow,
} from '../market-data/condition-screener-service.js';
import { runContextTool } from './agent-tool-runtime.js';
import type { IAgentContext } from './orchestrator-types.js';

const YI_YUAN = 100_000_000;

type TConditionScreenerParseResult =
  | { valid: true; input: IConditionScreenerInput; criteria: string[] }
  | { valid: false; errors: string[] };

export async function runConditionScreenerAgent(ctx: IAgentContext): Promise<void> {
  const parsed = parseConditionScreenerArguments(extractConditionScreenerArguments(ctx.query));
  if (!parsed.valid) {
    ctx.board = validationCard(parsed.errors);
    ctx.analysisOverview = formatValidationErrors(parsed.errors);
    return;
  }

  ctx.emitEvent?.({
    type: 'progress_updated',
    title: '条件选股进度',
    message: '正在基于本地行情与筹码缓存筛选',
    progress: { current: 10, total: 100 },
    step: {
      id: 'condition-screener',
      agent: 'ConditionScreener',
      description: '校验条件并基于真实市场快照执行全市场筛选',
      status: 'running',
    },
    subAgent: {
      name: 'ConditionScreener',
      description: '基于本地行情与筹码缓存筛选',
      status: 'running',
    },
  });
  const result = await runContextTool<IConditionScreenerResult>(
    ctx,
    'screenASharesByConditions',
    parsed.input,
    () => unavailableResult(),
  );
  ctx.board = resultToCard(result, parsed.criteria);
  ctx.analysisOverview = formatConditionScreenerResult(result, parsed.criteria);
  const evidence = resultToEvidence(result, parsed.criteria);
  if (evidence) ctx.evidence.push(evidence);
}

export function extractConditionScreenerArguments(query: string): string {
  const text = query.trim();
  return text.startsWith(CONDITION_SCREENER_COMMAND) ? text.slice(CONDITION_SCREENER_COMMAND.length).trim() : text;
}

export function parseConditionScreenerArguments(rawArguments: string): TConditionScreenerParseResult {
  const segments = rawArguments
    .split(/--/)
    .map((segment) => segment.trim().replace(/[，,]+$/g, '').trim())
    .filter(Boolean);
  if (!segments.length) {
    return { valid: false, errors: ['未提供筛选条件。请先选择预设，或使用 `--参数` 格式填写条件。'] };
  }

  const input: IConditionScreenerInput = {};
  const criteria: string[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const segment of segments) {
    const normalized = normalizeSegment(segment);
    const parameter = parseSegment(normalized, input);
    if (!parameter) {
      errors.push(`未识别参数：--${segment}`);
      continue;
    }
    if (seen.has(parameter)) {
      errors.push(`参数重复：--${segment}。请只保留一个同类条件。`);
      continue;
    }
    seen.add(parameter);
    criteria.push(formatConditionScreenerCriterion(normalized));
  }

  if (errors.length) return { valid: false, errors };
  return { valid: true, input, criteria };
}

function parseSegment(segment: string, input: IConditionScreenerInput): string | undefined {
  if (segment === '排除ST') {
    input.excludeST = true;
    return 'exclude-st';
  }
  if (segment === '今日领涨板块') {
    input.leadingBoards = true;
    return 'leading-boards';
  }
  if (segment === '排序=换手率降序') {
    input.sortBy = 'turnoverRate';
    input.sortOrder = 'desc';
    return 'sort';
  }

  const marketCapRange = /^总市值=(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)亿$/.exec(segment);
  if (marketCapRange) {
    const min = toYuan(marketCapRange[1]);
    const max = toYuan(marketCapRange[2]);
    if (min === undefined || max === undefined || min > max) return undefined;
    input.minTotalMarketCapYuan = min;
    input.maxTotalMarketCapYuan = max;
    return 'market-cap';
  }

  const marketCapMax = /^总市值<(\d+(?:\.\d+)?)亿$/.exec(segment);
  if (marketCapMax) {
    const max = toYuan(marketCapMax[1]);
    if (max === undefined) return undefined;
    input.maxTotalMarketCapYuanExclusive = max;
    return 'market-cap';
  }

  const turnoverRate = /^换手率>(\d+(?:\.\d+)?)%$/.exec(segment);
  if (turnoverRate) {
    const value = toPercent(turnoverRate[1]);
    if (value === undefined) return undefined;
    input.turnoverRateMinExclusive = value;
    return 'turnover-rate';
  }

  const amount = /^成交额>(\d+(?:\.\d+)?)亿$/.exec(segment);
  if (amount) {
    const value = toYuan(amount[1]);
    if (value === undefined) return undefined;
    input.amountMinYuanExclusive = value;
    return 'amount';
  }

  const changePercent = /^涨幅=(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)%$/.exec(segment);
  if (changePercent) {
    const min = toPercent(changePercent[1]);
    const max = toPercent(changePercent[2]);
    if (min === undefined || max === undefined || min > max) return undefined;
    input.changePercentMin = min;
    input.changePercentMax = max;
    return 'change-percent';
  }

  const concentration90 = /^筹码90%集中度<(\d+(?:\.\d+)?)%$/.exec(segment);
  if (concentration90) {
    const value = toPercent(concentration90[1]);
    if (value === undefined) return undefined;
    input.concentration90MaxExclusive = value;
    return 'concentration-90';
  }

  const profitRatio = /^获利比例>(\d+(?:\.\d+)?)%$/.exec(segment);
  if (profitRatio) {
    const value = toPercent(profitRatio[1]);
    if (value === undefined) return undefined;
    input.profitRatioMinExclusive = value;
    return 'profit-ratio';
  }

  return undefined;
}

function normalizeSegment(segment: string): string {
  return segment
    .replace(/\s+/g, '')
    .replaceAll('％', '%')
    .replaceAll('＝', '=')
    .replaceAll('＜', '<')
    .replaceAll('＞', '>')
    .replace(/[—–~至]/g, '-');
}

function formatConditionScreenerCriterion(segment: string): string {
  if (segment === '排除ST') return '排除 ST';
  if (segment === '今日领涨板块') return '今日领涨板块';
  if (segment === '排序=换手率降序') return '按换手率降序';

  const marketCapRange = /^总市值=(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)亿$/.exec(segment);
  if (marketCapRange) return `总市值 ${marketCapRange[1]}–${marketCapRange[2]} 亿`;
  const marketCapMax = /^总市值<(\d+(?:\.\d+)?)亿$/.exec(segment);
  if (marketCapMax) return `总市值 < ${marketCapMax[1]} 亿`;
  const turnoverRate = /^换手率>(\d+(?:\.\d+)?)%$/.exec(segment);
  if (turnoverRate) return `换手率 > ${turnoverRate[1]}%`;
  const amount = /^成交额>(\d+(?:\.\d+)?)亿$/.exec(segment);
  if (amount) return `成交额 > ${amount[1]} 亿`;
  const changePercent = /^涨幅=(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)%$/.exec(segment);
  if (changePercent) return `涨幅 ${changePercent[1]}–${changePercent[2]}%`;
  const concentration90 = /^筹码90%集中度<(\d+(?:\.\d+)?)%$/.exec(segment);
  if (concentration90) return `筹码 90% 集中度 < ${concentration90[1]}%`;
  const profitRatio = /^获利比例>(\d+(?:\.\d+)?)%$/.exec(segment);
  if (profitRatio) return `获利比例 > ${profitRatio[1]}%`;
  return segment;
}

function toYuan(rawValue: string): number | undefined {
  const value = Number(rawValue);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * YI_YUAN) : undefined;
}

function toPercent(rawValue: string): number | undefined {
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : undefined;
}

function validationCard(errors: string[]): AgentResultCard {
  return {
    title: '条件选股参数校验',
    subtitle: '未执行数据查询',
    metrics: [{ label: '参数错误', value: `${errors.length} 项`, tone: 'warn' }],
    narrative: errors.join('；'),
  };
}

function unavailableResult(): IConditionScreenerResult {
  return {
    source: 'duckdb+stock-sdk+a-stock-data',
    storage: 'none',
    freshness: 'stale',
    isComplete: false,
    rows: [],
    matchedCount: 0,
    returnedCount: 0,
    totalCandidates: 0,
    leadingBoards: [],
    sourceStats: {
      duckdbMatched: 0,
      stockSdkMatched: 0,
      aStockDataMatched: 0,
      missingQuoteFields: 0,
      missingChipData: 0,
    },
    warnings: ['条件选股服务暂不可用，请稍后重试。'],
    isEmpty: true,
  };
}

function resultToCard(result: IConditionScreenerResult, criteria: string[]): AgentResultCard {
  return {
    title: '条件选股',
    subtitle: criteria.join(' · '),
    metrics: [
      { label: '命中', value: `${result.matchedCount} 只`, tone: result.matchedCount ? 'up' : 'neutral' },
      { label: '展示', value: `${result.returnedCount} 只`, tone: 'neutral' },
      { label: '候选', value: `${result.totalCandidates} 只`, tone: 'neutral' },
      { label: '数据完整性', value: result.isComplete ? '完整' : '存在缺口', tone: result.isComplete ? 'up' : 'warn' },
    ],
  };
}

function formatConditionScreenerResult(result: IConditionScreenerResult, criteria: string[]): string {
  const resultLines = result.rows.length
    ? [
        '| 代码 | 名称 | 所属板块 | 涨幅 | 换手率 | 成交额 | 总市值 |',
        '| --- | --- | --- | ---: | ---: | ---: | ---: |',
        ...result.rows.map(
          (row) =>
            `| ${row.code} | ${row.name} | ${row.industry ?? '--'} | ${formatPercentPoints(row.changePercent)} | ${formatPercentPoints(row.turnoverRate)} | ${formatMoney(row.amountYuan)} | ${formatMoney(row.totalMarketCapYuan)} |`,
        ),
      ]
    : [];
  const warningLines = result.warnings.length
    ? ['## ⚠️ 数据状态', ...result.warnings.map((warning) => `- ${warning}`), '']
    : [];

  return [
    '# 条件选股',
    '',
    `> 条件：${criteria.join(' · ')}`,
    '',
    ...(resultLines.length ? ['## 📈 筛选结果', ...resultLines, ''] : []),
    '## 🎯 筛选总结',
    ...formatConditionScreenerSummary(result),
    '',
    ...warningLines,
    '> ⚠️ 公开行情可能存在延迟、字段缺失或短期波动风险。',
    '以上内容基于公开数据自动生成，仅供研究参考，不构成投资建议。',
  ].filter(Boolean).join('\n');
}

function formatConditionScreenerSummary(result: IConditionScreenerResult): string[] {
  if (!result.rows.length) {
    return [
      result.isComplete
        ? '- 已完整执行当前真实数据筛选，未发现符合全部条件的股票。'
        : '- 筛选数据存在缺口，当前未获得完整的命中结果。',
    ];
  }

  const displayedCount = result.rows.length;
  const displayLine = result.matchedCount > result.returnedCount
    ? `- 当前展示前 ${displayedCount} 只，实际命中 ${result.matchedCount} 只。`
    : `- 本轮命中并展示 ${displayedCount} 只。`;
  const leadingBoardLine = result.leadingBoards.length
    ? `- 今日领涨板块范围：${result.leadingBoards.map((board) => `${board.name}（${formatPercentPoints(board.changePercent)}）`).join('、')}。`
    : undefined;
  return [displayLine, formatIndustrySummary(result.rows), formatTopAmountSummary(result.rows), leadingBoardLine].filter(
    (line): line is string => Boolean(line),
  );
}

function formatIndustrySummary(rows: IConditionScreenerRow[]): string {
  const groups = new Map<string, { count: number; amountYuan: number }>();
  for (const row of rows) {
    const industry = row.industry?.trim();
    if (!industry) continue;
    const group = groups.get(industry) ?? { count: 0, amountYuan: 0 };
    group.count += 1;
    group.amountYuan += row.amountYuan ?? 0;
    groups.set(industry, group);
  }
  if (!groups.size) return '- 所属板块字段暂无可用数据，无法统计板块集中度。';
  const summary = [...groups.entries()]
    .sort((left, right) => right[1].count - left[1].count || right[1].amountYuan - left[1].amountYuan || left[0].localeCompare(right[0], 'zh-CN'))
    .slice(0, 3)
    .map(([industry, group]) => `${industry}（${group.count}只，占展示样本${((group.count / rows.length) * 100).toFixed(1)}%）`)
    .join('、');
  return `- 所属板块分布：${summary}。`;
}

function formatTopAmountSummary(rows: IConditionScreenerRow[]): string {
  const topRows = rows
    .filter((row) => row.amountYuan !== undefined && Number.isFinite(row.amountYuan))
    .sort((left, right) => (right.amountYuan ?? 0) - (left.amountYuan ?? 0) || left.code.localeCompare(right.code))
    .slice(0, 3);
  if (!topRows.length) return '- 展示样本缺少可用成交额，无法列出成交额较大个股。';
  return `- 成交额较大个股：${topRows.map((row) => `${row.name}（${row.code}，${formatMoney(row.amountYuan)}）`).join('、')}。`;
}

function formatValidationErrors(errors: string[]): string {
  return [
    '# 条件选股',
    '',
    '## ⚠️ 数据状态',
    ...errors.map((error) => `- ${error}`),
    '',
    '## 🎯 综合结论',
    '- 🟡 中性：参数校验未通过，尚未执行真实行情筛选。',
  ].join('\n');
}

function resultToEvidence(result: IConditionScreenerResult, criteria: string[]): EvidenceItem | undefined {
  if (!result.rows.length) return undefined;
  return {
    id: `condition-screener:${criteria.join('|')}:${result.latestTradeDate ?? 'unknown'}`,
    source: result.storage === 'local' ? 'local-market-data' : 'remote-market-data',
    title: '条件选股真实市场筛选',
    summary: `按 ${criteria.join('、')} 筛选，命中 ${result.matchedCount} 只，展示 ${result.returnedCount} 只。`,
    timestamp: result.latestTradeDate,
    raw: { source: result.source, storage: result.storage, warnings: result.warnings },
  };
}
