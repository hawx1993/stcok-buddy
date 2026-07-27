import gsap from 'gsap';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MarketQuoteRow } from '../../../shared/types';
import cx from '../../../shared/cx';
import { formatMarketCap, formatMoney, formatPercent, formatVolume, tone } from '../market-format';
import styles from '../index.module.scss';

const MARKET_ROW_ANIMATION_DURATION = 0.42;
const marketCellFields: TMarketCellField[] = [
  'changePercent',
  'price',
  'turnoverRate',
  'volume',
  'amount',
  'marketCap',
  'industry',
];

type TSortDirection = 'asc' | 'desc' | undefined;
type TMarketCellField = 'changePercent' | 'price' | 'turnoverRate' | 'volume' | 'amount' | 'marketCap' | 'industry';
type TMarketCellSnapshot = Record<TMarketCellField, string>;

export function StockTable({
  rows,
  sortDirection,
  updateVersion,
  changedCodes,
  movedCodes,
  onSortChange,
  onOpen,
}: {
  rows: MarketQuoteRow[];
  sortDirection: TSortDirection;
  updateVersion: number;
  changedCodes: string[];
  movedCodes: string[];
  onSortChange(): void;
  onOpen(row: MarketQuoteRow): void;
}) {
  const sortMark = sortDirection === 'asc' ? '↑' : sortDirection === 'desc' ? '↓' : '↕';
  const rowElements = useRef(new Map<string, HTMLTableRowElement>());
  const previousTops = useRef(new Map<string, number>());
  const previousCellSnapshots = useRef(new Map<string, TMarketCellSnapshot>());
  const lastAnimatedVersion = useRef(0);
  const [cellFlashVersions, setCellFlashVersions] = useState<Record<string, number>>({});
  const [rankFlashVersions, setRankFlashVersions] = useState<Record<string, number>>({});
  const rowKey = rows.map((row) => row.code).join('|');

  useLayoutEffect(() => {
    const nextTops = new Map<string, number>();
    const shouldAnimate = updateVersion > 0 && updateVersion !== lastAnimatedVersion.current;
    for (const row of rows) {
      const element = rowElements.current.get(row.code);
      if (!element) continue;
      const top = element.getBoundingClientRect().top;
      const previousTop = previousTops.current.get(row.code);
      nextTops.set(row.code, top);
      if (previousTop === undefined || !shouldAnimate || !movedCodes.includes(row.code)) continue;
      const delta = previousTop - top;
      if (Math.abs(delta) < 1) continue;
      gsap.killTweensOf(element);
      gsap.fromTo(element, { y: delta }, { y: 0, duration: MARKET_ROW_ANIMATION_DURATION, ease: 'power2.out' });
    }
    previousTops.current = nextTops;
    if (shouldAnimate) lastAnimatedVersion.current = updateVersion;
  }, [movedCodes, rowKey, rows, updateVersion]);

  useEffect(() => {
    const nextSnapshots = new Map<string, TMarketCellSnapshot>();
    const changedSet = new Set(changedCodes);
    const changedCellKeys: string[] = [];
    for (const row of rows) {
      const nextSnapshot = getMarketCellSnapshot(row);
      const previousSnapshot = previousCellSnapshots.current.get(row.code);
      nextSnapshots.set(row.code, nextSnapshot);
      if (!previousSnapshot || !changedSet.has(row.code)) continue;
      for (const field of marketCellFields) {
        if (previousSnapshot[field] !== nextSnapshot[field]) changedCellKeys.push(getMarketCellKey(row.code, field));
      }
    }
    previousCellSnapshots.current = nextSnapshots;
    if (changedCellKeys.length) {
      setCellFlashVersions((current) => incrementVersions(current, changedCellKeys));
    }
    if (movedCodes.length) {
      setRankFlashVersions((current) => incrementVersions(current, movedCodes));
    }
  }, [changedCodes, movedCodes, rows, updateVersion]);

  useEffect(() => {
    const elements = rowElements.current;
    return () => {
      for (const element of elements.values()) gsap.killTweensOf(element);
    };
  }, []);

  return (
    <table className={styles.marketTable}>
      <thead>
        <tr>
          <th>序号</th>
          <th>代码</th>
          <th>名称</th>
          <th>
            <button className={styles.sortButton} onClick={onSortChange} type='button'>
              涨跌幅 {sortMark}
            </button>
          </th>
          <th>最新价</th>
          <th>换手率</th>
          <th>成交量</th>
          <th>成交额</th>
          <th>市值</th>
          <th>所属行业</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const versions = getRowFlashVersions(cellFlashVersions, row.code);
          const rankVersion = rankFlashVersions[row.code] ?? 0;
          return (
            <tr
              key={row.code}
              ref={(element) => {
                if (element) rowElements.current.set(row.code, element);
                else rowElements.current.delete(row.code);
              }}
              onClick={() => onOpen(row)}
            >
              <td key={`rank-${rankVersion}`} className={cx(rankVersion > 0 && styles.rankUpdated)}>{index + 1}</td>
              <td>{row.code}</td>
              <td>{row.name}</td>
              <MarketCell version={versions.changePercent} className={tone(row.changePercent)}>{formatPercent(row.changePercent)}</MarketCell>
              <MarketCell version={versions.price} className={tone(row.changePercent)}>{row.price ?? '--'}</MarketCell>
              <MarketCell version={versions.turnoverRate}>{formatPercent(row.turnoverRate)}</MarketCell>
              <MarketCell version={versions.volume}>{formatVolume(row.volume)}</MarketCell>
              <MarketCell version={versions.amount}>{formatMoney(row.amount)}</MarketCell>
              <MarketCell version={versions.marketCap}>{formatMarketCap(row.marketCap)}</MarketCell>
              <MarketCell version={versions.industry}>{row.industry ?? '--'}</MarketCell>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function MarketCell({ version, className, children }: { version: number; className?: string; children: React.ReactNode }) {
  return <td key={version} className={cx(className, version > 0 && styles.cellUpdated)}>{children}</td>;
}

function getRowFlashVersions(versions: Record<string, number>, code: string): TMarketCellSnapshotVersions {
  return {
    changePercent: getCellFlashVersion(versions, code, 'changePercent'),
    price: getCellFlashVersion(versions, code, 'price'),
    turnoverRate: getCellFlashVersion(versions, code, 'turnoverRate'),
    volume: getCellFlashVersion(versions, code, 'volume'),
    amount: getCellFlashVersion(versions, code, 'amount'),
    marketCap: getCellFlashVersion(versions, code, 'marketCap'),
    industry: getCellFlashVersion(versions, code, 'industry'),
  };
}

type TMarketCellSnapshotVersions = Record<TMarketCellField, number>;

function incrementVersions(current: Record<string, number>, keys: string[]) {
  const next = { ...current };
  for (const key of keys) next[key] = (next[key] ?? 0) + 1;
  return next;
}

function getCellFlashVersion(versions: Record<string, number>, code: string, field: TMarketCellField) {
  return versions[getMarketCellKey(code, field)] ?? 0;
}

function getMarketCellKey(code: string, field: TMarketCellField) {
  return `${code}:${field}`;
}

function getMarketCellSnapshot(row: MarketQuoteRow): TMarketCellSnapshot {
  return {
    changePercent: formatPercent(row.changePercent),
    price: String(row.price ?? '--'),
    turnoverRate: formatPercent(row.turnoverRate),
    volume: formatVolume(row.volume),
    amount: formatMoney(row.amount),
    marketCap: formatMarketCap(row.marketCap),
    industry: row.industry ?? '--',
  };
}
