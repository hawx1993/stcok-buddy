import StockSDK from 'stock-sdk';
import type { AgentResultCard, StockDetail } from '../../../src/shared/types.js';
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
