import { message as antdMessage } from 'antd';
import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import cx from '../../../shared/cx';
import type { BoardConstituent, StockDetail } from '../../../shared/types';
import { useAppStore } from '../../../store/app-store';
import { StockKlineChart } from '../../kline-chart';
import styles from '../index.module.scss';

export function BoardDetailPanel() {
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const board = useAppStore((state) => state.selectedBoard);
  const setSelectedStock = useAppStore((state) => state.setSelectedStock);
  const setSelectedBoard = useAppStore((state) => state.setSelectedBoard);
  const setRightPanelTab = useAppStore((state) => state.setRightPanelTab);
  const loadingCodeRef = useRef<string>();

  useEffect(() => {
    if (board?.kline?.length || board?.constituents?.length) {
      setInitialLoading(false);
      return;
    }
    if (board?.code && board.code !== loadingCodeRef.current && loadingCodeRef.current !== undefined)
      setInitialLoading(false);
  }, [board]);

  useEffect(() => {
    setInitialLoading(true);
    loadingCodeRef.current = board?.code;
  }, [board?.code]);

  useEffect(() => {
    if (!initialLoading) return;
    const id = window.setTimeout(() => setInitialLoading(false), 20_000);
    return () => window.clearTimeout(id);
  }, [initialLoading, board?.code]);

  if (!board) return null;
  const stocks = board.constituents ?? [];
  const isLoading = initialLoading && !refreshing;

  const refreshBoard = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const detail = await getStocksenseApi().getBoardDetail(board.code, true, board.name);
      setSelectedBoard({
        ...detail,
        name: detail.name === detail.code ? board.name : detail.name,
        changePercent: detail.changePercent ?? board.changePercent,
      });
      window.requestAnimationFrame(() => antdMessage.success('更新成功'));
    } catch (error: unknown) {
      console.error(error);
      window.requestAnimationFrame(() => antdMessage.error('刷新失败，请稍后再试'));
    } finally {
      setRefreshing(false);
    }
  };

  const openBoardStock = async (stock: BoardConstituent) => {
    const rowSnapshot: StockDetail = {
      ...stock,
      turnover: stock.turnover ?? stock.amount,
      summary: `${board.name}板块成分股。`,
    };
    setRightPanelTab('stock');
    setSelectedStock(rowSnapshot);
    try {
      setSelectedStock({ ...rowSnapshot, ...(await getStocksenseApi().getStockDetail(stock.code)) });
    } catch (error: unknown) {
      console.error(error);
    }
  };

  return (
    <div className={styles['board-detail']}>
      <div className={styles['stock-header']}>
        <div className={styles['stock-name']}>
          {board.name}
          <span className={styles.code}>{board.code} · 板块</span>
        </div>
        <div className={styles['board-header-side']}>
          <button
            className={cx(styles['board-refresh'], refreshing && styles.spinning)}
            onClick={() => void refreshBoard()}
            disabled={refreshing}
            title='刷新板块详情'
            aria-label='刷新板块详情'
            type='button'
          >
            <RefreshCw size={14} />
          </button>
          <div className={cx(styles['board-change'], String(board.changePercent).startsWith('-') ? 'down' : 'up')}>
            {board.changePercent ?? '--'}
          </div>
        </div>
      </div>
      <div className={styles['board-kline-box']}>
        {board.kline?.length ? (
          <StockKlineChart
            stock={{ code: board.code, name: board.name }}
            data={board.kline}
            height='100%'
            showLegend={false}
            staticData
          />
        ) : isLoading ? (
          <div className={styles['empty-list']}>加载中…</div>
        ) : (
          <div className={styles['empty-list']}>暂无图表数据</div>
        )}
      </div>
      <div className={styles['board-stock-section']}>
        <div className={styles['section-title']}>
          成分股 <span>{stocks.length} 只</span>
        </div>
        <div className={styles['board-stock-list']}>
          {isLoading || refreshing ? (
            <BoardStockSkeleton />
          ) : stocks.length ? (
            stocks.map((stock) => (
              <BoardStockItem key={stock.code} stock={stock} onClick={() => void openBoardStock(stock)} />
            ))
          ) : (
            <div className={styles['empty-list']}>暂无成分股数据</div>
          )}
        </div>
      </div>
    </div>
  );
}

interface IBoardStockItemProps {
  stock: BoardConstituent;
  onClick(): void;
}

function BoardStockItem({ stock, onClick }: IBoardStockItemProps) {
  return (
    <button className={styles['board-stock-item']} onClick={onClick} type='button'>
      <span>
        <b>{stock.name}</b>
        <em>{stock.code}</em>
      </span>
      <span className={styles['board-stock-side']}>
        <strong>{stock.price ?? '--'}</strong>
        <em className={String(stock.changePercent).startsWith('-') ? 'down' : 'up'}>{stock.changePercent ?? '--'}</em>
      </span>
    </button>
  );
}

function BoardStockSkeleton() {
  return (
    <>
      {Array.from({ length: 8 }, (_, index) => (
        <div className={styles['board-stock-skeleton']} key={index}>
          <span />
          <em />
        </div>
      ))}
    </>
  );
}
