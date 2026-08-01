import type {
  IDragonTigerBranchRow,
  IDragonTigerDetailRow,
  IDragonTigerInstitutionRow,
  IDragonTigerReasonStat,
  IDragonTigerSnapshot,
  TDragonTigerRange,
} from '../../../src/shared/types.js';
import { pickNumber, pickString } from './format.js';
import { sdk, withTimeoutReject } from './shared.js';

const DRAGON_TIGER_TIMEOUT_MS = 10_000;
const TODAY_LOOKBACK_DAYS = 7;
const EASTMONEY_DATACENTER_URL = 'https://datacenter-web.eastmoney.com/api/data/v1/get';

export interface DailyDragonTigerItem {
  id: string;
  date: string;
  code: string;
  name: string;
  reason: string;
  close?: number;
  changePercent?: number;
  netBuy: number;
  buy: number;
  sell: number;
  turnover?: number;
}

export interface DailyDragonTigerGroup {
  date: string;
  items: DailyDragonTigerItem[];
}

type TStockSdkDragonTigerDetail = Awaited<ReturnType<typeof sdk.dragonTiger.detail>>[number];
type TStockSdkDragonTigerInstitution = Awaited<ReturnType<typeof sdk.dragonTiger.institution>>[number];
type TStockSdkDragonTigerBranch = Awaited<ReturnType<typeof sdk.dragonTiger.branchRank>>[number];
type TEastmoneyDatacenterPayload = { result?: { data?: Record<string, unknown>[] } };

export async function getDragonTigerSnapshot(range: TDragonTigerRange = 'today'): Promise<IDragonTigerSnapshot> {
  const requestRange = getDragonTigerDateRange(range);
  const detailRows = await fetchDetailRows(range, requestRange.startDate, requestRange.endDate);
  const effectiveRange = detailRows.length && range === 'today'
    ? { startDate: toCompactDate(detailRows[0].date), endDate: toCompactDate(detailRows[0].date) }
    : requestRange;
  const filteredRows = range === 'today' && detailRows[0]?.date
    ? detailRows.filter((row) => row.date === detailRows[0].date)
    : detailRows;
  const warnings: string[] = [];

  const [institutionResult, branchResult] = await Promise.allSettled([
    withTimeoutReject(sdk.dragonTiger.institution(effectiveRange), DRAGON_TIGER_TIMEOUT_MS, '龙虎榜机构买卖加载超时'),
    withTimeoutReject(sdk.dragonTiger.branchRank(toSdkPeriod(range)), DRAGON_TIGER_TIMEOUT_MS, '龙虎榜营业部排行加载超时'),
  ]);

  if (institutionResult.status === 'rejected') warnings.push(toWarningMessage('机构买卖', institutionResult.reason));
  if (branchResult.status === 'rejected') warnings.push(toWarningMessage('营业部排行', branchResult.reason));

  let institutionTop = institutionResult.status === 'fulfilled' ? institutionResult.value.map(toInstitutionRow) : [];
  if (!institutionTop.length && filteredRows.length) {
    institutionTop = await fetchInstitutionRowsFromDetails(filteredRows, warnings);
  }
  institutionTop = await enrichInstitutionRowsWithQuotes(institutionTop, filteredRows, warnings);

  return buildDragonTigerSnapshot({
    range,
    startDate: effectiveRange.startDate,
    endDate: effectiveRange.endDate,
    rows: filteredRows,
    institutionTop: institutionTop.slice(0, 8),
    branchTop: branchResult.status === 'fulfilled' ? branchResult.value.map(toBranchRow).slice(0, 8) : [],
    warnings,
  });
}

export async function listDailyDragonTiger(): Promise<DailyDragonTigerItem[]> {
  const [latest] = await listRecentDragonTigerDays(1);
  return latest?.items ?? [];
}

export async function listRecentDragonTigerDays(limit = 5): Promise<DailyDragonTigerGroup[]> {
  const requestRange = getRecentDragonTigerHistoryRange();
  const rows = await fetchDetailRows('30d', requestRange.startDate, requestRange.endDate);
  const groups = new Map<string, DailyDragonTigerItem[]>();
  for (const row of rows) {
    const items = groups.get(row.date) ?? [];
    items.push(toDailyDragonTigerItem(row));
    groups.set(row.date, items);
  }
  return Array.from(groups.entries())
    .sort(([left], [right]) => right.localeCompare(left))
    .slice(0, Math.max(1, limit))
    .map(([date, items]) => ({ date, items }));
}

async function fetchDetailRows(
  range: TDragonTigerRange,
  startDate: string,
  endDate: string,
): Promise<IDragonTigerDetailRow[]> {
  if (range !== 'today') {
    const rows = await withTimeoutReject(
      sdk.dragonTiger.detail({ startDate, endDate }),
      DRAGON_TIGER_TIMEOUT_MS,
      '龙虎榜详情加载超时',
    );
    return sortDetailRows(rows.map(toDetailRow));
  }

  for (const date of recentDateCandidates(TODAY_LOOKBACK_DAYS)) {
    const rows = await withTimeoutReject(
      sdk.dragonTiger.detail({ startDate: date, endDate: date }),
      DRAGON_TIGER_TIMEOUT_MS,
      '龙虎榜详情加载超时',
    );
    if (rows.length) return sortDetailRows(rows.map(toDetailRow));
  }
  return [];
}

async function fetchInstitutionRowsFromDetails(
  rows: IDragonTigerDetailRow[],
  warnings: string[],
): Promise<IDragonTigerInstitutionRow[]> {
  const result: IDragonTigerInstitutionRow[] = [];
  for (const row of rows.slice(0, 8)) {
    try {
      const institution = await fetchEastmoneyInstitutionForStock(row.code, row.date);
      if (institution && institution.orgNetAmount !== 0) result.push({ ...institution, changePercent: row.changePercent });
    } catch (error) {
      warnings.push(`a-stock-data 机构席位降级失败（${row.code}）：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!result.length) warnings.push('stock-sdk 未返回机构买卖数据，a-stock-data 机构席位明细也未检索到机构专用净买入');
  if (result.length) warnings.push('stock-sdk 未返回机构买卖数据，已使用 a-stock-data 东财席位明细补充机构净买入');
  return result.sort((a, b) => (b.orgNetAmount ?? 0) - (a.orgNetAmount ?? 0) || a.code.localeCompare(b.code));
}

async function fetchEastmoneyInstitutionForStock(code: string, date: string): Promise<IDragonTigerInstitutionRow | undefined> {
  const buyRows = await fetchEastmoneyDatacenterRows(
    'RPT_BILLBOARD_DAILYDETAILSBUY',
    `(TRADE_DATE='${date}')(SECURITY_CODE=\"${code}\")`,
    'BUY',
  );
  const sellRows = await fetchEastmoneyDatacenterRows(
    'RPT_BILLBOARD_DAILYDETAILSSELL',
    `(TRADE_DATE='${date}')(SECURITY_CODE=\"${code}\")`,
    'SELL',
  );
  const buyInstitutionRows = buyRows.filter(isInstitutionSeat);
  const sellInstitutionRows = sellRows.filter(isInstitutionSeat);
  const orgBuyAmount = sumDatacenterAmount(buyInstitutionRows, 'BUY');
  const orgSellAmount = sumDatacenterAmount(sellInstitutionRows, 'SELL');
  if (orgBuyAmount === 0 && orgSellAmount === 0) return undefined;
  return {
    code,
    name: pickString(buyRows[0] ?? sellRows[0], ['SECURITY_NAME_ABBR', 'SECURITY_NAME']) ?? code,
    date,
    price: null,
    changePercent: pickNumber(buyRows[0] ?? sellRows[0], ['CHANGE_RATE']) ?? null,
    buyOrgCount: buyInstitutionRows.length,
    sellOrgCount: sellInstitutionRows.length,
    orgBuyAmount,
    orgSellAmount,
    orgNetAmount: orgBuyAmount - orgSellAmount,
  };
}

async function enrichInstitutionRowsWithQuotes(
  rows: IDragonTigerInstitutionRow[],
  detailRows: IDragonTigerDetailRow[],
  warnings: string[],
): Promise<IDragonTigerInstitutionRow[]> {
  if (!rows.length) return rows;
  const detailByCode = new Map(detailRows.map((row) => [row.code, row]));
  let quoteByCode = new Map<string, Awaited<ReturnType<typeof sdk.quotes.cn>>[number]>();
  try {
    const quotes = await sdk.quotes.cn(rows.map((row) => row.code));
    quoteByCode = new Map(quotes.map((quote) => [normalizeCode(quote.code), quote]));
  } catch (error) {
    warnings.push(`机构净买入实时行情获取失败：${error instanceof Error ? error.message : String(error)}`);
  }

  return rows.map((row) => {
    const quote = quoteByCode.get(row.code);
    const detail = detailByCode.get(row.code);
    return {
      ...row,
      price: toNullableNumber(quote?.price) ?? detail?.close ?? row.price,
      changePercent: toNullableNumber(quote?.changePercent) ?? detail?.changePercent ?? row.changePercent,
    };
  });
}

async function fetchEastmoneyDatacenterRows(
  reportName: string,
  filter: string,
  sortColumns: string,
): Promise<Record<string, unknown>[]> {
  const url = new URL(EASTMONEY_DATACENTER_URL);
  url.search = new URLSearchParams({
    reportName,
    columns: 'ALL',
    filter,
    pageNumber: '1',
    pageSize: '10',
    sortColumns,
    sortTypes: '-1',
    source: 'WEB',
    client: 'WEB',
  }).toString();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DRAGON_TIGER_TIMEOUT_MS),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Referer: 'https://data.eastmoney.com/',
    },
  });
  if (!response.ok) throw new Error(`东财数据中心请求失败：HTTP ${response.status}`);
  const payload = (await response.json()) as TEastmoneyDatacenterPayload;
  return payload.result?.data ?? [];
}

function isInstitutionSeat(row: Record<string, unknown>): boolean {
  return pickString(row, ['OPERATEDEPT_CODE']) === '0' || /机构专用/.test(pickString(row, ['OPERATEDEPT_NAME']) ?? '');
}

function sumDatacenterAmount(rows: Record<string, unknown>[], key: 'BUY' | 'SELL') {
  return rows.reduce((sum, row) => sum + (pickNumber(row, [key]) ?? 0), 0);
}

function buildDragonTigerSnapshot({
  range,
  startDate,
  endDate,
  rows,
  institutionTop,
  branchTop,
  warnings,
}: {
  range: TDragonTigerRange;
  startDate: string;
  endDate: string;
  rows: IDragonTigerDetailRow[];
  institutionTop: IDragonTigerInstitutionRow[];
  branchTop: IDragonTigerBranchRow[];
  warnings: string[];
}): IDragonTigerSnapshot {
  const topNetBuy = rows
    .filter((row) => (row.netBuyAmount ?? 0) > 0)
    .sort((a, b) => (b.netBuyAmount ?? 0) - (a.netBuyAmount ?? 0) || a.code.localeCompare(b.code))
    .slice(0, 10);
  const topNetSell = rows
    .filter((row) => (row.netBuyAmount ?? 0) < 0)
    .sort((a, b) => (a.netBuyAmount ?? 0) - (b.netBuyAmount ?? 0) || a.code.localeCompare(b.code))
    .slice(0, 10);
  const buyAmount = sumRows(rows, 'buyAmount');
  const sellAmount = sumRows(rows, 'sellAmount');
  const netBuyAmount = sumRows(rows, 'netBuyAmount');
  const top = topNetBuy[0];
  const updatedAt = new Date().toISOString();
  return {
    range,
    summary: {
      tradeDate: rows[0]?.date ?? toIsoDate(endDate),
      startDate: toIsoDate(startDate),
      endDate: toIsoDate(endDate),
      totalCount: rows.length,
      netBuyAmount,
      buyAmount,
      sellAmount,
      netBuyCount: rows.filter((row) => (row.netBuyAmount ?? 0) > 0).length,
      netSellCount: rows.filter((row) => (row.netBuyAmount ?? 0) < 0).length,
      topNetBuy: top
        ? {
            code: top.code,
            name: top.name,
            date: top.date,
            value: top.netBuyAmount ?? 0,
            changePercent: top.changePercent,
            reason: top.reason,
          }
        : undefined,
      dataSource: 'stock-sdk',
      updatedAt,
    },
    topNetBuy,
    topNetSell,
    activeReasons: buildReasonStats(rows),
    institutionTop: institutionTop
      .sort((a, b) => (b.orgNetAmount ?? 0) - (a.orgNetAmount ?? 0) || a.code.localeCompare(b.code))
      .slice(0, 8),
    branchTop: branchTop
      .sort((a, b) => (b.totalBuyAmount ?? 0) - (a.totalBuyAmount ?? 0) || a.code.localeCompare(b.code))
      .slice(0, 8),
    rows,
    warnings,
  };
}

function toDetailRow(row: TStockSdkDragonTigerDetail): IDragonTigerDetailRow {
  return {
    id: `dragon-tiger-${row.date}-${row.code}-${stableTextKey(row.reason)}`,
    code: normalizeCode(row.code),
    name: row.name,
    date: row.date,
    reason: row.reason,
    close: row.close,
    changePercent: row.changePercent,
    netBuyAmount: row.netBuyAmount,
    buyAmount: row.buyAmount,
    sellAmount: row.sellAmount,
    dealAmount: row.dealAmount,
    totalAmount: row.totalAmount,
    netBuyRatio: row.netBuyRatio,
    dealAmountRatio: row.dealAmountRatio,
    turnoverRate: row.turnoverRate,
    floatMarketValue: row.floatMarketValue,
    afterChange1d: row.afterChange1d,
    afterChange2d: row.afterChange2d,
    afterChange5d: row.afterChange5d,
    afterChange10d: row.afterChange10d,
  };
}

function toInstitutionRow(row: TStockSdkDragonTigerInstitution): IDragonTigerInstitutionRow {
  return {
    code: normalizeCode(row.code),
    name: row.name,
    date: row.date,
    price: null,
    changePercent: row.changePercent,
    buyOrgCount: row.buyOrgCount,
    sellOrgCount: row.sellOrgCount,
    orgBuyAmount: row.orgBuyAmount,
    orgSellAmount: row.orgSellAmount,
    orgNetAmount: row.orgNetAmount,
  };
}

function toBranchRow(row: TStockSdkDragonTigerBranch): IDragonTigerBranchRow {
  return {
    code: row.code,
    name: row.name,
    totalBuyAmount: row.totalBuyAmount,
    totalSellAmount: row.totalSellAmount,
    buyCount: row.buyCount,
    sellCount: row.sellCount,
    totalCount: row.totalCount,
  };
}

function buildReasonStats(rows: IDragonTigerDetailRow[]): IDragonTigerReasonStat[] {
  const stats = new Map<string, IDragonTigerReasonStat>();
  for (const row of rows) {
    const reason = row.reason || '未披露原因';
    const current = stats.get(reason) ?? { reason, count: 0, netBuyAmount: 0, buyAmount: 0, sellAmount: 0 };
    current.count += 1;
    current.netBuyAmount += row.netBuyAmount ?? 0;
    current.buyAmount += row.buyAmount ?? 0;
    current.sellAmount += row.sellAmount ?? 0;
    stats.set(reason, current);
  }
  return [...stats.values()]
    .sort((a, b) => b.count - a.count || b.netBuyAmount - a.netBuyAmount || a.reason.localeCompare(b.reason))
    .slice(0, 8);
}

function sortDetailRows(rows: IDragonTigerDetailRow[]): IDragonTigerDetailRow[] {
  return rows.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      (b.netBuyAmount ?? 0) - (a.netBuyAmount ?? 0) ||
      a.code.localeCompare(b.code),
  );
}

function toDailyDragonTigerItem(row: IDragonTigerDetailRow): DailyDragonTigerItem {
  return {
    id: row.id,
    date: row.date,
    code: row.code,
    name: row.name,
    reason: row.reason,
    close: numberOrUndefined(row.close),
    changePercent: numberOrUndefined(row.changePercent),
    netBuy: row.netBuyAmount ?? 0,
    buy: row.buyAmount ?? 0,
    sell: row.sellAmount ?? 0,
    turnover: numberOrUndefined(row.turnoverRate),
  };
}

function getDragonTigerDateRange(range: TDragonTigerRange): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end);
  if (range === '5d') start.setDate(end.getDate() - 4);
  if (range === '10d') start.setDate(end.getDate() - 9);
  if (range === '30d') start.setDate(end.getDate() - 29);
  return { startDate: formatCompactDate(start), endDate: formatCompactDate(end) };
}

function getRecentDragonTigerHistoryRange(): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 29);
  return { startDate: formatCompactDate(start), endDate: formatCompactDate(end) };
}

function recentDateCandidates(days: number): string[] {
  const date = new Date();
  const result: string[] = [];
  for (let index = 0; index < days; index += 1) {
    result.push(formatCompactDate(date));
    date.setDate(date.getDate() - 1);
  }
  return result;
}

function toSdkPeriod(range: TDragonTigerRange): '1month' | '3month' | '6month' | '1year' {
  if (range === '30d') return '1month';
  return '1month';
}

function sumRows(rows: IDragonTigerDetailRow[], key: 'netBuyAmount' | 'buyAmount' | 'sellAmount') {
  return rows.reduce((sum, row) => sum + (row[key] ?? 0), 0);
}

function normalizeCode(code: string) {
  return code.replace(/^(sh|sz|bj)/i, '');
}

function numberOrUndefined(value: number | null) {
  return value === null ? undefined : value;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || value === '--') return null;
  const num = Number(String(value).replace('%', ''));
  return Number.isFinite(num) ? num : null;
}

function stableTextKey(text: string) {
  return text.replace(/\s+/g, '').slice(0, 24) || 'unknown';
}

function formatCompactDate(date: Date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

function toCompactDate(date: string) {
  return date.replace(/-/g, '').slice(0, 8);
}

function toIsoDate(date: string) {
  const compact = toCompactDate(date);
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

function toWarningMessage(section: string, reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason);
  return `${section}数据暂不可用：${message}`;
}

export const dragonTigerTestExports = {
  buildDragonTigerSnapshot,
  getDragonTigerDateRange,
  getRecentDragonTigerHistoryRange,
};
