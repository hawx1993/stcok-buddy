import type { AgentResultCard, EvidenceItem } from '../../../src/shared/types.js';
import { CONDITION_SCREENER_COMMAND } from '../../../src/shared/condition-screener.js';
import { formatMoney, formatPercentPoints } from '../stock/stock-detail/format.js';
import {
  type IConditionScreenerResult,
  type IConditionScreenerRow,
} from '../market-data/condition-screener-service.js';
import { compileConditionScreenerQuery, type TConditionScreenerCompileResult } from './condition-screener-compiler.js';
import { getConditionScreenerSessionState, setConditionScreenerSessionState } from './condition-screener-session.js';
import { runContextTool } from './agent-tool-runtime.js';
import type { IAgentContext } from './orchestrator-types.js';

type TConditionScreenerParseResult = TConditionScreenerCompileResult;

export async function runConditionScreenerAgent(ctx: IAgentContext): Promise<void> {
  const parsed = parseConditionScreenerArguments(
    extractConditionScreenerArguments(ctx.query),
    getConditionScreenerSessionState(ctx.conversationId),
  );
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
  const result = await runContextTool<IConditionScreenerResult>(ctx, 'screenASharesByConditions', parsed.input, () =>
    unavailableResult(),
  );
  setConditionScreenerSessionState(ctx.conversationId, parsed.state);
  ctx.board = resultToCard(result, parsed.criteria);
  ctx.analysisOverview = formatConditionScreenerResult(result, parsed.criteria, parsed.warnings);
  const evidence = resultToEvidence(result, parsed.criteria);
  if (evidence) ctx.evidence.push(evidence);
}

export function extractConditionScreenerArguments(query: string): string {
  const text = query.trim();
  return text.startsWith(CONDITION_SCREENER_COMMAND) ? text.slice(CONDITION_SCREENER_COMMAND.length).trim() : text;
}

export function parseConditionScreenerArguments(
  rawArguments: string,
  previousState?: Parameters<typeof compileConditionScreenerQuery>[1],
): TConditionScreenerParseResult {
  return compileConditionScreenerQuery(rawArguments, previousState);
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

function formatConditionScreenerResult(
  result: IConditionScreenerResult,
  criteria: string[],
  parseWarnings: string[] = [],
): string {
  const resultLines = result.rows.length
    ? [
        '| 代码 | 名称 | 所属板块 | 涨幅 | 换手率 | 成交额 | 成交量 | 总市值 | 流通市值 | 90%筹码 | 70%筹码 |',
        '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...result.rows.map(
          (row) =>
            `| ${row.code} | ${row.name} | ${row.industry ?? '--'} | ${formatPercentPoints(row.changePercent)} | ${formatPercentPoints(row.turnoverRate)} | ${formatMoney(row.amountYuan)} | ${formatVolume(row.volume)} | ${formatMoney(row.totalMarketCapYuan)} | ${formatMoney(row.circulatingMarketCapYuan)} | ${formatPercentPoints(row.concentration90Percent)} | ${formatPercentPoints(row.concentration70Percent)} |`,
        ),
      ]
    : [];
  const parameterWarningLines = parseWarnings.length
    ? ['## ⚠️ 参数提示', ...parseWarnings.map((warning) => `- ${warning}`), '']
    : [];

  return [
    '# 条件选股',
    '',
    '## ✅ 已解析条件',
    ...criteria.map((criterion) => `- ${criterion}`),
    '',
    ...parameterWarningLines,
    ...(resultLines.length ? ['## 📈 筛选结果', ...resultLines, ''] : []),
    '## 📊 命中数量',
    `- 命中 ${result.matchedCount} 只，展示 ${result.returnedCount} 只，候选 ${result.totalCandidates} 只。`,
    `- 数据源分布：DuckDB ${result.sourceStats.duckdbMatched} 只，stock-sdk ${result.sourceStats.stockSdkMatched} 只，a-stock-data ${result.sourceStats.aStockDataMatched} 只。`,
    '',
    '## 🎯 综合结论',
    ...formatConditionScreenerSummary(result),
    '- 🟡 中性：以上为真实数据条件筛选结果，仅用于缩小研究范围，不构成投资建议。',
    '',
    '> ⚠️ 公开行情可能存在延迟、字段缺失或短期波动风险。',
  ]
    .filter(Boolean)
    .join('\n');
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
  const displayLine =
    result.matchedCount > result.returnedCount
      ? `- 当前展示前 ${displayedCount} 只，实际命中 ${result.matchedCount} 只。`
      : `- 本轮命中并展示 ${displayedCount} 只。`;
  const leadingBoardLine = result.leadingBoards.length
    ? `- 今日领涨板块范围：${result.leadingBoards.map((board) => `${board.name}（${formatPercentPoints(board.changePercent)}）`).join('、')}。`
    : undefined;
  return [
    displayLine,
    formatIndustrySummary(result.rows),
    formatTopAmountSummary(result.rows),
    leadingBoardLine,
  ].filter((line): line is string => Boolean(line));
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
    .sort(
      (left, right) =>
        right[1].count - left[1].count ||
        right[1].amountYuan - left[1].amountYuan ||
        left[0].localeCompare(right[0], 'zh-CN'),
    )
    .slice(0, 3)
    .map(
      ([industry, group]) =>
        `${industry}（${group.count}只，占展示样本${((group.count / rows.length) * 100).toFixed(1)}%）`,
    )
    .join('、');
  return `- 所属板块分布：${summary}。`;
}

function formatVolume(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '--';
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿手`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(2)}万手`;
  return `${value}手`;
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
