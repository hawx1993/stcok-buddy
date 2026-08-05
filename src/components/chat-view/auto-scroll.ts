export interface IScrollMetrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

export type TChatAutoScrollReason = 'conversation-loaded' | 'message-added' | 'response-finished';

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
  if (reason === 'conversation-loaded') return false;
  if (reason === 'response-finished') return true;
  if (isResponding && userScrolledAway) return false;
  return true;
}

export function getChatLastMessageIndex(messageCount: number): number | undefined {
  return messageCount > 0 ? messageCount - 1 : undefined;
}

export function getChatAutoScrollBehavior({
  isResponding,
  reason,
  userScrolledAway,
}: {
  isResponding: boolean;
  reason: TChatAutoScrollReason;
  userScrolledAway: boolean;
}): ScrollBehavior | undefined {
  if (!shouldAutoScrollChat({ isResponding, reason, userScrolledAway })) return undefined;
  return 'smooth';
}
