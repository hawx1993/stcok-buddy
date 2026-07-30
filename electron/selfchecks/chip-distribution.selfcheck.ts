import assert from 'node:assert/strict';
import { calculateChipDistribution } from '../services/stock/chip-distribution.js';
import type { KlinePoint } from '../../src/shared/types.js';

const start = Date.parse('2026-01-02T00:00:00+08:00');
const klines: KlinePoint[] = Array.from({ length: 140 }, (_, index) => {
  const center = 8 + index * 0.025 + Math.sin(index / 7) * 0.45;
  const open = center - Math.sin(index / 3) * 0.08;
  const close = center + Math.cos(index / 4) * 0.1;
  return {
    time: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
    timestamp: start + index * 86_400_000,
    open,
    close,
    high: Math.max(open, close) + 0.22,
    low: Math.min(open, close) - 0.2,
    volume: 1_000_000 + index * 2_500,
    turnoverRate: 1.2 + (index % 9) * 0.35,
  };
});

const result = calculateChipDistribution(klines, 'a-stock-data', ['selfcheck fallback']);
const latest = result.latest;
assert.ok(latest, 'latest chip distribution is required');
assert.equal(result.source, 'a-stock-data');
assert.equal(result.distributions.length, klines.length);
assert.equal(new Set(result.distributions.map((item) => item.date)).size, result.distributions.length);
assert.equal(result.distributions.at(-1)?.date, latest.date);
assert.ok(result.distributions.every((item) => item.points.length > 0));
assert.notDeepEqual(result.distributions[20]?.points, result.distributions.at(-1)?.points);
assert.deepEqual(result.trend.map((item) => item.days), [5, 10, 20]);
assert.ok(latest.points.length >= 140 && latest.points.length <= 150, `histogram should contain nearly 150 non-zero price levels, received ${latest.points.length}`);
const ratioTotal = latest.points.reduce((sum, point) => sum + point.weight, 0);
assert.ok(Math.abs(ratioTotal - 1) < 0.01, `histogram ratio total should be near 1, received ${ratioTotal}`);
assert.ok(latest.profitRatio !== undefined && latest.profitRatio >= 0 && latest.profitRatio <= 1);
assert.ok(latest.avgCost !== undefined && latest.avgCost > 0);
assert.ok(latest.cost70 && latest.cost90);
assert.ok(latest.concentration70 !== undefined && latest.concentration90 !== undefined);
console.log('chip-distribution selfcheck passed');
