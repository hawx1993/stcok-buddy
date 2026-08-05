export interface IDataSyncTaskDisplayState {
  status: 'idle' | 'running' | 'completed' | 'error';
  processed: number;
  total: number;
  message: string;
}

export function getTaskProgressDisplay(state: IDataSyncTaskDisplayState) {
  const rawPct = state.total > 0 ? (state.processed / state.total) * 100 : 0;
  const isStarting = state.status === 'running' && (state.total <= 0 || state.processed === 0);
  const barWidth = isStarting ? 100 : state.processed > 0 ? Math.max(rawPct, 0.5) : 0;
  const badgeText = isStarting
    ? '准备中'
    : rawPct < 1 && state.processed > 0
      ? `${state.processed}/${state.total}`
      : `${rawPct.toFixed(1)}%`;

  return { rawPct, isStarting, barWidth, badgeText };
}
