import { useCallback } from 'react';
import { getStocksenseApi } from '../shared/stocksense-api';
import type { BoardDetail, MarketBoardRow, MarketQuoteRow, MarketSearchResult, StockDetail } from '../shared/types';
import { useAppStore } from '../store/app-store';
import { formatMarketCap, formatMoney, formatPercent, formatVolume } from '../components/market-view/market-format';

export function useOpenMarketSearchResult() {
  const setSelectedStock = useAppStore((state) => state.setSelectedStock);
  const setStockReturnContext = useAppStore((state) => state.setStockReturnContext);
  const setSelectedBoard = useAppStore((state) => state.setSelectedBoard);
  const selectedBoard = useAppStore((state) => state.selectedBoard);
  const openRightPanel = useAppStore((state) => state.openRightPanel);
  const openBoardPanel = useAppStore((state) => state.openBoardPanel);

  const openStock = useCallback(
    async (row: MarketQuoteRow) => {
      const rowSnapshot: StockDetail = {
        code: row.code,
        name: row.name,
        price: row.price,
        changePercent: formatPercent(row.changePercent),
        open: row.open,
        high: row.high,
        low: row.low,
        prevClose: row.prevClose,
        volume: formatVolume(row.volume),
        turnover: formatMoney(row.amount),
        turnoverRate: formatPercent(row.turnoverRate),
        marketCap: formatMarketCap(row.marketCap),
        industry: row.industry,
      };
      setStockReturnContext(undefined);
      openRightPanel();
      setSelectedStock(rowSnapshot);
      try {
        const detail = await getStocksenseApi().getStockDetail(row.code);
        setSelectedStock({
          ...rowSnapshot,
          ...detail,
          name: detail.name === detail.code ? rowSnapshot.name : detail.name,
        });
      } catch {
        setSelectedStock(rowSnapshot);
      }
    },
    [openRightPanel, setSelectedStock, setStockReturnContext],
  );

  const openBoard = useCallback(
    async (row: MarketBoardRow) => {
      const rowSnapshot: BoardDetail = {
        code: row.code,
        name: row.name,
        changePercent: formatPercent(row.changePercent),
        kline: row.minutes ?? [],
        constituents: row.constituents ?? [],
      };
      openBoardPanel();
      if (selectedBoard?.code !== row.code) setSelectedBoard(rowSnapshot);
      try {
        const detail = await getStocksenseApi().getBoardDetail(row.code, false, row.name);
        if (useAppStore.getState().selectedBoard?.code !== row.code) return;
        setSelectedBoard({
          ...detail,
          name: detail.name === detail.code ? row.name : detail.name,
          changePercent: detail.changePercent ?? rowSnapshot.changePercent,
        });
      } catch {
        if (useAppStore.getState().selectedBoard?.code !== row.code) return;
        setSelectedBoard(rowSnapshot);
      }
    },
    [openBoardPanel, selectedBoard?.code, setSelectedBoard],
  );

  const openSearchResult = useCallback(
    async (row: MarketSearchResult) => {
      if (row.kind === 'board') await openBoard(row);
      else await openStock(row);
    },
    [openBoard, openStock],
  );

  return { openStock, openBoard, openSearchResult };
}
