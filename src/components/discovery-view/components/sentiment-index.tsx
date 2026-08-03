import { ChevronDown, ChevronUp } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useAppStore } from '../../../store/app-store';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { StockDetail } from '../../../shared/types';

type TStockItem = { code: string; name: string; price?: string; changePercent?: string; amount?: string; industry?: string };

interface ISentimentProps {
  score?: number | null;
  factors?: Array<{ label: string; value: string | number }>;
  stocks?: { zt: TStockItem[]; dt: TStockItem[]; zb: TStockItem[] };
  consecutiveStocks?: TStockItem[];
  yesterdayZt?: TStockItem[];
  yesterdayLb?: TStockItem[];
  leaders?: Array<{ code: string; name: string; height?: number | null; changePercent?: number | null }>;
}

function chgClass(value?: string) {
  if (!value) return '';
  const num = parseFloat(value);
  if (isNaN(num)) return '';
  return num >= 0 ? 'up' : 'down';
}

function stockListForLabel(
  label: string,
  stocks: ISentimentProps['stocks'],
  consecutiveStocks: ISentimentProps['consecutiveStocks'],
  yesterdayZt: ISentimentProps['yesterdayZt'],
  yesterdayLb: ISentimentProps['yesterdayLb'],
  leaders: ISentimentProps['leaders'],
): TStockItem[] {
  switch (label) {
    case '涨停': return stocks?.zt ?? [];
    case '跌停': return stocks?.dt ?? [];
    case '炸板': return stocks?.zb ?? [];
    case '连板': return consecutiveStocks ?? [];
    case '最高板': {
      const top = leaders?.reduce((max, item) => ((item.height ?? 0) > (max.height ?? 0) ? item : max), leaders[0]);
      if (!top?.code) return [];
      return [{ code: top.code, name: top.name, changePercent: top.changePercent !== undefined && top.changePercent !== null ? String(top.changePercent) : undefined }];
    }
    case '昨日涨停指数': return yesterdayZt ?? [];
    case '昨日连板指数': return yesterdayLb ?? [];
    default: return [];
  }
}

export function SentimentIndex({ score, factors, stocks, consecutiveStocks, yesterdayZt, yesterdayLb, leaders }: ISentimentProps) {
  // ponytail: default all expanded, track collapsed ones. Empty set = all open.
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const toggleCollapse = useCallback((idx: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }, []);

  const setSelectedStock = useAppStore((state) => state.setSelectedStock);
  const openRightPanel = useAppStore((state) => state.openRightPanel);
  const setStockReturnContext = useAppStore((state) => state.setStockReturnContext);

  const handleStockClick = async (code: string, name: string) => {
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

  if (score === undefined || score === null) {
    return <div className="empty-block">暂无情绪指数数据</div>;
  }

  const needleLeft = `${Math.max(2, Math.min(98, score))}%`;

  return (
    <div>
      <div className="sent-wrap">
        <div className="sent-bar-wrap">
          <div className="sent-track">
            <div className="sent-needle" style={{ left: needleLeft }} />
          </div>
          <div className="sent-labels">
            <span>冰点</span>
            <span>中性</span>
            <span>火热</span>
          </div>
        </div>
        <div className="sent-score">{score}</div>
      </div>

      {factors?.length ? (
        <div className="sent-factors">
          {factors.map((f, idx) => {
            const stockList = stockListForLabel(f.label, stocks, consecutiveStocks, yesterdayZt, yesterdayLb, leaders);
            const hasStocks = stockList.length > 0;
            const isOpen = !collapsed.has(idx);

            return (
              <div key={f.label} className="sent-factor-cell">
                <button
                  className={`factor-btn${hasStocks ? ' expandable' : ''}${isOpen ? ' open' : ''}`}
                  onClick={() => toggleCollapse(idx)}
                  type="button"
                >
                  <span>{f.label}</span>
                  <b>{f.value}</b>
                  <span className="factor-arrow" aria-hidden="true">
                    {isOpen ? <ChevronUp size={18} strokeWidth={2} /> : <ChevronDown size={18} strokeWidth={2} />}
                  </span>
                </button>
                {isOpen ? (
                  <div className="sent-stock-list">
                    {hasStocks ? (
                      stockList.map((item) => (
                        <button
                          key={item.code}
                          className="sent-stock-row"
                          onClick={() => handleStockClick(item.code, item.name)}
                          type="button"
                        >
                          <span className="sent-stock-name">{item.name}</span>
                          <span className="sent-stock-code">{item.code}</span>
                          {item.price ? <span className="sent-stock-price">{item.price}</span> : null}
                          <span className={`sent-stock-chg ${chgClass(item.changePercent)}`}>
                            {item.changePercent
                              ? `${parseFloat(item.changePercent) >= 0 ? '+' : ''}${item.changePercent}%`
                              : '--'}
                          </span>
                          {item.amount ? <span className="sent-stock-amount">{item.amount}</span> : null}
                          <span className="sent-stock-industry">{item.industry ?? '--'}</span>
                        </button>
                      ))
                    ) : (
                      <div className="sent-stock-empty">暂无成分股数据</div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
