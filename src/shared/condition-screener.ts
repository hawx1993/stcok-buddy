export const CONDITION_SCREENER_COMMAND = '/条件选股';

export type TConditionScreenerPresetId =
  | 'small-cap-high-turnover'
  | 'chip-concentration-improving'
  | 'strong-volume-not-limit-up'
  | 'low-position-active'
  | 'leading-board-stocks';

type TConditionScreenerCriterionKey =
  | 'market-cap'
  | 'turnover-rate'
  | 'amount'
  | 'exclude-st'
  | 'sort'
  | 'concentration-90'
  | 'profit-ratio'
  | 'change-percent'
  | 'leading-boards';

export interface IConditionScreenerCriterion {
  key: TConditionScreenerCriterionKey;
  command: string;
  label: string;
}

export interface IConditionScreenerPreset {
  id: TConditionScreenerPresetId;
  title: string;
  description: string;
  criteria: readonly IConditionScreenerCriterion[];
}

const criterionOrder: readonly TConditionScreenerCriterionKey[] = [
  'leading-boards',
  'market-cap',
  'concentration-90',
  'profit-ratio',
  'change-percent',
  'turnover-rate',
  'amount',
  'exclude-st',
  'sort',
];

export const conditionScreenerPresets: readonly IConditionScreenerPreset[] = [
  {
    id: 'small-cap-high-turnover',
    title: '小盘高换手',
    description: '筛选市值适中、成交活跃的股票',
    criteria: [
      { key: 'market-cap', command: '--总市值=30-100亿', label: '总市值 30–100 亿' },
      { key: 'turnover-rate', command: '--换手率>8%', label: '换手率 > 8%' },
      { key: 'amount', command: '--成交额>2亿', label: '成交额 > 2 亿' },
      { key: 'exclude-st', command: '--排除ST', label: '排除 ST' },
      { key: 'sort', command: '--排序=换手率降序', label: '按换手率降序' },
    ],
  },
  {
    id: 'chip-concentration-improving',
    title: '筹码集中改善',
    description: '聚焦筹码集中度和获利盘条件',
    criteria: [
      { key: 'concentration-90', command: '--筹码90%集中度<15%', label: '筹码 90% 集中度 < 15%' },
      { key: 'profit-ratio', command: '--获利比例>50%', label: '获利比例 > 50%' },
      { key: 'change-percent', command: '--涨幅=0-5%', label: '涨幅 0–5%' },
      { key: 'exclude-st', command: '--排除ST', label: '排除 ST' },
    ],
  },
  {
    id: 'strong-volume-not-limit-up',
    title: '强势放量但未涨停',
    description: '筛选上涨、放量且未触及涨停区间的股票',
    criteria: [
      { key: 'change-percent', command: '--涨幅=3-8%', label: '涨幅 3–8%' },
      { key: 'turnover-rate', command: '--换手率>6%', label: '换手率 > 6%' },
      { key: 'amount', command: '--成交额>5亿', label: '成交额 > 5 亿' },
      { key: 'exclude-st', command: '--排除ST', label: '排除 ST' },
    ],
  },
  {
    id: 'low-position-active',
    title: '低位活跃',
    description: '筛选温和波动且交投活跃的中小市值股票',
    criteria: [
      { key: 'change-percent', command: '--涨幅=-2-3%', label: '涨幅 -2–3%' },
      { key: 'turnover-rate', command: '--换手率>5%', label: '换手率 > 5%' },
      { key: 'market-cap', command: '--总市值<150亿', label: '总市值 < 150 亿' },
      { key: 'amount', command: '--成交额>1亿', label: '成交额 > 1 亿' },
    ],
  },
  {
    id: 'leading-board-stocks',
    title: '板块内选股',
    description: '在今日领涨行业和概念板块中筛选活跃股',
    criteria: [
      { key: 'leading-boards', command: '--今日领涨板块', label: '今日领涨板块' },
      { key: 'turnover-rate', command: '--换手率>8%', label: '换手率 > 8%' },
      { key: 'amount', command: '--成交额>3亿', label: '成交额 > 3 亿' },
    ],
  },
];

const presetById = new Map(conditionScreenerPresets.map((preset) => [preset.id, preset]));

export function mergeConditionScreenerCriteria(
  presetIds: readonly TConditionScreenerPresetId[],
): IConditionScreenerCriterion[] {
  const criteriaByKey = new Map<TConditionScreenerCriterionKey, IConditionScreenerCriterion>();
  for (const presetId of presetIds) {
    const preset = presetById.get(presetId);
    if (!preset) continue;
    for (const criterion of preset.criteria) criteriaByKey.set(criterion.key, criterion);
  }
  return criterionOrder.flatMap((key) => {
    const criterion = criteriaByKey.get(key);
    return criterion ? [criterion] : [];
  });
}

export function createConditionScreenerCommand(presetIds: readonly TConditionScreenerPresetId[]): string {
  const criteria = mergeConditionScreenerCriteria(presetIds);
  return criteria.length ? `${CONDITION_SCREENER_COMMAND} ${criteria.map((criterion) => criterion.command).join(' ')}` : '';
}

export function toggleConditionScreenerPreset(
  presetIds: readonly TConditionScreenerPresetId[],
  presetId: TConditionScreenerPresetId,
): TConditionScreenerPresetId[] {
  return presetIds.includes(presetId)
    ? presetIds.filter((currentPresetId) => currentPresetId !== presetId)
    : [...presetIds, presetId];
}

export function isConditionScreenerCommand(value: string): boolean {
  const text = value.trim();
  return text === CONDITION_SCREENER_COMMAND || text.startsWith(`${CONDITION_SCREENER_COMMAND} `);
}
