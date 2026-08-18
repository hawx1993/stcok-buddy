import type { StockDetail } from '../../../../src/shared/types.js';
import { getLatestDailyBar } from '../../market-data/market-data-store.js';
import { queryLatestQuote } from '../../market-data/market-data-query.js';
import { remoteMarketStatus } from '../../market-data/providers.js';
import type { ITencentQuote } from '../../stock/a-stock-data-runner.js';
import { runAStockDataFn } from '../../stock/a-stock-data-runner.js';
import type { AgentTool } from '../../tools/types.js';
import { localBarToStockDetail, tencentQuoteToStockDetail } from '../agent-data-mappers.js';
import { asRecord, formatError, text } from './input.js';

/** 模型可调用：获取单股行情，遵循 DuckDB → stock-sdk → a-stock-data 的真实数据优先级。 */
export const getStockQuoteLocalFirst: AgentTool<{ symbol: string }, StockDetail> = {
  name: 'getStockQuoteLocalFirst',
  description: 'Get A-share quote with priority DuckDB → stock-sdk → a-stock-data.',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  async run(input) {
    const symbol = text(asRecord(input), 'symbol');
    const marketStatus = remoteMarketStatus();
    const marketOpen = marketStatus === 'open' || marketStatus === 'pre_market' || marketStatus === 'lunch_break';
    const errors: string[] = [];
    if (!marketOpen) {
      try {
        const bar = await getLatestDailyBar(symbol);
        const barDate = String(bar?.tradeDate ?? '');
        const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
        if (bar && barDate >= weekAgo) return localBarToStockDetail(bar, symbol);
      } catch (error) {
        errors.push(`DuckDB 本地行情读取失败：${formatError(error)}`);
      }
    }
    let localStaleQuote: StockDetail | undefined;
    try {
      const result = await queryLatestQuote(symbol);
      const freshRemote =
        result.meta.storage === 'remote' && result.meta.freshness !== 'stale' && result.meta.freshness !== 'fallback';
      if (freshRemote) return result.data;
      localStaleQuote = result.data;
      errors.push(...(result.meta.warnings ?? ['stock-sdk 未返回满足实时性的行情']));
    } catch (error) {
      errors.push(`stock-sdk 行情获取失败：${formatError(error)}`);
    }
    try {
      const quotes = await runAStockDataFn<Record<string, ITencentQuote>>('tencent_quote', { codes: symbol });
      const quote = quotes?.[symbol];
      if (quote && !quote.is_stale) return tencentQuoteToStockDetail(quote, symbol);
      if (quote?.is_stale) errors.push(`a-stock-data 腾讯行情过期：${quote.stale_reason ?? '报价可能非当日真实成交'}`);
    } catch (error) {
      errors.push(`a-stock-data 腾讯行情失败：${formatError(error)}`);
    }
    if (!marketOpen && localStaleQuote) return localStaleQuote;
    throw new Error(`行情数据源暂不可用：${errors.join('；') || '未返回可用行情'}`);
  },
};
