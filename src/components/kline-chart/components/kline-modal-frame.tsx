import type { ReactNode } from 'react';
import { useState } from 'react';
import type { KlinePoint, StockDetail } from '../../../shared/types';
import type { TimeframeId } from '../index';
import styles from '../index.module.scss';

type KlineStock = Pick<StockDetail, 'code' | 'name' | 'pe' | 'price'>;

interface KlineModalFrameProps {
  stock: KlineStock;
  data?: KlinePoint[];
  onClose(): void;
  chipsOpen: boolean;
  renderChart(tf: TimeframeId, setTf: (tf: TimeframeId) => void): ReactNode;
}

export function KlineModalFrame({ stock, onClose, renderChart }: KlineModalFrameProps) {
  const [tf, setTf] = useState<TimeframeId>('1d');
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
