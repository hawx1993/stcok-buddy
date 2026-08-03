import { create } from 'zustand';
import type { DataSyncTaskType, MarketNewsItem } from '../shared/types';

export type SidebarTab = 'all' | 'surge' | 'stock' | 'diagnosis' | 'market';
export type SidebarMainTab = 'session' | 'hot';
export type HotSubTab = 'sector' | 'market' | 'surge' | 'strategy' | 'diagnosis' | 'flow';
export type RightPanelTab = 'favorites' | 'stock' | 'board' | 'surge' | 'news' | 'ai-monitor';
export type MainView = 'chat' | 'market' | 'news-reader' | 'discovery';

export interface ISyncBannerState {
  taskType: DataSyncTaskType;
  status: 'running' | 'completed' | 'error';
  processed: number;
  total: number;
  message: string;
}

let latestNewsReaderRequestId = 0;

interface INewsReaderState {
  id: string;
  source: Pick<MarketNewsItem, 'id' | 'title' | 'source' | 'time' | 'url' | 'content'>;
  requestId: number;
  previousView: Exclude<MainView, 'news-reader'>;
  item?: MarketNewsItem;
  loading: boolean;
  error?: string;
}

interface IAppUiState {
  sidebarTab: SidebarTab;
  sidebarMainTab: SidebarMainTab;
  hotSubTab: HotSubTab;
  rightPanelTab: RightPanelTab;
  mainView: MainView;
  newsReader?: INewsReaderState;
  isLeftSidebarCollapsed: boolean;
  isRightPanelCollapsed: boolean;
  search: string;
  isSettingsOpen: boolean;
  isAboutOpen: boolean;
  isStorageManagerOpen: boolean;
  isDataSyncOpen: boolean;
  syncProgress: Record<string, ISyncBannerState>;
  setSidebarTab(tab: SidebarTab): void;
  setSidebarMainTab(tab: SidebarMainTab): void;
  setHotSubTab(tab: HotSubTab): void;
  setRightPanelTab(tab: RightPanelTab): void;
  setMainView(view: Exclude<MainView, 'news-reader'>): void;
  openNewsReader(item: Pick<MarketNewsItem, 'id' | 'title' | 'source' | 'time' | 'url' | 'content'>): number;
  setNewsReaderItem(requestId: number, item: MarketNewsItem): void;
  setNewsReaderError(requestId: number, error: string): void;
  closeNewsReader(): void;
  toggleLeftSidebar(): void;
  toggleRightPanel(): void;
  openRightPanel(): void;
  openBoardPanel(): void;
  openAiMonitorPanel(): void;
  setSearch(search: string): void;
  setSettingsOpen(open: boolean): void;
  setAboutOpen(open: boolean): void;
  setStorageManagerOpen(open: boolean): void;
  setDataSyncOpen(open: boolean): void;
  setSyncProgress(taskType: DataSyncTaskType, patch: Partial<ISyncBannerState>): void;
}

export const useAppUiStore = create<IAppUiState>((set) => ({
  sidebarTab: 'all',
  sidebarMainTab: 'session',
  hotSubTab: 'sector',
  rightPanelTab: 'stock',
  mainView: 'chat',
  isLeftSidebarCollapsed: false,
  isRightPanelCollapsed: true,
  search: '',
  isSettingsOpen: false,
  isAboutOpen: false,
  isStorageManagerOpen: false,
  isDataSyncOpen: false,
  syncProgress: {},
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setSidebarMainTab: (tab) => set({ sidebarMainTab: tab, search: '' }),
  setHotSubTab: (tab) => set({ hotSubTab: tab }),
  setRightPanelTab: (tab) =>
    set((state) => ({
      rightPanelTab: tab,
      isRightPanelCollapsed: state.rightPanelTab === tab ? !state.isRightPanelCollapsed : false,
    })),
  setMainView: (view) => set({ mainView: view }),
  openNewsReader: (source) => {
    const requestId = latestNewsReaderRequestId + 1;
    latestNewsReaderRequestId = requestId;
    set((state) => ({
      mainView: 'news-reader',
      newsReader: {
        id: source.id,
        source,
        requestId,
        previousView: state.mainView === 'news-reader' ? (state.newsReader?.previousView ?? 'chat') : state.mainView,
        loading: true,
      },
    }));
    return requestId;
  },
  setNewsReaderItem: (requestId, item) =>
    set((state) =>
      state.newsReader?.requestId === requestId
        ? { newsReader: { ...state.newsReader, item, loading: false, error: undefined } }
        : state,
    ),
  setNewsReaderError: (requestId, error) =>
    set((state) =>
      state.newsReader?.requestId === requestId ? { newsReader: { ...state.newsReader, loading: false, error } } : state,
    ),
  closeNewsReader: () =>
    set((state) => ({
      mainView: state.newsReader?.previousView ?? 'chat',
      newsReader: undefined,
    })),
  toggleLeftSidebar: () => set((state) => ({ isLeftSidebarCollapsed: !state.isLeftSidebarCollapsed })),
  toggleRightPanel: () => set((state) => ({ isRightPanelCollapsed: !state.isRightPanelCollapsed })),
  openRightPanel: () => set({ isRightPanelCollapsed: false, rightPanelTab: 'stock' }),
  openBoardPanel: () => set({ isRightPanelCollapsed: false, rightPanelTab: 'board' }),
  openAiMonitorPanel: () => set({ isRightPanelCollapsed: false, rightPanelTab: 'ai-monitor' }),
  setSearch: (search) => set({ search }),
  setSettingsOpen: (open) => set({ isSettingsOpen: open }),
  setAboutOpen: (open) => set({ isAboutOpen: open }),
  setStorageManagerOpen: (open) => set({ isStorageManagerOpen: open }),
  setDataSyncOpen: (open) => set({ isDataSyncOpen: open }),
  setSyncProgress: (taskType, patch) =>
    set((state) => ({
      syncProgress: {
        ...state.syncProgress,
        [taskType]: { ...state.syncProgress[taskType], taskType, ...patch } as ISyncBannerState,
      },
    })),
}));
