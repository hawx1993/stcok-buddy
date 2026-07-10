import type { AgentResultCard, AnnouncementItem, EvidenceItem, HotFocusItem, KlinePoint, MarketNewsItem, StockDetail } from '../../../src/shared/types.js';
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
