import type { IBoardDashboardMetric } from './types.js';

const DEFAULT_BOARD_RANKING_LIMIT = 10;

export function selectTopBoardChangeRankings(
  metrics: IBoardDashboardMetric[],
  limit = DEFAULT_BOARD_RANKING_LIMIT,
): IBoardDashboardMetric[] {
  return selectTopBoardRankings(metrics, 'changePercent', limit);
}

export function selectTopBoardFundInflowRankings(
  metrics: IBoardDashboardMetric[],
  limit = DEFAULT_BOARD_RANKING_LIMIT,
): IBoardDashboardMetric[] {
  return selectTopBoardRankings(metrics, 'mainNetInflow', limit);
}

function selectTopBoardRankings(
  metrics: IBoardDashboardMetric[],
  field: 'changePercent' | 'mainNetInflow',
  limit: number,
): IBoardDashboardMetric[] {
  const safeLimit = Math.max(0, Math.floor(limit));
  if (!safeLimit) return [];
  return metrics
    .filter((metric) => metric[field] !== null && Number.isFinite(metric[field]))
    .sort((left, right) => (right[field] ?? -Infinity) - (left[field] ?? -Infinity))
    .slice(0, safeLimit);
}
