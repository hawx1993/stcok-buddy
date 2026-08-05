import type { HotFocusItem } from '../../../src/shared/types.js';

export const LARGE_ORDER_MIN_HANDS = 10000;

type TSurgeLargeOrderFields = Pick<HotFocusItem, 'amount' | 'description' | 'tag' | 'title'>;

export function isLargeOrderLabel(item: TSurgeLargeOrderFields) {
  const text = `${item.title} ${item.description ?? ''} ${item.tag ?? ''}`;
  return /特大单买入|特大单卖出|大笔买入|大笔卖出/.test(text);
}

export function largeOrderHands(item: TSurgeLargeOrderFields) {
  const text = [item.amount, item.description, item.title, item.tag]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  const match = text.match(/(?:买入|卖出)?([0-9]+(?:\.[0-9]+)?)(万)?手/);
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0;
  return match[2] ? value * 10000 : value;
}

export function isLargeOrderItem(item: TSurgeLargeOrderFields) {
  return isLargeOrderLabel(item) && largeOrderHands(item) >= LARGE_ORDER_MIN_HANDS;
}

export function shouldKeepSurgeItem(item: TSurgeLargeOrderFields) {
  return !isLargeOrderLabel(item) || isLargeOrderItem(item);
}
