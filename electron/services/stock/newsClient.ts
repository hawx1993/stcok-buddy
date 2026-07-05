import type { MarketNewsItem } from '../../../src/shared/types.js';

const fallbackNews: MarketNewsItem[] = [
  { id: 'fallback-1', time: '10:45', title: '白酒板块持续走强，茅台五粮液领涨，中秋动销数据超预期', tags: ['白酒', '消费'], tagType: 'positive' },
  { id: 'fallback-2', time: '10:32', title: '央行宣布降准0.25个百分点，释放长期资金约5000亿元', tags: ['宏观', '政策'], tagType: 'impact' },
  { id: 'fallback-3', time: '10:18', title: '半导体板块拉升，北方华创涨超8%，大基金三期布局加速', tags: ['半导体', '科技'], tagType: 'positive' },
  { id: 'fallback-4', time: '09:56', title: '宁德时代跌超5%，欧盟电动车关税落地短期承压', tags: ['新能源', '利空'], tagType: 'impact' },
  { id: 'fallback-5', time: '09:42', title: '北向资金半日净买入20.9亿，重点加仓白酒和银行板块', tags: ['资金', '北向'], tagType: 'positive' },
  { id: 'fallback-6', time: '09:30', title: '问界M9大定突破10万台，赛力斯股价创历史新高', tags: ['新能源车', '华为'], tagType: 'positive' },
  { id: 'fallback-7', time: '09:15', title: '美国新一轮芯片出口限制传闻再起，寒武纪等AI芯片股承压', tags: ['芯片', '出口'], tagType: 'impact' },
  { id: 'fallback-8', time: '08:50', title: '中信证券：市场成交量放大，券商板块有望迎来估值修复', tags: ['券商', '策略'], tagType: 'positive' },
  { id: 'fallback-9', time: '08:30', title: '比亚迪9月销量再创新高，海外建厂进展加速', tags: ['新能源车', '出海'], tagType: 'positive' },
  { id: 'fallback-10', time: '08:10', title: '高股息板块持续受追捧，招商银行股息率达5.6%', tags: ['银行', '高股息'], tagType: 'positive' },
];

export async function listMarketNews(query = ''): Promise<MarketNewsItem[]> {
  try {
    // stock-sdk 2.2.2 has market data/events, but no direct market-news namespace.
    const response = await fetch('https://finance.eastmoney.com/yaowen.html', {
      signal: AbortSignal.timeout(6_000),
      headers: { 'user-agent': 'Mozilla/5.0 StockSense/0.1' },
    });
    if (!response.ok) throw new Error(`news http ${response.status}`);
    const html = await response.text();
    const parsed = parseEastmoneyNews(html);
    return filterNews(parsed.length ? parsed : fallbackNews, query);
  } catch {
    return filterNews(fallbackNews, query);
  }
}

function parseEastmoneyNews(html: string): MarketNewsItem[] {
  const items: MarketNewsItem[] = [];
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]{8,80})<\/a>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && items.length < 20) {
    const title = decodeHtml(match[2]).replace(/\s+/g, ' ').trim();
    const url = match[1].startsWith('http') ? match[1] : `https:${match[1]}`;
    if (!title || /东方财富|财经|首页|专题/.test(title)) continue;
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
