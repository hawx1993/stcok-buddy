import { analyzeTechnical } from '../stock/stock-detail/stock-client.js';

export async function runTechnicalAnalysis(symbol: string) {
  return analyzeTechnical(symbol);
}
