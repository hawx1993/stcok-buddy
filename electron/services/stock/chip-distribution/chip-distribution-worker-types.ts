import type {
  IChipDistributionResult,
  KlinePoint,
  TChipDistributionPeriod,
  TChipDistributionSource,
} from '../../../../src/shared/types.js';

export interface ICalculateChipDistributionInput {
  klines: KlinePoint[];
  source: TChipDistributionSource;
  period: TChipDistributionPeriod;
  warnings?: string[];
}

export interface IChipDistributionWorkerApi {
  loadStockSdkChipDistribution(symbol: string): Promise<IChipDistributionResult>;
  calculateChipDistribution(input: ICalculateChipDistributionInput): Promise<IChipDistributionResult>;
}
