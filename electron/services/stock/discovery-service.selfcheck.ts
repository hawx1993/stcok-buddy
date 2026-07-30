import assert from 'node:assert/strict';

import { mergeHotThemeLeaders } from './discovery-hot-themes.js';
import { selectLatestMainFundFlowYi, sumNorthFundFlowYi } from './discovery-market-summary.js';
import { buildMonthlyThemesFromHistoricalPools } from './discovery-monthly-themes.js';
import type { HotFocusItem } from '../../../src/shared/types.js';
import type { MarketFundFlow, NorthboundFlowSummary } from 'stock-sdk';

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
  {
    label: '第3周',
    dates: ['20260715'],
    items: [],
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
assert.equal(first.length, 3);
assert.deepEqual(first[0], { week: '第1周', theme: '银行', leader: { code: '600000', name: '浦发银行' } });
assert.deepEqual(first[1], { week: '第2周', theme: '白酒', leader: { code: '600519', name: '贵州茅台' } });
assert.deepEqual(first[2], { week: '第3周', theme: '暂无热点数据', leader: null });

const marketFundRows: MarketFundFlow[] = [
  {
    date: '2026-07-28',
    shClose: 4100,
    shChangePercent: 0.2,
    szClose: 14000,
    szChangePercent: -0.1,
    mainNetInflow: 8_000_000_000,
    mainNetInflowPercent: 1.2,
    superLargeNetInflow: null,
    superLargeNetInflowPercent: null,
    largeNetInflow: null,
    largeNetInflowPercent: null,
    mediumNetInflow: null,
    mediumNetInflowPercent: null,
    smallNetInflow: null,
    smallNetInflowPercent: null,
  },
  {
    date: '2026-07-30',
    shClose: 4080,
    shChangePercent: -0.4,
    szClose: 13900,
    szChangePercent: -0.6,
    mainNetInflow: null,
    mainNetInflowPercent: null,
    superLargeNetInflow: null,
    superLargeNetInflowPercent: null,
    largeNetInflow: null,
    largeNetInflowPercent: null,
    mediumNetInflow: null,
    mediumNetInflowPercent: null,
    smallNetInflow: null,
    smallNetInflowPercent: null,
  },
  {
    date: '2026-07-29',
    shClose: 4090,
    shChangePercent: -0.3,
    szClose: 13950,
    szChangePercent: -0.5,
    mainNetInflow: -11_947_974_656,
    mainNetInflowPercent: -1.8,
    superLargeNetInflow: null,
    superLargeNetInflowPercent: null,
    largeNetInflow: null,
    largeNetInflowPercent: null,
    mediumNetInflow: null,
    mediumNetInflowPercent: null,
    smallNetInflow: null,
    smallNetInflowPercent: null,
  },
];
assert.equal(selectLatestMainFundFlowYi(marketFundRows), -119.47974656);
assert.equal(selectLatestMainFundFlowYi([{ ...marketFundRows[0], mainNetInflow: null }]), null);

const northRows: NorthboundFlowSummary[] = [
  {
    date: '2026-07-30',
    type: '001',
    boardName: '沪股通',
    direction: '北向',
    status: '1',
    netBuyAmount: 1_500_000_000,
    netInflow: 9_999_000_000,
    remainAmount: null,
    upCount: null,
    flatCount: null,
    downCount: null,
    indexCode: '000001',
    indexName: '上证指数',
    indexChangePercent: null,
  },
  {
    date: '2026-07-30',
    type: '003',
    boardName: '深股通',
    direction: '北向',
    status: '1',
    netBuyAmount: -700_000_000,
    netInflow: 8_888_000_000,
    remainAmount: null,
    upCount: null,
    flatCount: null,
    downCount: null,
    indexCode: '399001',
    indexName: '深证成指',
    indexChangePercent: null,
  },
  {
    date: '2026-07-30',
    type: '002',
    boardName: '港股通(沪)',
    direction: '南向',
    status: '1',
    netBuyAmount: 6_000_000_000,
    netInflow: 6_000_000_000,
    remainAmount: null,
    upCount: null,
    flatCount: null,
    downCount: null,
    indexCode: 'HSI',
    indexName: '恒生指数',
    indexChangePercent: null,
  },
];
assert.equal(sumNorthFundFlowYi(northRows), 8);
assert.equal(sumNorthFundFlowYi([{ ...northRows[0], netBuyAmount: null, netInflow: 300_000_000 }]), 3);
assert.equal(sumNorthFundFlowYi([{ ...northRows[2] }]), null);

const themeWithTopStock = mergeHotThemeLeaders(
  { name: '休闲食品' },
  { topStockCode: '002847', topStockName: '盐津铺子' },
  [],
);
assert.deepEqual(themeWithTopStock.leaders, [{ code: '002847', name: '盐津铺子' }]);

const themeWithFallbackLeaders = mergeHotThemeLeaders(
  { name: '教育' },
  { topStockCode: '003032', topStockName: '传智教育' },
  [
    { code: '003032', name: '传智教育' },
    { code: '300010', name: '豆神教育' },
    { code: '002607', name: '中公教育' },
    { code: '600661', name: '昂立教育' },
  ],
);
assert.deepEqual(themeWithFallbackLeaders.leaders, [
  { code: '003032', name: '传智教育' },
  { code: '300010', name: '豆神教育' },
  { code: '002607', name: '中公教育' },
]);

const themeWithoutLeaders = mergeHotThemeLeaders({ name: '未知板块' }, undefined, []);
assert.deepEqual(themeWithoutLeaders, { name: '未知板块' });

console.log('discovery-service selfcheck passed');
