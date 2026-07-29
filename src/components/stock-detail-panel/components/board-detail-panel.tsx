import { message as antdMessage } from 'antd';
import { Layers, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import cx from '../../../shared/cx';
import { isChinaMarketOpen } from '../../../shared/market-time';
import type { BoardConstituent, StockDetail } from '../../../shared/types';
import { useAppStore } from '../../../store/app-store';
import { StockKlineChart } from '../../kline-chart';
import styles from '../index.module.scss';

export function BoardDetailPanel() {
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const board = useAppStore((state) => state.selectedBoard);
  const setSelectedStock = useAppStore((state) => state.setSelectedStock);
  const setStockReturnContext = useAppStore((state) => state.setStockReturnContext);
  const setSelectedBoard = useAppStore((state) => state.setSelectedBoard);
  const setRightPanelTab = useAppStore((state) => state.setRightPanelTab);
  const loadingCodeRef = useRef<string>();
  const quoteTimerRef = useRef<number>();

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

  // ponytail: keep constituent prices / change-percent fresh during market hours.
  // We poll every 15s like the individual stock detail view, and also fetch once
  // immediately so the "--" placeholders are filled even when the original board
  // API response lacked price fields.
  useEffect(() => {
    const codes = (board?.constituents ?? [])
      .map((row) => row.code)
      .filter((code): code is string => Boolean(code))
      .slice(0, 150);
    if (!board?.code || !codes.length) return;
    let alive = true;
    const boardCode = board.code;

    const refreshQuotes = () => {
      getStocksenseApi()
        .getBatchQuotes(codes)
        .then((quotes) => {
          if (!alive || !quotes.length) return;
          const byCode = new Map(
            quotes
              .filter((quote) => quote.code)
              .map((quote) => [quote.code.replace(/^(sh|sz|bj)/i, ''), quote]),
          );
          const current = useAppStore.getState().selectedBoard;
          if (!current || current.code !== boardCode || !current.constituents?.length) return;
          let changed = false;
          const next = current.constituents.map((row) => {
            const quote = byCode.get(row.code);
            if (!quote) return row;
            const price = quote.price === undefined || quote.price === '--' ? row.price : quote.price;
            const changePercent =
              !quote.changePercent || quote.changePercent === '--' ? row.changePercent : quote.changePercent;
            const amount = !quote.turnover || quote.turnover === '--' ? row.amount : quote.turnover;
            const turnover =
              !quote.turnoverRate || quote.turnoverRate === '--' ? row.turnover : String(quote.turnoverRate);
            if (
              price === row.price &&
              changePercent === row.changePercent &&
              amount === row.amount &&
              turnover === row.turnover
            )
              return row;
            changed = true;
            return { ...row, price, changePercent, amount, turnover };
          });
          if (changed) setSelectedBoard({ ...current, constituents: next });
        })
        .catch((error: unknown) => console.error('[board] refresh quotes failed', error));
    };

    refreshQuotes();
    window.clearInterval(quoteTimerRef.current);
    if (isChinaMarketOpen()) {
      quoteTimerRef.current = window.setInterval(refreshQuotes, 15_000);
    }

    return () => {
      alive = false;
      window.clearInterval(quoteTimerRef.current);
    };
  }, [board?.code, board?.constituents?.length, setSelectedBoard]);

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
    setStockReturnContext({ tab: 'board', code: stock.code });
    setSelectedStock(rowSnapshot);
    try {
      setSelectedStock({ ...rowSnapshot, ...(await getStocksenseApi().getStockDetail(stock.code)) });
    } catch (error: unknown) {
      console.error(error);
    }
  };

  return (
    <div className={styles['board-detail']}>
      <div className={cx(styles['stock-header'], styles['board-header'])}>
        <div className={cx(styles['stock-name'], styles['board-title'])}>
          <Layers className={styles['panel-title-icon']} size={16} />
          <span className={styles['board-title-text']}>{board.name}</span>
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
          <div
            className={cx(
              styles['board-change'],
              trendClass(board.changePercent) ?? styles['na'],
            )}
          >
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
  const trend = trendClass(stock.changePercent);
  return (
    <button className={styles['board-stock-item']} onClick={onClick} type='button'>
      <span>
        <b>{stock.name}</b>
        <em>{stock.code}</em>
      </span>
      <span className={styles['board-stock-side']}>
        <strong>{stock.price ?? '--'}</strong>
        <em className={cx(trend ?? styles['na'])}>{stock.changePercent ?? '--'}</em>
      </span>
    </button>
  );
}

function trendClass(value?: string | number) {
  if (value === undefined || value === null || value === '' || value === '--') return undefined;
  return String(value).startsWith('-') ? 'down' : 'up';
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
