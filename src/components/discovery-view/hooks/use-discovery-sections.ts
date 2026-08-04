import { useCallback, useEffect, useRef, useState } from 'react';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { TDiscoverySnapshotSection } from '../../../shared/types';
import type { IDiscoverySnapshot } from '../types';

export type TDiscoverySectionStatus = 'idle' | 'loading' | 'loaded' | 'error';

interface IDiscoverySectionState {
  status: TDiscoverySectionStatus;
  error?: string;
}

const IDLE_SECTION_STATE: IDiscoverySectionState = { status: 'idle' };

function toDiscoverySnapshot(input: Record<string, unknown>): IDiscoverySnapshot {
  return {
    ...input,
    tradeDate: typeof input.tradeDate === 'string' ? input.tradeDate : '',
    generatedAt: typeof input.generatedAt === 'string' ? input.generatedAt : new Date().toISOString(),
  } as IDiscoverySnapshot;
}

export function mergeDiscoverySectionSnapshot(
  current: IDiscoverySnapshot | undefined,
  incoming: IDiscoverySnapshot,
): IDiscoverySnapshot {
  if (!current || current.tradeDate !== incoming.tradeDate) return incoming;
  return {
    ...current,
    ...incoming,
    marketSummary: incoming.marketSummary ?? current.marketSummary,
    tradeDates: incoming.tradeDates?.length ? incoming.tradeDates : current.tradeDates,
    unavailableReason: incoming.unavailableReason,
  };
}

export function mergeDiscoveryTradeDateNavSnapshot(
  current: IDiscoverySnapshot | undefined,
  incoming: IDiscoverySnapshot,
): IDiscoverySnapshot {
  if (!current) return incoming;
  return {
    ...current,
    tradeDate: current.tradeDate || incoming.tradeDate,
    generatedAt: current.generatedAt || incoming.generatedAt,
    tradeDates: incoming.tradeDates?.length ? incoming.tradeDates : current.tradeDates,
  };
}

export function useDiscoverySections() {
  const [snapshot, setSnapshot] = useState<IDiscoverySnapshot>();
  const [selectedTradeDate, setSelectedTradeDate] = useState('');
  const [activeSections, setActiveSections] = useState<Set<TDiscoverySnapshotSection>>(
    () => new Set<TDiscoverySnapshotSection>(['hero']),
  );
  const [sectionStates, setSectionStates] = useState<Partial<Record<TDiscoverySnapshotSection, IDiscoverySectionState>>>(
    {},
  );
  const generationRef = useRef(0);
  const requestIdsRef = useRef(new Map<TDiscoverySnapshotSection, number>());
  const selectedTradeDateRef = useRef('');
  const sectionStatesRef = useRef<Partial<Record<TDiscoverySnapshotSection, IDiscoverySectionState>>>({});

  const setSectionState = useCallback((section: TDiscoverySnapshotSection, state: IDiscoverySectionState) => {
    sectionStatesRef.current = { ...sectionStatesRef.current, [section]: state };
    setSectionStates(sectionStatesRef.current);
  }, []);

  const loadSection = useCallback(async (
    section: TDiscoverySnapshotSection,
    tradeDate = selectedTradeDateRef.current,
  ) => {
    const generation = generationRef.current;
    const requestId = (requestIdsRef.current.get(section) ?? 0) + 1;
    requestIdsRef.current.set(section, requestId);
    setSectionState(section, { status: 'loading' });
    try {
      const data = await getStocksenseApi().getDiscoverySnapshot({
        ...(tradeDate ? { tradeDate } : {}),
        sections: [section],
      });
      if (generation !== generationRef.current || requestIdsRef.current.get(section) !== requestId) return;
      const nextSnapshot = toDiscoverySnapshot(data);
      setSnapshot((current) => mergeDiscoverySectionSnapshot(current, nextSnapshot));
      if (section === 'hero') {
        const nextTradeDate = tradeDate || nextSnapshot.tradeDate;
        selectedTradeDateRef.current = nextTradeDate;
        setSelectedTradeDate(nextTradeDate);
      }
      setSectionState(section, { status: 'loaded' });
    } catch (error) {
      if (generation !== generationRef.current || requestIdsRef.current.get(section) !== requestId) return;
      setSectionState(section, {
        status: 'error',
        error: error instanceof Error ? error.message : '数据加载失败',
      });
    }
  }, [setSectionState]);

  const loadTradeDateNav = useCallback(async (tradeDate = selectedTradeDateRef.current) => {
    const generation = generationRef.current;
    const section: TDiscoverySnapshotSection = 'trade-date-nav';
    const requestId = (requestIdsRef.current.get(section) ?? 0) + 1;
    requestIdsRef.current.set(section, requestId);
    try {
      const data = await getStocksenseApi().getDiscoverySnapshot({
        ...(tradeDate ? { tradeDate } : {}),
        sections: [section],
      });
      if (generation !== generationRef.current || requestIdsRef.current.get(section) !== requestId) return;
      setSnapshot((current) => mergeDiscoveryTradeDateNavSnapshot(current, toDiscoverySnapshot(data)));
    } catch (error) {
      console.warn('[discovery] trade date navigation unavailable', error);
    }
  }, []);

  const activateSection = useCallback((section: TDiscoverySnapshotSection) => {
    setActiveSections((current) => {
      if (current.has(section)) return current;
      const next = new Set(current);
      next.add(section);
      return next;
    });
    const state = sectionStatesRef.current[section] ?? IDLE_SECTION_STATE;
    if (state.status === 'idle') void loadSection(section);
  }, [loadSection]);

  const selectTradeDate = useCallback((tradeDate: string) => {
    generationRef.current += 1;
    requestIdsRef.current.clear();
    selectedTradeDateRef.current = tradeDate;
    setSelectedTradeDate(tradeDate);
    setSnapshot((current) => ({
      tradeDate,
      generatedAt: new Date().toISOString(),
      tradeDates: current?.tradeDates,
    }));
    sectionStatesRef.current = {};
    setSectionStates({});
    setActiveSections(new Set<TDiscoverySnapshotSection>(['hero']));
    void loadTradeDateNav(tradeDate);
    void loadSection('hero', tradeDate);
  }, [loadSection, loadTradeDateNav]);

  const refreshActiveSections = useCallback((useDefaultTradeDate = false) => {
    const tradeDate = useDefaultTradeDate ? '' : selectedTradeDate;
    for (const section of activeSections) void loadSection(section, tradeDate);
  }, [activeSections, loadSection, selectedTradeDate]);

  useEffect(() => {
    void loadTradeDateNav('');
    void loadSection('hero', '');
  }, [loadSection, loadTradeDateNav]);

  return {
    snapshot,
    selectedTradeDate,
    activeSections,
    activateSection,
    retrySection: loadSection,
    selectTradeDate,
    refreshActiveSections,
    getSectionState: (section: TDiscoverySnapshotSection) => sectionStates[section] ?? IDLE_SECTION_STATE,
  };
}
