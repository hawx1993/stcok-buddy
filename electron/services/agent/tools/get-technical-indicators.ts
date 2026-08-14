import type { AgentTool } from '../../tools/types.js';
import { runTechnicalAnalysis } from '../analysis-agent.js';
import { asRecord, text } from './input.js';

/** 模型可调用：基于真实 K 线计算 MACD、KDJ、均线等技术指标摘要。 */
export const getTechnicalIndicators: AgentTool<{ symbol: string }, Awaited<ReturnType<typeof runTechnicalAnalysis>>> = {
  name: 'getTechnicalIndicators',
  description: 'Calculate technical indicator summary.',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  run: (input) => runTechnicalAnalysis(text(asRecord(input), 'symbol')),
};
