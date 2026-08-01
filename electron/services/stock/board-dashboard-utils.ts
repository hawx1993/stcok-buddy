import type {
  IBoardDashboardMetric,
  IBoardDashboardSnapshot,
  IBoardLeaderCandidate,
  TBoardDashboardBucket,
  TBoardDashboardRange,
} from '../../../src/shared/types.js';

export interface IBoardDashboardInput {
  boardCode: string;
  boardName: string;
  boardKind?: 'industry' | 'concept' | 'unknown';
  range: TBoardDashboardRange;
  tradeDate: string;
  changePercent: number | null;
  maxDailyChangePercent: number | null;
  mainNetInflow: number | null;
  amount: number | null;
  limitUpCount: number | null;
  upCount: number | null;
  downCount: number | null;
  constituentCount: number;
  upRatio: number | null;
  averageTurnoverRate: number | null;
  averageAmplitude: number | null;
  leaders: IBoardLeaderCandidate[];
  updatedAt: string;
  warnings?: string[];
}

export interface ILeaderInput {
  code: string;
  name: string;
  price?: number | string | null;
  changePercent?: number | string | null;
  mainNetInflow?: number | string | null;
  amount?: number | string | null;
  turnoverRate?: number | string | null;
  amplitude?: number | string | null;
}

const dashboardRanges: TBoardDashboardRange[] = ['today', 'five-days', 'twenty-days'];
const MAX_BOARD_DAILY_CHANGE_PERCENT = 20;

export function normalizeDashboardRange(range?: TBoardDashboardRange): TBoardDashboardRange {
  return range && dashboardRanges.includes(range) ? range : 'today';
}

export function rangeToDayLimit(range: TBoardDashboardRange): number {
  if (range === 'twenty-days') return 20;
  if (range === 'five-days') return 5;
  return 1;
}

export function rangeToMaxChangePercent(range: TBoardDashboardRange): number {
  if (range === 'twenty-days') return 100;
  if (range === 'five-days') return 50;
  return MAX_BOARD_DAILY_CHANGE_PERCENT;
}

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text === '--') return null;
  const unit = text.includes('亿') ? 100000000 : text.includes('万') ? 10000 : 1;
  const parsed = Number.parseFloat(text.replace(/[,%+，]/g, '').replace(/[亿元万]/g, ''));
  return Number.isFinite(parsed) ? parsed * unit : null;
}

export function normalizeBoardChangePercent(
  value: unknown,
  range: TBoardDashboardRange = 'today',
): number | null {
  const changePercent = toFiniteNumber(value);
  if (changePercent === null) return null;
  const maxAllowed = rangeToMaxChangePercent(range);
  return Math.abs(changePercent) <= maxAllowed ? changePercent : null;
}

export function normalizeDashboardBoardName(value: string): string {
  return value.replace(/板块|行业|概念|Ⅱ|Ⅲ|II|III|\s/g, '');
}

export function toHalfStepScore(rank: number, total: number): number {
  if (total <= 1) return 10;
  const percentileScore = 10 - ((rank - 1) / (total - 1)) * 9;
  return Math.min(10, Math.max(1, Math.round(percentileScore * 2) / 2));
}

export function scorePercentile(
  value: number | null | undefined,
  values: Array<number | null | undefined>,
  direction: 'higher-better' | 'lower-better' = 'higher-better',
): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const sorted = values.filter((item): item is number => Number.isFinite(item)).sort((left, right) => left - right);
  if (!sorted.length) return null;
  if (sorted.length === 1) return 100;
  const lowerOrEqual = sorted.filter((item) => item <= value).length;
  const percentile = ((lowerOrEqual - 1) / (sorted.length - 1)) * 100;
  const score = direction === 'higher-better' ? percentile : 100 - percentile;
  return clampScore(score);
}

export function pickBoardLeaders(items: ILeaderInput[], limit = 5): IBoardLeaderCandidate[] {
  return items
    .map((item) => {
      const changePercent = toFiniteNumber(item.changePercent);
      const mainNetInflow = toFiniteNumber(item.mainNetInflow);
      const amount = toFiniteNumber(item.amount);
      const turnoverRate = toFiniteNumber(item.turnoverRate);
      const amplitude = toFiniteNumber(item.amplitude);
      const price = toFiniteNumber(item.price);
      const scoreParts = [
        mainNetInflow === null ? null : normalizeSigned(mainNetInflow, 100000000),
        changePercent === null ? null : normalizeSigned(changePercent, 10),
        amount === null ? null : Math.min(100, Math.max(0, amount / 10000000)),
        turnoverRate === null ? null : Math.max(0, 100 - Math.abs(turnoverRate - 8) * 5),
      ].filter((score): score is number => score !== null && Number.isFinite(score));
      const leaderScore = scoreParts.length
        ? clampScore(scoreParts.reduce((sum, score) => sum + score, 0) / scoreParts.length)
        : null;
      return {
        code: item.code,
        name: item.name,
        price,
        changePercent,
        mainNetInflow,
        amount,
        turnoverRate,
        amplitude,
        leaderScore,
        reason: buildLeaderReason(mainNetInflow, changePercent, amount),
      };
    })
    .filter((item) => item.code && item.name)
    .sort((left, right) => (right.leaderScore ?? -Infinity) - (left.leaderScore ?? -Infinity))
    .slice(0, limit);
}

export function rankBoardMetrics(inputs: IBoardDashboardInput[]): IBoardDashboardSnapshot {
  const scored = inputs.map((input) => scoreMetric(input, inputs));
  const rankable = scored
    .filter((metric) => metric.rawScore !== null)
    .sort((left, right) => (right.rawScore ?? -Infinity) - (left.rawScore ?? -Infinity));
  const total = rankable.length;
  const rankByCode = new Map(rankable.map((metric, index) => [metric.boardCode, index + 1]));
  const metrics = scored
    .map((metric) => {
      const rank = rankByCode.get(metric.boardCode) ?? null;
      const heatScore = rank === null ? null : toHalfStepScore(rank, total);
      return { ...metric, heatRank: rank, heatScore };
    })
    .sort((left, right) => (left.heatRank ?? Infinity) - (right.heatRank ?? Infinity));
  const hot = [...metrics]
    .filter((metric) => metric.rawScore !== null && metric.riskScore !== null && metric.riskScore < 70)
    .sort((left, right) => (right.rawScore ?? -Infinity) - (left.rawScore ?? -Infinity))
    .slice(0, 10);
  const potential = [...metrics]
    .filter((metric) => metric.fundScore !== null && metric.riskScore !== null && metric.riskScore < 60)
    .sort(
      (left, right) =>
        (right.fundScore ?? -Infinity) - (left.fundScore ?? -Infinity) ||
        (right.breadthScore ?? -Infinity) - (left.breadthScore ?? -Infinity),
    )
    .slice(0, 10);
  const avoid = [...metrics]
    .filter((metric) => metric.riskScore !== null)
    .sort((left, right) => (right.riskScore ?? -Infinity) - (left.riskScore ?? -Infinity))
    .slice(0, 10);
  const leaders = [...metrics]
    .filter((metric) => metric.leaders.length)
    .sort((left, right) => (right.leaderScore ?? -Infinity) - (left.leaderScore ?? -Infinity))
    .slice(0, 10);
  const firstInput = inputs[0];
  const summary = pickDistinctSummaryMetrics([
    { key: 'hottest', candidates: hot },
    { key: 'potential', candidates: potential },
    { key: 'avoid', candidates: avoid },
    { key: 'strongestLeader', candidates: leaders },
  ]);
  return {
    range: firstInput?.range ?? 'today',
    tradeDate: firstInput?.tradeDate ?? '',
    updatedAt: firstInput?.updatedAt ?? new Date().toISOString(),
    summary,
    rankings: metrics,
    potential,
    hot,
    avoid,
    leaders,
    warnings: collectWarnings(metrics),
  };
}

function pickDistinctSummaryMetrics(
  categories: Array<{ key: string; candidates: IBoardDashboardMetric[] }>,
): Record<string, IBoardDashboardMetric | undefined> {
  const usedCodes = new Set<string>();
  const result: Record<string, IBoardDashboardMetric | undefined> = {};
  for (const { key, candidates } of categories) {
    const metric = candidates.find((item) => !usedCodes.has(item.boardCode));
    result[key] = metric ?? candidates[0];
    if (metric) usedCodes.add(metric.boardCode);
  }
  return result;
}

export function classifyBoardBucket(metric: Pick<IBoardDashboardMetric, 'riskScore' | 'fundScore' | 'momentumScore' | 'leaderScore'>): TBoardDashboardBucket {
  if ((metric.riskScore ?? 0) >= 70) return 'avoid';
  if ((metric.leaderScore ?? 0) >= 75) return 'leader';
  if ((metric.momentumScore ?? 0) >= 70 && (metric.fundScore ?? 0) >= 45) return 'hot';
  return 'potential';
}

function scoreMetric(input: IBoardDashboardInput, peers: IBoardDashboardInput[]): IBoardDashboardMetric {
  const momentumScore = averageScores([
    scorePercentile(input.changePercent, peers.map((item) => item.changePercent)),
    scorePercentile(input.maxDailyChangePercent, peers.map((item) => item.maxDailyChangePercent)),
  ]);
  const fundScore = averageScores([
    scorePercentile(input.mainNetInflow, peers.map((item) => item.mainNetInflow)),
    scorePercentile(input.amount, peers.map((item) => item.amount)),
  ]);
  const breadthScore = averageScores([
    scorePercentile(input.upRatio, peers.map((item) => item.upRatio)),
    scorePercentile(input.limitUpCount, peers.map((item) => item.limitUpCount)),
  ]);
  const leaderScore = averageScores(input.leaders.map((leader) => leader.leaderScore));
  const riskScore = averageScores([
    input.mainNetInflow === null ? null : scorePercentile(input.mainNetInflow, peers.map((item) => item.mainNetInflow), 'lower-better'),
    input.upRatio === null ? null : scorePercentile(input.upRatio, peers.map((item) => item.upRatio), 'lower-better'),
    input.averageAmplitude === null ? null : scorePercentile(input.averageAmplitude, peers.map((item) => item.averageAmplitude)),
  ]);
  const rawScore = [momentumScore, fundScore, breadthScore, leaderScore, riskScore].some((score) => score !== null)
    ? clampScore(
        (momentumScore ?? 0) * 0.3 +
          (fundScore ?? 0) * 0.3 +
          (breadthScore ?? 0) * 0.2 +
          (leaderScore ?? 0) * 0.2 -
          (riskScore ?? 0) * 0.25,
      )
    : null;
  const partialMetric = { riskScore, fundScore, momentumScore, leaderScore };
  const bucket = classifyBoardBucket(partialMetric);
  return {
    ...input,
    momentumScore,
    fundScore,
    breadthScore,
    leaderScore,
    riskScore,
    rawScore,
    heatScore: null,
    heatRank: null,
    bucket,
    source: 'merged',
    reason: buildMetricReason(input, { momentumScore, fundScore, breadthScore, leaderScore, riskScore }),
  };
}

function averageScores(scores: Array<number | null | undefined>): number | null {
  const values = scores.filter((score): score is number => score !== null && score !== undefined && Number.isFinite(score));
  if (!values.length) return null;
  return clampScore(values.reduce((sum, score) => sum + score, 0) / values.length);
}

function normalizeSigned(value: number, scale: number): number {
  return clampScore(50 + (value / scale) * 50);
}

function clampScore(value: number): number {
  return Math.min(100, Math.max(0, Number(value.toFixed(2))));
}

function buildLeaderReason(mainNetInflow: number | null, changePercent: number | null, amount: number | null): string {
  const parts: string[] = [];
  if (mainNetInflow !== null) parts.push(mainNetInflow >= 0 ? '主力资金净流入' : '主力资金承压');
  if (changePercent !== null) parts.push(changePercent >= 0 ? '涨幅强于板块样本' : '短线表现偏弱');
  if (amount !== null) parts.push('成交额具备辨识度');
  return parts.length ? parts.join(' / ') : '真实行情字段不足，暂不生成强结论';
}

function buildMetricReason(
  input: IBoardDashboardInput,
  scores: Pick<IBoardDashboardMetric, 'momentumScore' | 'fundScore' | 'breadthScore' | 'leaderScore' | 'riskScore'>,
): string {
  const parts: string[] = [];
  if ((scores.fundScore ?? 0) >= 70) parts.push('资金强度领先');
  if ((scores.momentumScore ?? 0) >= 70) parts.push('价格强度靠前');
  if ((scores.breadthScore ?? 0) >= 70) parts.push('成分股扩散较好');
  if ((scores.leaderScore ?? 0) >= 70) parts.push('龙头股强度突出');
  if ((scores.riskScore ?? 0) >= 70) parts.push('风险指标偏高');
  if (!parts.length && input.constituentCount > 0) parts.push('真实样本已纳入评分但优势不突出');
  return parts.join(' / ') || '暂无足够真实评分数据';
}

function collectWarnings(metrics: IBoardDashboardMetric[]): string[] | undefined {
  const warnings = metrics.flatMap((metric) => metric.warnings ?? []);
  return warnings.length ? Array.from(new Set(warnings)) : undefined;
}
