import { useCallback, useEffect, useRef, useState } from 'react';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import { createHotStockHintGroups, type IHotStockHint } from './hot-stock-hints';

interface IUseHotStockHintsResult {
  hints: IHotStockHint[];
  loading: boolean;
  error?: string;
  isPreviousTradeDay: boolean;
  tradeDate?: string;
  refresh(): void;
}

let cachedGroups: IHotStockHint[][] = [];
let cachedGroupIndex = 0;
let cachedSource = { isPreviousTradeDay: false, tradeDate: undefined as string | undefined };
let pendingGroups: Promise<IHotStockHint[][]> | undefined;

async function fetchHintGroups(): Promise<IHotStockHint[][]> {
  if (!pendingGroups) {
    pendingGroups = getStocksenseApi()
      .getHotStockHintSource()
      .then((source) => {
        cachedSource = { isPreviousTradeDay: source.isPreviousTradeDay, tradeDate: source.tradeDate };
        return createHotStockHintGroups(source.items);
      })
      .finally(() => {
        pendingGroups = undefined;
      });
  }
  return pendingGroups;
}

export function useHotStockHints(conversationId?: string): IUseHotStockHintsResult {
  const [hints, setHints] = useState<IHotStockHint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [source, setSource] = useState(cachedSource);
  const previousConversationId = useRef<string>();
  const loadingRef = useRef(false);

  const loadNextGroup = useCallback(() => {
    if (loadingRef.current) return undefined;
    loadingRef.current = true;
    let active = true;
    const next = async () => {
      const group = cachedGroups[cachedGroupIndex];
      if (group) {
        cachedGroupIndex += 1;
        if (active) setHints(group);
        loadingRef.current = false;
        return;
      }
      if (active) {
        setLoading(true);
        setError(undefined);
      }
      try {
        cachedGroups = await fetchHintGroups();
        cachedGroupIndex = 0;
        const firstGroup = cachedGroups[cachedGroupIndex];
        if (active) {
          setHints(firstGroup ?? []);
          setSource(cachedSource);
          if (firstGroup) cachedGroupIndex += 1;
        }
      } catch (error: unknown) {
        if (active) {
          setHints([]);
          setError(error instanceof Error ? error.message : '热点数据暂不可用');
        }
      } finally {
        loadingRef.current = false;
        if (active) setLoading(false);
      }
    };
    void next();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (previousConversationId.current === conversationId) return;
    previousConversationId.current = conversationId;
    return loadNextGroup();
  }, [conversationId, loadNextGroup]);

  return { hints, loading, error, isPreviousTradeDay: source.isPreviousTradeDay, tradeDate: source.tradeDate, refresh: loadNextGroup };
}
