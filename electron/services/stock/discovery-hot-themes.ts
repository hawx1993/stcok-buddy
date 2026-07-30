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
  topStockName?: string;
  topStockCode?: string;
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
