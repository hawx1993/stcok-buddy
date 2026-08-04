import { BarChart3 } from 'lucide-react';
import { useAppDataStore, useAppUiStore } from '../../../store/app-store';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { BoardDetail, StockDetail } from '../../../shared/types';
import styles from '../index.module.scss';

interface ISectorSummary {
  code: string;
  name: string;
  changePercent: number;
  mainNetInflow: number;
  amount?: number;
}

interface IOpportunityRadarItem {
  code: string;
  name: string;
  ratio: number;
  changePercent: number;
  mainNetInflow: number;
}

interface IMonthlyThemeItem {
  week: string;
  theme: string;
  leader: { code: string; name: string } | null;
}

interface INextWeekSector {
  code?: string;
  name: string;
  score: number;
  reasoning: {
    fundFlow: string;
    news: string;
    policy: string;
    technical: string;
    rotation: string;
  };
}

interface IMarketSummary {
  indices: Array<{ code: string; name: string; price: number; changePercent: number }>;
  mainFundFlow: number | null;
  northFundFlow: number | null;
  limitUp: number;
  limitDown: number;
  sentimentBar: number;
  sectors: ISectorSummary[];
  opportunityRadar: IOpportunityRadarItem[];
  monthlyThemes: IMonthlyThemeItem[];
  nextWeekSectors: INextWeekSector[];
}

interface IMarketSummaryProps {
  indices?: Array<{ code: string; name: string; price?: number | string; changePercent?: number | string }>;
  wealthMetrics?: Array<{ label: string; value: number | null; unit: string }>;
  bullets?: string[];
  marketSummary?: IMarketSummary;
}

function chgClass(value?: number | string) {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (num === undefined || num === null || isNaN(num)) return '';
  return num >= 0 ? styles.up : styles.down;
}

function formatChange(value?: number | string) {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (num === undefined || num === null || isNaN(num)) return '--';
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}

function formatMoneyYi(value?: number | null) {
  if (value === undefined || value === null) return '--';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}亿`;
}

function formatAmountYi(value?: number | null) {
  if (value === undefined || value === null) return '成交额暂无';
  return `成交额 ${(value / 100_000_000).toFixed(1)}亿`;
}

function sectorTone(changePercent: number) {
  return changePercent >= 0 ? 'var(--market-up)' : 'var(--market-down)';
}

function sectorCellBg(changePercent: number) {
  const abs = Math.min(Math.abs(changePercent) / 5, 1);
  return `color-mix(in srgb, ${sectorTone(changePercent)} ${8 + abs * 12}%, var(--surface) 100%)`;
}

function sectorCellBorder(changePercent: number) {
  const abs = Math.min(Math.abs(changePercent) / 5, 1);
  return `color-mix(in srgb, ${sectorTone(changePercent)} ${28 + abs * 18}%, var(--border) 100%)`;
}

export function getSentimentMarkerPosition(value: number): number {
  return Math.min(Math.max(value, 0), 100);
}

function SentimentBar({ value, up, down }: { value: number; up: number; down: number }) {
  const marker = getSentimentMarkerPosition(value);
  return (
    <div className={styles.msBarWrap}>
      <div className={styles.msBarTrack}>
        <div className={styles.msBarMarker} style={{ left: `${marker}%` }} />
      </div>
      <div className={styles.msBarLabels}>
        <span>偏空</span>
        <span className={styles.msBarValue}>
          情绪指数 {value.toFixed(0)} · 涨停 {up} / 跌停 {down}
        </span>
        <span>偏多</span>
      </div>
    </div>
  );
}

function LegacyMarketSummary({
  indices,
  wealthMetrics,
  bullets,
}: Pick<IMarketSummaryProps, 'indices' | 'wealthMetrics' | 'bullets'>) {
  const setSelectedBoard = useAppDataStore((state) => state.setSelectedBoard);
  const openBoardPanel = useAppUiStore((state) => state.openBoardPanel);
  const setStockReturnContext = useAppDataStore((state) => state.setStockReturnContext);

  const handleIndexClick = async (code: string, name: string) => {
    const snapshot = { code, name } as BoardDetail;
    setStockReturnContext(undefined);
    setSelectedBoard(snapshot);
    openBoardPanel();
    try {
      const detail = await getStocksenseApi().getBoardDetail(code, false, name);
      setSelectedBoard({ ...snapshot, ...detail, name: detail.name === detail.code ? name : detail.name });
    } catch {
      setSelectedBoard(snapshot);
    }
  };

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
        <div className={styles.idxRow}>
          {indices.map((idx) => (
            <button
              key={idx.code}
              className={`${styles.idxCard} ${styles.clickable}`}
              onClick={() => handleIndexClick(idx.code, idx.name)}
              type='button'
            >
              <div className={styles.idxName}>{idx.name}</div>
              <div className={styles.idxVal}>{idx.price ?? '--'}</div>
              <div className={`${styles.idxChg} ${chgClass(idx.changePercent)}`}>
                {idx.changePercent !== undefined && idx.changePercent !== null
                  ? `${Number(idx.changePercent) >= 0 ? '+' : ''}${Number(idx.changePercent).toFixed(2)}%`
                  : '--'}
              </div>
            </button>
          ))}
        </div>
      ) : null}
      {hasBreadth ? (
        <div className={styles.breadthChart}>
          <div className={styles.breadthTitle}>
            <BarChart3 size={14} />
            涨跌分布
          </div>
          <div className={styles.breadthBars}>
            <div className={styles.breadthRow}>
              <span className={`${styles.breadthLabel} ${styles.up}`}>上涨 {upCount}家</span>
              <div className={styles.breadthTrack}>
                <div className={`${styles.breadthFill} ${styles.up}`} style={{ width: `${Math.max(upPct, 2)}%` }} />
              </div>
              <span className={styles.breadthPct}>{upPct}%</span>
            </div>
            <div className={styles.breadthRow}>
              <span className={`${styles.breadthLabel} ${styles.down}`}>下跌 {downCount}家</span>
              <div className={styles.breadthTrack}>
                <div className={`${styles.breadthFill} ${styles.down}`} style={{ width: `${Math.max(downPct, 2)}%` }} />
              </div>
              <span className={styles.breadthPct}>{downPct}%</span>
            </div>
          </div>
        </div>
      ) : null}
      {bullets?.length ? (
        <ul className={styles.bulletList} style={{ marginTop: 12 }}>
          {bullets
            .filter((b) => !b.startsWith('上涨股票') && !b.startsWith('下跌股票'))
            .map((b, i) => (
              <li key={i}>{b}</li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}

function isRequestedBoardDetail(detail: BoardDetail, snapshot: BoardDetail) {
  if (snapshot.code && detail.code && detail.code !== snapshot.code) return false;
  if (!snapshot.code && detail.name && detail.name !== detail.code && detail.name !== snapshot.name) return false;
  return true;
}

export function MarketSummary({ indices, wealthMetrics, bullets, marketSummary }: IMarketSummaryProps) {
  const setSelectedBoard = useAppDataStore((state) => state.setSelectedBoard);
  const setSelectedStock = useAppDataStore((state) => state.setSelectedStock);
  const openRightPanel = useAppUiStore((state) => state.openRightPanel);
  const openBoardPanel = useAppUiStore((state) => state.openBoardPanel);
  const setStockReturnContext = useAppDataStore((state) => state.setStockReturnContext);

  if (!marketSummary) {
    return <LegacyMarketSummary indices={indices} wealthMetrics={wealthMetrics} bullets={bullets} />;
  }

  const {
    indices: msIndices,
    mainFundFlow,
    northFundFlow,
    limitUp,
    limitDown,
    sentimentBar,
    sectors,
    opportunityRadar,
    monthlyThemes,
    nextWeekSectors,
  } = marketSummary;

  const sortedSectors = [...sectors].sort((a, b) => b.changePercent - a.changePercent);
  const hasMainFundFlow = mainFundFlow !== null;
  const hasNorthFundFlow = northFundFlow !== null;

  const getSectorCellStyle = (sector: ISectorSummary) => ({
    background: sectorCellBg(sector.changePercent),
    borderColor: sectorCellBorder(sector.changePercent),
  });

  const handleSectorClick = async (sector: ISectorSummary) => {
    const snapshot = { code: sector.code, name: sector.name } as BoardDetail;
    setStockReturnContext(undefined);
    setSelectedBoard(snapshot);
    openBoardPanel();
    try {
      const detail = await getStocksenseApi().getBoardDetail(sector.code, false, sector.name);
      setSelectedBoard({ ...snapshot, ...detail, name: detail.name === detail.code ? sector.name : detail.name });
    } catch {
      // Keep the snapshot on error
    }
  };

  const handleIndexClick = async (code: string, name: string) => {
    const snapshot = { code, name } as BoardDetail;
    setStockReturnContext(undefined);
    setSelectedBoard(snapshot);
    openBoardPanel();
    try {
      const detail = await getStocksenseApi().getBoardDetail(code, false, name);
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

  const handleBoardNameClick = async (name: string, code?: string) => {
    const snapshot = { code: code ?? '', name } as BoardDetail;
    setStockReturnContext(undefined);
    setSelectedBoard(snapshot);
    openBoardPanel();
    try {
      const detail = await getStocksenseApi().getBoardDetail(snapshot.code, false, name);
      if (isRequestedBoardDetail(detail, snapshot)) {
        setSelectedBoard({ ...snapshot, ...detail, name: detail.name === detail.code ? name : detail.name });
      } else {
        setSelectedBoard(snapshot);
      }
    } catch {
      setSelectedBoard(snapshot);
    }
  };

  const getNextWeekSectorCode = (sector: INextWeekSector) =>
    sector.code ?? sectors.find((item) => item.name === sector.name)?.code;

  return (
    <div className={styles.marketSummary}>
      {/* ── Indices ── */}
      <div className={styles.msIndices}>
        {msIndices.map((idx) => (
          <button
            key={idx.code}
            className={`${styles.msIndexCard} ${styles.clickable}`}
            onClick={() => handleIndexClick(idx.code, idx.name)}
            type='button'
          >
            <div className={styles.msIndexName}>{idx.name}</div>
            <div className={styles.msIndexPrice}>{idx.price.toFixed(2)}</div>
            <div className={`${styles.msIndexChg} ${chgClass(idx.changePercent)}`}>
              {formatChange(idx.changePercent)}
            </div>
          </button>
        ))}
      </div>

      <SentimentBar value={sentimentBar} up={limitUp} down={limitDown} />
      {/* ── Sector Heatmap ── */}
      <div className={styles.msSection}>
        <div className={styles.msSectionHead}>
          <h3 className={styles.msSectionTitle}>板块强弱</h3>
        </div>
        <div className={styles.msSectorGrid}>
          {sortedSectors.slice(0, 12).map((sector) => (
            <button
              key={sector.code}
              className={styles.msSectorCell}
              style={getSectorCellStyle(sector)}
              onClick={() => handleSectorClick(sector)}
              type='button'
            >
              <span className={styles.msSectorName}>{sector.name}</span>
              <span className={`${styles.msSectorSub} ${chgClass(sector.changePercent)}`}>
                {formatChange(sector.changePercent)} · {formatAmountYi(sector.amount)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Opportunity Radar ── */}
      {opportunityRadar.length > 0 && (
        <div className={styles.msSection}>
          <div className={styles.msSectionHead}>
            <h3 className={styles.msSectionTitle}>机会雷达 · 资金抢跑但涨幅未跟上</h3>
          </div>
          <div className={styles.msRadarList}>
            {opportunityRadar.map((item) => (
              <button
                key={item.code}
                className={styles.msRadarRow}
                onClick={() => handleSectorClick(item)}
                type='button'
              >
                <div className={styles.msRadarLeft}>
                  <span className={styles.msRadarName}>{item.name}</span>
                  <span className={styles.msRadarRatio}>资金/涨幅比 {item.ratio.toFixed(1)}</span>
                </div>
                <div className={styles.msRadarRight}>
                  <span className={`${styles.msRadarFlow} ${chgClass(item.mainNetInflow)}`}>
                    {item.mainNetInflow >= 0 ? '+' : ''}
                    {item.mainNetInflow.toFixed(1)}亿
                  </span>
                  <span className={`${styles.msRadarChg} ${chgClass(item.changePercent)}`}>
                    {formatChange(item.changePercent)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Monthly Hot Themes ── */}
      {monthlyThemes.length > 0 && (
        <div className={styles.msSection}>
          <div className={styles.msSectionHead}>
            <h3 className={styles.msSectionTitle}>近一个月热点脉络</h3>
          </div>
          <div className={styles.msMonthlyGrid}>
            {monthlyThemes.map((theme) => (
              <div key={theme.week} className={styles.msMonthlyCard}>
                <div className={styles.msMonthlyWeek}>{theme.week}</div>
                {theme.leader ? (
                  <button
                    className={styles.msMonthlyTheme}
                    onClick={() => handleBoardNameClick(theme.theme)}
                    type='button'
                  >
                    {theme.theme}
                  </button>
                ) : (
                  <div className={styles.msMonthlyTheme}>{theme.theme}</div>
                )}
                {theme.leader ? (
                  <button
                    className={styles.msMonthlyLeader}
                    onClick={() => handleStockClick(theme.leader!.code, theme.leader!.name)}
                    type='button'
                  >
                    龙头 {theme.leader.name}
                  </button>
                ) : (
                  <div className={styles.msMonthlyLeader}>龙头数据暂缺</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Next Week Sectors ── */}
      {nextWeekSectors.length > 0 && (
        <div className={styles.msSection}>
          <div className={styles.msSectionHead}>
            <h3 className={styles.msSectionTitle}>下周可能比较强势的板块</h3>
          </div>
          <div className={styles.msNextWeekList}>
            {nextWeekSectors.map((sector) => (
              <button
                key={sector.name}
                className={styles.msNextWeekCard}
                onClick={() => handleBoardNameClick(sector.name, getNextWeekSectorCode(sector))}
                type='button'
              >
                <div className={styles.msNextWeekHeader}>
                  <span className={styles.msNextWeekName}>{sector.name}</span>
                  <span className={styles.msNextWeekScore}>AI 强度 {sector.score}</span>
                </div>
                <div className={styles.msNextWeekReasons}>
                  <div>
                    <b>资金面：</b>
                    {sector.reasoning.fundFlow}
                  </div>
                  <div>
                    <b>消息面：</b>
                    {sector.reasoning.news}
                  </div>
                  <div>
                    <b>政策面：</b>
                    {sector.reasoning.policy}
                  </div>
                  <div>
                    <b>技术面：</b>
                    {sector.reasoning.technical}
                  </div>
                  <div>
                    <b>板块轮动：</b>
                    {sector.reasoning.rotation}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
