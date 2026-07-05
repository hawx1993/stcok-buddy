import StockSDK from 'stock-sdk';
import type { AgentResultCard, HotFocusItem, HotFocusTab, StockDetail } from '../../../src/shared/types.js';
import { formatNumber, formatPercent, pickNumber, pickString } from './format.js';
import { analyzeIndicators } from './indicators.js';
import { normalizeASymbol, inferExchange } from './symbols.js';

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
  const marketCap = pickNumber(record, ['marketCap', '总市值', 'f20']);

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

export async function getQuote(symbolInput: string): Promise<StockDetail> {
  const symbol = normalizeASymbol(symbolInput);
  const quotes = await sdk.quotes.cn([symbol]);
  return toStockDetail(quotes[0], symbol);
}

export async function getKline(symbolInput: string, limit = 120): Promise<unknown[]> {
  const symbol = normalizeASymbol(symbolInput);
  const data = await sdk.kline.cn(symbol, { period: 'daily', adjust: 'qfq' as const });
  return data.slice(-limit);
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
  const [industries, concepts] = await Promise.all([sdk.board.industry.list(), sdk.board.concept.list()]);
  return [...industries, ...concepts]
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
  return changes.slice(0, 20).map((item) => ({
    id: `surge-${item.time}-${item.code}`,
    title: item.name,
    code: item.code,
    name: item.name,
    description: `${item.time} ${item.changeTypeLabel}${item.info ? `：${item.info}` : ''}`,
    tag: item.changeTypeLabel,
    type: /卖|跌|跳水|下挫/.test(item.changeTypeLabel) ? 'plummet' : 'surge',
  }));
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
