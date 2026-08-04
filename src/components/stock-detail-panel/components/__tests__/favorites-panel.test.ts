import { beforeEach, describe, expect, it } from 'vitest';
import { readFavoriteTimelineSwitchCache, writeFavoriteTimelineSwitchCache } from '../favorites-panel';

function createMemoryStorage(): Storage {
  const entries = new Map<string, string>();

  return {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem(key: string) {
      return entries.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(entries.keys())[index] ?? null;
    },
    removeItem(key: string) {
      entries.delete(key);
    },
    setItem(key: string, value: string) {
      entries.set(key, value);
    },
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: createMemoryStorage(),
    configurable: true,
  });
});

describe('收藏个股分时图开关缓存', () => {
  it('默认关闭，开启后应从持久化缓存恢复开启状态', () => {
    expect(readFavoriteTimelineSwitchCache()).toBe(false);

    writeFavoriteTimelineSwitchCache(true);

    expect(readFavoriteTimelineSwitchCache()).toBe(true);
  });

  it('关闭后应覆盖缓存为关闭状态', () => {
    writeFavoriteTimelineSwitchCache(true);
    writeFavoriteTimelineSwitchCache(false);

    expect(readFavoriteTimelineSwitchCache()).toBe(false);
  });
});
