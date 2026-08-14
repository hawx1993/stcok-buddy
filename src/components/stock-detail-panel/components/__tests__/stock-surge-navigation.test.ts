import { describe, expect, it } from 'vitest';
import type { HotFocusItem } from '../../../../shared/types';
import { findSurgeReturnIndex } from '../stock-surge-navigation';

const items: HotFocusItem[] = [
  { id: 'surge-1', code: '600000', title: '浦发银行' },
  { id: 'surge-2', code: '600000', title: '浦发银行' },
  { id: 'surge-3', code: '000001', title: '平安银行' },
];

describe('异动列表返回定位', () => {
  it('优先按异动项 id 定位重复股票中的具体行', () => {
    expect(findSurgeReturnIndex(items, { id: 'surge-2', code: '600000' })).toBe(1);
  });

  it('没有异动项 id 时按股票代码兼容定位', () => {
    expect(findSurgeReturnIndex(items, { code: '000001' })).toBe(2);
  });

  it('目标不存在时返回未命中', () => {
    expect(findSurgeReturnIndex(items, { id: 'missing', code: '300001' })).toBe(-1);
  });
});
