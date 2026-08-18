import { useCallback, useEffect, useRef, useState } from 'react';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { IHotStockHintSource } from '../../../shared/types';
import { createHotStockHintGroups, type IHotStockHint } from './hot-stock-hints';

interface IUseHotStockHintsResult {
  hints: IHotStockHint[];
  loading: boolean;
  error?: string;
  isPreviousTradeDay: boolean;
  tradeDate?: string;
  refresh(): void;
}

type THotStockHintDisplaySource = Pick<IHotStockHintSource, 'isPreviousTradeDay' | 'tradeDate'>;

const emptySource: THotStockHintDisplaySource = { isPreviousTradeDay: false };

export function useHotStockHints(conversationId?: string): IUseHotStockHintsResult {
  const [hints, setHints] = useState<IHotStockHint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [source, setSource] = useState<THotStockHintDisplaySource>(emptySource);
  const groupsRef = useRef<IHotStockHint[][]>([]);
  const groupIndexRef = useRef(0);
  const loadingRef = useRef(false);
  const requestVersionRef = useRef(0);

  const applySource = useCallback((nextSource: IHotStockHintSource) => {
    const groups = createHotStockHintGroups(nextSource.items);
    groupsRef.current = groups;
    groupIndexRef.current = groups.length > 1 ? 1 : 0;
    setHints(groups[0] ?? []);
    setSource({
      isPreviousTradeDay: nextSource.isPreviousTradeDay,
      tradeDate: nextSource.tradeDate,
    });
    setError(undefined);
  }, []);

  const loadSource = useCallback(
    (force = false) => {
      if (loadingRef.current && !force) return;
      loadingRef.current = true;
      const requestVersion = requestVersionRef.current + 1;
      requestVersionRef.current = requestVersion;
      setLoading(true);
      setError(undefined);

      void getStocksenseApi()
        .getHotStockHintSource()
        .then((nextSource) => {
          if (requestVersion !== requestVersionRef.current) return;
          applySource(nextSource);
        })
        .catch((requestError: unknown) => {
          if (requestVersion !== requestVersionRef.current) return;
          setHints([]);
          setError(requestError instanceof Error ? requestError.message : '热点数据暂不可用');
        })
        .finally(() => {
          if (requestVersion !== requestVersionRef.current) return;
          loadingRef.current = false;
          setLoading(false);
        });
    },
    [applySource],
  );

  const refresh = useCallback(() => {
    if (loadingRef.current) return;
    const groups = groupsRef.current;
    if (!groups.length) {
      loadSource();
      return;
    }

    if (groupIndexRef.current >= groups.length) groupIndexRef.current = 0;
    const nextGroup = groups[groupIndexRef.current];
    groupIndexRef.current += 1;
    setHints(nextGroup ?? []);
  }, [loadSource]);

  useEffect(() => {
    const api = getStocksenseApi();
    const unsubscribe = api.onHotStockHintSourceUpdated?.((updatedSource) => {
      requestVersionRef.current += 1;
      loadingRef.current = false;
      setLoading(false);
      applySource(updatedSource);
    });
    loadSource(true);
    return () => unsubscribe?.();
  }, [applySource, conversationId, loadSource]);

  return { hints, loading, error, isPreviousTradeDay: source.isPreviousTradeDay, tradeDate: source.tradeDate, refresh };
}
