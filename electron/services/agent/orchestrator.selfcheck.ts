import assert from 'node:assert/strict';
import { buildAgentWorkflow } from './agent-workflows.js';
import { classifyIntent, extractBoardKeyword, extractUrls, parseSlashCommand } from './intent-routing.js';
import type { IAgentContext } from './orchestrator-types.js';

assert.equal(parseSlashCommand('/复盘今日行情')?.intent, 'market-review');
assert.equal(parseSlashCommand('/技术面分析 000858')?.singleAgent, 'technical');
assert.equal(classifyIntent('市场复盘'), 'market-review');
assert.equal(classifyIntent('今天哪些股票走强，主要是什么题材'), 'theme-attribution');
assert.deepEqual(extractUrls('查看 https://example.com/a 和 https://example.com/a'), ['https://example.com/a']);
assert.equal(extractBoardKeyword('半导体板块'), '半导体');

const context: IAgentContext = {
  query: '/复盘今日行情',
  intent: 'market-review',
  urls: [],
  evidence: [],
  toolCalls: [],
  findings: [],
};
const workflow = buildAgentWorkflow(context);
assert.deepEqual(workflow.map((node) => node.id), ['market-review-data', 'market-review-report']);
assert.deepEqual(workflow[1]?.dependsOn, ['market-review-data']);

console.log('orchestrator selfcheck passed');
