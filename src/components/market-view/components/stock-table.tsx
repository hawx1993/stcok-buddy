import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import type { MarketQuoteRow } from '../../../shared/types';
import cx from '../../../shared/cx';
import { formatMarketCap, formatMoney, formatPercent, formatVolume, tone } from '../market-format';
import styles from '../index.module.scss';

const MARKET_ROW_HEIGHT = 34;
const MARKET_ROW_OVERSCAN = 32;
const MARKET_REORDER_ANIMATION_MS = 450;

// 仅第 4-9 列（最新价/涨跌幅/换手率/成交量/成交额/市值）在数据变化时闪烁高亮
const flashCellFields: TMarketCellField[] = [
  'price',
  'changePercent',
  'turnoverRate',
  'volume',
  'amount',
  'marketCap',
];

export type TSortDirection = 'asc' | 'desc' | undefined;
export type TMarketCellField = 'changePercent' | 'price' | 'turnoverRate' | 'volume' | 'amount' | 'marketCap' | 'industry';
type TMarketCellSnapshot = Record<TMarketCellField, string>;

export function StockTable({
  rows,
  scrollRef,
  sortField,
  sortDirection,
  updateVersion,
  reorderingVersion,
  changedCodes,
  onSortChange,
  onOpen,
}: {
  rows: MarketQuoteRow[];
  scrollRef: RefObject<HTMLDivElement>;
  sortField: TMarketCellField | undefined;
  sortDirection: TSortDirection;
  updateVersion: number;
  reorderingVersion: number;
  changedCodes: string[];
  onSortChange(field: TMarketCellField): void;
  onOpen(row: MarketQuoteRow): void;
}) {
  const sortMark = (field: TMarketCellField) =>
    field === sortField && sortDirection ? (sortDirection === 'asc' ? '↑' : '↓') : '↕';
  const previousCellSnapshots = useRef(new Map<string, TMarketCellSnapshot>());
  const previousRowCodesRef = useRef<string[]>([]);
  const previousStartByCodeRef = useRef<Map<string, number>>(new Map());
  const animationTimeoutsRef = useRef<Map<string, number>>(new Map());
  const rowRefsMap = useRef<Map<string, HTMLDivElement>>(new Map());
  const [cellFlashVersions, setCellFlashVersions] = useState<Record<string, number>>({});
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
      for (const field of flashCellFields) {
        if (previousSnapshot[field] !== nextSnapshot[field]) changedCellKeys.push(getMarketCellKey(row.code, field));
      }
    }
    previousCellSnapshots.current = nextSnapshots;
    if (changedCellKeys.length) {
      setCellFlashVersions((current) => incrementVersions(current, changedCellKeys));
    }
  }, [changedCodes, rows, updateVersion]);

  // FLIP 动画：用 CSS 变量 --market-row-start 作为位置基准（不受滚动/布局影响）
  useLayoutEffect(() => {
    const currentCodes = rows.map((row) => row.code);
    const prevCodes = previousRowCodesRef.current;
    const codesChanged =
      currentCodes.length !== prevCodes.length ||
      currentCodes.some((code, index) => code !== prevCodes[index]);
    if (!codesChanged) return;

    const currentCodeSet = new Set(currentCodes);
    const animateRefs: Array<{ el: HTMLDivElement; code: string; delta: number }> = [];

    rowRefsMap.current.forEach((el, code) => {
      if (!el || !currentCodeSet.has(code)) return;
      const startValue = el.style.getPropertyValue('--market-row-start');
      const newStart = Number.parseFloat(startValue);
      if (!Number.isFinite(newStart)) return;
      const oldStart = previousStartByCodeRef.current.get(code);
      if (oldStart === undefined) {
        previousStartByCodeRef.current.set(code, newStart);
        return;
      }
      const delta = oldStart - newStart;
      previousStartByCodeRef.current.set(code, newStart);
      if (delta === 0) return;
      animateRefs.push({ el, code, delta });
    });

    previousStartByCodeRef.current.forEach((_, code) => {
      if (!currentCodeSet.has(code)) previousStartByCodeRef.current.delete(code);
    });

    if (animateRefs.length === 0) {
      previousRowCodesRef.current = currentCodes;
      return;
    }

    // 取消旧动画
    animationTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    animationTimeoutsRef.current.clear();
    rowRefsMap.current.forEach((el) => {
      if (!el) return;
      el.classList.remove(styles.marketTableRowReordering);
      el.style.removeProperty('--market-row-delta');
    });

    // 启动新动画
    animateRefs.forEach(({ el, delta }) => {
      el.style.setProperty('--market-row-delta', `${delta}px`);
      el.classList.add(styles.marketTableRowReordering);
    });
    void document.body.offsetHeight;

    animateRefs.forEach(({ el, code }) => {
      const timeoutId = window.setTimeout(() => {
        el.classList.remove(styles.marketTableRowReordering);
        el.style.removeProperty('--market-row-delta');
        animationTimeoutsRef.current.delete(code);
      }, MARKET_REORDER_ANIMATION_MS + 50);
      animationTimeoutsRef.current.set(code, timeoutId);
    });

    previousRowCodesRef.current = currentCodes;
  }, [rows, reorderingVersion]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const handleScroll = () => {
      animationTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      animationTimeoutsRef.current.clear();
      rowRefsMap.current.forEach((el) => {
        if (!el) return;
        el.classList.remove(styles.marketTableRowReordering);
        el.style.removeProperty('--market-row-delta');
      });
    };
    element.addEventListener('scroll', handleScroll, { passive: true });
    return () => element.removeEventListener('scroll', handleScroll);
  }, [scrollRef]);

  useEffect(() => {
    return () => {
      animationTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      animationTimeoutsRef.current.clear();
    };
  }, []);

  return (
    <div className={styles.marketTable} role='table'>
      <div className={styles.marketTableHead} role='rowgroup'>
        <div className={styles.marketTableRow} role='row'>
          <div role='columnheader'>序号</div>
          <div role='columnheader'>代码</div>
          <div role='columnheader'>名称</div>
          <div role='columnheader'>最新价</div>
          <div role='columnheader'>
            <button className={styles.sortButton} onClick={() => onSortChange('changePercent')} type='button'>
              涨跌幅 {sortMark('changePercent')}
            </button>
          </div>
          <div role='columnheader'>
            <button className={styles.sortButton} onClick={() => onSortChange('turnoverRate')} type='button'>
              换手率 {sortMark('turnoverRate')}
            </button>
          </div>
          <div role='columnheader'>
            <button className={styles.sortButton} onClick={() => onSortChange('volume')} type='button'>
              成交量 {sortMark('volume')}
            </button>
          </div>
          <div role='columnheader'>
            <button className={styles.sortButton} onClick={() => onSortChange('amount')} type='button'>
              成交额 {sortMark('amount')}
            </button>
          </div>
          <div role='columnheader'>
            <button className={styles.sortButton} onClick={() => onSortChange('marketCap')} type='button'>
              市值 {sortMark('marketCap')}
            </button>
          </div>
          <div role='columnheader'>所属行业</div>
        </div>
      </div>
      <div className={styles.marketTableBody} role='rowgroup' style={{ height: rowVirtualizer.getTotalSize() }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;
          const versions = getRowFlashVersions(cellFlashVersions, row.code);
          const refSetter = (el: HTMLDivElement | null) => {
            if (el) rowRefsMap.current.set(row.code, el);
            else rowRefsMap.current.delete(row.code);
          };
          return (
            <div
              key={row.code}
              ref={refSetter}
              className={styles.marketTableRow}
              role='row'
              style={{ '--market-row-start': `${virtualRow.start}px` } as CSSProperties}
              onClick={() => onOpen(row)}
            >
              <div role='cell'>{virtualRow.index + 1}</div>
              <div role='cell'>{row.code}</div>
              <div role='cell'>{row.name}</div>
              <MarketCell version={versions.price} className={tone(row.changePercent)}>{row.price ?? '--'}</MarketCell>
              <MarketCell version={versions.changePercent} className={tone(row.changePercent)}>{formatPercent(row.changePercent)}</MarketCell>
              <MarketCell version={versions.turnoverRate}>{formatPercent(row.turnoverRate)}</MarketCell>
              <MarketCell version={versions.volume}>{formatVolume(row.volume)}</MarketCell>
              <MarketCell version={versions.amount}>{formatMoney(row.amount)}</MarketCell>
              <MarketCell version={versions.marketCap}>{formatMarketCap(row.marketCap)}</MarketCell>
              <div role='cell'>{row.industry ?? '--'}</div>
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
    industry: 0,
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