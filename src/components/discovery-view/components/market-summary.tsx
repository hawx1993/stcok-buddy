import { useAppStore } from '../../../store/app-store';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { StockDetail } from '../../../shared/types';

interface IMarketSummaryProps {
  indices?: Array<{ code: string; name: string; price?: number | string; changePercent?: number | string }>;
  wealthMetrics?: Array<{ label: string; value: number | null; unit: string }>;
  bullets?: string[];
}

function chgClass(value?: number | string) {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (num === undefined || num === null || isNaN(num)) return '';
  return num >= 0 ? 'up' : 'down';
}

export function MarketSummary({ indices, wealthMetrics, bullets }: IMarketSummaryProps) {
  const setSelectedStock = useAppStore((state) => state.setSelectedStock);
  const openRightPanel = useAppStore((state) => state.openRightPanel);
  const setStockReturnContext = useAppStore((state) => state.setStockReturnContext);

  const handleIndexClick = async (code: string, name: string) => {
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

  if (!indices?.length && !wealthMetrics?.length && !bullets?.length) {
    return <div className="empty-block">暂无市场总结数据</div>;
  }

  // Build metric bars from wealth data
  let upCount = 0;
  let downCount = 0;
  if (wealthMetrics) {
    for (const m of wealthMetrics) {
      if (m.label === '上涨股票' && m.value !== null) upCount = m.value;
      if (m.label === '下跌股票' && m.value !== null) downCount = m.value;
    }
  }
  const totalCount = upCount + downCount;
  const upPct = totalCount > 0 ? Math.round((upCount / totalCount) * 100) : 0;
  const downPct = totalCount > 0 ? Math.round((downCount / totalCount) * 100) : 0;
  const hasBreadth = upCount > 0 || downCount > 0;

  return (
    <div>
      {indices?.length ? (
        <div className="idx-row">
          {indices.map((idx) => (
            <button
              key={idx.code}
              className="idx-card clickable"
              onClick={() => handleIndexClick(idx.code, idx.name)}
              type="button"
            >
              <div className="idx-name">{idx.name}</div>
              <div className="idx-val">{idx.price ?? '--'}</div>
              <div className={`idx-chg ${chgClass(idx.changePercent)}`}>
                {idx.changePercent !== undefined && idx.changePercent !== null
                  ? `${Number(idx.changePercent) >= 0 ? '+' : ''}${Number(idx.changePercent).toFixed(2)}%`
                  : '--'}
              </div>
            </button>
          ))}
        </div>
      ) : null}

      {/* Market breadth bar chart */}
      {hasBreadth ? (
        <div className="breadth-chart">
          <div className="breadth-title">📊 涨跌分布</div>
          <div className="breadth-bars">
            <div className="breadth-row">
              <span className="breadth-label up">上涨 {upCount}家</span>
              <div className="breadth-track">
                <div className="breadth-fill up" style={{ width: `${Math.max(upPct, 2)}%`, background: 'var(--market-up, #f5484b)' }} />
              </div>
              <span className="breadth-pct">{upPct}%</span>
            </div>
            <div className="breadth-row">
              <span className="breadth-label down">下跌 {downCount}家</span>
              <div className="breadth-track">
                <div className="breadth-fill down" style={{ width: `${Math.max(downPct, 2)}%`, background: 'var(--market-down, #2fbf71)' }} />
              </div>
              <span className="breadth-pct">{downPct}%</span>
            </div>
          </div>
        </div>
      ) : null}

      {/* Remaining bullets as text */}
      {bullets?.length ? (
        <ul className="bullet-list" style={{ marginTop: 12 }}>
          {bullets.filter((b) => !b.startsWith('上涨股票') && !b.startsWith('下跌股票')).map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
