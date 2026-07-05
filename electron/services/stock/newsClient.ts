import type { MarketNewsItem, PagedMarketNews } from '../../../src/shared/types.js';

const fallbackNews: MarketNewsItem[] = [];

export async function listMarketNews(query = '', page = 1, pageSize = 30): Promise<PagedMarketNews> {
  try {
    // stock-sdk 2.2.2 has market data/events, but no direct market-news namespace.
    const response = await fetch('https://finance.eastmoney.com/yaowen.html', {
      signal: AbortSignal.timeout(6_000),
      headers: { 'user-agent': 'Mozilla/5.0 StockSense/0.1' },
    });
    if (!response.ok) throw new Error(`news http ${response.status}`);
    const html = await response.text();
    return paginate(filterNews(parseEastmoneyNews(html), query), page, pageSize);
  } catch {
    return paginate(filterNews(fallbackNews, query), page, pageSize);
  }
}

function parseEastmoneyNews(html: string): MarketNewsItem[] {
  const items: MarketNewsItem[] = [];
  const seen = new Set<string>();
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]{8,120})<\/a>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && items.length < 150) {
    const title = decodeHtml(match[2]).replace(/\s+/g, ' ').trim();
    const url = match[1].startsWith('http') ? match[1] : `https:${match[1]}`;
    if (!title || seen.has(title) || /东方财富|财经|首页|专题/.test(title)) continue;
    seen.add(title);
    items.push({
      id: `em-${items.length}-${title}`,
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      title,
      tags: inferTags(title),
      tagType: inferTagType(title),
      url,
      source: '东方财富',
    });
  }
  return items;
}

function paginate(news: MarketNewsItem[], page: number, pageSize: number): PagedMarketNews {
  const safePageSize = Math.max(1, pageSize || 30);
  const safePage = Math.max(1, page || 1);
  const start = (safePage - 1) * safePageSize;
  return { items: news.slice(start, start + safePageSize), total: news.length, page: safePage, pageSize: safePageSize };
}

function filterNews(news: MarketNewsItem[], query: string) {
  const q = query.trim();
  if (!q) return news;
  return news.filter((item) => item.title.includes(q) || item.tags.some((tag) => tag.includes(q)));
}

function inferTags(title: string) {
  const tags = [
    ['白酒', '白酒'], ['消费', '消费'], ['半导体', '半导体'], ['芯片', '芯片'], ['新能源', '新能源'],
    ['银行', '银行'], ['券商', '券商'], ['北向', '北向'], ['资金', '资金'], ['央行', '宏观'], ['政策', '政策'],
  ].filter(([key]) => title.includes(key)).map(([, tag]) => tag);
  return tags.length ? Array.from(new Set(tags)).slice(0, 3) : ['市场'];
}

function inferTagType(title: string): MarketNewsItem['tagType'] {
  if (/利空|承压|下跌|跳水|限制|风险|减持/.test(title)) return 'impact';
  if (/走强|上涨|领涨|增持|净买入|突破|利好|修复/.test(title)) return 'positive';
  return 'neutral';
}

function decodeHtml(text: string) {
  return text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}
