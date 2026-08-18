export type TMarketDataHydrationStage = 'snapshots' | 'securities' | 'chips';
export type TMarketDataHydrationState = 'running' | 'completed' | 'partial' | 'failed';

export interface IMarketDataHydrationStatus {
  state: TMarketDataHydrationState;
  stage: TMarketDataHydrationStage;
  processed: number;
  total: number;
  succeeded: number;
  failed: number;
  hydrated: number;
  warnings: string[];
  message?: string;
}

export interface IHydrateAllMarketChipsOptions {
  timeoutMs?: number;
  concurrency?: number;
  batchSize?: number;
  maxAgeMs?: number;
}

export type TMarketDataHydrationProgressListener = (status: IMarketDataHydrationStatus) => void;

export interface IMarketDataHydrationWorkerApi {
  hydrateAllMarketSnapshots(onProgress: TMarketDataHydrationProgressListener): Promise<IMarketDataHydrationStatus>;
  hydrateAllSecurities(onProgress: TMarketDataHydrationProgressListener): Promise<IMarketDataHydrationStatus>;
  hydrateAllMarketChips(
    options: IHydrateAllMarketChipsOptions,
    onProgress: TMarketDataHydrationProgressListener,
  ): Promise<IMarketDataHydrationStatus>;
}
