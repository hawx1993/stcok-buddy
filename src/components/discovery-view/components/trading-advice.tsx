import { AlertTriangle, BarChart3, Bot, RefreshCw, Target, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAppDataStore, useAppUiStore } from '../../../store/app-store';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { BoardDetail, ITradingAdvice, StockDetail } from '../../../shared/types';

const CONFIDENCE_LABELS: Record<string, string> = {
  high: '高置信',
  medium: '中置信',
  low: '低置信',
};

function StarRating({ rating }: { rating: number }) {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    stars.push(
      <span key={i} style={{ color: i <= rating ? '#e8b84b' : 'var(--glass-border)', fontSize: 20 }}>
        ★
      </span>,
    );
  }
  return <span>{stars}</span>;
}

function StrategyTags({ items, type }: { items: string[]; type: 'suitable' | 'unsuitable' }) {
  if (!items.length) return null;
  const isSuitable = type === 'suitable';
  return (
    <div className='advice-tags'>
      {items.map((item) => (
        <span key={item} className={`advice-tag ${isSuitable ? 'suitable' : 'unsuitable'}`}>
          {isSuitable ? '✓' : '✗'} {item}
        </span>
      ))}
    </div>
  );
}

interface ITradingAdviceProps {
  tradeDate?: string;
}

export function TradingAdvice({ tradeDate }: ITradingAdviceProps) {
  const [advice, setAdvice] = useState<ITradingAdvice | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const setSelectedBoard = useAppDataStore((state) => state.setSelectedBoard);
  const setSelectedStock = useAppDataStore((state) => state.setSelectedStock);
  const openRightPanel = useAppUiStore((state) => state.openRightPanel);
  const openBoardPanel = useAppUiStore((state) => state.openBoardPanel);
  const setStockReturnContext = useAppDataStore((state) => state.setStockReturnContext);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setAdvice(undefined);
    try {
      const api = getStocksenseApi();
      const data = await api.getTradingAdvice(tradeDate ? { tradeDate } : undefined);
      setAdvice(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [tradeDate]);

  const handleSectorClick = async (name: string) => {
    const snapshot = { code: '', name } as BoardDetail;
    setStockReturnContext(undefined);
    setSelectedBoard(snapshot);
    openBoardPanel();
    try {
      const detail = await getStocksenseApi().getBoardDetail('', false, name);
      setSelectedBoard({ ...snapshot, ...detail, name: detail.name === detail.code ? name : detail.name });
    } catch {
      setSelectedBoard(snapshot);
    }
  };

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

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className='advice-card'>
        <div className='advice-loading'>
          <Bot size={26} />
          <p>AI 正在分析今日市场数据…</p>
          <div className='advice-skeleton'>
            <div className='advice-skeleton-line' />
            <div className='advice-skeleton-line' />
            <div className='advice-skeleton-line' />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className='advice-card'>
        <div className='advice-error'>
          <AlertTriangle className='advice-error-icon' size={26} />
          <p>{error}</p>
          <button className='advice-retry-btn' onClick={load} type='button'>
            重试
          </button>
        </div>
      </div>
    );
  }

  if (!advice) {
    return (
      <div className='advice-card'>
        <div className='advice-empty'>
          <BarChart3 className='advice-empty-icon' size={26} />
          <p>暂无交易建议数据</p>
        </div>
      </div>
    );
  }

  return (
    <div className='advice-card'>
      <div className='advice-hero'>
        <div className='advice-stars'>
          <StarRating rating={advice.starRating} />
          <span className='advice-star-label'>{advice.starLabel}</span>
        </div>
      </div>
      {/* Position & Summary Row */}
      <div className='advice-metrics'>
        <div className='advice-position'>
          <span className='advice-metric-label'>建议仓位</span>
          <span className='advice-position-value'>{advice.suggestedPosition}%</span>
          <span className='advice-position-reason'>{advice.positionReason}</span>
          <div className='advice-position-bar'>
            <div className='advice-position-fill' style={{ width: `${advice.suggestedPosition}%` }} />
          </div>
        </div>
        <div className='advice-summary-box'>
          <span className='advice-metric-label'>市场核心矛盾</span>
          <p className='advice-summary-text'>{advice.marketSummary}</p>
        </div>
      </div>

      {/* Strategies */}
      <div className='advice-strategies'>
        <div className='advice-strategy-group'>
          <span className='advice-strategy-label'>适合</span>
          <StrategyTags items={advice.suitableStrategies} type='suitable' />
        </div>
        <div className='advice-strategy-group'>
          <span className='advice-strategy-label'>不建议</span>
          <StrategyTags items={advice.unsuitableStrategies} type='unsuitable' />
        </div>
      </div>

      {/* Key Sectors */}
      {advice.keySectors.length > 0 && (
        <div className='advice-sectors'>
          <span className='advice-sectors-title'>重点观察</span>
          <div className='advice-sectors-grid'>
            {advice.keySectors.map((sector) => (
              <div key={sector.name} className={`advice-sector-card confidence-${sector.confidence}`}>
                <div className='advice-sector-top'>
                  <button className='advice-sector-name' onClick={() => handleSectorClick(sector.name)} type='button'>
                    {sector.name}
                  </button>
                  <span className={`advice-sector-confidence ${sector.confidence}`}>
                    {CONFIDENCE_LABELS[sector.confidence] ?? sector.confidence}
                  </span>
                </div>
                <span className='advice-sector-reason'>{sector.reason}</span>
                {sector.leaderName && sector.leaderCode && (
                  <button
                    className='advice-sector-leader'
                    onClick={() => handleStockClick(sector.leaderCode, sector.leaderName)}
                    type='button'
                  >
                    领涨：{sector.leaderName} <span className='advice-sector-code'>{sector.leaderCode}</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Risk Reminder */}
      {advice.riskReminder && (
        <div className='advice-risk'>
          <Zap className='advice-risk-icon' size={14} />
          <span>风险提示：{advice.riskReminder}</span>
        </div>
      )}

      {/* Refresh */}
      <div className='advice-footer'>
        <button className='advice-refresh-btn' onClick={load} type='button'>
          <RefreshCw size={13} />
          刷新建议
        </button>
      </div>
    </div>
  );
}
