import { Popover } from 'antd';
import type { IBoardDashboardMetric, IBoardLeaderCandidate } from '../../../shared/types';
import cx from '../../../shared/cx';
import styles from '../index.module.scss';

interface IBoardDashboardQuadrantProps {
  items: IBoardDashboardMetric[];
  hotItems?: IBoardDashboardMetric[];
  potentialItems?: IBoardDashboardMetric[];
  avoidItems?: IBoardDashboardMetric[];
  leaderItems?: IBoardDashboardMetric[];
  variant: 'board' | 'stock';
  onOpenBoard(metric: IBoardDashboardMetric): void;
}

interface ILeaderPoint {
  board: IBoardDashboardMetric;
  leader: IBoardLeaderCandidate;
  rank: number;
  order: number;
}

type TBoardDashboardQuadrantPoint =
  | {
      type: 'board';
      board: IBoardDashboardMetric;
      x: number;
      y: number;
      key: string;
    }
  | {
      type: 'leader';
      board: IBoardDashboardMetric;
      leader: IBoardLeaderCandidate;
      rank: number;
      x: number;
      y: number;
      key: string;
    };

const MIN_STOCK_POINTS = 10;
const MAX_STOCK_POINTS = 40;
const PRIMARY_LEADER_LIMIT = 3;

export function BoardDashboardQuadrant({
  items,
  hotItems = [],
  potentialItems = [],
  avoidItems = [],
  leaderItems = [],
  variant,
  onOpenBoard,
}: IBoardDashboardQuadrantProps) {
  const boardItems = collectBoardItems(hotItems, potentialItems, avoidItems, leaderItems);
  const points =
    variant === 'board' ? collectBoardPoints(boardItems) : buildLeaderPoints(boardItems.length ? boardItems : items);

  if (!points.length) {
    return (
      <div className={styles['empty-list']}>{variant === 'board' ? '暂无板块四象限数据' : '暂无个股四象限数据'}</div>
    );
  }

  return (
    <div
      className={cx(
        styles['board-dashboard-quadrant'],
        variant === 'board' ? styles['board-dashboard-quadrant-board'] : styles['board-dashboard-quadrant-stock'],
      )}
      aria-label={variant === 'board' ? '板块资金强度和价格强度四象限' : '个股资金强度和价格强度四象限'}
    >
      <div className={styles['quadrant-axis-x']} />
      <div className={styles['quadrant-axis-y']} />
      <span className={cx(styles['quadrant-label'], styles['quadrant-label-hot'])}>风头正盛</span>
      <span className={cx(styles['quadrant-label'], styles['quadrant-label-potential'])}>潜力蓄势</span>
      <span className={cx(styles['quadrant-label'], styles['quadrant-label-risk'])}>谨慎追高</span>
      <span className={cx(styles['quadrant-label'], styles['quadrant-label-avoid'])}>回避观察</span>
      {points.map((point) => {
        const pointButton = (
          <button
            key={point.key}
            type='button'
            className={cx(
              styles['quadrant-point'],
              styles[`bucket-${point.board.bucket}`],
              point.type === 'leader' ? styles['quadrant-stock-point'] : styles['quadrant-board-point'],
            )}
            style={{ left: `${point.x}%`, top: `${point.y}%` }}
            data-tooltip={formatTooltip(point)}
            title={point.type === 'leader' ? undefined : formatTitle(point)}
            aria-label={formatAriaLabel(point)}
            onClick={() => onOpenBoard(point.board)}
          >
            {formatPointLabel(point)}
          </button>
        );
        return point.type === 'leader' ? (
          <Popover
            key={point.key}
            content={renderLeaderCard(point)}
            trigger='hover'
            placement='top'
            overlayClassName={styles['quadrant-stock-popover']}
          >
            {pointButton}
          </Popover>
        ) : (
          pointButton
        );
      })}
    </div>
  );
}

function collectBoardItems(
  hotItems: IBoardDashboardMetric[],
  potentialItems: IBoardDashboardMetric[],
  avoidItems: IBoardDashboardMetric[],
  leaderItems: IBoardDashboardMetric[],
): IBoardDashboardMetric[] {
  const seen = new Set<string>();
  const result: IBoardDashboardMetric[] = [];
  for (const item of [...hotItems, ...potentialItems, ...avoidItems, ...leaderItems]) {
    if (seen.has(item.boardCode)) continue;
    seen.add(item.boardCode);
    result.push(item);
  }
  return result;
}

function collectBoardPoints(items: IBoardDashboardMetric[]): TBoardDashboardQuadrantPoint[] {
  const points: TBoardDashboardQuadrantPoint[] = [];
  items.forEach((item, index) => {
    const { x, y } = boardPoint(item, index);
    points.push({ type: 'board', board: item, x, y, key: `board-${item.boardCode}` });
  });
  return points;
}

function boardPoint(item: IBoardDashboardMetric, index: number): { x: number; y: number } {
  if (item.bucket === 'hot') return toHotPoint(item, index);
  if (item.bucket === 'avoid') return toAvoidPoint(item, index);
  if (item.bucket === 'leader') return toLeaderPoint(item, index);
  return toPotentialPoint(item, index);
}

function toHotPoint(item: IBoardDashboardMetric, index: number): { x: number; y: number } {
  return quadrantPoint(item, 68 + offsetColumn(index, 24), 18 + offsetRow(index, 24), {
    minX: 54,
    maxX: 94,
    minY: 6,
    maxY: 46,
  });
}

function toPotentialPoint(item: IBoardDashboardMetric, index: number): { x: number; y: number } {
  return quadrantPoint(item, 62 + offsetColumn(index, 28), 62 + offsetRow(index, 28), {
    minX: 54,
    maxX: 94,
    minY: 54,
    maxY: 94,
  });
}

function toAvoidPoint(item: IBoardDashboardMetric, index: number): { x: number; y: number } {
  return quadrantPoint(item, 14 + offsetColumn(index, 28), 62 + offsetRow(index, 28), {
    minX: 6,
    maxX: 46,
    minY: 54,
    maxY: 94,
  });
}

function toLeaderPoint(item: IBoardDashboardMetric, index: number): { x: number; y: number } {
  return quadrantPoint(item, 14 + offsetColumn(index, 28), 18 + offsetRow(index, 24), {
    minX: 6,
    maxX: 46,
    minY: 6,
    maxY: 46,
  });
}

function quadrantPoint(
  item: IBoardDashboardMetric,
  fallbackX: number,
  fallbackY: number,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
): { x: number; y: number } {
  return {
    x: clampInRange(item.fundScore ?? fallbackX, bounds.minX, bounds.maxX),
    y: clampInRange(100 - (item.momentumScore ?? 100 - fallbackY), bounds.minY, bounds.maxY),
  };
}

function clampInRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function offsetColumn(index: number, width: number): number {
  return (index % 3) * (width / 2);
}

function offsetRow(index: number, height: number): number {
  return (Math.floor(index / 3) % 4) * (height / 3);
}

function buildLeaderPoints(items: IBoardDashboardMetric[]): TBoardDashboardQuadrantPoint[] {
  const candidateBoards = prioritizeBoards(items);
  const primary = collectUniqueLeaderPoints(candidateBoards, PRIMARY_LEADER_LIMIT, MAX_STOCK_POINTS);
  if (primary.length >= MIN_STOCK_POINTS) return primary.map(toLeaderQuadrantPoint);

  return collectUniqueLeaderPoints(candidateBoards, Number.POSITIVE_INFINITY, MAX_STOCK_POINTS).map(
    toLeaderQuadrantPoint,
  );
}

function toLeaderQuadrantPoint(point: ILeaderPoint): TBoardDashboardQuadrantPoint {
  const stockX =
    point.leader.mainNetInflow === null || point.leader.mainNetInflow === undefined
      ? (point.board.fundScore ?? 50)
      : normalizeSigned(point.leader.mainNetInflow, 100000000);
  const stockY =
    point.leader.changePercent === null || point.leader.changePercent === undefined
      ? (point.board.momentumScore ?? 50)
      : normalizeSigned(point.leader.changePercent, 10);
  const { x, y } = spreadStockPoint(stockX, 100 - stockY, point.order);
  return {
    type: 'leader',
    board: point.board,
    leader: point.leader,
    rank: point.rank,
    x,
    y,
    key: `leader-${point.board.boardCode}-${point.leader.code}`,
  };
}

function spreadStockPoint(baseX: number, baseY: number, order: number): { x: number; y: number } {
  const columnOffset = ((order % 5) - 2) * 3.8;
  const rowOffset = ((Math.floor(order / 5) % 5) - 2) * 3.2;
  return {
    x: clampPoint(baseX + columnOffset),
    y: clampPoint(baseY + rowOffset),
  };
}

function prioritizeBoards(items: IBoardDashboardMetric[]): IBoardDashboardMetric[] {
  return [...items].sort((left, right) => {
    const leftPotential = left.bucket === 'potential' ? 1 : 0;
    const rightPotential = right.bucket === 'potential' ? 1 : 0;
    return rightPotential - leftPotential || (right.rawScore ?? -Infinity) - (left.rawScore ?? -Infinity);
  });
}

function collectUniqueLeaderPoints(
  boards: IBoardDashboardMetric[],
  leaderLimit: number,
  maxPoints: number,
): ILeaderPoint[] {
  const seen = new Set<string>();
  const points: ILeaderPoint[] = [];
  for (const board of boards) {
    for (const point of createLeaderPoints(board, leaderLimit, points.length)) {
      if (seen.has(point.leader.code)) continue;
      seen.add(point.leader.code);
      points.push(point);
      if (points.length >= maxPoints) return points;
    }
  }
  return points;
}

function createLeaderPoints(board: IBoardDashboardMetric, limit: number, startOrder: number): ILeaderPoint[] {
  return board.leaders.slice(0, Number.isFinite(limit) ? limit : board.leaders.length).map((leader, index) => ({
    board,
    leader,
    rank: index + 1,
    order: startOrder + index,
  }));
}

function formatPointLabel(point: TBoardDashboardQuadrantPoint): string | number {
  if (point.type === 'leader') return '';
  return point.board.heatRank ?? '板';
}

function renderLeaderCard(point: Extract<TBoardDashboardQuadrantPoint, { type: 'leader' }>) {
  const rows = [
    ['股票代码', point.leader.code],
    ['现价', formatPrice(point.leader.price)],
    ['涨跌幅', formatPercent(point.leader.changePercent ?? null)],
    ['所属板块', point.board.boardName],
    ['上榜理由', point.leader.reason],
  ];

  return (
    <div className={styles['quadrant-stock-card']}>
      <div className={styles['quadrant-stock-card-title']}>{point.leader.name}</div>
      {rows.map(([label, value]) => (
        <div key={label} className={styles['quadrant-stock-card-row']}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function formatTooltip(point: TBoardDashboardQuadrantPoint): string {
  if (point.type === 'leader') return `${point.leader.name}｜${point.board.boardName}`;
  return `${point.board.boardName}｜${formatBoardDescription(point.board)}`;
}

function formatTitle(point: TBoardDashboardQuadrantPoint): string {
  if (point.type === 'leader') return `${point.leader.name}｜${point.board.boardName} 龙${point.rank}`;
  return `${point.board.boardName}｜${formatPercent(point.board.changePercent)}｜${formatMoney(point.board.mainNetInflow)}`;
}

function formatAriaLabel(point: TBoardDashboardQuadrantPoint): string {
  const strength = `资金强度 ${formatScore(point.x)}，价格强度 ${formatScore(100 - point.y)}`;
  if (point.type === 'leader') return `${point.board.boardName}龙${point.rank}，${point.leader.name}，${strength}`;
  return `${point.board.boardName}，${formatBoardDescription(point.board)}，${strength}`;
}

function formatBoardDescription(item: IBoardDashboardMetric): string {
  const kindLabel = item.boardKind === 'industry' ? '行业' : item.boardKind === 'concept' ? '概念' : '';
  return kindLabel ? `${kindLabel} · ${item.reason}` : item.reason;
}

function formatMoney(value: number | null): string {
  if (value === null) return '--';
  return `${value >= 0 ? '+' : ''}${(value / 100000000).toFixed(2)}亿`;
}

function formatPercent(value: number | null): string {
  if (value === null) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) return '--';
  return value.toFixed(2);
}

function clampPoint(value: number): number {
  return Math.min(96, Math.max(4, value));
}

function normalizeSigned(value: number, scale: number): number {
  return Math.min(100, Math.max(0, 50 + (value / scale) * 50));
}

function formatScore(value: number): string {
  return value.toFixed(0);
}
