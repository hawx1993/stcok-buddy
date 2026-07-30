import type { HotFocusItem } from '../../../src/shared/types.js';
import type { IMonthlyThemeItem, TLocalBoardSummary } from './discovery-service.js';

export function normalizeBoardLookupName(name: string) {
  return name.replace(/行业|板块|Ⅱ|Ⅲ|II|III|\s/g, '');
}

function buildLocalBoardCatalog(rows: TLocalBoardSummary[]) {
  const byName = new Map<string, TLocalBoardSummary>();
  for (const row of rows) {
    byName.set(row.name, row);
    byName.set(normalizeBoardLookupName(row.name), row);
  }
  return { rows, byName };
}

function findLocalBoard(rows: TLocalBoardSummary[], name: string) {
  const catalog = buildLocalBoardCatalog(rows);
  const normalized = normalizeBoardLookupName(name);
  return catalog.byName.get(name)
    ?? catalog.byName.get(normalized)
    ?? catalog.rows.find((row) => {
      const rowName = normalizeBoardLookupName(row.name);
      return rowName.includes(normalized) || normalized.includes(rowName);
    });
}

function parseAmountYi(value?: string): number {
  if (!value) return 0;
  const match = value.match(/([\d.]+)\s*(万|亿)?/);
  if (!match) return 0;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return 0;
  if (match[2] === '万') return amount / 10_000;
  return amount;
}

function getPoolBoardName(item: HotFocusItem): string | undefined {
  const boardName = item.description?.split('·')[0]?.trim();
  if (!boardName || boardName.includes('换手') || boardName.includes('封单') || boardName.includes('成交额')) return undefined;
  return boardName;
}

export function buildMonthlyThemesFromHistoricalPools(
  weeks: Array<{ label: string; dates: string[]; items: HotFocusItem[] }>,
  boardRows: TLocalBoardSummary[],
): IMonthlyThemeItem[] {
  return weeks.flatMap((week) => {
    const groups = new Map<string, { count: number; amount: number; leaders: Array<{ code: string; name: string; amount: number }> }>();
    for (const item of week.items) {
      if (item.tag !== '封涨停板') continue;
      const boardName = getPoolBoardName(item);
      if (!boardName) continue;
      const board = findLocalBoard(boardRows, boardName);
      const theme = board?.name ?? boardName;
      const group = groups.get(theme) ?? { count: 0, amount: 0, leaders: [] };
      const amount = parseAmountYi(item.amount);
      group.count += 1;
      group.amount += amount;
      if (item.code && item.name) group.leaders.push({ code: item.code, name: item.name, amount });
      groups.set(theme, group);
    }

    const topTheme = Array.from(groups.entries())
      .sort((a, b) => b[1].count - a[1].count || b[1].amount - a[1].amount || a[0].localeCompare(b[0], 'zh-Hans-CN'))[0];
    if (!topTheme) return [{ week: week.label, theme: '暂无热点数据', leader: null }];

    const [theme, stats] = topTheme;
    const leader = stats.leaders
      .sort((a, b) => b.amount - a.amount || a.code.localeCompare(b.code))[0];
    return [{ week: week.label, theme, leader: leader ? { code: leader.code, name: leader.name } : null }];
  });
}
