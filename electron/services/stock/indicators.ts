import { calcKDJ, calcMA, calcMACD } from 'stock-sdk/indicators';
import { calcSignals } from 'stock-sdk/signals';
import type { AgentResultCard } from '../../../src/shared/types.js';
import { pickNumber, pickString } from './format.js';

type AnyRecord = Record<string, unknown>;

function toOhlcv(item: AnyRecord, index: number) {
  return {
    timestamp: pickString(item, ['date', 'time', '日期']) ?? pickNumber(item, ['timestamp']) ?? index,
    open: pickNumber(item, ['open', '开盘']) ?? 0,
    high: pickNumber(item, ['high', '最高']) ?? 0,
    low: pickNumber(item, ['low', '最低']) ?? 0,
    close: pickNumber(item, ['close', '收盘']) ?? 0,
    volume: pickNumber(item, ['volume', '成交量']) ?? 0,
    amount: pickNumber(item, ['amount', '成交额']),
    change: pickNumber(item, ['change', '涨跌额']),
    changePercent: pickNumber(item, ['changePercent', '涨跌幅']),
    turnoverRate: pickNumber(item, ['turnoverRate', '换手率']),
    pe: pickNumber(item, ['pe', 'PE', '市盈率']),
  };
}

function toKlinePoint(item: ReturnType<typeof toOhlcv>): import('../../../src/shared/types.js').KlinePoint {
  return {
    time: String(item.timestamp),
    open: item.open,
    close: item.close,
    high: item.high,
    low: item.low,
    volume: item.volume,
    amount: item.amount,
    change: item.change,
    changePercent: item.changePercent,
    turnoverRate: item.turnoverRate,
    pe: item.pe,
  };
}

export function analyzeIndicators(klines: unknown[]): AgentResultCard {
  const records = (klines as AnyRecord[]).slice(-120);
  const ohlcv = records.map(toOhlcv).filter((item) => item.close > 0);
  const closes = ohlcv.map((item) => item.close);

  if (closes.length < 20) {
    return {
      title: '技术指标摘要',
      chart: { type: 'kline', data: ohlcv.slice(-60).map(toKlinePoint) },
      narrative: 'K 线数据不足，暂无法计算稳定的 MACD/KDJ/均线信号。',
    };
  }

  const macd = calcMACD(closes).at(-1) as Record<string, number | null> | undefined;
  const prevMacd = calcMACD(closes).at(-2) as Record<string, number | null> | undefined;
  const kdj = calcKDJ(ohlcv).at(-1) as Record<string, number | null> | undefined;
  const ma = calcMA(closes, { periods: [5, 10, 20, 60] }).at(-1) as Record<string, number | null> | undefined;
  const signals = calcSignals(ohlcv as never, { macd: true, kdj: {} }).slice(-5);

  const dif = Number(macd?.dif ?? macd?.DIF ?? 0);
  const dea = Number(macd?.dea ?? macd?.DEA ?? 0);
  const prevDif = Number(prevMacd?.dif ?? prevMacd?.DIF ?? 0);
  const prevDea = Number(prevMacd?.dea ?? prevMacd?.DEA ?? 0);
  const macdSignal = prevDif <= prevDea && dif > dea ? 'MACD 金叉' : prevDif >= prevDea && dif < dea ? 'MACD 死叉' : dif > dea ? 'DIF 位于 DEA 上方' : 'DIF 位于 DEA 下方';
  const lastClose = closes.at(-1) ?? 0;
  const ma5 = Number(ma?.ma5 ?? ma?.MA5 ?? 0);
  const ma20 = Number(ma?.ma20 ?? ma?.MA20 ?? 0);
  const trend = ma20 > 0 ? (lastClose >= ma20 ? '收盘价站上 20 日均线' : '收盘价低于 20 日均线') : '均线状态待确认';
  const signalText = signals.length ? signals.map((signal) => signal.type).join('、') : '近 5 根 K 线未识别到强信号';

  return {
    title: '技术指标摘要',
    subtitle: `${macdSignal} · ${trend}`,
    chart: { type: 'kline', data: ohlcv.slice(-60).map(toKlinePoint) },
    metrics: [
      { label: 'MACD', value: macdSignal, tone: dif > dea ? 'up' : 'down' },
      { label: 'KDJ-K', value: Number(kdj?.k ?? kdj?.K ?? 0).toFixed(2), tone: 'neutral' },
      { label: 'MA5', value: ma5 ? ma5.toFixed(2) : '--', tone: lastClose >= ma5 ? 'up' : 'down' },
      { label: 'MA20', value: ma20 ? ma20.toFixed(2) : '--', tone: lastClose >= ma20 ? 'up' : 'down' },
    ],
    narrative: `最近信号：${signalText}。${trend}，${macdSignal}。技术面只代表历史价格和成交量的统计状态，需要结合基本面、流动性与风险事件交叉验证。`,
  };
}
