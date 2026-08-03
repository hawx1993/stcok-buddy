import assert from 'node:assert/strict';
import { app } from 'electron';
import { rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dbPath = path.join(os.tmpdir(), `stocksense-discovery-selfcheck-${process.pid}.duckdb`);
const surgeDbPath = path.join(os.tmpdir(), `stocksense-discovery-surge-selfcheck-${process.pid}.duckdb`);
process.env.STOCKSENSE_MARKET_DB_PATH = dbPath;
process.env.STOCKSENSE_SURGE_DB_PATH = surgeDbPath;

import { mergeHotThemeLeaders, reconcileHotThemeWithLocalBoard } from '../services/stock/discovery-hot-themes.js';
import { selectLatestMainFundFlowYi, sumNorthFundFlowYi } from '../services/stock/discovery-market-summary.js';
import { buildMonthlyThemesFromHistoricalPools } from '../services/stock/discovery-monthly-themes.js';
import {
  buildLocalBoardCatalog,
  parseMoneyTextToYuanForTest,
  reconcileSectorsWithLocalBoardsForTest,
  shouldDeferDiscoveryRefresh,
  shouldHoldDiscoverySnapshotUntil930,
  sumBoardConstituentAmountsForTest,
  sumConstituentMainNetInflowYiForTest,
  toLimitDownStockItemForTest,
} from '../services/stock/discovery-service.js';
import type { HotFocusItem } from '../../src/shared/types.js';
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
  { code: 'BK0475', name: '银行', changePercent: 0, mainNetInflow: 0, amount: 20_000_000 },
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

const localBoardCatalog = buildLocalBoardCatalog(boardCatalog);
const reconciledSectors = reconcileSectorsWithLocalBoardsForTest(
  [{ code: 'BK0475', name: '银行', changePercent: 1.5, mainNetInflow: 3.2 }],
  localBoardCatalog,
);
assert.equal(reconciledSectors[0].amount, 20_000_000);
assert.equal(parseMoneyTextToYuanForTest('1.20亿'), 120_000_000);
assert.equal(parseMoneyTextToYuanForTest('3500.00万'), 35_000_000);
assert.equal(
  sumBoardConstituentAmountsForTest([{ amount: '1.20亿' }, { amount: '3500.00万' }, { amount: '--' }]),
  155_000_000,
);

assert.equal(toLimitDownStockItemForTest({ code: '300407', name: '凯发电气', price: 11.28, changePercent: -12.56 }), undefined);
assert.deepEqual(toLimitDownStockItemForTest({ code: '300001', name: '创业板测试', price: 8.01, changePercent: -19.82 }), {
  code: '300001',
  name: '创业板测试',
  price: '8.01',
  changePercent: '-19.82',
  amount: undefined,
});
assert.deepEqual(toLimitDownStockItemForTest({ code: '600001', name: '主板测试', price: 9.01, changePercent: -9.82 }), {
  code: '600001',
  name: '主板测试',
  price: '9.01',
  changePercent: '-9.82',
  amount: undefined,
});

const nextWeekSectorPayload = {
  code: reconciledSectors[0].code,
  name: reconciledSectors[0].name,
  score: 70,
  reasoning: {
    fundFlow: '资金关注度一般，需持续跟踪。',
    news: '消息面暂无重大催化。',
    policy: '政策面无明确边际变化。',
    technical: '技术面处于震荡整理阶段。',
    rotation: '板块轮动中尚未形成明确主线。',
  },
};
assert.equal(nextWeekSectorPayload.code, 'BK0475');
assert.equal(nextWeekSectorPayload.name, '银行');

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
assert.equal(selectLatestMainFundFlowYi(marketFundRows, '2026-07-30'), null);
assert.equal(selectLatestMainFundFlowYi(marketFundRows, '2026-07-29'), -119.47974656);
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
assert.equal(sumNorthFundFlowYi(northRows, '2026-07-30'), 8);
assert.equal(sumNorthFundFlowYi([
  { ...northRows[0], date: '2026-07-31', netBuyAmount: 0, netInflow: 0 },
  { ...northRows[1], date: '2026-07-31', netBuyAmount: 0, netInflow: 0 },
], '2026-07-31'), 0);
assert.equal(sumNorthFundFlowYi(northRows, '2026-07-31'), null);
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

const localTheme = reconcileHotThemeWithLocalBoard(
  { name: '医药生物', changePercent: 95, reason: '远端异常涨幅' },
  { code: 'BK1044', name: '生物医药', changePercent: 1.23 },
  { mainNetInflow: 2.5 },
);
assert.deepEqual(localTheme, {
  name: '生物医药',
  code: 'BK1044',
  changePercent: 1.23,
  reason: '板块涨跌幅 +1.23%，主力净流入 +2.5 亿。',
});
assert.equal(reconcileHotThemeWithLocalBoard({ name: '未知板块', changePercent: 88 }, undefined, undefined), undefined);

const constituentMainNetInflow = sumConstituentMainNetInflowYiForTest(
  [
    { code: '003032' },
    { code: 'sz002659' },
    { code: '300010' },
  ],
  [
    { code: '003032', mainNetInflow: 120_000_000 },
    { code: '002659', mainNetInflow: -20_000_000 },
    { code: '600000', mainNetInflow: 500_000_000 },
    { code: '300010', mainNetInflow: null },
  ],
);
assert.equal(constituentMainNetInflow, 1);
assert.equal(sumConstituentMainNetInflowYiForTest([{ code: 'BK0475' }], []), undefined);

assert.equal(await shouldHoldDiscoverySnapshotUntil930(new Date('2026-07-31T00:30:00.000Z')), true);
assert.equal(await shouldHoldDiscoverySnapshotUntil930(new Date('2026-07-31T00:00:00.000Z')), true);
assert.equal(await shouldHoldDiscoverySnapshotUntil930(new Date('2026-07-31T01:29:00.000Z')), true);
assert.equal(await shouldHoldDiscoverySnapshotUntil930(new Date('2026-07-31T01:30:00.000Z')), false);
assert.equal(await shouldDeferDiscoveryRefresh(new Date('2026-08-01T02:00:00.000Z')), true);
assert.equal(await shouldDeferDiscoveryRefresh(new Date('2026-08-03T00:00:00.000Z')), true);
assert.equal(await shouldDeferDiscoveryRefresh(new Date('2026-08-03T01:30:00.000Z')), false);

const marketStore = await import('../services/market-data/market-data-store.js');
await marketStore.initializeMarketDataStore();
const updatedAt = '2026-07-30T09:30:00.000Z';
await marketStore.writeDiscoverySnapshot({
  updatedAt,
  snapshot: {
    tradeDate: '2026-07-30',
    generatedAt: updatedAt,
    indices: [{ code: 'sh000001', name: '上证指数', price: 3200, changePercent: 0.5 }],
  },
});
const cachedSnapshot = await marketStore.readDiscoverySnapshot();
assert.equal(cachedSnapshot?.updatedAt ? new Date(cachedSnapshot.updatedAt).toISOString() : undefined, updatedAt);
assert.deepEqual(cachedSnapshot?.snapshot, {
  tradeDate: '2026-07-30',
  generatedAt: updatedAt,
  indices: [{ code: 'sh000001', name: '上证指数', price: 3200, changePercent: 0.5 }],
});
await marketStore.closeMarketDataStore();
for (const basePath of [dbPath, surgeDbPath]) {
  for (const suffix of ['', '.wal']) {
    try {
      rmSync(`${basePath}${suffix}`);
    } catch {
      /* already removed */
    }
  }
}

console.log('discovery-service selfcheck passed');
app.quit();
