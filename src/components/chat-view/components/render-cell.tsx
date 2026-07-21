import type { BoardDetail, StockDetail } from '../../../shared/types';

export function renderCell(
  header: string,
  row: Record<string, unknown>,
  onStockClick: (stock: StockDetail) => void,
  onBoardClick: (board: Pick<BoardDetail, 'code' | 'name'>) => void,
) {
  const value = stringifyCell(row[header]);
  const name = pickCell(row, ['名称', 'name', 'title']);
  const code = pickCell(row, ['代码', 'code', 'symbol']);
  if (/^(名称|name|title)$/i.test(header) && code) {
    if (isBoardCode(code) || /板块|行业|概念/.test(name || value))
      return (
        <button
          className='stock-link btn-link'
          onClick={() => onBoardClick({ code, name: name || value })}
          type='button'
        >
          {value}
        </button>
      );
    return (
      <button className='stock-link btn-link' onClick={() => onStockClick({ code, name: name || value })} type='button'>
        {value}
      </button>
    );
  }
  if (/涨跌幅|涨幅|涨跌|change|pct/i.test(header)) return <span className={getChinaMarketTone(value)}>{value}</span>;
  if (/净流入|资金|amount|turnover|flow/i.test(header))
    return <span className={getChinaMarketTone(value)}>{formatChinaMoney(value)}</span>;
  if (/链接|url/i.test(header) && /^https?:\/\//.test(value))
    return (
      <a href={value} target='_blank' rel='noreferrer'>
        查看
      </a>
    );
  return value;
}

export function pickCell(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== '') return stringifyCell(value);
  }
  return '';
}

export function stringifyCell(value: unknown) {
  if (value === undefined || value === null || value === '') return '--';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function getChinaMarketTone(value: string) {
  const n = Number(String(value).replace(/[^\d.-]/g, ''));
  if (n > 0) return 'cn-up';
  if (n < 0) return 'cn-down';
  return '';
}

export function formatChinaMoney(value: string) {
  const text = String(value).trim();
  const n = Number(text.replace(/,/g, '').replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n)) return text;
  if (/万|亿/.test(text)) return text.replace(/\s+/g, '');
  const abs = Math.abs(n);
  const sign = n > 0 && /^\+/.test(text) ? '+' : n < 0 ? '-' : '';
  const amount =
    abs >= 100_000_000
      ? `${(abs / 100_000_000).toFixed(2)}亿`
      : abs >= 10_000
        ? `${(abs / 10_000).toFixed(2)}万`
        : abs.toFixed(0);
  return `${sign}${amount}`;
}

export function isBoardCode(code: string) {
  return /^BK\d{3,6}$/i.test(code) || /^(sh|sz|bj)\d{6}$/i.test(code);
}
