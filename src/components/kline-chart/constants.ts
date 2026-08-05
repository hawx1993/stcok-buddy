import type { KlinePoint } from '../../shared/types';

export const klineTimeframes = [
  { id: 'timeline', label: '分时', limit: 0, period: { type: 'minute', span: 1 } },
  { id: '15m', label: '15分钟', limit: 240, period: { type: 'minute', span: 15 } },
  { id: '1h', label: '1小时', limit: 240, period: { type: 'hour', span: 1 } },
  { id: '1d', label: '天', limit: 360, period: { type: 'day', span: 1 } },
  { id: '1w', label: '周', limit: 240, period: { type: 'week', span: 1 } },
  { id: '1mo', label: '月', limit: 120, period: { type: 'month', span: 1 } },
] as const;

export type TimeframeId = (typeof klineTimeframes)[number]['id'];

export interface ILoadOlderKlineInput {
  timeframe: TimeframeId;
  limit: number;
  beforeTimestamp?: number;
}

export type TLoadOlderKline = (input: ILoadOlderKlineInput) => Promise<KlinePoint[]>;
