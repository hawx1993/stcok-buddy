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
          <div>
            {stock.name}（{stock.code || '--'}）K线图
          </div>
          <button onClick={onClose} type='button'>
            ✕
          </button>
        </div>
        {renderChart(tf, setTf)}
      </div>
    </div>
  );
}
