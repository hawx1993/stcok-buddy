import type { MarketColorMode } from './types.js';

export const marketColorModes: Array<{ value: MarketColorMode; label: string; upColor: string; downColor: string }> = [
  { value: 'red-up-green-down', label: '红涨绿跌', upColor: '#EF4444', downColor: '#22C55E' },
  { value: 'green-up-red-down', label: '绿涨红跌', upColor: '#22C55E', downColor: '#EF4444' },
];

export function getMarketColors(mode: MarketColorMode = 'red-up-green-down') {
  return marketColorModes.find((item) => item.value === mode) ?? marketColorModes[0];
}
