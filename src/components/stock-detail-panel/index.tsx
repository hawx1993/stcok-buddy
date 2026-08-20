import { getStocksenseApi } from '../../shared/stocksense-api';
import type { IMonitorEvent, StockDetail } from '../../shared/types';
import { useAppDataStore, useAppUiStore } from '../../store/app-store';
import type { RightPanelTab } from '../../store/app-store';
import { BoardDashboardPanel } from './components/board-dashboard-panel';
import { BoardDetailPanel } from './components/board-detail-panel';
import { FavoritesPanel } from './components/favorites-panel';
import { MarketNewsPanel } from './components/market-news-panel';
import { StockDetailView } from './components/stock-detail-view';
import { StockSurgePanel } from './components/stock-surge-panel';
import { AiMonitorPanel } from './components/ai-monitor-panel';
import styles from './index.module.scss';

const BACK_LABELS: Record<RightPanelTab, string> = {
  favorites: '收藏个股',
  board: '板块详情',
  surge: '异动',
  news: '新闻',
  stock: '返回',
  'ai-monitor': 'AI监控',
};

interface IStockDetailPanelProps {
  onOpenGlobalSearch(options?: {
    placeholder?: string;
    aiMonitorDate?: string;
    onSelectAiMonitorEvent?(event: IMonitorEvent): void;
  }): void;
  onOpenNewsSearch(): void;
}

export function StockDetailPanel({ onOpenGlobalSearch, onOpenNewsSearch }: IStockDetailPanelProps) {
  const selectedStock = useAppDataStore((state) => state.selectedStock);
  const selectedBoard = useAppDataStore((state) => state.selectedBoard);
  const stockReturnContext = useAppDataStore((state) => state.stockReturnContext);
  const rightPanelTab = useAppUiStore((state) => state.rightPanelTab);
  const isRightPanelCollapsed = useAppUiStore((state) => state.isRightPanelCollapsed);
  const setRightPanelTab = useAppUiStore((state) => state.setRightPanelTab);
  const setSelectedStock = useAppDataStore((state) => state.setSelectedStock);
  const setStockReturnContext = useAppDataStore((state) => state.setStockReturnContext);

  const openSurgeStock = async (stock: StockDetail, surgeId?: string) => {
    setStockReturnContext({ tab: 'surge', code: stock.code, id: surgeId });
    setSelectedStock(stock);
    setRightPanelTab('stock');
    try {
      const detail = await getStocksenseApi().getStockDetail(stock.code);
      setSelectedStock({
        ...stock,
        ...detail,
        name: detail.name === detail.code ? stock.name : detail.name,
        industry: detail.industry ?? stock.industry,
      });
    } catch (error: unknown) {
      console.error(error);
    }
  };

  const returnToSurge = () => {
    if (!stockReturnContext) return;
    setRightPanelTab('surge');
  };

  const showSurgeBack = Boolean(
    selectedStock && stockReturnContext?.tab === 'surge' && selectedStock.code === stockReturnContext.code,
  );

  const showGenericBack = Boolean(
    selectedStock &&
      stockReturnContext &&
      stockReturnContext.tab !== 'stock' &&
      stockReturnContext.tab !== 'surge' &&
      selectedStock.code === stockReturnContext.code,
  );

  const handleGenericBack = () => {
    if (stockReturnContext) setRightPanelTab(stockReturnContext.tab);
  };

  return (
    <aside className={`${styles['right-panel']} right-panel`}>
      {rightPanelTab === 'favorites' ? <FavoritesPanel isActive={!isRightPanelCollapsed} /> : null}
      {rightPanelTab === 'news' ? (
        <MarketNewsPanel isActive={!isRightPanelCollapsed} onOpenNewsSearch={onOpenNewsSearch} />
      ) : null}
      {rightPanelTab === 'board' ? (
        selectedBoard ? (
          <BoardDetailPanel />
        ) : (
          <BoardDashboardPanel isActive={!isRightPanelCollapsed} />
        )
      ) : null}
      {rightPanelTab === 'surge' ? (
        <StockSurgePanel
          isActive={!isRightPanelCollapsed}
          returnCode={stockReturnContext?.tab === 'surge' ? stockReturnContext.code : undefined}
          returnId={stockReturnContext?.tab === 'surge' ? stockReturnContext.id : undefined}
          onOpenStock={(stock, surgeId) => void openSurgeStock(stock, surgeId)}
          onClearReturnCode={() => setStockReturnContext(undefined)}
        />
      ) : null}
      {rightPanelTab === 'stock' ? (
        <StockDetailView
          returnToSurge={showSurgeBack}
          onReturnToSurge={returnToSurge}
          onGenericBack={showGenericBack ? handleGenericBack : undefined}
          genericBackLabel={showGenericBack && stockReturnContext ? BACK_LABELS[stockReturnContext.tab] : undefined}
        />
      ) : null}
      {rightPanelTab === 'ai-monitor' ? (
        <AiMonitorPanel
          isActive={!isRightPanelCollapsed}
          onOpenGlobalSearch={onOpenGlobalSearch}
          restoreState={stockReturnContext?.tab === 'ai-monitor' ? stockReturnContext.aiMonitor : undefined}
        />
      ) : null}
    </aside>
  );
}
