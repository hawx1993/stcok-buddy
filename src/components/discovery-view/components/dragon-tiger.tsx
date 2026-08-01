import { useState } from 'react';
import { useAppStore } from '../../../store/app-store';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { StockDetail } from '../../../shared/types';

type TDragonTigerRow = { code: string; name: string; changePercent?: number; netBuy: number; reason: string };

type TDragonTigerDay = {
  date: string;
  weekday: string;
  inst: TDragonTigerRow[];
  hot: TDragonTigerRow[];
  first: TDragonTigerRow[];
};

interface IDragonTigerProps {
  inst: TDragonTigerRow[];
  hot: TDragonTigerRow[];
  first: TDragonTigerRow[];
  history?: TDragonTigerDay[];
  selectedDate?: string;
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

function formatHistoryLabel(date: string, weekday: string) {
  const parts = date.split('-');
  const shortWeekday = weekday.replace('星期', '周');
  return parts.length === 3 ? `${parts[1]}-${parts[2]} ${shortWeekday}` : `${date} ${shortWeekday}`;
}

export function DragonTiger({ inst, hot, first, history, selectedDate }: IDragonTigerProps) {
  const selectedDay = selectedDate ? history?.find((item) => item.date === selectedDate) : undefined;
  const currentInst = inst;
  const currentHot = hot;
  const currentFirst = first;
  const tabs = [
    { key: 'inst', label: '机构榜', rows: currentInst },
    { key: 'hot', label: '净买入榜', rows: currentHot },
    { key: 'first', label: '涨幅上榜', rows: currentFirst },
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

  const allEmpty = currentInst.length === 0 && currentHot.length === 0 && currentFirst.length === 0;
  if (allEmpty) return <div className='empty-block'>暂无该交易日龙虎榜数据</div>;

  return (
    <div>
      <div className='dt-date-note'>当前龙虎榜交易日：{selectedDay ? formatHistoryLabel(selectedDay.date, selectedDay.weekday) : selectedDate || '--'}</div>
      <div className='dt-tabs'>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`tab-btn${activeTab === tab.key ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
            type='button'
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className='dt-table-wrap'>
        <table className='dt-table'>
          <thead>
            <tr>
              <th>名称</th>
              <th>涨跌幅</th>
              <th>净买入</th>
              <th>上榜原因</th>
            </tr>
          </thead>
          <tbody>
            {activeRows.length ? (
              activeRows.map((row) => (
                <tr
                  key={`${row.code}-${row.reason}`}
                  className='clickable-row'
                  onClick={() => handleClick(row.code, row.name)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>
                    {row.name} <span className='stock-code-mono'>{row.code}</span>
                  </td>
                  <td className={chgClass(row.changePercent)}>
                    {row.changePercent !== undefined
                      ? `${row.changePercent >= 0 ? '+' : ''}${row.changePercent.toFixed(1)}%`
                      : '--'}
                  </td>
                  <td>{formatNetBuy(row.netBuy)}</td>
                  <td className='dt-reason'>{row.reason}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>
                  暂无该分类数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
