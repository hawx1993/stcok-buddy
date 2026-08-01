import { useEffect, useState } from 'react';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { IDragonTigerSnapshot, MarketQuoteRow, TDragonTigerRange } from '../../../shared/types';
import cx from '../../../shared/cx';
import { DragonTigerRankList } from './dragon-tiger-rank-list';
import { DragonTigerSummary } from './dragon-tiger-summary';
import { formatMoney, formatPercent, tone } from '../market-format';
import styles from '../index.module.scss';

const ranges: Array<{ id: TDragonTigerRange; label: string }> = [
  { id: 'today', label: '最新' },
  { id: '5d', label: '5日' },
  { id: '10d', label: '10日' },
  { id: '30d', label: '30日' },
];

const DRAGON_TIGER_INSTITUTION_VISIBLE_SIZE = 8;

export function DragonTigerPanel({ onOpen }: { onOpen(row: MarketQuoteRow): void }) {
  const [range, setRange] = useState<TDragonTigerRange>('today');
  const [snapshot, setSnapshot] = useState<IDragonTigerSnapshot>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(undefined);
    getStocksenseApi()
      .getDragonTigerSnapshot(range)
      .then((data) => {
        if (!alive) return;
        setSnapshot(data);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [range]);

  return (
    <section className={styles.dragonTigerPanel}>
      <div className={styles.dragonTigerHeader}>
        <div>
          <h2>龙虎榜</h2>
          <p>stock-sdk 真实上榜数据 · 净买额、原因与机构/营业部线索</p>
        </div>
        <div className={styles.dragonTigerRanges}>
          {ranges.map((item) => (
            <button
              key={item.id}
              className={cx(range === item.id && styles.dragonTigerRangeActive)}
              onClick={() => setRange(item.id)}
              type='button'
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? <DragonTigerSkeleton /> : null}
      {!loading && error ? <div className={styles.dragonTigerState}>龙虎榜数据源暂不可用：{error}</div> : null}
      {!loading && !error && snapshot ? <DragonTigerContent snapshot={snapshot} onOpen={onOpen} /> : null}
    </section>
  );
}

function DragonTigerSkeleton() {
  return (
    <div className={styles.dragonTigerSkeleton} aria-label='龙虎榜加载中'>
      <div className={styles.dragonTigerSummary}>
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className={styles.dragonTigerMetricSkeleton}>
            <span />
            <strong />
          </div>
        ))}
      </div>
      <div className={styles.dragonTigerGrid}>
        {[0, 1, 2].map((card) => (
          <div key={card} className={styles.dragonTigerRankSkeletonCard}>
            <div className={styles.dragonTigerSkeletonTitle} />
            {card === 2
              ? [0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
                  <div key={row} className={styles.dragonTigerCompactSkeletonRow}>
                    <span />
                    <em />
                    <em />
                  </div>
                ))
              : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((row) => (
                  <div key={row} className={styles.dragonTigerSkeletonRow}>
                    <span />
                    <span />
                    <em />
                    <em />
                    <strong />
                  </div>
                ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function DragonTigerContent({
  snapshot,
  onOpen,
}: {
  snapshot: IDragonTigerSnapshot;
  onOpen(row: MarketQuoteRow): void;
}) {
  if (!snapshot.rows.length) {
    return <div className={styles.dragonTigerState}>暂无龙虎榜数据，可能为非交易日或数据尚未更新</div>;
  }

  return (
    <>
      <DragonTigerSummary summary={snapshot.summary} />
      <div className={styles.dragonTigerGrid}>
        <DragonTigerRankList title='净买入 TOP' rows={snapshot.topNetBuy} emptyText='暂无净买入记录' onOpen={onOpen} />
        <DragonTigerRankList title='净卖出 TOP' rows={snapshot.topNetSell} emptyText='暂无净卖出记录' onOpen={onOpen} />
        <div className={styles.dragonTigerReasonCard}>
          <div className={styles.dragonTigerSubTitle}>
            <span>机构净买入</span>
            <em>{snapshot.institutionTop.length ? `共 ${snapshot.institutionTop.length} 条` : '暂无'}</em>
          </div>
          {snapshot.institutionTop.length ? (
            <div className={styles.dragonTigerCompactList}>
              {snapshot.institutionTop.slice(0, DRAGON_TIGER_INSTITUTION_VISIBLE_SIZE).map((item) => (
                <button
                  key={`${item.date}-${item.code}`}
                  className={(item.orgNetAmount ?? 0) > 0 ? styles.dragonTigerInstitutionBuy : undefined}
                  onClick={() =>
                    onOpen({
                      code: item.code,
                      name: item.name,
                      price: item.price ?? undefined,
                      changePercent: item.changePercent ?? undefined,
                    })
                  }
                  type='button'
                >
                  <span>{item.name}</span>
                  <em>
                    现价 {item.price ?? '--'} ·{' '}
                    <span className={tone(item.changePercent)}>{formatPercent(item.changePercent)}</span>
                  </em>
                  <em>
                    {item.buyOrgCount ?? 0}买/{item.sellOrgCount ?? 0}卖 · {formatMoney(item.orgNetAmount)}
                  </em>
                </button>
              ))}
            </div>
          ) : (
            <div className={styles.dragonTigerEmpty}>暂无机构席位数据</div>
          )}
        </div>
      </div>
      {snapshot.warnings.length ? (
        <div className={styles.dragonTigerWarning}>{snapshot.warnings.join('；')}</div>
      ) : null}
    </>
  );
}
