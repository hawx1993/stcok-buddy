import type { ReactNode } from 'react';
import { useState } from 'react';
import cx from '../../../shared/cx';
import type { KlinePoint, StockDetail } from '../../../shared/types';
import type { TimeframeId } from '../constants';
import styles from '../index.module.scss';

type KlineStock = Pick<StockDetail, 'code' | 'name' | 'pe' | 'price' | 'changePercent'>;
type TModalChangeTone = 'up' | 'down' | 'flat';

interface KlineModalFrameProps {
  stock: KlineStock;
  data?: KlinePoint[];
  onClose(): void;
  chipsOpen: boolean;
  renderChart(tf: TimeframeId, setTf: (tf: TimeframeId) => void): ReactNode;
}

export function KlineModalFrame({ stock, onClose, renderChart }: KlineModalFrameProps) {
  const [tf, setTf] = useState<TimeframeId>('1d');
  const changePercent = formatModalChangePercent(stock.changePercent);
  const changeTone = getModalChangeTone(stock.changePercent);
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles['modal-title-group']}>
            <span className={styles['modal-title']}>{stock.name}</span>
            <span className={styles['modal-code']}>{stock.code || '--'}</span>
            <span className={styles['modal-tag']}>K线图</span>
          </div>
          <div className={styles['modal-header-actions']}>
            {stock.price !== undefined ? <span className={styles['modal-meta']}>现价 {stock.price}</span> : null}
            {changePercent ? (
              <span className={cx(styles['modal-meta'], styles['modal-change'], styles[changeTone])}>
                涨跌幅 {changePercent}
              </span>
            ) : null}
            {stock.pe !== undefined ? <span className={styles['modal-meta']}>PE {stock.pe}</span> : null}
            <button className={styles['modal-close']} onClick={onClose} type='button' aria-label='关闭K线图弹窗'>
              ✕
            </button>
          </div>
        </div>
        {renderChart(tf, setTf)}
      </div>
    </div>
  );
}

export function formatModalChangePercent(value: StockDetail['changePercent']) {
  const numeric = parseModalChangePercent(value);
  if (numeric === undefined) return undefined;
  return `${numeric > 0 ? '+' : ''}${numeric.toFixed(2)}%`;
}

export function getModalChangeTone(value: StockDetail['changePercent']): TModalChangeTone {
  const numeric = parseModalChangePercent(value);
  if (numeric === undefined || numeric === 0) return 'flat';
  return numeric > 0 ? 'up' : 'down';
}

function parseModalChangePercent(value: StockDetail['changePercent']) {
  if (value === undefined || value === '') return undefined;
  const numeric = Number.parseFloat(value.replace('%', ''));
  return Number.isFinite(numeric) ? numeric : undefined;
}
