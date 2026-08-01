import type { IDragonTigerDetailRow, MarketQuoteRow } from '../../../shared/types';
import { formatMoney, formatPercent, tone } from '../market-format';
import styles from '../index.module.scss';

const DRAGON_TIGER_RANK_VISIBLE_SIZE = 10;

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
  const visibleRows = rows.slice(0, DRAGON_TIGER_RANK_VISIBLE_SIZE);

  return (
    <div className={styles.dragonTigerRankCard}>
      <div className={styles.dragonTigerSubTitle}>
        <span>{title}</span>
        <em>{visibleRows.length ? `共 ${visibleRows.length} 条` : '暂无'}</em>
      </div>
      {visibleRows.length ? (
        <div className={styles.dragonTigerRankList}>
          {visibleRows.map((row, index) => (
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
              <span className={styles.dragonTigerRankReason}>{row.reason}</span>
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
