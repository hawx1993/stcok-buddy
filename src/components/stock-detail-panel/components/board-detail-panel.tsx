import { message as antdMessage } from 'antd';
import { ArrowLeft, Layers, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import cx from '../../../shared/cx';
import { isChinaMarketOpen } from '../../../shared/market-time';
import type { BoardConstituent, StockDetail } from '../../../shared/types';
import { useAppDataStore, useAppUiStore } from '../../../store/app-store';
import { StockKlineChart } from '../../kline-chart';
import { formatMoney, formatMarketCap, formatPercent, formatVolume } from '../../market-view/market-format';
import styles from '../index.module.scss';

export function BoardDetailPanel() {
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const board = useAppDataStore((state) => state.selectedBoard);
  const setSelectedStock = useAppDataStore((state) => state.setSelectedStock);
  const setStockReturnContext = useAppDataStore((state) => state.setStockReturnContext);
  const setSelectedBoard = useAppDataStore((state) => state.setSelectedBoard);
  const setRightPanelTab = useAppUiStore((state) => state.setRightPanelTab);
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
              .map((quote) => [normalizeBoardStockCode(quote.code), quote]),
          );
          const current = useAppDataStore.getState().selectedBoard;
          if (!current || current.code !== boardCode || !current.constituents?.length) return;
          let changed = false;
          const next = current.constituents.map((row) => {
            const quote = byCode.get(normalizeBoardStockCode(row.code));
            if (!quote) return row;
            const price = isEmptyQuoteField(quote.price) ? row.price : quote.price;
            const changePercent = isEmptyQuoteField(quote.changePercent) ? row.changePercent : quote.changePercent;
            const amount = isEmptyQuoteField(quote.turnover) ? row.amount : quote.turnover;
            const marketCap = isEmptyQuoteField(quote.marketCap) ? row.marketCap : quote.marketCap;
            const turnoverRate = isEmptyQuoteField(quote.turnoverRate) ? row.turnoverRate : String(quote.turnoverRate);
            const volume = isEmptyQuoteField(quote.volume) ? row.volume : quote.volume;
            const turnover = turnoverRate === undefined ? row.turnover : String(turnoverRate);
            if (
              price === row.price &&
              changePercent === row.changePercent &&
              amount === row.amount &&
              marketCap === row.marketCap &&
              turnoverRate === row.turnoverRate &&
              volume === row.volume &&
              turnover === row.turnover
            )
              return row;
            changed = true;
            return { ...row, price, changePercent, amount, marketCap, turnoverRate, volume, turnover };
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

  const stocks = board?.constituents ?? [];
  const sortedStocks = useMemo(() => sortBoardConstituents(stocks), [stocks]);
  const showMainNetInflow = useMemo(() => hasMainNetInflowData(stocks), [stocks]);
  if (!board) return null;
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
      code: stock.code,
      name: stock.name,
      price: stock.price,
      changePercent: stock.changePercent,
      marketCap: formatMarketCap(stock.marketCap),
      volume: formatVolume(stock.volume),
      turnover: formatPlainValue(stock.turnover ?? stock.amount),
      turnoverRate: stock.turnoverRate,
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

  const returnToDashboard = () => {
    setSelectedBoard(undefined);
  };

  return (
    <div className={styles['board-detail']}>
      <div className={cx(styles['stock-header'], styles['board-header'])}>
        <div className={cx(styles['stock-name'], styles['board-title'])}>
          <button
            className={styles['board-dashboard-back']}
            onClick={returnToDashboard}
            type='button'
            title='返回板块 Dashboard'
            aria-label='返回板块 Dashboard'
          >
            <ArrowLeft size={13} />
            <span>Dashboard</span>
          </button>
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
          ) : sortedStocks.length ? (
            <div className={styles['board-stock-table']}>
              <div className={cx(
                styles['board-stock-row'],
                showMainNetInflow && styles['board-stock-row-with-flow'],
                styles['board-stock-head'],
              )}>
                <span className={cx(styles['board-stock-cell'], styles['board-stock-name'])}>名称</span>
                <span className={styles['board-stock-cell']}>最新价</span>
                <span className={styles['board-stock-cell']}>涨幅</span>
                <span className={styles['board-stock-cell']}>总市值</span>
                {showMainNetInflow ? <span className={styles['board-stock-cell']}>主力净流入</span> : null}
                <span className={styles['board-stock-cell']}>换手率</span>
                <span className={cx(styles['board-stock-cell'], styles['board-stock-volume'])}>成交量</span>
              </div>
              {sortedStocks.map((stock) => (
                <BoardStockItem
                  key={stock.code}
                  stock={stock}
                  showMainNetInflow={showMainNetInflow}
                  onClick={() => void openBoardStock(stock)}
                />
              ))}
            </div>
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
  showMainNetInflow: boolean;
  onClick(): void;
}

function BoardStockItem({ stock, showMainNetInflow, onClick }: IBoardStockItemProps) {
  const trend = trendClass(stock.changePercent);
  const flowTrend = trendClass(stock.mainNetInflow);
  return (
    <button
      className={cx(styles['board-stock-row'], showMainNetInflow && styles['board-stock-row-with-flow'])}
      onClick={onClick}
      type='button'
    >
      <span className={cx(styles['board-stock-cell'], styles['board-stock-name'])}>
        <b>{stock.name}</b>
        <em>{stock.code}</em>
      </span>
      <span className={styles['board-stock-cell']}>{formatPlainValue(stock.price)}</span>
      <span className={cx(styles['board-stock-cell'], trend ?? styles['na'])}>{formatPercent(stock.changePercent)}</span>
      <span className={styles['board-stock-cell']}>{formatMarketCap(stock.marketCap)}</span>
      {showMainNetInflow ? (
        <span className={cx(styles['board-stock-cell'], flowTrend ?? styles['na'])}>{formatMoney(stock.mainNetInflow)}</span>
      ) : null}
      <span className={styles['board-stock-cell']}>{formatRatioPercent(stock.turnoverRate ?? stock.turnover)}</span>
      <span className={cx(styles['board-stock-cell'], styles['board-stock-volume'])}>{formatVolume(stock.volume)}</span>
    </button>
  );
}

export function hasMainNetInflowData(stocks: BoardConstituent[]) {
  return stocks.some((stock) => !isMissingBoardValue(stock.mainNetInflow));
}

export function sortBoardConstituents(stocks: BoardConstituent[]) {
  return [...stocks].sort(
    (left, right) =>
      parseConstituentChange(right.changePercent) - parseConstituentChange(left.changePercent) ||
      left.code.localeCompare(right.code),
  );
}

function parseConstituentChange(value: unknown) {
  const parsed = Number.parseFloat(String(value ?? '').replace('%', ''));
  return Number.isFinite(parsed) ? parsed : -Infinity;
}

function isEmptyQuoteField(value: unknown) {
  return value === undefined || value === null || value === '' || value === '--';
}

function isMissingBoardValue(value: unknown) {
  if (value === undefined || value === null) return true;
  const text = String(value).trim();
  return !text || text === '--';
}

function normalizeBoardStockCode(value: string) {
  return value.replace(/^(sh|sz|bj)/i, '').replace(/\.(SH|SZ|BJ)$/i, '');
}

function formatPlainValue(value: unknown) {
  return value === undefined || value === null || value === '' ? '--' : String(value);
}

function formatRatioPercent(value: unknown) {
  if (value === undefined || value === null || value === '') return '--';
  const text = String(value);
  if (text === '--' || text.includes('%')) return text;
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? `${parsed.toFixed(2)}%` : text;
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
