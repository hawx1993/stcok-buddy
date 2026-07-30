import assert from 'node:assert/strict';

import { buildMonthlyThemesFromHistoricalPools } from './discovery-monthly-themes.js';
import type { HotFocusItem } from '../../../src/shared/types.js';

function poolItem(date: string, code: string, name: string, industry: string, amount: string): HotFocusItem {
  return {
    id: `${date}-${code}`,
    title: `${name} ${code}`,
    code,
    name,
    time: '09:30',
    amount,
    description: `${industry} · 2连板`,
    tag: '封涨停板',
    type: 'surge',
  };
}

const weeks = [
  {
    label: '第1周',
    dates: ['20260701', '20260702'],
    items: [
      poolItem('20260701', '000001', '平安银行', '银行', '封单1亿'),
      poolItem('20260702', '000002', '万科A', '房地产开发', '封单2亿'),
      poolItem('20260702', '600000', '浦发银行', '银行', '封单3亿'),
    ],
  },
  {
    label: '第2周',
    dates: ['20260708'],
    items: [
      poolItem('20260708', '600519', '贵州茅台', '白酒', '封单5亿'),
      poolItem('20260708', '000858', '五粮液', '白酒', '封单2亿'),
    ],
  },
];

const boardCatalog = [
  { code: 'BK0475', name: '银行', changePercent: 0, mainNetInflow: 0 },
  { code: 'BK0477', name: '房地产开发', changePercent: 0, mainNetInflow: 0 },
  { code: 'BK0436', name: '白酒', changePercent: 0, mainNetInflow: 0 },
];

const first = buildMonthlyThemesFromHistoricalPools(weeks, boardCatalog);
const second = buildMonthlyThemesFromHistoricalPools(weeks, boardCatalog);

assert.deepEqual(first, second);
assert.equal(first.length, 2);
assert.deepEqual(first[0], { week: '第1周', theme: '银行', leader: { code: '600000', name: '浦发银行' } });
assert.deepEqual(first[1], { week: '第2周', theme: '白酒', leader: { code: '600519', name: '贵州茅台' } });

console.log('discovery-service selfcheck passed');
