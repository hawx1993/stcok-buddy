import { getStocksenseApi } from '../../../shared/stocksense-api';
import cx from '../../../shared/cx';
import { useAppStore } from '../../../store/app-store';
import type { BoardDetail, StockDetail } from '../../../shared/types';
import styles from '../index.module.scss';

export interface IOpportunityRadarBoardItem {
  code: string;
  name: string;
  ratio: number;
  changePercent: number;
  mainNetInflow: number;
}

export interface IOpportunityRadarStockItem {
  code: string;
  name: string;
  reason: string;
  changePercent?: number | null;
  amount?: number | null;
  score: number;
}

export interface IOpportunityRadarData {
  boards: IOpportunityRadarBoardItem[];
  stocks: IOpportunityRadarStockItem[];
}

interface IOpportunityRadarProps {
  data?: IOpportunityRadarData;
}

function hasStockRadarItems(data?: IOpportunityRadarData) {
  return Boolean(data?.stocks.length);
}

export function hasOpportunityRadarItems(data?: IOpportunityRadarData) {
  return hasStockRadarItems(data) || Boolean(data?.boards.length);
}

function formatChange(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatMoneyYi(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return '--';
  return `${value >= 0 ? '+' : ''}${(value / 100_000_000).toFixed(2)}亿`;
}

function formatMoneyYiUnit(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}亿`;
}

function toneClass(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return '';
  return value >= 0 ? 'up' : 'down';
}

export function OpportunityRadar({ data }: IOpportunityRadarProps) {
  const stocks = data?.stocks ?? [];
  const boards = data?.boards ?? [];
  const setSelectedStock = useAppStore((state) => state.setSelectedStock);
  const setSelectedBoard = useAppStore((state) => state.setSelectedBoard);
  const setStockReturnContext = useAppStore((state) => state.setStockReturnContext);
  const openRightPanel = useAppStore((state) => state.openRightPanel);
  const openBoardPanel = useAppStore((state) => state.openBoardPanel);

  const handleStockClick = async (item: IOpportunityRadarStockItem) => {
    const snapshot = { code: item.code, name: item.name, changePercent: item.changePercent ?? undefined } as StockDetail;
    setStockReturnContext(undefined);
    openRightPanel();
    setSelectedStock(snapshot);
    try {
      const detail = await getStocksenseApi().getStockDetail(item.code);
      setSelectedStock({ ...snapshot, ...detail, name: detail.name === detail.code ? item.name : detail.name });
    } catch {
      setSelectedStock(snapshot);
    }
  };

  const handleBoardClick = async (item: IOpportunityRadarBoardItem) => {
    const snapshot = { code: item.code, name: item.name } as BoardDetail;
    setStockReturnContext(undefined);
    setSelectedBoard(snapshot);
    openBoardPanel();
    try {
      const detail = await getStocksenseApi().getBoardDetail(item.code, false, item.name);
      setSelectedBoard({ ...snapshot, ...detail, name: detail.name === detail.code ? item.name : detail.name });
    } catch {
      setSelectedBoard(snapshot);
    }
  };

  if (!hasOpportunityRadarItems(data)) return <div className='empty-block'>暂无机会雷达数据</div>;

  return (
    <div className={styles.opportunityRadar}>
      <div className={styles.opportunityRadarList}>
        {stocks.map((item) => (
          <button className={styles.opportunityRadarRow} key={item.code} onClick={() => handleStockClick(item)} type='button'>
            <span className={styles.opportunityRadarMain}>
              <strong>{item.name}</strong>
              <em>{item.reason}</em>
            </span>
            <span className={styles.opportunityRadarMetrics}>
              <b className={cx(styles.opportunityRadarValue, toneClass(item.amount))}>{formatMoneyYi(item.amount)}</b>
              <b className={cx(styles.opportunityRadarValue, toneClass(item.changePercent))}>{formatChange(item.changePercent)}</b>
            </span>
          </button>
        ))}
        {!stocks.length && boards.map((item) => (
          <button className={styles.opportunityRadarRow} key={item.code} onClick={() => handleBoardClick(item)} type='button'>
            <span className={styles.opportunityRadarMain}>
              <strong>{item.name}</strong>
              <em>资金/涨幅比 {item.ratio.toFixed(1)}</em>
            </span>
            <span className={styles.opportunityRadarMetrics}>
              <b className={cx(styles.opportunityRadarValue, toneClass(item.mainNetInflow))}>
                {formatMoneyYiUnit(item.mainNetInflow)}
              </b>
              <b className={cx(styles.opportunityRadarValue, toneClass(item.changePercent))}>{formatChange(item.changePercent)}</b>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
