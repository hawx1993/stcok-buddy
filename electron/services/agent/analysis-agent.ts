import { analyzeTechnical } from '../stock/stock-client.js';

export async function runTechnicalAnalysis(symbol: string) {
  return analyzeTechnical(symbol);
}
