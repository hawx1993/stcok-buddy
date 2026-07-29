import { useAppStore } from '../../../store/app-store';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { StockDetail } from '../../../shared/types';

interface IWatchlistProps {
  items?: Array<{ code: string; name: string; price?: number | string; changePercent?: number | string }>;
}

function chgClass(value?: number | string) {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (num === undefined || num === null || isNaN(num)) return '';
  return num >= 0 ? 'up' : 'down';
}

export function WatchlistRadar({ items }: IWatchlistProps) {
  const setSelectedStock = useAppStore((state) => state.setSelectedStock);
  const openRightPanel = useAppStore((state) => state.openRightPanel);
  const setStockReturnContext = useAppStore((state) => state.setStockReturnContext);

  const handleClick = async (code: string, name: string) => {
    const snapshot = { code, name } as StockDetail;
    setStockReturnContext(undefined);
    openRightPanel();
    setSelectedStock(snapshot);
    try {
      const detail = await getStocksenseApi().getStockDetail(code);
      setSelectedStock({ ...snapshot, ...detail, name: detail.name === detail.code ? name : detail.name });
    } catch {
      setSelectedStock(snapshot);
    }
  };

  if (!items?.length) {
    return (
      <div className="empty-block">
        <p>📭 添加自选股以启用机会雷达</p>
        <p style={{ fontSize: 12, marginTop: 4 }}>在个股详情页点击收藏，即可在此查看实时机会信号</p>
      </div>
    );
  }

  return (
    <div className="wl-grid">
      {items.slice(0, 8).map((item) => (
        <button
          key={item.code}
          className="wl-card clickable"
          onClick={() => handleClick(item.code, item.name)}
          type="button"
        >
          <div className="wl-top">
            <span className="wl-name">{item.name}</span>
            <span className="wl-code">{item.code}</span>
            <span className={`wl-chg ${chgClass(item.changePercent)}`}>
              {item.changePercent !== undefined && item.changePercent !== null
                ? `${Number(item.changePercent) >= 0 ? '+' : ''}${Number(item.changePercent).toFixed(2)}%`
                : '--'}
            </span>
          </div>
          <div className="wl-info">
            {item.price !== undefined && item.price !== null ? (
              <span className="wl-price">{typeof item.price === 'number' ? item.price.toFixed(2) : item.price}</span>
            ) : null}
            <span className="tag">自选</span>
          </div>
        </button>
      ))}
    </div>
  );
}
