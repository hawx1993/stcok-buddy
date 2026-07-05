export function formatNumber(value: unknown, digits = 2): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return num.toFixed(digits);
}

export function formatPercent(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  const normalized = Math.abs(num) > 1 ? num : num * 100;
  return `${normalized >= 0 ? '+' : ''}${normalized.toFixed(2)}%`;
}

export function pickNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

export function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}
