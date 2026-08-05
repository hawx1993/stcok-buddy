import assert from 'node:assert/strict';
import { app } from '../electron-runtime.js';
import {
  isLargeOrderItem,
  isRecentLargeBuyEvent,
  isRecentLimitUpEvent,
  parseMarketCapYi,
  ratioPercent,
} from '../services/stock/monitor-service.js';
import type { HotFocusItem, StockSurgeEvent } from '../../src/shared/types.js';

const baseItem: HotFocusItem = {
  id: 'large-order-selfcheck',
  title: '测试股份 600000',
  code: '600000',
  name: '测试股份',
  time: '10:30:00',
  amount: '买入1万手',
  description: '特大单买入',
  tag: '特大单买入',
  type: 'surge',
};

assert.equal(isLargeOrderItem(baseItem), true);
assert.equal(isLargeOrderItem({ ...baseItem, amount: '买入10001手' }), true);
assert.equal(isLargeOrderItem({ ...baseItem, amount: '买入1.01万手' }), true);
assert.equal(isLargeOrderItem({ ...baseItem, amount: '买入9999手' }), false);
assert.equal(isLargeOrderItem({ ...baseItem, amount: '买入585手' }), false);
assert.equal(isLargeOrderItem({ ...baseItem, amount: '买入2万手', description: '快速涨幅', tag: '快速涨幅' }), false);

assert.equal(ratioPercent(0.14)?.toFixed(2), '14.00');
assert.equal(ratioPercent(14), 14);
assert.equal(ratioPercent(0.29)?.toFixed(2), '29.00');
assert.equal(ratioPercent(undefined), undefined);

assert.equal(parseMarketCapYi('50.0亿'), 50);
assert.equal(parseMarketCapYi('1.2万亿'), 12000);
assert.equal(parseMarketCapYi('8000万'), 0.8);
assert.equal(parseMarketCapYi(5_000_000_000), 50);
assert.equal(parseMarketCapYi(50), 50);
assert.equal(parseMarketCapYi('150亿'), 150);
assert.equal(parseMarketCapYi('--'), undefined);

const baseSurgeEvent: StockSurgeEvent = {
  ...baseItem,
  tradeDate: '2026-07-23',
};

assert.equal(isRecentLimitUpEvent({ ...baseSurgeEvent, tag: '封涨停板', description: '封涨停板' }), true);
assert.equal(isRecentLimitUpEvent({ ...baseSurgeEvent, tag: '涨停开板', description: '涨停开板' }), false);
assert.equal(isRecentLimitUpEvent({ ...baseSurgeEvent, tag: '封跌停板', description: '封跌停板' }), false);

assert.equal(isRecentLargeBuyEvent(baseSurgeEvent), true);
assert.equal(isRecentLargeBuyEvent({ ...baseSurgeEvent, amount: '买入9999手' }), false);
assert.equal(isRecentLargeBuyEvent({ ...baseSurgeEvent, amount: '卖出1.2万手', tag: '特大单卖出', description: '特大单卖出' }), false);

console.log('monitor-service selfcheck passed');
app.quit();
