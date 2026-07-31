import { describe, expect, it } from 'vitest';

import { uniqueRowsByCode } from '../market-review-data.js';

describe('按代码去重行情行', () => {
  it('重复代码保留最新行并保持首次插入顺序', () => {
    expect(uniqueRowsByCode([
      { code: '600001', value: 'old-a' },
      { code: '600002', value: 'b' },
      { code: '600001', value: 'new-a' },
    ])).toEqual([
      { code: '600001', value: 'new-a' },
      { code: '600002', value: 'b' },
    ]);
  });
});
