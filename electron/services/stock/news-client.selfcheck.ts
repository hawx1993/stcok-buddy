import assert from 'node:assert/strict';
import type { IMarketNewsSummary, IMarketNewsSummaryState } from '../../../src/shared/types.js';
import { articleToText, ensureMarketNewsSummaryState } from './news-client.js';

const existingSummary: IMarketNewsSummary = {
  tradeDate: '2026-07-23',
  generatedAt: '2026-07-23T07:00:00.000Z',
  content: '## 📰 核心事件',
  sourceNews: [],
};

let refreshCalls = 0;
const existingState = await ensureMarketNewsSummaryState(
  async () => ({ tradeDate: existingSummary.tradeDate, summary: existingSummary }),
  async () => {
    refreshCalls += 1;
    return existingSummary;
  },
);
assert.deepEqual(existingState, { tradeDate: existingSummary.tradeDate, summary: existingSummary });
assert.equal(refreshCalls, 0);
await new Promise<void>((resolve) => setImmediate(resolve));

let storedState: IMarketNewsSummaryState = { tradeDate: existingSummary.tradeDate };
const refresh = async () => {
  refreshCalls += 1;
  await new Promise((resolve) => setTimeout(resolve, 5));
  storedState = { tradeDate: existingSummary.tradeDate, summary: existingSummary };
  return existingSummary;
};
const [first, second] = await Promise.all([
  ensureMarketNewsSummaryState(async () => storedState, refresh),
  ensureMarketNewsSummaryState(async () => storedState, refresh),
]);
assert.deepEqual(first, { tradeDate: existingSummary.tradeDate, summary: existingSummary });
assert.deepEqual(second, { tradeDate: existingSummary.tradeDate, summary: existingSummary });
assert.equal(refreshCalls, 1);

const tableContent = articleToText('<p>龙虎榜数据</p><table><thead><tr><th>代码</th><th colspan="2">营业部净买卖</th></tr></thead><tbody><tr><td rowspan="2">603459</td><td>2140.51</td><td>19.84</td></tr><tr><td>盛新锂能</td><td>30.42</td></tr></tbody></table>');
assert.match(tableContent, /\[\[STOCK_BUDDY_TABLE:%5B%5B/);
assert.doesNotMatch(tableContent, /\[\[STOCK_BUDDY_TABLE:\[\[/);
assert.match(decodeURIComponent(tableContent), /"content":"603459"/);
assert.match(decodeURIComponent(tableContent), /"colSpan":2/);
assert.match(decodeURIComponent(tableContent), /"rowSpan":2/);

const failedState: IMarketNewsSummaryState = { tradeDate: existingSummary.tradeDate, error: '模型连接失败' };
let failedReadCount = 0;
assert.deepEqual(
  await ensureMarketNewsSummaryState(
    async () => {
      failedReadCount += 1;
      return failedReadCount === 1 ? { tradeDate: existingSummary.tradeDate } : failedState;
    },
    async () => {
      throw new Error(failedState.error);
    },
  ),
  failedState,
);

console.log('news-client selfcheck passed');
