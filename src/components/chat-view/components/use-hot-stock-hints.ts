import { useCallback, useEffect, useRef, useState } from 'react';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import { createHotStockHintGroups, type IHotStockHint } from './hot-stock-hints';

interface IUseHotStockHintsResult {
  hints: IHotStockHint[];
  loading: boolean;
  refresh(): void;
}

let cachedGroups: IHotStockHint[][] = [];
let cachedGroupIndex = 0;
let pendingGroups: Promise<IHotStockHint[][]> | undefined;

async function fetchHintGroups(): Promise<IHotStockHint[][]> {
  if (!pendingGroups) {
    pendingGroups = Promise.all([getStocksenseApi().listHotFocus('surge'), getStocksenseApi().listHotFocus('sector')])
      .then(([surge, sector]) => createHotStockHintGroups([...surge, ...sector]))
      .finally(() => {
        pendingGroups = undefined;
      });
  }
  return pendingGroups;
}

export function useHotStockHints(conversationId?: string): IUseHotStockHintsResult {
  const [hints, setHints] = useState<IHotStockHint[]>([]);
  const [loading, setLoading] = useState(false);
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
      if (active) setLoading(true);
      try {
        cachedGroups = await fetchHintGroups();
        cachedGroupIndex = 0;
        const firstGroup = cachedGroups[cachedGroupIndex];
        if (active) {
          setHints(firstGroup ?? []);
          if (firstGroup) cachedGroupIndex += 1;
        }
      } catch {
        if (active) setHints([]);
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

  return { hints, loading, refresh: loadNextGroup };
}
