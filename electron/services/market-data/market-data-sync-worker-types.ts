import type { MarketDataSyncStatus } from './types.js';

export type TMarketDataProgressListener = (status: MarketDataSyncStatus) => void;

export interface IRunMarketDataSyncInput {
  force: boolean;
  onProgress: TMarketDataProgressListener;
}

export interface IMarketDataSyncWorkerApi {
  runSync(input: IRunMarketDataSyncInput): Promise<MarketDataSyncStatus>;
  runRepair(onProgress: TMarketDataProgressListener): Promise<MarketDataSyncStatus>;
  requestStop(): Promise<void>;
}
