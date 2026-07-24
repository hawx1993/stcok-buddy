import type { StockAnalysisAgentName } from './stock-analysis-agents.js';
import type { TAgentIntent } from './orchestrator-types.js';

interface ISlashCommand {
  name: string;
  intent: TAgentIntent;
  usage: string;
  allowEmptyArgs?: boolean;
  singleAgent?: StockAnalysisAgentName;
}

export interface IParsedSlashCommand extends ISlashCommand {
  args: string;
}

const slashCommands: ISlashCommand[] = [
  { name: '/综合投研报告', intent: 'analysis', usage: '请输入股票代码或股票名称，例如：/综合投研报告 中公教育' },
  { name: '/新闻公告', intent: 'news-announcements', usage: '请输入股票代码或股票名称，例如：/新闻公告 000858' },
  { name: '/题材归因', intent: 'theme-attribution', usage: '今天哪些股票走强，主要是什么题材', allowEmptyArgs: true },
  { name: '/全市场龙虎榜', intent: 'daily-lhb', usage: '今天龙虎榜哪些票净买入最多', allowEmptyArgs: true },
  { name: '/复盘今日行情', intent: 'market-review', usage: '直接发送即可，系统将复盘最近可用交易日行情', allowEmptyArgs: true },
  { name: '/技术面分析', intent: 'analysis', singleAgent: 'technical', usage: '请输入股票代码或股票名称，例如：/技术面分析 000858' },
  { name: '/基本面分析', intent: 'analysis', singleAgent: 'fundamental', usage: '请输入股票代码或股票名称，例如：/基本面分析 000858' },
  { name: '/资金面分析', intent: 'analysis', singleAgent: 'capital', usage: '请输入股票代码或股票名称，例如：/资金面分析 000858' },
  { name: '/情绪面分析', intent: 'analysis', singleAgent: 'sentiment', usage: '请输入股票代码或股票名称，例如：/情绪面分析 000858' },
  { name: '/筹码分布', intent: 'analysis', singleAgent: 'chip', usage: '请输入股票代码或股票名称，例如：/筹码分布 000858' },
  { name: '/筹码分析', intent: 'analysis', singleAgent: 'chip', usage: '请输入股票代码或股票名称，例如：/筹码分析 000858' },
];

export function parseSlashCommand(query: string): IParsedSlashCommand | undefined {
  const text = query.trim();
  const command = slashCommands.find((item) => text === item.name || text.startsWith(`${item.name} `));
  return command ? { ...command, args: text.slice(command.name.length).trim() } : undefined;
}

export function extractUrls(text: string): string[] {
  return [...new Set([...text.matchAll(/https?:\/\/[^\s，。；、)）]+/g)].map((match) => match[0]))];
}

export function classifyIntent(query: string): TAgentIntent {
  if (/复盘今日行情|今日行情复盘|市场复盘/.test(query)) return 'market-review';
  if (/全市场龙虎榜|龙虎榜.*净买入|净买入.*龙虎榜/.test(query)) return 'daily-lhb';
  if (/题材归因|哪些股票走强|主要是什么题材/.test(query)) return 'theme-attribution';
  if (hasStock(query) && /新闻|公告/.test(query)) return 'news-announcements';
  if (/持仓|我买|成本|盈亏|记住/.test(query)) return 'portfolio';
  if (/板块|行业|选股|资金流|北向|热点/.test(query)) return 'board';
  if (/MACD|KDJ|K线|均线|技术|走势|金叉|死叉/.test(query)) return 'technical';
  if (/股价|行情|现价|多少|涨跌/.test(query)) return 'quote';
  if (hasStock(query) && (/分析|诊股|个股分析|帮我看看|看看/.test(query) || isStockOnlyQuery(query))) return 'analysis';
  return 'chat';
}

export function isPossibleStockOnlyQuery(query: string): boolean {
  return /^\s*(?:\d{6}|[A-Za-z0-9一-龥]{2,12})\s*$/.test(query);
}

export function needsSymbol(intent: TAgentIntent): boolean {
  return intent === 'quote' || intent === 'technical' || intent === 'analysis' || intent === 'news-announcements';
}

export function intentLabel(intent: TAgentIntent): string {
  return {
    quote: '行情查询', technical: '技术诊股', analysis: '五维个股分析', 'news-announcements': '新闻公告',
    'theme-attribution': '题材归因', 'daily-lhb': '全市场龙虎榜', 'market-review': '今日行情复盘',
    board: '板块分析', portfolio: '持仓管理', chat: '普通问答',
  }[intent];
}

export function extractBoardKeyword(query: string): string {
  const match = query.match(/([一-龥A-Za-z0-9]+)(板块|行业)/);
  if (match) return match[1];
  if (query.includes('北向')) return '北向资金';
  if (query.includes('资金')) return '资金流';
  return '热点';
}

function hasStock(query: string): boolean {
  return /\d{6}|[一-龥]{2,}(?:股份|教育|银行|证券|科技|时代|茅台|五粮液|老窖)/.test(query);
}

function isStockOnlyQuery(query: string): boolean {
  return /^\s*(?:\d{6}|[一-龥]{2,}(?:股份|教育|银行|证券|科技|时代|茅台|五粮液|老窖))\s*$/.test(query);
}
