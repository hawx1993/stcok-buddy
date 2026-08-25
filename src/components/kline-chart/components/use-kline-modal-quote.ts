import { useEffect, useState } from 'react';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import { isChinaMarketOpen } from '../../../shared/market-time';
import type { StockDetail } from '../../../shared/types';

const KLINE_MODAL_QUOTE_REFRESH_INTERVAL_MS = 15_000;

type TKlineModalQuote = Pick<StockDetail, 'price' | 'changePercent'>;
type TSetInterval = (callback: () => void, milliseconds: number) => number;
type TClearInterval = (handle: number) => void;

interface IKlineModalQuotePollerOptions {
  code: string;
  load(): Promise<TKlineModalQuote | undefined>;
  onQuote(quote: TKlineModalQuote): void;
  onError(error: unknown): void;
  shouldPoll?: () => boolean;
  setIntervalFn?: TSetInterval;
  clearIntervalFn?: TClearInterval;
}

export function createKlineModalQuotePoller(options: IKlineModalQuotePollerOptions) {
  if (!options.code) return { stop: () => undefined };
  const shouldPoll = options.shouldPoll ?? isChinaMarketOpen;
  const setIntervalFn = options.setIntervalFn ?? ((callback, milliseconds) => window.setInterval(callback, milliseconds));
  const clearIntervalFn = options.clearIntervalFn ?? ((handle) => window.clearInterval(handle));
  let active = true;
  let pending = false;

  const poll = async () => {
    if (!active || pending) return;
    pending = true;
    try {
      const quote = await options.load();
      if (active && quote) options.onQuote(quote);
    } catch (error: unknown) {
      if (active) options.onError(error);
    } finally {
      pending = false;
    }
  };

  void poll();
  const timer = shouldPoll()
    ? setIntervalFn(() => void poll(), KLINE_MODAL_QUOTE_REFRESH_INTERVAL_MS)
    : undefined;

  return {
    stop() {
      active = false;
      if (timer !== undefined) clearIntervalFn(timer);
    },
  };
}

export function useKlineModalQuote(stock: Pick<StockDetail, 'code' | 'price' | 'changePercent'>): TKlineModalQuote {
  const [quote, setQuote] = useState<TKlineModalQuote>(() => ({
    price: stock.price,
    changePercent: stock.changePercent,
  }));

  useEffect(() => {
    if (!stock.code) return;

    const poller = createKlineModalQuotePoller({
      code: stock.code,
      load: async () => (await getStocksenseApi().getBatchQuotes([stock.code]))[0],
      onQuote: (nextQuote) => {
        setQuote((current) => ({
          price: nextQuote.price ?? current.price,
          changePercent: nextQuote.changePercent ?? current.changePercent,
        }));
      },
      onError: (error: unknown) => console.error('K 线弹窗实时行情刷新失败', error),
    });

    return () => poller.stop();
  }, [stock.code]);

  useEffect(() => {
    setQuote((current) => ({
      price: stock.price ?? current.price,
      changePercent: stock.changePercent ?? current.changePercent,
    }));
  }, [stock.changePercent, stock.code, stock.price]);

  return quote;
}
