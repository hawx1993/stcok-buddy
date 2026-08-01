import type { IDragonTigerDetailRow, MarketQuoteRow } from '../../../shared/types';
import { formatMoney, formatPercent, tone } from '../market-format';
import styles from '../index.module.scss';

export function DragonTigerRankList({
  title,
  rows,
  emptyText,
  onOpen,
}: {
  title: string;
  rows: IDragonTigerDetailRow[];
  emptyText: string;
  onOpen(row: MarketQuoteRow): void;
}) {
  return (
    <div className={styles.dragonTigerRankCard}>
      <div className={styles.dragonTigerSubTitle}>{title}</div>
      {rows.length ? (
        <div className={styles.dragonTigerRankList}>
          {rows.slice(0, 6).map((row, index) => (
            <button
              key={row.id}
              className={styles.dragonTigerRankItem}
              onClick={() => onOpen({ code: row.code, name: row.name, price: row.close ?? undefined, changePercent: row.changePercent ?? undefined })}
              type='button'
            >
              <span className={styles.dragonTigerRankNo}>{index + 1}</span>
              <span className={styles.dragonTigerStock}>
                <strong>{row.name}</strong>
                <em>{row.code}</em>
              </span>
              <span className={tone(row.changePercent)}>{formatPercent(row.changePercent)}</span>
              <span className={styles.dragonTigerMoney}>{formatMoney(row.netBuyAmount)}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className={styles.dragonTigerEmpty}>{emptyText}</div>
      )}
    </div>
  );
}
