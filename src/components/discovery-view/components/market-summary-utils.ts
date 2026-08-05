export function getSentimentMarkerPosition(value: number): number {
  return Math.min(Math.max(value, 0), 100);
}
