import { useState } from 'react';
import type { AgentResultCard, BoardDetail, StockDetail } from '../../../shared/types';
import { KlineModal, StockKlineChart } from '../../kline-chart';
import { renderMarkdownContent } from './markdown';
import { renderCell } from './render-cell';
import cx from '../../../shared/cx';
import styles from '../index.module.scss';

export function ResultCard({
  result,
  onStockClick,
  onBoardClick,
}: {
  result: AgentResultCard;
  onStockClick(stock: StockDetail): void;
  onBoardClick(board: Pick<BoardDetail, 'code' | 'name'>): void;
}) {
  const [open, setOpen] = useState(!isNewsAnnouncementCard(result));
  const [rowsOpen, setRowsOpen] = useState(false);
  const headers = result.rows?.[0] ? Object.keys(result.rows[0]) : [];
  const isCollapsible = isNewsAnnouncementCard(result);
  const isDailyDragonTiger = isDailyDragonTigerCard(result);
  const rows = result.rows ?? [];
  const visibleRows = isDailyDragonTiger && !rowsOpen ? rows.slice(0, 5) : rows;
  return (
    <div className={styles.card} data-card>
      <div className={styles['card-title']}>
        <span>{result.title}</span>
        <span className={styles.sub}>{result.subtitle}</span>
        {isCollapsible ? (
          <button className={styles['card-toggle']} onClick={() => setOpen((value) => !value)} type='button'>
            {open ? '收起' : '展开'}
          </button>
        ) : null}
      </div>
      {result.metrics?.length ? (
        <div className={styles['metric-row']}>
          {result.metrics.map((metric) => (
            <div className={styles['metric-item']} key={metric.label}>
              <div className={styles.lbl}>{metric.label}</div>
              <div className={cx(styles.val, metric.tone ? styles[metric.tone] : undefined)}>{metric.value}</div>
            </div>
          ))}
        </div>
      ) : null}
      {open && result.chart?.type === 'kline' ? (
        <KlineChart data={result.chart.data} stock={result.stocks?.[0]} />
      ) : null}
      {open && headers.length ? (
        <>
          <div className={styles['table-wrap']}>
            <table className={cx(styles.tbl, isDailyDragonTiger && styles['lhb-table'])}>
              <thead>
                <tr>
                  {headers.map((header, index) => (
                    <th className={getTableCellClass(header, index, headers.length)} key={header}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, index) => (
                  <tr key={index}>
                    {headers.map((header, colIndex) => (
                      <td className={getTableCellClass(header, colIndex, headers.length)} key={header}>
                        {renderCell(header, row, onStockClick, onBoardClick)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {isDailyDragonTiger && rows.length > 5 ? (
            <button className={styles['table-toggle']} onClick={() => setRowsOpen((value) => !value)} type='button'>
              {rowsOpen ? '收起列表' : `展开全部 ${rows.length} 条`}
            </button>
          ) : null}
        </>
      ) : null}
      {open && result.narrative && !isCollapsible ? (
        <div
          className={styles['card-narrative']}
          dangerouslySetInnerHTML={{
            __html: renderMarkdownContent(result.narrative, { disclaimer: result.title !== '技术指标摘要' }),
          }}
        />
      ) : null}
    </div>
  );
}

function isDailyDragonTigerCard(result: AgentResultCard) {
  return result.title === '全市场龙虎榜';
}

export function getTableCellClass(header: string, index?: number, total?: number) {
  if (total !== undefined && index === total - 1) return styles['col-last'];
  if (index === 2) return styles['col-wrap'];
  if (/^(名称|name|title)$/i.test(header)) return styles['col-name'];
  if (/上榜原因|reason/i.test(header)) return styles['col-reason'];
  return undefined;
}

export function isNewsAnnouncementCard(result: AgentResultCard) {
  return (
    /新闻公告/.test(result.title) ||
    (result.metrics?.some((metric) => metric.label === '新闻') &&
      result.metrics?.some((metric) => metric.label === '公告'))
  );
}

function KlineChart({ data, stock }: { data: NonNullable<AgentResultCard['chart']>['data']; stock?: StockDetail }) {
  const [isModalOpen, setModalOpen] = useState(false);
  return (
    <div className={styles['card-kline']}>
      <button className={styles['kline-expand']} onClick={() => setModalOpen(true)} title='放大K线图' type='button'>
        ⛶
      </button>
      <StockKlineChart stock={stock} data={data} height={230} />
      {isModalOpen ? (
        <KlineModal
          stock={stock ?? { code: '', name: '技术指标摘要' }}
          data={data}
          onClose={() => setModalOpen(false)}
        />
      ) : null}
    </div>
  );
}
