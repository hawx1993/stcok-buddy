import { useEffect, useState } from 'react';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { ChipDistribution, TChipDistributionPeriod, TChipDistributionSource } from '../../../shared/types';

interface IChipDistributionState {
  period?: TChipDistributionPeriod;
  distribution?: ChipDistribution;
  distributions: ChipDistribution[];
  source?: TChipDistributionSource;
  warnings?: string[];
  loading: boolean;
  empty: boolean;
  error?: string;
}

export function useChipDistribution(
  symbol: string | undefined,
  period: TChipDistributionPeriod | undefined,
  enabled: boolean,
): IChipDistributionState {
  const [state, setState] = useState<IChipDistributionState>({ distributions: [], loading: false, empty: false });

  useEffect(() => {
    if (!enabled || !symbol || !period) {
      setState({ distributions: [], loading: false, empty: false });
      return;
    }
    let alive = true;
    setState({ period, distributions: [], loading: true, empty: false });
    getStocksenseApi()
      .getChipDistribution(symbol, period)
      .then(({ latest, distributions, source, warnings, period: resultPeriod }) => {
        if (!alive) return;
        if (resultPeriod !== period) {
          setState({
            period,
            distributions: [],
            loading: false,
            empty: false,
            error: '筹码分布周期与当前 K 线周期不匹配',
          });
          return;
        }
        const matchedDistributions = distributions.filter((item) => item.period === period && item.points.length);
        const distribution =
          latest?.period === period && latest.points.length
            ? latest
            : matchedDistributions[matchedDistributions.length - 1];
        setState({
          period,
          distribution,
          distributions: matchedDistributions,
          source,
          warnings,
          loading: false,
          empty: !distribution,
        });
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setState({
          period,
          distributions: [],
          loading: false,
          empty: false,
          error: error instanceof Error ? error.message : '筹码分布加载失败',
        });
      });
    return () => {
      alive = false;
    };
  }, [enabled, symbol, period]);

  return state;
}

export function findChipDistributionByDate(
  distributions: ChipDistribution[],
  value: string | undefined,
  period: TChipDistributionPeriod = '1d',
  timestamp?: number,
) {
  if (period === '15m' || period === '1h') {
    const targetTimestamp = normalizeChipTimestamp(timestamp);
    if (targetTimestamp !== undefined) {
      const matched = distributions.find((item) => normalizeChipTimestamp(item.timestamp) === targetTimestamp);
      if (matched) return matched;
    }
    const targetMinute = normalizeChipMinute(value);
    const matched = targetMinute
      ? distributions.find((item) => normalizeChipMinute(item.date) === targetMinute)
      : undefined;
    if (matched) return matched;
    const targetDate = normalizeChipDate(value) ?? normalizeChipDateFromTimestamp(targetTimestamp);
    const dailyMatched = findDailyChipDistribution(distributions, targetDate);
    if (dailyMatched) return dailyMatched;
    const comparableTimestamp = targetTimestamp ?? parseChipMinuteTimestamp(value) ?? parseChipDateTimestamp(targetDate);
    if (comparableTimestamp === undefined) return undefined;
    const nearestMinuteMatched = period === '15m' ? findNearestMinuteChipDistribution(distributions, comparableTimestamp, 15 * 60_000) : undefined;
    return nearestMinuteMatched ?? findLatestChipDistributionAtOrBefore(distributions, comparableTimestamp);
  }
  const target = normalizeChipDate(value) ?? normalizeChipDateFromTimestamp(timestamp);
  if (!target) return undefined;
  const matched = distributions.find((item) => normalizeChipDate(item.date) === target);
  if (matched) return matched;
  if (period === '1w') {
    const targetWeek = normalizeChipWeek(target);
    const weekMatched = targetWeek ? findChipDistributionByWeek(distributions, targetWeek, target) : undefined;
    if (weekMatched) return weekMatched;
  }
  if (period === '1mo') {
    const monthMatched = findChipDistributionByMonth(distributions, target);
    if (monthMatched) return monthMatched;
  }
  const comparableTimestamp = normalizeChipTimestamp(timestamp) ?? parseChipDateTimestamp(target);
  return comparableTimestamp === undefined ? undefined : findLatestChipDistributionAtOrBefore(distributions, comparableTimestamp);
}

export function selectChipDistributionForKline(
  distributions: ChipDistribution[],
  latest: ChipDistribution | undefined,
  value: string | undefined,
  period: TChipDistributionPeriod,
  timestamp?: number,
): { distribution?: ChipDistribution; matchesHoveredKline: boolean } {
  const matched = findChipDistributionByDate(distributions, value, period, timestamp);
  return {
    distribution: matched ?? latest,
    matchesHoveredKline: Boolean(matched),
  };
}

function findDailyChipDistribution(distributions: ChipDistribution[], target: string | undefined) {
  return target
    ? distributions.find((item) => !normalizeChipMinute(item.date) && normalizeChipDate(item.date) === target)
    : undefined;
}

function findChipDistributionByWeek(distributions: ChipDistribution[], targetWeek: string, target: string) {
  for (let index = distributions.length - 1; index >= 0; index -= 1) {
    const distributionDate = normalizeChipDate(distributions[index].date);
    if (distributionDate && distributionDate <= target && normalizeChipWeek(distributionDate) === targetWeek) return distributions[index];
  }
  return undefined;
}

function findChipDistributionByMonth(distributions: ChipDistribution[], target: string) {
  const month = target.slice(0, 6);
  for (let index = distributions.length - 1; index >= 0; index -= 1) {
    const distributionDate = normalizeChipDate(distributions[index].date);
    if (distributionDate && distributionDate <= target && distributionDate.slice(0, 6) === month) return distributions[index];
  }
  return undefined;
}

function findNearestMinuteChipDistribution(
  distributions: ChipDistribution[],
  targetTimestamp: number,
  maxDistanceMs: number,
) {
  let nearest: { distribution: ChipDistribution; distance: number } | undefined;
  for (const distribution of distributions) {
    const distributionTimestamp = getChipDistributionTimestamp(distribution);
    if (distributionTimestamp === undefined) continue;
    const distance = Math.abs(distributionTimestamp - targetTimestamp);
    if (!nearest || distance < nearest.distance) nearest = { distribution, distance };
  }
  return nearest && nearest.distance <= maxDistanceMs ? nearest.distribution : undefined;
}

function findLatestChipDistributionAtOrBefore(distributions: ChipDistribution[], targetTimestamp: number) {
  let latest: { distribution: ChipDistribution; timestamp: number } | undefined;
  for (const distribution of distributions) {
    const distributionTimestamp = getChipDistributionTimestamp(distribution);
    if (distributionTimestamp === undefined || distributionTimestamp > targetTimestamp) continue;
    if (!latest || distributionTimestamp > latest.timestamp) latest = { distribution, timestamp: distributionTimestamp };
  }
  return latest?.distribution;
}

function getChipDistributionTimestamp(distribution: ChipDistribution) {
  return normalizeChipTimestamp(distribution.timestamp) ?? parseChipMinuteTimestamp(distribution.date) ?? parseChipDateTimestamp(distribution.date);
}

function normalizeChipTimestamp(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeChipDateFromTimestamp(value: number | undefined) {
  const timestamp = normalizeChipTimestamp(value);
  if (timestamp === undefined) return undefined;
  return new Date(timestamp + 8 * 60 * 60_000).toISOString().slice(0, 10).replace(/-/g, '');
}

function normalizeChipMinute(value: string | undefined) {
  const digits = String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, 12);
  return digits.length === 12 ? digits : undefined;
}

function parseChipMinuteTimestamp(value: string | undefined) {
  const minute = normalizeChipMinute(value);
  if (!minute) return undefined;
  const year = Number(minute.slice(0, 4));
  const month = Number(minute.slice(4, 6));
  const day = Number(minute.slice(6, 8));
  const hour = Number(minute.slice(8, 10));
  const minuteValue = Number(minute.slice(10, 12));
  const utcTimestamp = Date.UTC(year, month - 1, day, hour, minuteValue);
  const date = new Date(utcTimestamp);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minuteValue
  )
    return undefined;
  return utcTimestamp - 8 * 60 * 60_000;
}

function parseChipDateTimestamp(value: string | undefined) {
  const target = normalizeChipDate(value);
  if (!target) return undefined;
  const year = Number(target.slice(0, 4));
  const month = Number(target.slice(4, 6));
  const day = Number(target.slice(6, 8));
  const utcTimestamp = Date.UTC(year, month - 1, day);
  const date = new Date(utcTimestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return utcTimestamp - 8 * 60 * 60_000;
}

function normalizeChipWeek(value: string | undefined) {
  const date = normalizeChipDate(value);
  if (!date) return undefined;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  const monday = new Date(Date.UTC(year, month - 1, day));
  if (monday.getUTCFullYear() !== year || monday.getUTCMonth() !== month - 1 || monday.getUTCDate() !== day)
    return undefined;
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

function normalizeChipDate(value: string | undefined) {
  const digits = String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, 8);
  return digits.length === 8 ? digits : undefined;
}
