import assert from 'node:assert/strict';
import { marketBoardsCache } from '../services/stock/shared.js';
import { resolveBoardDetailLookupKey } from '../services/stock/board-detail.js';
import { reconcileAdviceLeaderStocks } from '../services/stock/trading-advice-service.js';
import type { ITradingAdvice } from '../../src/shared/types.js';

const advice: ITradingAdvice = {
  starRating: 5,
  starLabel: '强烈看多',
  suggestedPosition: 85,
  positionReason: '情绪亢奋',
  suitableStrategies: ['打板龙头'],
  unsuitableStrategies: ['追高杂毛股'],
  keySectors: [
    {
      name: '家居',
      confidence: 'high',
      reason: '板块效应强',
      leaderCode: '603326',
      leaderName: '爱丽家居',
    },
    {
      name: '教育',
      confidence: 'medium',
      reason: '独立高位',
      leaderCode: '003032',
      leaderName: '传智教育',
    },
  ],
  marketSummary: '市场放量普涨',
  riskReminder: '防高位分歧',
};

const reconciled = await reconcileAdviceLeaderStocks(advice, async (codes) => {
  assert.deepEqual(codes, ['603326', '003032']);
  return [
    { code: '603326', name: '我乐家居' },
    { code: '003032', name: '传智教育' },
  ];
});

assert.equal(reconciled.keySectors[0].leaderCode, '603326');
assert.equal(reconciled.keySectors[0].leaderName, '我乐家居');
assert.equal(reconciled.keySectors[1].leaderName, '传智教育');

const failedResolverResult = await reconcileAdviceLeaderStocks(advice, async () => {
  throw new Error('quote source unavailable');
});
assert.equal(failedResolverResult.keySectors[0].leaderName, '爱丽家居');

marketBoardsCache.rows = [
  { code: 'BK1197', name: '机器人执行器', minutes: [] },
  { code: 'BK0854', name: '机器人', minutes: [] },
  { code: 'BK1228', name: '电动乘用车', minutes: [] },
];
assert.equal(resolveBoardDetailLookupKey('', '机器人执行器'), 'BK1197');
assert.equal(resolveBoardDetailLookupKey('', '机器人'), 'BK0854');
assert.equal(resolveBoardDetailLookupKey('', '电动乘用车'), 'BK1228');
assert.equal(resolveBoardDetailLookupKey('BK0815', '机器人'), 'BK0815');

console.log('trading-advice selfcheck passed');
process.exit(0);
