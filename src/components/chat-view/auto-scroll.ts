export interface IScrollMetrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

export type TChatAutoScrollReason = 'message-added' | 'response-finished';

const DEFAULT_BOTTOM_THRESHOLD = 48;

export function isNearChatBottom(metrics: IScrollMetrics, threshold = DEFAULT_BOTTOM_THRESHOLD): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= threshold;
}

export function shouldAutoScrollChat({
  isResponding,
  reason,
  userScrolledAway,
}: {
  isResponding: boolean;
  reason: TChatAutoScrollReason;
  userScrolledAway: boolean;
}): boolean {
  if (reason === 'response-finished') return true;
  if (isResponding && userScrolledAway) return false;
  return true;
}
