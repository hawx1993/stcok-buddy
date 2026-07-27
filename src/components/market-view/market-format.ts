export function tone(value: unknown) {
  return Number(value) < 0 || String(value).startsWith('-') ? 'down' : 'up';
}

export function parsePercent(value: unknown) {
  const num = Number.parseFloat(String(value ?? '').replace('%', ''));
  return Number.isFinite(num) ? num : 0;
}

export function formatSigned(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? `${num > 0 ? '+' : ''}${num.toFixed(2)}` : '--';
}

export function formatPercent(value: unknown) {
  const raw = String(value ?? '');
  const num = Number.parseFloat(raw.replace('%', ''));
  return Number.isFinite(num) ? `${num > 0 ? '+' : ''}${num.toFixed(2)}%` : String(value ?? '--');
}

export function formatVolume(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value ?? '--');
  return num >= 100_000_000
    ? `${(num / 100_000_000).toFixed(2)}亿手`
    : num >= 10_000
      ? `${(num / 10_000).toFixed(2)}万手`
      : `${num.toFixed(0)}手`;
}

export function formatMoney(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value ?? '--');
  return num >= 100_000_000
    ? `${(num / 100_000_000).toFixed(2)}亿`
    : num >= 10_000
      ? `${(num / 10_000).toFixed(2)}万`
      : `${num.toFixed(0)}`;
}

export function formatMarketCap(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value ?? '--');
  const yi = num / 100_000_000;
  return yi >= 10_000 ? `${(yi / 10_000).toFixed(2)}万亿` : `${yi.toFixed(1)}亿`;
}
