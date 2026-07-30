export interface IHotThemeLeader {
  code: string;
  name: string;
  height?: number | null;
}

export interface IHotThemeForLeader {
  name?: string;
  leaders?: IHotThemeLeader[];
}

export interface ISectorLeaderSource {
  mainNetInflow?: number;
  topStockName?: string;
  topStockCode?: string;
}

export interface ILocalBoardThemeSource {
  code: string;
  name: string;
  changePercent: number;
}

export interface IHotThemeForLocalBoard extends IHotThemeForLeader {
  code?: string | null;
  name: string;
  changePercent?: number | null;
  reason?: string | null;
}

function appendLeader(leaders: IHotThemeLeader[], leader: IHotThemeLeader | undefined): void {
  if (!leader?.code || !leader.name) return;
  if (leaders.some((item) => item.code === leader.code)) return;
  leaders.push(leader);
}

export function mergeHotThemeLeaders<T extends IHotThemeForLeader>(
  theme: T,
  sector: ISectorLeaderSource | undefined,
  fallbackLeaders: IHotThemeLeader[],
): T & IHotThemeForLeader {
  const existingLeaders = theme.leaders ?? [];
  if (existingLeaders.length) return { ...theme, leaders: existingLeaders.slice(0, 3) };

  const leaders: IHotThemeLeader[] = [];
  appendLeader(leaders, sector?.topStockCode && sector.topStockName
    ? { code: sector.topStockCode, name: sector.topStockName }
    : undefined);
  for (const leader of fallbackLeaders) {
    appendLeader(leaders, leader);
    if (leaders.length >= 3) break;
  }

  return leaders.length ? { ...theme, leaders } : theme;
}

export function reconcileHotThemeWithLocalBoard<T extends IHotThemeForLocalBoard>(
  theme: T,
  localBoard: ILocalBoardThemeSource | undefined,
  sector: ISectorLeaderSource | undefined,
): T | undefined {
  if (!localBoard) return undefined;
  const mainNetInflowText = sector?.mainNetInflow !== undefined
    ? `，主力净流入 ${sector.mainNetInflow >= 0 ? '+' : ''}${sector.mainNetInflow.toFixed(1)} 亿`
    : '';
  return {
    ...theme,
    code: localBoard.code,
    name: localBoard.name,
    changePercent: localBoard.changePercent,
    reason: `板块涨跌幅 ${localBoard.changePercent >= 0 ? '+' : ''}${localBoard.changePercent.toFixed(2)}%${mainNetInflowText}。`,
  };
}
