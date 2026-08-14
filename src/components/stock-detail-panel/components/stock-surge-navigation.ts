import type { HotFocusItem } from '../../../shared/types';

export interface ISurgeReturnTarget {
  id?: string;
  code?: string;
}

export function findSurgeReturnIndex(items: HotFocusItem[], target: ISurgeReturnTarget): number {
  if (target.id) {
    const idIndex = items.findIndex((item) => item.id === target.id);
    if (idIndex >= 0) return idIndex;
  }
  return target.code ? items.findIndex((item) => item.code === target.code) : -1;
}
