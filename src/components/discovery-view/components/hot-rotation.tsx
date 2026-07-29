import { useState } from 'react';
import { useAppStore } from '../../../store/app-store';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { StockDetail } from '../../../shared/types';

interface IHotChip {
  name: string;
  score?: number | null;
  changePercent?: number | null;
  limitUpCount?: number | null;
  reason?: string | null;
  leaderName?: string | null;
  leaderCode?: string | null;
  leaders?: Array<{ code: string; name: string; height?: number | null }>;
}

interface IHotRotationProps {
  themes?: IHotChip[];
}

export function HotRotation({ themes }: IHotRotationProps) {
  const [activeChip, setActiveChip] = useState<string>();
  const setSelectedStock = useAppStore((state) => state.setSelectedStock);
  const openRightPanel = useAppStore((state) => state.openRightPanel);
  const setStockReturnContext = useAppStore((state) => state.setStockReturnContext);

  const handleLeaderClick = async (code: string, name: string) => {
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

  if (!themes?.length) return <div className="empty-block">暂无热点板块数据</div>;

  const chip = themes.find((t) => t.name === activeChip);

  return (
    <div>
      <div className="chip-cloud">
        {themes.map((t) => {
          const isHot = (t.score ?? 0) >= 4;
          const isActive = activeChip === t.name;
          return (
            <button key={t.name} className={`chip${isHot ? ' hot' : ''}${isActive ? ' active' : ''}`} onClick={() => setActiveChip(isActive ? undefined : t.name)} type="button">
              <span>{(t.changePercent ?? 0) >= 0 ? '▲' : '▼'} {t.name}</span>
              {t.score !== null && t.score !== undefined ? <span className="chip-heat">评分{t.score}</span> : null}
              {t.limitUpCount ? <span className="chip-heat">{t.limitUpCount}家涨停</span> : null}
            </button>
          );
        })}
      </div>
      {chip ? (
        <div className="chip-detail show">
          <div className="chip-detail-header">
            <strong>{chip.name}</strong>
            {chip.changePercent !== null && chip.changePercent !== undefined ? (
              <span className={`chip-detail-chg ${chip.changePercent >= 0 ? 'up' : 'down'}`}>
                {chip.changePercent >= 0 ? '+' : ''}{chip.changePercent.toFixed(2)}%
              </span>
            ) : null}
            {chip.limitUpCount ? <span className="chip-detail-count">{chip.limitUpCount} 家涨停</span> : null}
          </div>
          <div className="chip-detail-reason">{chip.reason ?? '暂无归因'}</div>
          {chip.leaders && chip.leaders.length > 0 ? (
            <div className="chip-leaders">
              {chip.leaders.map((leader, index) => (
                <button
                  key={leader.code}
                  className="chip-leader-row"
                  onClick={() => handleLeaderClick(leader.code, leader.name)}
                  type="button"
                >
                  <span className="chip-leader-rank">龙{index + 1}</span>
                  <span className="chip-leader-name">{leader.name}</span>
                  <span className="chip-leader-code">{leader.code}</span>
                  {leader.height ? <span className="chip-leader-height">{leader.height}板</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
