import { useState } from 'react';
import { useAppStore } from '../../../store/app-store';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { StockDetail } from '../../../shared/types';

interface IDragonTigerProps {
  inst: Array<{ code: string; name: string; changePercent?: number; netBuy: number; reason: string }>;
  hot: Array<{ code: string; name: string; changePercent?: number; netBuy: number; reason: string }>;
  north: Array<{ code: string; name: string; changePercent?: number; netBuy: number; reason: string }>;
}

function formatNetBuy(value: number) {
  const yi = value / 100_000_000;
  if (yi >= 1) return `${yi.toFixed(2)}亿`;
  return `${(value / 10_000).toFixed(0)}万`;
}

function chgClass(value?: number) {
  if (value === undefined || value === null) return '';
  return value >= 0 ? 'up' : 'down';
}

export function DragonTiger({ inst, hot, north }: IDragonTigerProps) {
  const tabs = [
    { key: 'inst', label: '机构专用', rows: inst },
    { key: 'hot', label: '游资营业部', rows: hot },
    { key: 'north', label: '北向资金', rows: north },
  ] as const;
  const [activeTab, setActiveTab] = useState<string>('inst');
  const activeRows = tabs.find((t) => t.key === activeTab)?.rows ?? [];

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

  const allEmpty = inst.length === 0 && hot.length === 0 && north.length === 0;
  if (allEmpty) return <div className="empty-block">暂无今日龙虎榜数据</div>;

  return (
    <div>
      <div className="dt-tabs">
        {tabs.map((tab) => (
          <button key={tab.key} className={`tab-btn${activeTab === tab.key ? ' active' : ''}`} onClick={() => setActiveTab(tab.key)} type="button">
            {tab.label}
          </button>
        ))}
      </div>
      <table className="dt-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>涨跌幅</th>
            <th>净买入</th>
            <th>上榜原因</th>
          </tr>
        </thead>
        <tbody>
          {activeRows.length ? activeRows.map((row) => (
            <tr key={`${row.code}-${row.reason}`} className="clickable-row" onClick={() => handleClick(row.code, row.name)} style={{ cursor: 'pointer' }}>
              <td>{row.name} <span className="stock-code-mono">{row.code}</span></td>
              <td className={chgClass(row.changePercent)}>{row.changePercent !== undefined ? `${row.changePercent >= 0 ? '+' : ''}${row.changePercent.toFixed(1)}%` : '--'}</td>
              <td>{formatNetBuy(row.netBuy)}</td>
              <td className="dt-reason">{row.reason}</td>
            </tr>
          )) : (
            <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>暂无该分类数据</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
