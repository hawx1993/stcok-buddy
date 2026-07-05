import { analyzeTechnical } from '../stock/stockClient.js';

export async function runTechnicalAnalysis(symbol: string) {
  return analyzeTechnical(symbol);
}
