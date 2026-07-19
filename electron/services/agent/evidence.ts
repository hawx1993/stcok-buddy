import type { AgentResultCard, AnnouncementItem, EvidenceItem, HotFocusItem, IStockFundFlowSnapshot, KlinePoint, MarketNewsItem, StockDetail } from '../../../src/shared/types.js';
import type { HistoricalBarsResult } from '../market-data/types.js';
import type { DailyDragonTigerItem } from '../stock/stock-client.js';

export function fallbackEvidence(id: string, title: string, summary = '数据不足，当前结论仅作为研究占位。'): EvidenceItem {
  return { id: `fallback:${id}`, source: 'fallback', title, summary };
}

export function evidenceFromQuote(quote?: StockDetail): EvidenceItem[] {
  if (!quote) return [fallbackEvidence('quote', '行情数据不足')];
  return [{
    id: `quote:${quote.code}`,
    source: 'quote',
    title: `${quote.name}（${quote.code}）行情`,
    summary: `现价 ${quote.price ?? '--'}，涨跌幅 ${quote.changePercent ?? '--'}，成交额 ${quote.turnover ?? '--'}。`,
    value: quote.changePercent,
    raw: quote,
  }];
}

export function evidenceFromKline(symbol: string, kline?: KlinePoint[]): EvidenceItem[] {
  const latest = kline?.at(-1);
  if (!latest) return [fallbackEvidence(`kline:${symbol}`, 'K线数据不足')];
  return [{
    id: `kline:${symbol}:latest`,
    source: 'kline',
    title: `${symbol} 最新K线`,
    summary: `${latest.time} 收盘 ${latest.close}，最高 ${latest.high}，最低 ${latest.low}。`,
    value: latest.close,
    timestamp: latest.time,
    raw: latest,
  }];
}

export function evidenceFromHistoricalBars(symbol: string, result: HistoricalBarsResult): EvidenceItem[] {
  const first = result.data[0];
  const latest = result.data.at(-1);
  if (!latest) return [fallbackEvidence(`local-kline:${symbol}`, '本地历史行情数据不足')];
  return [{
    id: `${result.meta.storage === 'local' ? 'local' : 'mixed'}-kline:${symbol}:${first?.time ?? 'unknown'}:${latest.time}`,
    source: result.meta.storage === 'local' ? 'local-market-data' : 'remote-market-data',
    title: `${symbol} 历史日K`,
    summary: `${result.data.length} 条${result.meta.adjustType === 'qfq' ? '前复权' : '不复权'}日线，截止 ${latest.time}，最新收盘 ${latest.close}。`,
    value: latest.close,
    timestamp: latest.time,
    dataSource: result.meta.source,
    storage: result.meta.storage,
    freshness: result.meta.freshness,
    periodStart: first?.time,
    periodEnd: latest.time,
    isComplete: result.meta.isComplete,
    adjustType: result.meta.adjustType,
    raw: { count: result.data.length, latest: { time: latest.time, open: latest.open, high: latest.high, low: latest.low, close: latest.close } },
  }];
}

export function evidenceFromTechnical(symbol: string, card?: AgentResultCard): EvidenceItem[] {
  if (!card) return [fallbackEvidence(`technical:${symbol}`, '技术指标数据不足')];
  return [{
    id: `technical:${symbol}`,
    source: 'technical',
    title: card.title || `${symbol} 技术指标`,
    summary: card.narrative ?? card.subtitle,
    raw: card,
  }];
}

export function evidenceFromNews(news?: MarketNewsItem[]): EvidenceItem[] {
  if (!news?.length) return [fallbackEvidence('news', '新闻样本不足')];
  return news.slice(0, 10).map((item, index) => ({
    id: `news:${index}`,
    source: 'news',
    title: item.title,
    summary: item.content,
    url: item.url,
    timestamp: item.time,
    raw: item,
  }));
}

export function evidenceFromAnnouncements(items?: AnnouncementItem[]): EvidenceItem[] {
  if (!items?.length) return [fallbackEvidence('announcement', '公告样本不足')];
  return items.slice(0, 10).map((item, index) => ({
    id: `announcement:${index}`,
    source: 'announcement',
    title: item.title,
    summary: item.content ?? item.type,
    url: item.url,
    timestamp: item.date,
    raw: item,
  }));
}

export function evidenceFromDragonTiger(items?: DailyDragonTigerItem[]): EvidenceItem[] {
  if (!items?.length) return [fallbackEvidence('lhb', '龙虎榜数据不足或非交易日尚未更新')];
  return items.slice(0, 10).map((item, index) => ({
    id: `lhb:daily:${index}`,
    source: 'dragon-tiger',
    title: `${item.name}（${item.code}）龙虎榜`,
    summary: `${item.reason || '上榜原因待补充'}，净买入 ${item.netBuy}。`,
    value: item.netBuy,
    timestamp: item.date,
    raw: item,
  }));
}

export function evidenceFromChip(symbol: string, chip?: unknown): EvidenceItem[] {
  const latest = chip && typeof chip === 'object' ? (chip as { latest?: { profitRatio?: number; avgCost?: number; cost70?: string; cost90?: string } }).latest : undefined;
  if (!latest) return [fallbackEvidence(`chip:${symbol}`, '筹码分布数据不足')];
  return [{
    id: `chip:${symbol}:latest`,
    source: 'chip',
    title: `${symbol} 筹码分布`,
    summary: `平均成本 ${latest.avgCost ?? '--'}，获利盘 ${latest.profitRatio === undefined ? '--' : `${(latest.profitRatio * 100).toFixed(1)}%`}，70%成本区间 ${latest.cost70 ?? '--'}，90%成本区间 ${latest.cost90 ?? '--'}。`,
    raw: chip,
  }];
}

export function evidenceFromFundFlow(symbol: string, fundFlow?: IStockFundFlowSnapshot): EvidenceItem[] {
  if (!fundFlow) return [fallbackEvidence(`fund-flow:${symbol}`, '资金流数据不足')];
  const activeText = fundFlow.activeSampleCount
    ? `主动买 ${formatRatio(fundFlow.activeBuyRatio)}，主动卖 ${formatRatio(fundFlow.activeSellRatio)}（${fundFlow.activeRatioSource ?? '盘口异动样本'}）`
    : '主动买卖比例暂无可用样本';
  return [{
    id: `fund-flow:${symbol}:${fundFlow.date}`,
    source: 'fund-flow',
    title: `${symbol} 个股资金流向`,
    summary: `主力合计 ${formatMoney(fundFlow.mainNetInflow)}，超大单 ${formatMoney(fundFlow.superLargeNetInflow)}，大单 ${formatMoney(fundFlow.largeNetInflow)}，中单 ${formatMoney(fundFlow.mediumNetInflow)}，小单 ${formatMoney(fundFlow.smallNetInflow)}；${activeText}。`,
    value: fundFlow.mainNetInflow ?? undefined,
    timestamp: fundFlow.date,
    dataSource: fundFlow.source,
    raw: fundFlow,
  }];
}

function formatMoney(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  const sign = num > 0 ? '+' : num < 0 ? '-' : '';
  const abs = Math.abs(num);
  if (abs >= 100000000) return `${sign}${(abs / 100000000).toFixed(2)}亿`;
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(2)}万`;
  return `${sign}${abs.toFixed(0)}`;
}

function formatRatio(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? `${num.toFixed(1)}%` : '--';
}

export function evidenceFromHotFocus(items?: HotFocusItem[]): EvidenceItem[] {
  if (!items?.length) return [fallbackEvidence('hot-focus', '热点数据不足')];
  return items.slice(0, 10).map((item, index) => ({
    id: `hot-focus:${index}`,
    source: 'hot-focus',
    title: item.name ? `${item.name} ${item.code ?? ''}`.trim() : item.title,
    summary: item.description ?? item.tag,
    value: item.changePercent,
    timestamp: item.time,
    raw: item,
  }));
}
