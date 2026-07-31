import { getStocksenseApi } from '../../shared/stocksense-api';
import type { StockDetail } from '../../shared/types';
import { Empty } from '../empty';
import { useAppStore } from '../../store/app-store';
import type { RightPanelTab } from '../../store/app-store';
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

export function StockDetailPanel() {
  const selectedStock = useAppStore((state) => state.selectedStock);
  const selectedBoard = useAppStore((state) => state.selectedBoard);
  const stockReturnContext = useAppStore((state) => state.stockReturnContext);
  const rightPanelTab = useAppStore((state) => state.rightPanelTab);
  const isRightPanelCollapsed = useAppStore((state) => state.isRightPanelCollapsed);
  const setRightPanelTab = useAppStore((state) => state.setRightPanelTab);
  const setSelectedStock = useAppStore((state) => state.setSelectedStock);
  const setStockReturnContext = useAppStore((state) => state.setStockReturnContext);

  const openSurgeStock = async (stock: StockDetail) => {
    setRightPanelTab('stock');
    setStockReturnContext({ tab: 'surge', code: stock.code });
    setSelectedStock(stock);
    try {
      setSelectedStock(await getStocksenseApi().getStockDetail(stock.code));
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
          returnCode={stockReturnContext?.tab === 'surge' ? stockReturnContext.code : undefined}
          onOpenStock={(stock) => void openSurgeStock(stock)}
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
      {rightPanelTab === 'ai-monitor' ? <AiMonitorPanel isActive={!isRightPanelCollapsed} restoreState={stockReturnContext?.tab === 'ai-monitor' ? stockReturnContext.aiMonitor : undefined} /> : null}
    </aside>
  );
}
