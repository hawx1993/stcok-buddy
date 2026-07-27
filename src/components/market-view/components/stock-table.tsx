import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ReactNode, RefObject } from 'react';
import type { MarketQuoteRow } from '../../../shared/types';
import cx from '../../../shared/cx';
import { formatMarketCap, formatMoney, formatPercent, formatVolume, tone } from '../market-format';
import styles from '../index.module.scss';

const MARKET_ROW_HEIGHT = 34;
const MARKET_ROW_OVERSCAN = 32;
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
  scrollRef,
  sortDirection,
  updateVersion,
  changedCodes,
  movedCodes,
  onSortChange,
  onOpen,
}: {
  rows: MarketQuoteRow[];
  scrollRef: RefObject<HTMLDivElement>;
  sortDirection: TSortDirection;
  updateVersion: number;
  changedCodes: string[];
  movedCodes: string[];
  onSortChange(): void;
  onOpen(row: MarketQuoteRow): void;
}) {
  const sortMark = sortDirection === 'asc' ? '↑' : sortDirection === 'desc' ? '↓' : '↕';
  const previousCellSnapshots = useRef(new Map<string, TMarketCellSnapshot>());
  const [cellFlashVersions, setCellFlashVersions] = useState<Record<string, number>>({});
  const [rankFlashVersions, setRankFlashVersions] = useState<Record<string, number>>({});
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => MARKET_ROW_HEIGHT,
    overscan: MARKET_ROW_OVERSCAN,
  });

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

  return (
    <div className={styles.marketTable} role='table'>
      <div className={styles.marketTableHead} role='rowgroup'>
        <div className={styles.marketTableRow} role='row'>
          <div role='columnheader'>序号</div>
          <div role='columnheader'>代码</div>
          <div role='columnheader'>名称</div>
          <div role='columnheader'>
            <button className={styles.sortButton} onClick={onSortChange} type='button'>
              涨跌幅 {sortMark}
            </button>
          </div>
          <div role='columnheader'>最新价</div>
          <div role='columnheader'>换手率</div>
          <div role='columnheader'>成交量</div>
          <div role='columnheader'>成交额</div>
          <div role='columnheader'>市值</div>
          <div role='columnheader'>所属行业</div>
        </div>
      </div>
      <div className={styles.marketTableBody} role='rowgroup' style={{ height: rowVirtualizer.getTotalSize() }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;
          const versions = getRowFlashVersions(cellFlashVersions, row.code);
          const rankVersion = rankFlashVersions[row.code] ?? 0;
          return (
            <div
              key={row.code}
              className={styles.marketTableRow}
              role='row'
              style={{ transform: `translateY(${virtualRow.start}px)` }}
              onClick={() => onOpen(row)}
            >
              <div key={`rank-${rankVersion}`} className={cx(rankVersion > 0 && styles.rankUpdated)} role='cell'>
                {virtualRow.index + 1}
              </div>
              <div role='cell'>{row.code}</div>
              <div role='cell'>{row.name}</div>
              <MarketCell version={versions.changePercent} className={tone(row.changePercent)}>{formatPercent(row.changePercent)}</MarketCell>
              <MarketCell version={versions.price} className={tone(row.changePercent)}>{row.price ?? '--'}</MarketCell>
              <MarketCell version={versions.turnoverRate}>{formatPercent(row.turnoverRate)}</MarketCell>
              <MarketCell version={versions.volume}>{formatVolume(row.volume)}</MarketCell>
              <MarketCell version={versions.amount}>{formatMoney(row.amount)}</MarketCell>
              <MarketCell version={versions.marketCap}>{formatMarketCap(row.marketCap)}</MarketCell>
              <MarketCell version={versions.industry}>{row.industry ?? '--'}</MarketCell>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MarketCell({ version, className, children }: { version: number; className?: string; children: ReactNode }) {
  return <div key={version} className={cx(className, version > 0 && styles.cellUpdated)} role='cell'>{children}</div>;
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
