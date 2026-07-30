import { AlertTriangle, BadgeCent, BarChart3, Bot, CircleAlert, Landmark, Newspaper, TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../../store/app-store';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { IMonitorEvent, TMonitorCategory, StockDetail } from '../../../shared/types';

const CATEGORY_CONFIG: Record<TMonitorCategory, { label: string; Icon: typeof BadgeCent; color: string }> = {
  'large-order': { label: '大单异动', Icon: BadgeCent, color: '#22c55e' },
  chip: { label: '筹码变化', Icon: BarChart3, color: '#f59e0b' },
  technical: { label: '技术信号', Icon: TrendingUp, color: '#3b82f6' },
  'dragon-tiger': { label: '龙虎榜', Icon: Landmark, color: '#e8b84b' },
  news: { label: '新闻公告', Icon: Newspaper, color: '#8b5cf6' },
  risk: { label: '风险预警', Icon: AlertTriangle, color: '#ef4444' },
  'ai-opportunity': { label: 'AI机会', Icon: Bot, color: '#a855f7' },
  'ai-warning': { label: 'AI预警', Icon: CircleAlert, color: '#f43f5e' },
};

const ALL_CATEGORIES: TMonitorCategory[] = [
  'large-order',
  'chip',
  'technical',
  'dragon-tiger',
  'news',
  'risk',
  'ai-opportunity',
  'ai-warning',
];

function formatTime(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function chgClass(value?: number | string) {
  if (value === undefined || value === null) return '';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(num)) return '';
  return num >= 0 ? 'up' : 'down';
}

function formatChange(value?: number | string) {
  if (value === undefined || value === null) return '--';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(num)) return '--';
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}

export function MonitoringCenter() {
  const [events, setEvents] = useState<IMonitorEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isTradingTime, setTradingTime] = useState(false);
  const [mode, setMode] = useState<'realtime' | 'history'>('history');

  const setSelectedStock = useAppStore((state) => state.setSelectedStock);
  const openRightPanel = useAppStore((state) => state.openRightPanel);
  const openAiMonitorPanel = useAppStore((state) => state.openAiMonitorPanel);
  const setStockReturnContext = useAppStore((state) => state.setStockReturnContext);

  const loadFeed = async () => {
    try {
      setError('');
      const api = getStocksenseApi();
      const feed = await api.getMonitorFeed({ categories: ALL_CATEGORIES, limit: 8 });
      setTradingTime(feed.isTradingTime);
      setMode(feed.mode);
      setEvents(
        feed.events.slice(0, 8).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '监控数据加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    loadFeed();
  }, []);

  useEffect(() => {
    if (!isTradingTime || mode !== 'realtime') return;
    const id = setInterval(loadFeed, 30_000);
    return () => clearInterval(id);
  }, [isTradingTime, mode]);

  const previewEvents = useMemo(() => events.slice(0, 8), [events]);

  const handleStockClick = async (code: string, name: string) => {
    const snapshot = { code, name } as StockDetail;
    openRightPanel();
    setStockReturnContext({ tab: 'ai-monitor', code });
    setSelectedStock(snapshot);
    try {
      const detail = await getStocksenseApi().getStockDetail(code);
      setSelectedStock({ ...snapshot, ...detail, name: detail.name === detail.code ? name : detail.name });
    } catch {
      setSelectedStock(snapshot);
    }
  };

  const handleViewMore = () => {
    openAiMonitorPanel();
  };

  return (
    <div className='monitor-center compact'>
      <div className='monitor-feed compact-feed'>
        {loading && !events.length ? (
          <div className='monitor-skeleton-grid'>
            {Array.from({ length: 6 }).map((_, index) => (
              <div className='monitor-card compact monitor-skeleton-card' key={index}>
                <div className='monitor-card-body'>
                  <div className='monitor-card-dot' />
                  <div className='monitor-card-top'>
                    <div className='monitor-skeleton-line category' />
                    <div className='monitor-skeleton-line time' />
                  </div>
                  <div className='monitor-card-stock'>
                    <div className='monitor-skeleton-line stock-name' />
                    <div className='monitor-skeleton-line stock-code' />
                    <div className='monitor-skeleton-line stock-price' />
                    <div className='monitor-skeleton-line stock-chg' />
                  </div>
                  <div className='monitor-skeleton-line title' />
                  <div className='monitor-skeleton-ai'>
                    <div className='monitor-skeleton-line ai-label' />
                    <div className='monitor-skeleton-line ai-text' />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className='empty-block'>{error}</div>
        ) : previewEvents.length === 0 ? (
          <div className='empty-block'>暂无监控事件</div>
        ) : (
          previewEvents.map((event) => {
            const cfg = CATEGORY_CONFIG[event.category];
            const Icon = cfg.Icon;
            return (
              <div
                key={event.id}
                className='monitor-card compact'
                onClick={() => handleStockClick(event.code, event.name)}
                role='button'
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    handleStockClick(event.code, event.name);
                  }
                }}
              >
                <div className='monitor-card-body'>
                  <div className='monitor-card-top'>
                    <div className='monitor-card-dot' style={{ background: cfg.color }} />
                    <span className='monitor-card-category' style={{ color: cfg.color }}>
                      <Icon size={13} /> {cfg.label}
                    </span>
                    <span className='monitor-card-time'>{formatTime(event.timestamp)}</span>
                  </div>
                  <div className='monitor-card-stock'>
                    <span className='monitor-stock-name'>{event.name}</span>
                    <span className='monitor-stock-code'>{event.code}</span>
                    {event.price !== undefined && event.price !== null ? (
                      <span className='monitor-stock-price'>
                        ¥{typeof event.price === 'number' ? event.price.toFixed(2) : event.price}
                      </span>
                    ) : null}
                    <span className={`monitor-stock-chg ${chgClass(event.changePercent)}`}>
                      {formatChange(event.changePercent)}
                    </span>
                  </div>
                  <div className='monitor-card-title'>{event.title}</div>
                  <div className='monitor-card-ai compact-ai'>
                    <span className='monitor-ai-label'>AI</span>
                    <span className='monitor-ai-text'>{event.aiAnalysis}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <button className='monitor-view-more' onClick={handleViewMore} type='button'>
        查看更多
      </button>
    </div>
  );
}
