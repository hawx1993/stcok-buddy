import type { Period } from 'klinecharts';
import type { KlinePoint } from '../../../shared/types';
import cx from '../../../shared/cx';
import styles from '../index.module.scss';

export function KlineHoverInfo({
  point,
  previous,
  pe,
  side,
  period,
}: {
  point: KlinePoint;
  previous?: KlinePoint;
  pe?: string | number;
  side: 'left' | 'right';
  period: Period;
}) {
  const change = point.change ?? point.close - (previous?.close ?? point.open);
  const changePercent = point.changePercent ?? (previous?.close ? (change / previous.close) * 100 : 0);
  return (
    <div className={cx(styles['hover-tooltip'], styles[side])}>
      <div className={styles.date}>{formatKlineTime(point, period)}</div>
      <KlineInfoRow label='开盘' value={formatPrice(point.open)} />
      <KlineInfoRow label='最高' value={formatPrice(point.high)} tone={point.high >= point.open ? 'up' : 'down'} />
      <KlineInfoRow label='最低' value={formatPrice(point.low)} tone={point.low >= point.open ? 'up' : 'down'} />
      <KlineInfoRow label='收盘' value={formatPrice(point.close)} tone={point.close >= point.open ? 'up' : 'down'} />
      <KlineInfoRow label='涨跌额' value={formatSigned(change)} tone={change >= 0 ? 'up' : 'down'} />
      <KlineInfoRow
        label='涨跌幅'
        value={`${formatSigned(changePercent)}%`}
        tone={changePercent >= 0 ? 'up' : 'down'}
      />
      <KlineInfoRow label='成交量' value={formatVolume(point.volume)} />
      {(point.pe ?? pe) ? <KlineInfoRow label='市盈率' value={String(point.pe ?? pe)} /> : null}
    </div>
  );
}

function KlineInfoRow({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className={styles['info-row']}>
      <span>{label}</span>
      <b className={tone ? styles[tone] : undefined}>{value}</b>
    </div>
  );
}

function formatKlineTime(point: KlinePoint, period: Period) {
  const timestamp = point.timestamp ?? parseKlineTimestamp(point.time, 0, 1, period);
  if (!Number.isFinite(timestamp)) return point.time || '--';
  const date = new Date(timestamp);
  const dateText = `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}`;
  const weekText = `周${'日一二三四五六'[date.getDay()]}`;
  if (period.type === 'day') return `${dateText} ${weekText}`;
  return `${dateText} ${pad2(date.getHours())}:${pad2(date.getMinutes())} ${weekText}`;
}

function parseKlineTimestamp(value: string, index: number, total: number, period: Period) {
  const text = String(value || '').trim();
  const date = text.includes('-')
    ? new Date(text).getTime()
    : Number(text.length === 8 ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}` : text);
  if (Number.isFinite(date) && date > 10_000_000_000) return date;
  const compactMinute = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (compactMinute)
    return new Date(
      `${compactMinute[1]}-${compactMinute[2]}-${compactMinute[3]}T${compactMinute[4]}:${compactMinute[5]}:00+08:00`,
    ).getTime();
  const compactDay = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactDay) return new Date(`${compactDay[1]}-${compactDay[2]}-${compactDay[3]}T00:00:00+08:00`).getTime();
  const span =
    period.type === 'minute'
      ? period.span * 60_000
      : period.type === 'hour'
        ? period.span * 3_600_000
        : period.type === 'week'
          ? 7 * 86_400_000
          : period.type === 'month'
            ? 30 * 86_400_000
            : 86_400_000;
  return new Date('2024-01-01').getTime() + (index - total) * span;
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function formatPrice(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : '--';
}

function formatSigned(value: number) {
  if (!Number.isFinite(value)) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function formatVolume(value: number) {
  if (!Number.isFinite(value)) return '--';
  return value >= 10000 ? `${(value / 10000).toFixed(2)}万手` : `${value.toFixed(0)}手`;
}
