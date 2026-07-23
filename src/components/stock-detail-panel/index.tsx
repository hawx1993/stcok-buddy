import { useState } from 'react';
import { getStocksenseApi } from '../../shared/stocksense-api';
import type { StockDetail } from '../../shared/types';
import { Empty } from '../empty';
import { useAppStore } from '../../store/app-store';
import { BoardDetailPanel } from './components/board-detail-panel';
import { FavoritesPanel } from './components/favorites-panel';
import { MarketNewsPanel } from './components/market-news-panel';
import { StockDetailView } from './components/stock-detail-view';
import { StockSurgePanel } from './components/stock-surge-panel';
import styles from './index.module.scss';

export function StockDetailPanel() {
  const [surgeReturnCode, setSurgeReturnCode] = useState<string>();
  const selectedStock = useAppStore((state) => state.selectedStock);
  const selectedBoard = useAppStore((state) => state.selectedBoard);
  const rightPanelTab = useAppStore((state) => state.rightPanelTab);
  const isRightPanelCollapsed = useAppStore((state) => state.isRightPanelCollapsed);
  const setRightPanelTab = useAppStore((state) => state.setRightPanelTab);
  const setSelectedStock = useAppStore((state) => state.setSelectedStock);

  const openSurgeStock = async (stock: StockDetail) => {
    setSurgeReturnCode(stock.code);
    setRightPanelTab('stock');
    setSelectedStock(stock);
    try {
      setSelectedStock(await getStocksenseApi().getStockDetail(stock.code));
    } catch (error: unknown) {
      console.error(error);
    }
  };

  const returnToSurge = () => {
    if (!surgeReturnCode) return;
    setRightPanelTab('surge');
  };

  const showSurgeBack = Boolean(selectedStock && selectedStock.code === surgeReturnCode);

  return (
    <aside className={`${styles['right-panel']} right-panel`}>
      {rightPanelTab === 'favorites' ? <FavoritesPanel isActive={!isRightPanelCollapsed} /> : null}
      {rightPanelTab === 'news' ? <MarketNewsPanel isActive={!isRightPanelCollapsed} /> : null}
      {rightPanelTab === 'board' ? (
        selectedBoard ? (
          <BoardDetailPanel />
        ) : (
          <Empty
            text={
              <>
                点击行情板块或聊天中的<span className={styles.hl}>板块代码</span>，查看板块详情。
              </>
            }
          />
        )
      ) : null}
      {rightPanelTab === 'surge' ? (
        <StockSurgePanel
          isActive={!isRightPanelCollapsed}
          returnCode={surgeReturnCode}
          onOpenStock={(stock) => void openSurgeStock(stock)}
          onClearReturnCode={() => setSurgeReturnCode(undefined)}
        />
      ) : null}
      {rightPanelTab === 'stock' ? (
        <StockDetailView returnToSurge={showSurgeBack} onReturnToSurge={returnToSurge} />
      ) : null}
    </aside>
  );
}
