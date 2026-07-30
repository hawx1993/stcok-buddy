import { Flame, TrendingDown, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { useAppStore } from '../../../store/app-store';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { BoardDetail, StockDetail } from '../../../shared/types';

interface IHotChip {
  code?: string | null;
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
  const setSelectedBoard = useAppStore((state) => state.setSelectedBoard);
  const openRightPanel = useAppStore((state) => state.openRightPanel);
  const openBoardPanel = useAppStore((state) => state.openBoardPanel);
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

  const handleBoardClick = async (code: string | null | undefined, name: string) => {
    const snapshot = { code: code ?? '', name } as BoardDetail;
    setStockReturnContext(undefined);
    setSelectedBoard(snapshot);
    openBoardPanel();
    try {
      const detail = await getStocksenseApi().getBoardDetail(code ?? '', false, name);
      setSelectedBoard({ ...snapshot, ...detail, name: detail.name === detail.code ? name : detail.name });
    } catch {
      setSelectedBoard(snapshot);
    }
  };

  if (!themes?.length) return <div className='empty-block'>暂无热点板块数据</div>;

  const sortedThemes = [...themes].sort(
    (a, b) => (b.limitUpCount ?? 0) - (a.limitUpCount ?? 0) || (b.score ?? 0) - (a.score ?? 0),
  );
  const chip = sortedThemes.find((t) => t.name === activeChip) ?? sortedThemes[0];
  const chipLeaders = chip?.leaders?.slice(0, 3) ?? [];

  return (
    <div className='hot-rotation-panel'>
      <div className='hot-rotation-grid'>
        {sortedThemes.map((t) => {
          const isHot = (t.limitUpCount ?? 0) >= 2 || (t.score ?? 0) >= 4;
          const isActive = chip?.name === t.name;
          const isUp = (t.changePercent ?? 0) >= 0;
          const TrendIcon = isUp ? TrendingUp : TrendingDown;
          return (
            <button
              key={t.name}
              className={`hot-rotation-card${isHot ? ' hot' : ''}${isActive ? ' active' : ''}`}
              onClick={() => setActiveChip(t.name)}
              type='button'
            >
              <span className='hot-rotation-main'>
                <span className='hot-rotation-icon'>
                  <Flame size={16} />
                </span>
                <span className='hot-rotation-name'>{t.name}</span>
              </span>
              <span className={`hot-rotation-change ${isUp ? 'up' : 'down'}`}>
                <TrendIcon size={14} />
                {t.changePercent !== null && t.changePercent !== undefined
                  ? `${isUp ? '+' : ''}${t.changePercent.toFixed(2)}%`
                  : '--'}
              </span>
              <span className='hot-rotation-meta'>
                {t.limitUpCount ? `${t.limitUpCount}家涨停` : t.score ? `评分${t.score}` : '实时板块'}
              </span>
            </button>
          );
        })}
      </div>
      {chip ? (
        <div className='chip-detail show'>
          <div className='chip-detail-header'>
            <button
              className='chip-detail-title'
              style={{ background: 'transparent' }}
              onClick={() => handleBoardClick(chip.code, chip.name)}
              type='button'
            >
              {chip.name}
            </button>
            {chip.changePercent !== null && chip.changePercent !== undefined ? (
              <span className={`chip-detail-chg ${chip.changePercent >= 0 ? 'up' : 'down'}`}>
                {chip.changePercent >= 0 ? '+' : ''}
                {chip.changePercent.toFixed(2)}%
              </span>
            ) : null}
            {chip.limitUpCount ? <span className='chip-detail-count'>{chip.limitUpCount} 家涨停</span> : null}
          </div>
          <div className='chip-detail-reason'>{chip.reason ?? '暂无归因'}</div>
          {chipLeaders.length > 0 ? (
            <div className='chip-leaders'>
              {chipLeaders.map((leader, index) => (
                <button
                  key={leader.code}
                  className='chip-leader-row'
                  onClick={() => handleLeaderClick(leader.code, leader.name)}
                  type='button'
                >
                  <span className='chip-leader-rank'>龙{index + 1}</span>
                  <span className='chip-leader-name'>{leader.name}</span>
                  <span className='chip-leader-code'>{leader.code}</span>
                  {leader.height ? <span className='chip-leader-height'>{leader.height}板</span> : null}
                </button>
              ))}
            </div>
          ) : (
            <div className='chip-detail-reason'>龙头股数据暂缺</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
