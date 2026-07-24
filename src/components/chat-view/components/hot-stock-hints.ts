import type { HotFocusItem } from '../../../shared/types.js';

export interface IHotStockHint {
  code: string;
  name: string;
  label?: string;
  priority: number;
}

export const HOT_STOCK_HINT_GROUP_SIZE = 5;
const HOT_STOCK_HINT_BASE_GROUPS = 5;
const HOT_STOCK_HINT_MIXED_GROUPS = 10;

export function createHotStockHintGroups(items: HotFocusItem[]): IHotStockHint[][] {
  const candidates = uniqueCandidates(items).slice(0, HOT_STOCK_HINT_GROUP_SIZE * HOT_STOCK_HINT_BASE_GROUPS);
  const baseGroups = chunk(candidates, HOT_STOCK_HINT_GROUP_SIZE);
  return [...baseGroups, ...createMixedGroups(baseGroups)];
}

function createMixedGroups(baseGroups: IHotStockHint[][]): IHotStockHint[][] {
  if (baseGroups.length !== HOT_STOCK_HINT_BASE_GROUPS) return [];
  return Array.from({ length: HOT_STOCK_HINT_MIXED_GROUPS }, (_, mixIndex) => {
    const phase = Math.floor(mixIndex / HOT_STOCK_HINT_BASE_GROUPS) + 1;
    const offset = mixIndex % HOT_STOCK_HINT_BASE_GROUPS;
    return baseGroups
      .map((group, groupIndex) => group[(offset + groupIndex * phase) % group.length])
      .filter((hint): hint is IHotStockHint => Boolean(hint));
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function uniqueCandidates(items: HotFocusItem[]): IHotStockHint[] {
  const byCode = new Map<string, IHotStockHint>();
  for (const item of items) {
    const code = item.code?.trim();
    const name = item.name?.trim();
    if (!code || !name || !/^\d{6}$/.test(code)) continue;
    const candidate = toCandidate(item, code, name);
    const existing = byCode.get(code);
    if (!existing || candidate.priority > existing.priority) byCode.set(code, candidate);
  }
  return [...byCode.values()].sort(
    (left, right) => right.priority - left.priority || left.code.localeCompare(right.code),
  );
}

function toCandidate(item: HotFocusItem, code: string, name: string): IHotStockHint {
  const height = readConsecutiveBoardHeight(item.description);
  if (height && height >= 2) return { code, name, label: `${height}连板`, priority: 3 };
  if (item.tag === '封涨停板') return { code, name, label: '涨停', priority: 2 };
  return { code, name, priority: 1 };
}

function readConsecutiveBoardHeight(description?: string): number | undefined {
  const match = description?.match(/(\d+)连板/);
  const height = match ? Number(match[1]) : Number.NaN;
  return Number.isInteger(height) && height > 0 ? height : undefined;
}
