import StockSDK from 'stock-sdk';
import type { AgentResultCard, BoardDetail, HotFocusItem, HotFocusTab, KlinePoint, StockDetail } from '../../../src/shared/types.js';
import { formatNumber, formatPercent, pickNumber, pickString } from './format.js';
import { analyzeIndicators } from './indicators.js';
import { extractSymbolCandidate, normalizeASymbol, inferExchange, toQuoteSymbol } from './symbols.js';

const sdk = new StockSDK({ timeout: 12_000, retry: { maxRetries: 1 } });

type AnyRecord = Record<string, unknown>;

function toStockDetail(raw: unknown, fallbackCode: string): StockDetail {
  const record = (raw ?? {}) as AnyRecord;
  const code = pickString(record, ['code', '代码', 'symbol', 'f12']) ?? fallbackCode;
  const name = pickString(record, ['name', '名称', 'f14']) ?? code;
  const price = pickNumber(record, ['price', '最新价', 'lastPrice', 'close', 'f2']);
  const changePercent = pickNumber(record, ['changePercent', '涨跌幅', 'pctChg', 'f3']);
  const change = pickNumber(record, ['change', '涨跌额', 'f4']);
  const volume = pickNumber(record, ['volume', '成交量', 'f5']);
  const turnover = pickNumber(record, ['turnover', '成交额', 'amount', 'f6']);
  const pe = pickNumber(record, ['pe', 'PE', '市盈率', 'f9']);
  const pb = pickNumber(record, ['pb', 'PB', '市净率', 'f23']);
  const marketCap = pickNumber(record, ['marketCap', 'totalMarketCap', '总市值', 'f20']);

  return {
    code,
    name,
    exchange: inferExchange(code),
    price: price === undefined ? '--' : price,
    change: change === undefined ? '--' : `${change >= 0 ? '+' : ''}${formatNumber(change)}`,
    changePercent: changePercent === undefined ? '--' : formatPercent(changePercent),
    pe: pe === undefined ? '--' : formatNumber(pe),
    pb: pb === undefined ? '--' : formatNumber(pb),
    marketCap: marketCap === undefined ? '--' : `${(marketCap / 100000000).toFixed(1)}亿`,
    volume: volume === undefined ? '--' : `${(volume / 10000).toFixed(1)}万手`,
    turnover: turnover === undefined ? '--' : `${(turnover / 100000000).toFixed(2)}亿`,
    rating: {
      fundamental: '待评估',
      valuation: pe && pe < 25 ? '相对合理' : '需核查',
      tech: '待分析',
      risk: '中性',
    },
    summary: `${name}（${code}）实时行情来自 stock-sdk。当前价格 ${price === undefined ? '--' : price}，涨跌幅 ${changePercent === undefined ? '--' : formatPercent(changePercent)}。`,
  };
}

export async function resolveASymbol(input: string): Promise<string> {
  const candidate = extractSymbolCandidate(input);
  if (/^\d{6}$/.test(candidate)) return candidate;
  const result = (await sdk.search(candidate)).find((item: { code?: string; category?: string }) => item.category === 'stock' && item.code);
  return result?.code?.replace(/^\D+/, '') ?? normalizeASymbol(candidate);
}

export async function getQuote(symbolInput: string): Promise<StockDetail> {
  const symbol = normalizeASymbol(symbolInput);
  const quotes = await sdk.quotes.cn([toQuoteSymbol(symbol)]);
  return toStockDetail(quotes[0], symbol);
}

export async function getKline(symbolInput: string, limit = 120, period = '1d'): Promise<KlinePoint[]> {
  const symbol = normalizeASymbol(symbolInput);
  try {
    if (period === '15m') return getTencentMinuteKline(symbol, limit, '15');
    if (period === '1h') return getTencentMinuteKline(symbol, limit, '60');
    if (period === '4h') return aggregateKline(await getTencentMinuteKline(symbol, limit * 4, '60'), 4).slice(-limit);
    const tencent = await getTencentHistoryKline(symbol, limit, period);
    if (tencent.length) return tencent;
    const data = await sdk.kline.cn(symbol, { period: toSdkKlinePeriod(period), adjust: 'qfq' as const });
    return data.slice(-limit).map(toKlinePoint).filter((point): point is KlinePoint => Boolean(point));
  } catch {
    const klt = toEastmoneyKlt(period);
    try {
      return period === '4h' ? aggregateKline(await getEastmoneyKline(symbol, limit * 4, '60'), 4).slice(-limit) : getEastmoneyKline(symbol, limit, klt);
    } catch {
      return [];
    }
  }
}

function toSdkKlinePeriod(period: string): 'daily' | 'weekly' | 'monthly' {
  return period === '1w' ? 'weekly' : period === '1mo' ? 'monthly' : 'daily';
}

function toEastmoneyKlt(period: string) {
  return ({ '15m': '15', '1h': '60', '4h': '60', '1d': '101', '1w': '102', '1mo': '103' } as Record<string, string>)[period] ?? '101';
}

async function getEastmoneyKline(symbol: string, limit: number, klt = '101'): Promise<KlinePoint[]> {
  const market = symbol.startsWith('6') ? '1' : '0';
  const url = new URL('https://push2his.eastmoney.com/api/qt/stock/kline/get');
  url.search = new URLSearchParams({
    secid: `${market}.${symbol}`,
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    klt,
    fqt: '1',
    beg: '0',
    end: '20500101',
    lmt: String(limit),
  }).toString();
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://quote.eastmoney.com/' } });
    if (!response.ok) return [];
    const payload = await response.json() as { data?: { klines?: string[] } };
    return (payload.data?.klines ?? []).map(parseEastmoneyKline).filter((point): point is KlinePoint => Boolean(point));
  } catch {
    return [];
  }
}

async function getTencentHistoryKline(symbol: string, limit: number, period: string): Promise<KlinePoint[]> {
  const quoteSymbol = toQuoteSymbol(symbol);
  const type = period === '1w' ? 'week' : period === '1mo' ? 'month' : 'day';
  const key = `qfq${type}`;
  const url = new URL('https://ifzq.gtimg.cn/appstock/app/fqkline/get');
  url.search = new URLSearchParams({ param: `${quoteSymbol},${type},,,${limit},qfq` }).toString();
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: `https://gu.qq.com/${quoteSymbol}/gp` } });
    if (!response.ok) return [];
    const payload = await response.json() as { data?: Record<string, Record<string, unknown[]>> };
    const rows = payload.data?.[quoteSymbol]?.[key] ?? [];
    return rows.map(parseTencentKline).filter((point): point is KlinePoint => Boolean(point));
  } catch {
    return [];
  }
}

async function getTencentMinuteKline(symbol: string, limit: number, period: '15' | '60'): Promise<KlinePoint[]> {
  const quoteSymbol = toQuoteSymbol(symbol);
  const url = new URL('https://ifzq.gtimg.cn/appstock/app/kline/mkline');
  url.search = new URLSearchParams({ param: `${quoteSymbol},m${period},,${limit}` }).toString();
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: `https://gu.qq.com/${quoteSymbol}/gp` } });
    if (!response.ok) return [];
    const payload = await response.json() as { data?: Record<string, Record<string, unknown[]>> };
  const rows = payload.data?.[quoteSymbol]?.[`m${period}`] ?? [];
    return rows.map(parseTencentKline).filter((point): point is KlinePoint => Boolean(point));
  } catch {
    return [];
  }
}

function parseTencentKline(row: unknown): KlinePoint | undefined {
  if (!Array.isArray(row)) return undefined;
  const [time, open, close, high, low, volume, , amount] = row;
  const point = {
    time: String(time ?? ''),
    timestamp: parseMarketTime(String(time ?? '')),
    open: Number(open),
    close: Number(close),
    high: Number(high),
    low: Number(low),
    volume: Number(volume),
    amount: amount === undefined ? undefined : Number(amount) * 10000,
  };
  return [point.open, point.close, point.high, point.low].every(Number.isFinite) ? point : undefined;
}

function aggregateKline(data: KlinePoint[], size: number): KlinePoint[] {
  const result: KlinePoint[] = [];
  for (let i = 0; i < data.length; i += size) {
    const chunk = data.slice(i, i + size);
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    if (!first || !last) continue;
    result.push({
      time: last.time,
      timestamp: last.timestamp,
      open: first.open,
      close: last.close,
      high: Math.max(...chunk.map((item) => item.high)),
      low: Math.min(...chunk.map((item) => item.low)),
      volume: chunk.reduce((sum, item) => sum + item.volume, 0),
      amount: chunk.reduce((sum, item) => sum + (item.amount ?? 0), 0),
      change: last.close - first.open,
      changePercent: first.open ? ((last.close - first.open) / first.open) * 100 : undefined,
      turnoverRate: chunk.reduce((sum, item) => sum + (item.turnoverRate ?? 0), 0),
      pe: last.pe,
    });
  }
  return result;
}

function parseEastmoneyKline(line: string): KlinePoint | undefined {
  const [time, open, close, high, low, volume, amount, amplitude, changePercent, change, turnoverRate] = line.split(',');
  const point = {
    time,
    timestamp: parseMarketTime(time),
    open: Number(open),
    close: Number(close),
    high: Number(high),
    low: Number(low),
    volume: Number(volume),
    amount: Number(amount),
    change: Number(change),
    changePercent: Number(changePercent),
    turnoverRate: Number(turnoverRate),
  };
  void amplitude;
  return [point.open, point.close, point.high, point.low].every(Number.isFinite) ? point : undefined;
}

function parseMarketTime(value: string): number | undefined {
  const text = String(value || '').trim();
  const minute = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (minute) return new Date(`${minute[1]}-${minute[2]}-${minute[3]}T${minute[4]}:${minute[5]}:00+08:00`).getTime();
  const day = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (day) return new Date(`${day[1]}-${day[2]}-${day[3]}T00:00:00+08:00`).getTime();
  const date = Date.parse(text.includes('T') ? text : `${text}T00:00:00+08:00`);
  return Number.isFinite(date) ? date : undefined;
}

function toKlinePoint(raw: unknown): KlinePoint | undefined {
  const record = (raw ?? {}) as AnyRecord;
  const open = pickNumber(record, ['open', '开盘价']);
  const close = pickNumber(record, ['close', '收盘价']);
  const high = pickNumber(record, ['high', '最高价']);
  const low = pickNumber(record, ['low', '最低价']);
  if (open === undefined || close === undefined || high === undefined || low === undefined) return undefined;
  return {
    time: pickString(record, ['date', 'time', '日期']) ?? '',
    timestamp: pickNumber(record, ['timestamp']) ?? parseMarketTime(pickString(record, ['date', 'time', '日期']) ?? ''),
    open,
    close,
    high,
    low,
    volume: pickNumber(record, ['volume', '成交量']) ?? 0,
    amount: pickNumber(record, ['amount', '成交额']),
    change: pickNumber(record, ['change', '涨跌额']),
    changePercent: pickNumber(record, ['changePercent', '涨跌幅']),
    turnoverRate: pickNumber(record, ['turnoverRate', '换手率']),
    pe: pickNumber(record, ['pe', 'PE', '市盈率']),
  };
}

export async function getStockDetail(symbolInput: string): Promise<StockDetail> {
  try {
    const quote = await getQuote(symbolInput);
    try {
      const technical = await analyzeTechnical(symbolInput);
      return {
        ...quote,
        rating: {
          fundamental: quote.rating?.fundamental ?? '待评估',
          valuation: quote.rating?.valuation ?? '需核查',
          risk: quote.rating?.risk ?? '中性',
          tech: technical.subtitle?.includes('金叉') || technical.subtitle?.includes('站上') ? '偏多' : '中性',
        },
        summary: `${quote.summary ?? ''} ${technical.narrative ?? ''}`.trim(),
      };
    } catch {
      return quote;
    }
  } catch (error) {
    const code = normalizeASymbol(symbolInput);
    return {
      code,
      name: code,
      exchange: inferExchange(code),
      price: '--',
      changePercent: '--',
      summary: `暂时无法从 stock-sdk 获取 ${code} 的实时详情：${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}

export async function getBoardDetail(symbol: string): Promise<BoardDetail> {
  const [industries, concepts] = await Promise.all([sdk.board.industry.list(), sdk.board.concept.list()]);
  const board = [...industries, ...concepts].find((item) => item.code === symbol) ?? { code: symbol, name: symbol, changePercent: null };
  const loader = industries.some((item) => item.code === symbol) ? sdk.board.industry.constituents : sdk.board.concept.constituents;
  const rows = await loader(symbol);
  return {
    code: board.code,
    name: board.name,
    changePercent: board.changePercent === null ? '--' : formatPercent(board.changePercent),
    constituents: rows.slice(0, 80).map((item) => ({
      code: item.code,
      name: item.name,
      price: item.price ?? '--',
      changePercent: item.changePercent === null ? '--' : formatPercent(item.changePercent),
      amount: item.amount === null ? '--' : formatMoney(item.amount),
      turnover: item.turnoverRate === null ? '--' : `${formatNumber(item.turnoverRate)}%`,
    })),
  };
}

export async function analyzeTechnical(symbolInput: string): Promise<AgentResultCard> {
  const klines = await getKline(symbolInput, 140);
  return analyzeIndicators(klines);
}

export async function listHotFocus(tab: HotFocusTab): Promise<HotFocusItem[]> {
  try {
    if (tab === 'sector') return listSectorHot();
    if (tab === 'market') return listMarketHot();
    if (tab === 'surge') return listSurgeHot();
    if (tab === 'flow') return listFlowHot();
    return listStockRankHot(tab);
  } catch {
    return [];
  }
}

async function listSectorHot(): Promise<HotFocusItem[]> {
  const [industries, concepts, flows] = await Promise.allSettled([
    sdk.board.industry.list(),
    sdk.board.concept.list(),
    sdk.fundFlow.sectorRank({ indicator: 'today' }),
  ]);
  const boards = [
    ...(industries.status === 'fulfilled' ? industries.value : []),
    ...(concepts.status === 'fulfilled' ? concepts.value : []),
  ];
  if (boards.length) {
    return boards
      .sort((a, b) => Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0))
      .slice(0, 12)
      .map((item) => ({
        id: `sector-${item.code}`,
        title: item.name,
        code: item.code,
        name: item.name,
        changePercent: formatPercent(item.changePercent ?? 0),
        amount: item.totalMarketCap ? `${(item.totalMarketCap / 100000000).toFixed(1)}亿` : undefined,
        description: item.leadingStock ? `领涨：${item.leadingStock}${item.leadingStockChangePercent === null ? '' : ` ${formatPercent(item.leadingStockChangePercent)}`}` : 'stock-sdk 板块行情',
        tag: item.code,
        type: Number(item.changePercent ?? 0) >= 0 ? 'surge' : 'plummet',
      }));
  }
  return flows.status === 'fulfilled' && flows.value.length ? flows.value.slice(0, 12).map((item) => ({
    id: `sector-${item.code}`,
    title: item.name,
    code: item.code,
    name: item.name,
    changePercent: item.changePercent === null ? '--' : formatPercent(item.changePercent),
    amount: item.mainNetInflow === null ? '--' : formatMoney(item.mainNetInflow),
    description: `主力净流入 ${formatMoney(item.mainNetInflow)}${item.topStockName ? `，最大净流入：${item.topStockName}` : ''}`,
    tag: item.code,
    type: Number(item.changePercent ?? 0) >= 0 ? 'surge' : 'plummet',
  })) : fallbackSectorHot();
}

function fallbackSectorHot(): HotFocusItem[] {
  return [
    ['BK0475', '半导体', '+1.86%', '国产替代与AI算力链活跃'],
    ['BK0437', '酿酒行业', '+1.12%', '消费复苏预期升温'],
    ['BK0428', '证券', '+0.94%', '市场成交回暖带动券商弹性'],
    ['BK0737', '软件开发', '+0.73%', 'AI应用与信创方向轮动'],
  ].map(([code, name, changePercent, description]) => ({
    id: `sector-fallback-${code}`,
    title: name,
    code,
    name,
    changePercent,
    description,
    tag: code,
    type: String(changePercent).startsWith('-') ? 'plummet' : 'surge',
  }));
}

async function listMarketHot(): Promise<HotFocusItem[]> {
  const rows = (await sdk.fundFlow.market()).slice(0, 10);
  return rows.map((item) => ({
    id: `market-${item.date}`,
    title: item.date,
    price: item.shClose ?? '--',
    changePercent: item.shChangePercent === null ? '--' : formatPercent(item.shChangePercent),
    amount: item.mainNetInflow === null ? '--' : formatMoney(item.mainNetInflow),
    description: `上证 ${formatPercent(item.shChangePercent ?? 0)} / 深证 ${formatPercent(item.szChangePercent ?? 0)}，主力净流入 ${formatMoney(item.mainNetInflow)}`,
    tag: '大盘资金',
    type: Number(item.mainNetInflow ?? 0) >= 0 ? 'surge' : 'plummet',
  }));
}

async function listSurgeHot(): Promise<HotFocusItem[]> {
  const changes = await sdk.marketEvent.stockChanges();
  return changes.slice(0, 20).map((item) => {
    const [, price, pct] = String(item.info ?? '').split(',');
    return {
      id: `surge-${item.time}-${item.code}`,
      title: `${item.name} ${item.code}`,
      code: item.code,
      name: item.name,
      time: item.time,
      price: price ? Number(price).toFixed(2) : undefined,
      changePercent: pct ? formatPercent(Number(pct) * 100) : undefined,
      description: [price ? `现价 ${Number(price).toFixed(2)}` : '', pct ? `涨跌幅 ${formatPercent(Number(pct) * 100)}` : ''].filter(Boolean).join(' · '),
      tag: item.changeTypeLabel,
      type: /卖|跌|跳水|下挫/.test(item.changeTypeLabel) ? 'plummet' : 'surge',
    };
  });
}

async function listFlowHot(): Promise<HotFocusItem[]> {
  const rows = await sdk.fundFlow.sectorRank({ indicator: 'today' });
  return rows.slice(0, 16).map((item) => ({
    id: `flow-${item.code}`,
    title: item.name,
    code: item.topStockCode,
    name: item.topStockName,
    changePercent: item.changePercent === null ? '--' : formatPercent(item.changePercent),
    amount: item.mainNetInflow === null ? '--' : formatMoney(item.mainNetInflow),
    description: `主力净流入 ${formatMoney(item.mainNetInflow)}${item.topStockName ? `，最大净流入：${item.topStockName}` : ''}`,
    tag: '资金流向',
    type: Number(item.mainNetInflow ?? 0) >= 0 ? 'surge' : 'plummet',
  }));
}

async function listStockRankHot(tab: HotFocusTab): Promise<HotFocusItem[]> {
  const rows = await sdk.fundFlow.rank({ indicator: 'today' });
  return rows.slice(0, 16).map((item) => ({
    id: `${tab}-${item.code}`,
    title: item.name,
    code: item.code,
    name: item.name,
    price: item.price ?? '--',
    changePercent: item.changePercent === null ? '--' : formatPercent(item.changePercent),
    amount: item.mainNetInflow === null ? '--' : formatMoney(item.mainNetInflow),
    description: tab === 'diagnosis' ? `主力净占比 ${formatPercent(item.mainNetInflowPercent ?? 0)}，点击查看个股详情` : `主力净流入 ${formatMoney(item.mainNetInflow)}，超大单 ${formatMoney(item.superLargeNetInflow)}`,
    tag: tab === 'diagnosis' ? '诊股候选' : '资金策略',
    type: Number(item.mainNetInflow ?? 0) >= 0 ? 'surge' : 'plummet',
  }));
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

export async function getBoardSnapshot(keyword: string): Promise<AgentResultCard> {
  const [industries, concepts, sectorRank] = await Promise.allSettled([
    sdk.board.industry.list(),
    sdk.board.concept.list(),
    sdk.fundFlow.sectorRank({ indicator: 'today' }),
  ]);

  const boards = [
    ...(industries.status === 'fulfilled' ? (industries.value as unknown as AnyRecord[]) : []),
    ...(concepts.status === 'fulfilled' ? (concepts.value as unknown as AnyRecord[]) : []),
  ];
  const matched = boards.find((board) => String(board.name ?? board.boardName ?? '').includes(keyword.replace(/板块|行业/g, '')));
  const flows = sectorRank.status === 'fulfilled' ? (sectorRank.value as unknown as AnyRecord[]).slice(0, 6) : [];

  return {
    title: `${keyword}板块速览`,
    subtitle: matched ? `匹配板块：${String(matched.name ?? matched.boardName)}` : '未精确匹配板块，展示资金流排名参考',
    rows: flows.map((flow) => ({
      板块: String(flow.name ?? flow.boardName ?? flow.sectorName ?? '--'),
      净流入: String(flow.netInflow ?? flow.mainNetInflow ?? flow.today ?? '--'),
      涨跌幅: String(flow.changePercent ?? flow.pctChg ?? '--'),
    })),
    narrative: '板块数据来自 stock-sdk 行业/概念与资金流接口。若上游数据源限流或字段变动，结果会自动降级展示。',
  };
}
