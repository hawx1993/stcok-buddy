import StockSDK from 'stock-sdk';
import type { NorthboundFlowSummary } from 'stock-sdk';

const sdk = new StockSDK({ timeout: 12_000, retry: { maxRetries: 1 } });

export interface INorthboundFlowReport {
  /** 最新交易日 YYYY-MM-DD */
  date: string;
  /** 北向净买入是否披露（false=交易所自 2024-08 起停止实时披露） */
  netBuyDisclosed: boolean;
  /** 披露说明，供 LLM 如实作答（避免把未披露的 0 误报为净买入为 0） */
  note: string;
  /** 基于真实数据可直接引用的摘要：北向涨跌家数与对应指数表现 */
  summary: string;
  /** 沪深港通资金流向汇总原始行（沪股通/深股通/港股通沪/港股通深） */
  rows: NorthboundFlowSummary[];
}

function isNorthRow(row: NorthboundFlowSummary): boolean {
  return row.direction?.includes('北向') ?? false;
}

/** 北向净买入是否披露：北向行中存在非空且非 0 的净买额（含 netInflow 兜底）才视为已披露。 */
export function isNorthboundNetBuyDisclosed(rows: NorthboundFlowSummary[]): boolean {
  return rows.filter(isNorthRow).some((row) => {
    const value = row.netBuyAmount ?? row.netInflow;
    return value !== null && value !== undefined && value !== 0;
  });
}

function formatIndexPercent(value: number | null): string {
  return value === null ? '--' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

/** 北向涨跌家数与对应指数表现摘要，供 LLM 直接引用（涨跌家数与指数均为无单位真实数据）。 */
export function buildNorthboundSummary(rows: NorthboundFlowSummary[]): string {
  return rows
    .filter(isNorthRow)
    .map((row) => {
      const up = row.upCount;
      const flat = row.flatCount;
      const down = row.downCount;
      const hasBreadth = up !== null || down !== null;
      const breadth = hasBreadth
        ? `上涨 ${up ?? 0} 家 / 持平 ${flat ?? 0} 家 / 下跌 ${down ?? 0} 家`
        : '涨跌家数暂无';
      return `${row.boardName}：${breadth}，对应${row.indexName} ${formatIndexPercent(row.indexChangePercent)}`;
    })
    .join('；');
}

/** 北向披露说明，供 LLM 如实作答。 */
export function buildNorthboundNote(rows: NorthboundFlowSummary[]): string {
  const northRows = rows.filter(isNorthRow);
  if (!northRows.length) return '未获取到北向资金汇总数据，请按数据源暂不可用处理。';
  if (isNorthboundNetBuyDisclosed(rows)) return '北向资金净买入金额正常披露，可直接使用 netBuyAmount 作答。';
  return '北向资金（沪股通/深股通）净买入金额自 2024 年 8 月起交易所停止实时披露，netBuyAmount=0 表示未披露而非净买入为 0；请基于 summary 中的北向涨跌家数与指数表现如实回答当日北向情况。南向（港股通）净买入仍披露，可参考 rows。';
}

/** 获取沪深港通（北向/南向）资金流向汇总：真实数据源 stock-sdk northbound.summary。 */
export async function listNorthboundFlow(): Promise<INorthboundFlowReport> {
  const rows = await sdk.northbound.summary();
  const latestDate = [...rows].sort((a, b) => b.date.localeCompare(a.date))[0]?.date ?? '';
  return {
    date: latestDate,
    netBuyDisclosed: isNorthboundNetBuyDisclosed(rows),
    note: buildNorthboundNote(rows),
    summary: buildNorthboundSummary(rows),
    rows,
  };
}
