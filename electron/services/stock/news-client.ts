import type { IMarketNewsSummary, IMarketNewsSummaryState, IStockNewsFeed, AnnouncementItem, FavoriteStock, MarketNewsItem, PagedMarketNews } from '../../../src/shared/types.js';
import { getMarketNewsSummaryState as readMarketNewsSummaryState, getStockNewsPreferences, listFavoriteStocks, setMarketNewsSummaryState } from '../config-store.js';
import { generateReport } from '../llm/index.js';
import { resolveTradingDate } from '../market-data/trade-date-resolver.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const ARTICLE_BODY_PATTERNS = [
  /<div[^>]+id=["']ContentBody["'][^>]*>([\s\S]*?)<\/div>\s*<div[^>]+class=["'](?:source|share|statement)/i,
  /<div[^>]+id=["']ContentBody["'][^>]*>([\s\S]*?)<\/div>/i,
  /<article[^>]*>([\s\S]*?)<\/article>/i,
];
let activeMarketNewsSummary: Promise<IMarketNewsSummary> | undefined;
let activeMarketNewsSummaryState: Promise<IMarketNewsSummaryState> | undefined;
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
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    throw new Error(`热点新闻数据源暂不可用：${message}`);
  }
}

export async function getMarketNewsItem(id: string): Promise<MarketNewsItem> {
  const items = (await listMarketNews('', 1, 150)).items;
  const item = items.find((candidate) => candidate.id === id) ?? findMarketNewsByLegacyId(items, id);
  if (!item) throw new Error('新闻内容已更新，请刷新热点新闻后重试');
  return getMarketNewsDetail(item);
}

export async function getMarketNewsDetail(item: Pick<MarketNewsItem, 'id' | 'title' | 'source' | 'time' | 'url' | 'content'>): Promise<MarketNewsItem> {
  const source = item.url ? item : await resolveMarketNewsSource(item);
  const content = source.url ? await fetchNewsArticleContent(source.url) : source.content;
  if (!content?.trim()) throw new Error('新闻正文暂不可用，请稍后刷新热点新闻后重试');
  return { ...source, tags: [], content };
}

async function resolveMarketNewsSource(item: Pick<MarketNewsItem, 'id' | 'title' | 'source' | 'time' | 'url' | 'content'>) {
  if (item.content?.trim()) return item;
  const items = (await listMarketNews('', 1, 150)).items;
  const source = items.find((candidate) => candidate.id === item.id) ?? findMarketNewsByLegacyId(items, item.id) ?? items.find((candidate) => candidate.title === item.title);
  if (!source) throw new Error('新闻内容已更新，请刷新热点新闻后重试');
  return source;
}

function findMarketNewsByLegacyId(items: MarketNewsItem[], id: string): MarketNewsItem | undefined {
  const title = id.match(/^em-\d+-(.+)$/)?.[1];
  return title ? items.find((item) => item.title === title) : undefined;
}

async function fetchNewsArticleContent(url: string): Promise<string | undefined> {
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: { 'User-Agent': UA, Referer: 'https://finance.eastmoney.com/' } });
  if (!response.ok) throw new Error(`news article http ${response.status}`);
  const html = await response.text();
  for (const pattern of ARTICLE_BODY_PATTERNS) {
    const article = html.match(pattern)?.[1];
    const content = articleToText(article ?? '');
    if (content.length >= 80) return content;
  }
  return undefined;
}

export async function getMarketNewsSummaryState(): Promise<IMarketNewsSummaryState> {
  const tradeDate = await resolveTradingDate(0);
  return getMarketNewsSummaryStateFromStore(tradeDate);
}

export async function ensureMarketNewsSummaryState(
  readState: () => Promise<IMarketNewsSummaryState> = getMarketNewsSummaryState,
  refresh: () => Promise<IMarketNewsSummary> = refreshMarketNewsSummary,
): Promise<IMarketNewsSummaryState> {
  const current = await readState();
  if (current.summary) return current;
  if (!activeMarketNewsSummaryState) {
    activeMarketNewsSummaryState = refresh()
      .then((summary) => ({ tradeDate: summary.tradeDate, summary }))
      .catch(() => readState())
      .finally(() => {
        activeMarketNewsSummaryState = undefined;
      });
  }
  return activeMarketNewsSummaryState;
}

export async function refreshMarketNewsSummary(): Promise<IMarketNewsSummary> {
  if (!activeMarketNewsSummary) activeMarketNewsSummary = refreshMarketNewsSummaryOnce().finally(() => {
    activeMarketNewsSummary = undefined;
  });
  return activeMarketNewsSummary;
}

async function refreshMarketNewsSummaryOnce(): Promise<IMarketNewsSummary> {
  const tradeDate = await resolveTradingDate(0);
  const current = getMarketNewsSummaryStateFromStore(tradeDate);
  if (current.summary) return current.summary;
  try {
    const result = await listMarketNews('', 1, 12);
    if (!result.items.length) throw new Error('未获取到真实 A 股热点新闻');
    const sourceNews = uniqueNewsByTitle(result.items).slice(0, 8);
    const content = await generateReport([
      {
        role: 'system',
        content: `你是一名专业 A 股投研分析师。仅基于输入的真实新闻标题、时间、来源与摘要进行汇总，不得补充、推测或编造事实、数据、个股、板块或市场表现。输出 Markdown，必须使用以下标题：\n## 📰 核心事件\n## ✅ 利好因素\n## ⚠️ 利空因素\n## 📈 短期影响\n## 🏛️ 中长期影响\n## 🚨 风险提示\n## 🎯 综合结论\n综合结论必须包含 🟢 偏利好、🟡 中性 或 🔴 偏利空之一。每段至多两个专业金融风格 Emoji，禁止娱乐化或炒作型 Emoji。信息不足时明确写“暂无数据”或“需持续观察”。每个章节最多 2 条，总字数不超过 700 字。`,
      },
      {
        role: 'user',
        content: JSON.stringify({ tradeDate, news: sourceNews.map(({ time, title, source, content: summary }) => ({ time, title, source, summary })) }),
      },
    ]);
    const summary: IMarketNewsSummary = {
      tradeDate,
      generatedAt: new Date().toISOString(),
      content: content.trim(),
      sourceNews: sourceNews.map(({ id, title, source, time, url, content: summary }) => ({ id, title, source, time, url, content: summary })),
    };
    setMarketNewsSummaryState({ tradeDate, summary });
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : '新闻热点汇总失败';
    setMarketNewsSummaryState({ tradeDate, error: message });
    throw error;
  }
}

function uniqueNewsByTitle(items: MarketNewsItem[]): MarketNewsItem[] {
  const titles = new Set<string>();
  return items.filter((item) => !titles.has(item.title) && titles.add(item.title));
}

function getMarketNewsSummaryStateFromStore(tradeDate: string): IMarketNewsSummaryState {
  const state = readMarketNewsSummaryState();
  if (!state || state.tradeDate !== tradeDate) return { tradeDate };
  return state;
}

export async function listStockNewsFeed(): Promise<IStockNewsFeed> {
  const preferences = getStockNewsPreferences();
  const stocks = stockNewsStocks(preferences.favoritesOnly, listFavoriteStocks(), preferences.manualStocks);
  if (!stocks.length) return { preferences, items: [] };

  const results = await Promise.allSettled(stocks.map(async (stock) => {
    const { news } = await listStockNewsAnnouncements(stock.code, 12);
    return news.map((item) => ({ ...item, stockCode: stock.code, stockName: stock.name }));
  }));
  const fulfilled = results.filter((result): result is PromiseFulfilledResult<Array<MarketNewsItem & { stockCode: string; stockName: string }>> => result.status === 'fulfilled');
  if (!fulfilled.length) {
    const messages = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason instanceof Error ? result.reason.message : '未知错误');
    throw new Error(`个股新闻数据源暂不可用：${messages.join('；')}`);
  }
  return { preferences, items: sortAndDeduplicateStockNews(fulfilled.flatMap((result) => result.value)) };
}

function stockNewsStocks(favoritesOnly: boolean, favorites: FavoriteStock[], manualStocks: IStockNewsFeed['preferences']['manualStocks']) {
  const byCode = new Map<string, Pick<FavoriteStock, 'code' | 'name'>>();
  for (const stock of favorites) byCode.set(stock.code, stock);
  if (!favoritesOnly) {
    for (const stock of manualStocks) {
      if (!byCode.has(stock.code)) byCode.set(stock.code, stock);
    }
  }
  return [...byCode.values()];
}

function sortAndDeduplicateStockNews(items: MarketNewsItem[]): MarketNewsItem[] {
  const seen = new Set<string>();
  return items
    .filter((item) => {
      const key = `${item.stockCode ?? ''}:${item.url ?? item.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => right.time.localeCompare(left.time));
}

export async function listStockNewsAnnouncements(code: string, pageSize = 10) {
  const [newsResult, announcementsResult] = await Promise.allSettled([
    eastmoneyStockNews(code, pageSize),
    cninfoAnnouncements(code, pageSize),
  ]);
  if (newsResult.status === 'rejected' && announcementsResult.status === 'rejected') {
    const newsError = newsResult.reason instanceof Error ? newsResult.reason.message : '未知错误';
    const announcementError = announcementsResult.reason instanceof Error ? announcementsResult.reason.message : '未知错误';
    throw new Error(`个股资讯与公告数据源均不可用：${newsError}；${announcementError}`);
  }
  return {
    news: newsResult.status === 'fulfilled' ? newsResult.value : [],
    announcements: announcementsResult.status === 'fulfilled' ? announcementsResult.value : [],
  };
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
  if (!response.ok) throw new Error(`个股新闻请求失败：${response.status}`);
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
  if (!response.ok) throw new Error(`个股公告请求失败：${response.status}`);
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

export function articleToText(html: string) {
  const tables: string[] = [];
  const body = html.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (table) => {
    const marker = `\n\n[[STOCK_BUDDY_TABLE_${tables.length}]]\n\n`;
    tables.push(JSON.stringify(parseArticleTable(table)));
    return marker;
  });
  const text = decodeHtml(
    body
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<p[^>]*>/gi, '')
      .replace(/<[^>]+>/g, ''),
  ).replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return tables.reduce((content, table, index) => content.replace(`[[STOCK_BUDDY_TABLE_${index}]]`, `[[STOCK_BUDDY_TABLE:${encodeURIComponent(table)}]]`), text);
}

interface IArticleTableCell {
  content: string;
  header: boolean;
  colSpan?: number;
  rowSpan?: number;
}

function parseArticleTable(html: string): IArticleTableCell[][] {
  return Array.from(html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi), ([, row]) =>
    Array.from(row.matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi), ([, tag, attributes, content]) => ({
      content: stripTags(content),
      header: tag.toLowerCase() === 'th',
      colSpan: readTableSpan(attributes, 'colspan'),
      rowSpan: readTableSpan(attributes, 'rowspan'),
    })),
  ).filter((row) => row.length > 0);
}

function readTableSpan(attributes: string, name: 'colspan' | 'rowspan'): number | undefined {
  const value = attributes.match(new RegExp(`\\b${name}=["']?(\\d+)`, 'i'))?.[1];
  if (!value) return undefined;
  const span = Number(value);
  return Number.isInteger(span) && span > 1 ? span : undefined;
}

function decodeHtml(text: string) {
  return text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}
