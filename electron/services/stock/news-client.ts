import type { AnnouncementItem, MarketNewsItem, PagedMarketNews } from '../../../src/shared/types.js';

const fallbackNews: MarketNewsItem[] = [];
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
let cninfoOrgIdMap: Record<string, string> | undefined;

export async function listMarketNews(query = '', page = 1, pageSize = 30): Promise<PagedMarketNews> {
  try {
    // stock-sdk 2.2.2 has market data/events, but no direct market-news namespace.
    const response = await fetch('https://finance.eastmoney.com/yaowen.html', {
      signal: AbortSignal.timeout(6_000),
      headers: { 'user-agent': 'Mozilla/5.0 StockBuddy/0.1' },
    });
    if (!response.ok) throw new Error(`news http ${response.status}`);
    const html = await response.text();
    return paginate(filterNews(parseEastmoneyNews(html), query), page, pageSize);
  } catch {
    return paginate(filterNews(fallbackNews, query), page, pageSize);
  }
}

export async function listStockNewsAnnouncements(code: string, pageSize = 10) {
  const [news, announcements] = await Promise.all([
    eastmoneyStockNews(code, pageSize).catch(() => []),
    cninfoAnnouncements(code, pageSize).catch(() => []),
  ]);
  return { news, announcements };
}

async function eastmoneyStockNews(code: string, pageSize: number): Promise<MarketNewsItem[]> {
  const cb = 'jQuery_news';
  const innerParams = JSON.stringify({
    uid: '',
    keyword: code,
    type: ['cmsArticleWebOld'],
    client: 'web',
    clientType: 'web',
    clientVersion: 'curr',
    param: { cmsArticleWebOld: { searchScope: 'default', sort: 'default', pageIndex: 1, pageSize, preTag: '', postTag: '' } },
  });
  const url = new URL('https://search-api-web.eastmoney.com/search/jsonp');
  url.search = new URLSearchParams({ cb, param: innerParams }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': UA, Referer: 'https://so.eastmoney.com/' } });
  if (!response.ok) return [];
  const text = await response.text();
  const json = text.slice(text.indexOf('(') + 1, text.lastIndexOf(')'));
  const payload = JSON.parse(json) as { result?: { cmsArticleWebOld?: Array<Record<string, unknown>> } };
  return (payload.result?.cmsArticleWebOld ?? []).map((item, index) => ({
    id: `stock-news-${code}-${index}`,
    time: String(item.date ?? '').slice(0, 16),
    title: stripTags(String(item.title ?? '')),
    content: stripTags(String(item.content ?? '')).slice(0, 500),
    tags: ['新闻'],
    tagType: inferTagType(String(item.title ?? '') + String(item.content ?? '')),
    url: String(item.url ?? ''),
    source: String(item.mediaName ?? '东方财富'),
  })).filter((item) => item.title);
}

async function cninfoAnnouncements(code: string, pageSize: number): Promise<AnnouncementItem[]> {
  const orgId = await cninfoOrgId(code);
  const body = new URLSearchParams({
    stock: `${code},${orgId}`,
    tabName: 'fulltext',
    pageSize: String(pageSize),
    pageNum: '1',
    column: '',
    category: '',
    plate: '',
    seDate: '',
    searchkey: '',
    secid: '',
    sortName: '',
    sortType: '',
    isHLtitle: 'true',
  });
  const response = await fetch('https://www.cninfo.com.cn/new/hisAnnouncement/query', {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    body,
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: 'https://www.cninfo.com.cn/new/disclosure',
      Origin: 'https://www.cninfo.com.cn',
    },
  });
  if (!response.ok) return [];
  const payload = await response.json() as { announcements?: Array<Record<string, unknown>> };
  return (payload.announcements ?? []).map((item) => ({
    title: stripTags(String(item.announcementTitle ?? '')),
    type: String(item.announcementTypeName ?? item.announcementType ?? '公告'),
    date: cninfoTimeToDate(item.announcementTime),
    url: `https://www.cninfo.com.cn/new/disclosure/detail?annoId=${item.announcementId ?? ''}`,
    content: stripTags(String(item.announcementContent ?? item.shortTitle ?? item.announcementTitle ?? '')).slice(0, 500),
  })).filter((item) => item.title);
}

async function cninfoOrgId(code: string) {
  if (!cninfoOrgIdMap) {
    const response = await fetch('http://www.cninfo.com.cn/new/data/szse_stock.json', { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': UA } });
    const payload = await response.json() as { stockList?: Array<{ code: string; orgId: string }> };
    cninfoOrgIdMap = Object.fromEntries((payload.stockList ?? []).map((item) => [item.code, item.orgId]));
  }
  return cninfoOrgIdMap[code] ?? (code.startsWith('6') ? `gssh0${code}` : code.startsWith('8') || code.startsWith('4') ? `gsbj0${code}` : `gssz0${code}`);
}

function cninfoTimeToDate(value: unknown) {
  if (typeof value === 'number') return new Date(value).toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
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

function stripTags(text: string) {
  return decodeHtml(text.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function decodeHtml(text: string) {
  return text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}
