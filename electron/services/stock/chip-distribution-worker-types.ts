import type { IChipDistributionResult, KlinePoint, TChipDistributionSource } from '../../../src/shared/types.js';

export interface ICalculateChipDistributionInput {
  klines: KlinePoint[];
  source: TChipDistributionSource;
  warnings?: string[];
}

export interface IChipDistributionWorkerApi {
  loadStockSdkChipDistribution(symbol: string): Promise<IChipDistributionResult>;
  calculateChipDistribution(input: ICalculateChipDistributionInput): Promise<IChipDistributionResult>;
}
