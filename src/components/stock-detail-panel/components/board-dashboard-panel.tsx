import { message as antdMessage } from 'antd';
import { Layers, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { IBoardDashboardMetric, IBoardDashboardSnapshot, TBoardDashboardRange } from '../../../shared/types';
import cx from '../../../shared/cx';
import { useAppDataStore, useAppUiStore } from '../../../store/app-store';
import styles from '../index.module.scss';
import { BoardDashboardQuadrant } from './board-dashboard-quadrant';
import { BoardDashboardRankListTab } from './board-dashboard-rank-list-tab';
import { BoardDashboardSkeleton } from './board-dashboard-skeleton';
import { BoardDashboardSummary } from './board-dashboard-summary';
import { BoardDashboardTabs } from './board-dashboard-tabs';

interface IBoardDashboardPanelProps {
  isActive: boolean;
}

export function BoardDashboardPanel({ isActive }: IBoardDashboardPanelProps) {
  const [range, setRange] = useState<TBoardDashboardRange>('today');
  const [snapshot, setSnapshot] = useState<IBoardDashboardSnapshot>();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const setSelectedBoard = useAppDataStore((state) => state.setSelectedBoard);
  const openBoardPanel = useAppUiStore((state) => state.openBoardPanel);

  useEffect(() => {
    if (!isActive) return;
    let alive = true;
    setLoading(true);
    setError(undefined);
    getStocksenseApi()
      .getBoardDashboard(range)
      .then((next) => {
        if (!alive) return;
        setSnapshot(next);
      })
      .catch((loadError: unknown) => {
        if (!alive) return;
        console.error(loadError);
        setError(loadError instanceof Error ? loadError.message : '板块 Dashboard 加载失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [isActive, range]);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setError(undefined);
    try {
      setSnapshot(await getStocksenseApi().getBoardDashboard(range, true));
      window.requestAnimationFrame(() => antdMessage.success('板块 Dashboard 已更新'));
    } catch (refreshError: unknown) {
      console.error(refreshError);
      setError(refreshError instanceof Error ? refreshError.message : '板块 Dashboard 刷新失败');
      window.requestAnimationFrame(() => antdMessage.error('板块 Dashboard 刷新失败'));
    } finally {
      setRefreshing(false);
    }
  };

  const openBoard = (metric: IBoardDashboardMetric) => {
    setSelectedBoard({
      code: metric.boardCode,
      name: metric.boardName,
      changePercent: metric.changePercent === null ? undefined : `${metric.changePercent >= 0 ? '+' : ''}${metric.changePercent.toFixed(2)}%`,
    });
    openBoardPanel();
    getStocksenseApi()
      .getBoardDetail(metric.boardCode, false, metric.boardName)
      .then((detail) => setSelectedBoard({ ...detail, name: detail.name === detail.code ? metric.boardName : detail.name }))
      .catch((detailError: unknown) => console.error('[board-dashboard] open board detail failed', detailError));
  };

  const isBusy = loading || refreshing;

  return (
    <div className={styles['board-dashboard']}>
      <div className={cx(styles['stock-header'], styles['board-dashboard-header'])}>
        <div className={cx(styles['stock-name'], styles['board-title'])}>
          <Layers className={styles['panel-title-icon']} size={16} />
          <span className={styles['board-title-text']}>板块 Dashboard</span>
          <span className={styles.code}>{snapshot?.tradeDate ?? '真实数据'} · 总览</span>
        </div>
        <button
          className={cx(styles['board-refresh'], refreshing && styles.spinning)}
          onClick={() => void refresh()}
          disabled={isBusy}
          title='刷新板块 Dashboard'
          aria-label='刷新板块 Dashboard'
          type='button'
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <BoardDashboardTabs value={range} disabled={isBusy} onChange={setRange} />
      {error ? <div className={styles['board-dashboard-warning']}>{error}</div> : null}

      {loading && !snapshot ? (
        <BoardDashboardSkeleton />
      ) : snapshot && snapshot.rankings.length ? (
        <>
          <BoardDashboardSummary snapshot={snapshot} onOpenBoard={openBoard} />
          <BoardDashboardRankListTab items={snapshot.rankings} range={snapshot.range} onOpenBoard={openBoard} />
          <section className={styles['board-dashboard-section']}>
            <div className={styles['section-title']}>板块四象限 · 资金强度 × 价格强度</div>
            <BoardDashboardQuadrant
              items={snapshot.rankings}
              hotItems={snapshot.hot}
              potentialItems={snapshot.potential}
              avoidItems={snapshot.avoid}
              leaderItems={snapshot.leaders}
              variant='board'
              onOpenBoard={openBoard}
            />
          </section>
          <section className={styles['board-dashboard-section']}>
            <div className={styles['section-title']}>个股四象限 · 龙头资金 × 个股涨幅</div>
            <BoardDashboardQuadrant
              items={snapshot.rankings}
              hotItems={snapshot.hot}
              potentialItems={snapshot.potential}
              avoidItems={snapshot.avoid}
              leaderItems={snapshot.leaders}
              variant='stock'
              onOpenBoard={openBoard}
            />
          </section>
        </>
      ) : (
        <div className={styles['empty-list']}>暂无板块 Dashboard 数据</div>
      )}
    </div>
  );
}
