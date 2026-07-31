function toFiniteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '' || value === '--') return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

export function formatNumber(value: unknown, digits = 2): string {
  const num = toFiniteNumber(value);
  if (num === undefined) return '--';
  return num.toFixed(digits);
}

export function formatPercent(value: unknown): string {
  const num = toFiniteNumber(value);
  if (num === undefined) return '--';
  const normalized = Math.abs(num) > 1 ? num : num * 100;
  return `${normalized >= 0 ? '+' : ''}${normalized.toFixed(2)}%`;
}

export function pickNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = toFiniteNumber(record[key]);
    if (value !== undefined) return value;
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

export function formatMoney(value: unknown): string {
  const num = toFiniteNumber(value);
  if (num === undefined) return '--';
  const sign = num > 0 ? '+' : num < 0 ? '-' : '';
  const abs = Math.abs(num);
  if (abs >= 100000000) return `${sign}${(abs / 100000000).toFixed(2)}亿`;
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(2)}万`;
  return `${sign}${abs.toFixed(0)}`;
}

export function formatMoneyFromWan(value: unknown): string {
  const num = toFiniteNumber(value);
  if (num === undefined) return '--';
  const sign = num > 0 ? '+' : num < 0 ? '-' : '';
  const abs = Math.abs(num);
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(2)}亿`;
  return `${sign}${abs.toFixed(2)}万`;
}

export function formatPercentPoints(value: unknown): string {
  const num = toFiniteNumber(value);
  if (num === undefined) return '--';
  return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
}

export function normalizeMarketCap(value?: number): number | undefined {
  return value !== undefined && value < 100_000 ? value * 100_000_000 : value;
}
