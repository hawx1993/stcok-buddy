import { useEffect, useState } from 'react';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { ChipDistribution, TChipDistributionSource } from '../../../shared/types';

interface IChipDistributionState {
  distribution?: ChipDistribution;
  distributions: ChipDistribution[];
  source?: TChipDistributionSource;
  warnings?: string[];
  loading: boolean;
  empty: boolean;
  error?: string;
}

export function useChipDistribution(symbol: string | undefined, enabled: boolean): IChipDistributionState {
  const [state, setState] = useState<IChipDistributionState>({ distributions: [], loading: false, empty: false });

  useEffect(() => {
    if (!enabled || !symbol) {
      setState({ distributions: [], loading: false, empty: false });
      return;
    }
    let alive = true;
    setState({ distributions: [], loading: true, empty: false });
    getStocksenseApi()
      .getChipDistribution(symbol)
      .then(({ latest, distributions, source, warnings }) => {
        if (!alive) return;
        const distribution = latest?.points.length ? latest : undefined;
        setState({ distribution, distributions, source, warnings, loading: false, empty: !distribution });
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setState({
          distributions: [],
          loading: false,
          empty: false,
          error: error instanceof Error ? error.message : '筹码分布加载失败',
        });
      });
    return () => {
      alive = false;
    };
  }, [enabled, symbol]);

  return state;
}

export function findChipDistributionByDate(distributions: ChipDistribution[], value: string | undefined) {
  const target = normalizeChipDate(value);
  return target ? distributions.find((item) => normalizeChipDate(item.date) === target) : undefined;
}

function normalizeChipDate(value: string | undefined) {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 8);
  return digits.length === 8 ? digits : undefined;
}
