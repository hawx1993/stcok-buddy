import type { AgentResultCard, StockDetail } from '../../../src/shared/types.js';
import { formatMoney, formatMoneyFromWan, formatNumber, formatPercentPoints, normalizeMarketCap, pickNumber, pickString } from './format.js';
import { inferExchange } from './symbols.js';

type AnyRecord = Record<string, unknown>;
type StockRating = NonNullable<StockDetail['rating']>;

export { StockRating };

export function toStockDetail(raw: unknown, fallbackCode: string): StockDetail {
  const record = (raw ?? {}) as AnyRecord;
  const code = pickString(record, ['code', '代码', 'symbol', 'f12']) ?? fallbackCode;
  const name = pickString(record, ['name', '名称', 'f14']) ?? code;
  const price = pickNumber(record, ['price', '最新价', 'lastPrice', 'close', 'f2']);
  const changePercent = pickNumber(record, ['changePercent', '涨跌幅', 'pctChg', 'f3']);
  const change = pickNumber(record, ['change', '涨跌额', 'f4']);
  const volume = pickNumber(record, ['volume', '成交量', 'f5']);
  const turnoverInYuan = pickNumber(record, ['turnover', '成交额', 'f6']);
  const turnoverInWan = turnoverInYuan === undefined ? pickNumber(record, ['amount']) : undefined;
  const pe = pickNumber(record, ['pe', 'PE', '市盈率', 'f9']);
  const pb = pickNumber(record, ['pb', 'PB', '市净率', 'f23']);
  const marketCap = pickNumber(record, ['marketCap', 'totalMarketCap', '总市值', 'f20']);
  const normalizedMarketCap = marketCap === undefined ? undefined : normalizeMarketCap(marketCap);
  const open = pickNumber(record, ['open', '今开', '开盘价', 'f17']);
  const high = pickNumber(record, ['high', '最高', '最高价', 'f15']);
  const low = pickNumber(record, ['low', '最低', '最低价', 'f16']);
  const prevClose = pickNumber(record, ['prevClose', '昨收', '昨收价', 'f18']);
  const turnoverRate = pickNumber(record, ['turnoverRate', '换手率', 'f8']);
  const industry = pickString(record, ['industry', '所属行业', 'f100']);

  return {
    code,
    name,
    exchange: inferExchange(code),
    price: price === undefined ? '--' : price,
    change: change === undefined ? '--' : `${change >= 0 ? '+' : ''}${formatNumber(change)}`,
    changePercent: changePercent === undefined ? '--' : formatPercentPoints(changePercent),
    open: open === undefined ? '--' : formatNumber(open),
    high: high === undefined ? '--' : formatNumber(high),
    low: low === undefined ? '--' : formatNumber(low),
    prevClose: prevClose === undefined ? '--' : formatNumber(prevClose),
    pe: pe === undefined ? '--' : formatNumber(pe),
    pb: pb === undefined ? '--' : formatNumber(pb),
    marketCap: normalizedMarketCap === undefined ? '--' : `${(normalizedMarketCap / 100_000_000).toFixed(1)}亿`,
    volume: volume === undefined ? '--' : `${(volume / 10000).toFixed(1)}万手`,
    turnover: turnoverInYuan !== undefined ? formatMoney(turnoverInYuan) : formatMoneyFromWan(turnoverInWan),
    turnoverRate: turnoverRate === undefined ? '--' : `${formatNumber(turnoverRate)}%`,
    industry,
    rating: deriveStockRating({ pe, pb, changePercent, turnoverRate }),
    summary: `${name}（${code}）实时行情来自 stock-sdk。当前价格 ${price === undefined ? '--' : price}，涨跌幅 ${changePercent === undefined ? '--' : formatPercentPoints(changePercent)}。`,
  };
}

export function deriveStockRating(input: {
  quote?: StockDetail;
  technical?: AgentResultCard;
  previous?: StockRating;
  pe?: number;
  pb?: number;
  changePercent?: number;
  turnoverRate?: number;
}): StockRating {
  const pe = input.pe ?? numericValue(input.quote?.pe);
  const pb = input.pb ?? numericValue(input.quote?.pb);
  const changePercent = input.changePercent ?? numericValue(input.quote?.changePercent);
  const turnoverRate = input.turnoverRate ?? numericValue(input.quote?.turnoverRate);
  return {
    fundamental:
      pe !== undefined || pb !== undefined
        ? rateFundamental(pe, pb)
        : (keepResolvedRating(input.previous?.fundamental) ?? '数据有限'),
    valuation:
      pe !== undefined || pb !== undefined
        ? rateValuation(pe, pb)
        : (keepResolvedRating(input.previous?.valuation) ?? '数据有限'),
    tech: rateTechnical(input.technical, changePercent),
    risk: rateRisk(pe, changePercent, turnoverRate),
  };
}

function keepResolvedRating(value: string | undefined) {
  return value && !['待评估', '需核查', '待分析'].includes(value) ? value : undefined;
}

function rateFundamental(pe?: number, pb?: number) {
  if (pe !== undefined && pe < 0) return '盈利承压';
  if (pe !== undefined && pe <= 25 && (pb === undefined || pb <= 4)) return '盈利稳健';
  if (pe !== undefined && pe <= 60) return '盈利正常';
  if (pb !== undefined && pb > 8) return '资产溢价高';
  return '数据有限';
}

function rateValuation(pe?: number, pb?: number) {
  if (pe !== undefined && pe < 0) return '亏损估值';
  if (pe !== undefined && pe <= 20 && (pb === undefined || pb <= 3)) return '相对合理';
  if (pe !== undefined && pe <= 45 && (pb === undefined || pb <= 6)) return '估值适中';
  if ((pe !== undefined && pe > 60) || (pb !== undefined && pb > 8)) return '估值偏高';
  return '数据有限';
}

function rateTechnical(technical?: AgentResultCard, changePercent?: number) {
  const text = `${technical?.subtitle ?? ''} ${technical?.narrative ?? ''}`;
  if (/金叉|站上|上方/.test(text)) return '偏多';
  if (/死叉|低于|下方/.test(text)) return '偏弱';
  if (changePercent !== undefined && changePercent >= 5) return '强势';
  if (changePercent !== undefined && changePercent <= -5) return '承压';
  return '中性';
}

function rateRisk(pe?: number, changePercent?: number, turnoverRate?: number) {
  if (
    (changePercent !== undefined && Math.abs(changePercent) >= 9) ||
    (turnoverRate !== undefined && turnoverRate >= 20)
  )
    return '高波动';
  if (turnoverRate !== undefined && turnoverRate >= 10) return '波动偏高';
  if (pe !== undefined && pe < 0) return '盈利风险';
  return '中性';
}

function numericValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const match = value.replaceAll(',', '').match(/[-+]?\d+(?:\.\d+)?/);
  const parsed = match ? Number(match[0]) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}
