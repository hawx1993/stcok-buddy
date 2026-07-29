import { useAppStore } from '../../../store/app-store';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { StockDetail } from '../../../shared/types';

interface ILimitUpProps {
  items?: Array<{
    code: string;
    name: string;
    height: string;
    reason: string;
    price?: number | string;
    changePercent?: number | null;
    turnoverRate?: number | null;
  }>;
}

function formatPrice(value?: number | string) {
  if (value === undefined || value === null) return '--';
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return num.toFixed(2);
}

function formatPercent(value?: number | string | null) {
  if (value === undefined || value === null) return '--';
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}

export function LimitUpReview({ items }: ILimitUpProps) {
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

  if (!items?.length) return <div className="empty-block">暂无今日涨停复盘数据</div>;

  return (
    <div className="lu-grid">
      {items.slice(0, 6).map((item) => (
        <button key={item.code} className="lu-card clickable" onClick={() => handleClick(item.code, item.name)} type="button">
          <div className="lu-name">{item.name}</div>
          <div className="lu-board">{item.height}</div>
          <div className="lu-reason">{item.reason}</div>
          <div className="lu-metrics">
            <span className="lu-code">{item.code}</span>
            <span className="lu-price">¥{formatPrice(item.price)}</span>
            <span className={`lu-chg ${(item.changePercent ?? 0) >= 0 ? 'up' : 'down'}`}>
              {formatPercent(item.changePercent)}
            </span>
            <span className="lu-turnover">换手 {formatPercent(item.turnoverRate)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
