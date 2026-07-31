import { describe, expect, it } from 'vitest';

import { SymbolInputSchema, KlineOptionsSchema } from '../schemas.js';

describe('股票服务输入 Schema', () => {
  it('股票代码会去除首尾空白且空值失败', () => {
    expect(SymbolInputSchema.parse(' 600001 ')).toBe('600001');
    expect(SymbolInputSchema.safeParse('   ').success).toBe(false);
  });

  it('K 线参数使用默认周期和默认数量', () => {
    expect(KlineOptionsSchema.parse({ symbol: ' 600001 ' })).toEqual({
      symbol: '600001',
      period: 'daily',
      limit: 120,
    });
  });

  it('K 线数量小于 20 或大于 300 时失败', () => {
    expect(KlineOptionsSchema.safeParse({ symbol: '600001', limit: 19 }).success).toBe(false);
    expect(KlineOptionsSchema.safeParse({ symbol: '600001', limit: 301 }).success).toBe(false);
  });

  it('K 线周期必须是支持的枚举值', () => {
    expect(KlineOptionsSchema.safeParse({ symbol: '600001', period: 'hourly' }).success).toBe(false);
    expect(KlineOptionsSchema.parse({ symbol: '600001', period: 'weekly', limit: 20 })).toEqual({
      symbol: '600001',
      period: 'weekly',
      limit: 20,
    });
  });
});
