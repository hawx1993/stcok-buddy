import type { MarketDataSyncStatus } from './types.js';

export type TMarketDataProgressListener = (status: MarketDataSyncStatus) => void;

export interface IMarketDataSyncWorkerApi {
  runSync(force: boolean, onProgress: TMarketDataProgressListener): Promise<MarketDataSyncStatus>;
  runRepair(onProgress: TMarketDataProgressListener): Promise<MarketDataSyncStatus>;
  runHistoricalBackfill(onProgress: TMarketDataProgressListener): Promise<MarketDataSyncStatus>;
  requestStop(): Promise<void>;
}
