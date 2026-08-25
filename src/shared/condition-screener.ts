export const CONDITION_SCREENER_COMMAND = '/条件选股';

export type TConditionScreenerParameterId =
  | 'market-scope'
  | 'exclude-st'
  | 'total-market-cap'
  | 'circulating-market-cap'
  | 'turnover-rate'
  | 'amount'
  | 'volume'
  | 'change-percent'
  | 'concentration-90'
  | 'concentration-70'
  | 'profit-ratio'
  | 'leading-boards'
  | 'sort'
  | 'limit';

export interface IConditionScreenerParameter {
  id: TConditionScreenerParameterId;
  name: string;
  description: string;
  example: string;
  aliases: readonly string[];
}

export const conditionScreenerParameters: readonly IConditionScreenerParameter[] = [
  {
    id: 'market-scope',
    name: '市场范围',
    description: '限定沪市、深市、北交所、科创板、创业板或主板；多个市场用逗号分隔。',
    example: '--市场范围=沪市,深市',
    aliases: ['市场范围', '市场'],
  },
  {
    id: 'exclude-st',
    name: '排除 ST',
    description: '剔除名称中包含 ST 或 *ST 的股票。',
    example: '--排除ST',
    aliases: ['排除ST', '非ST', '不要ST'],
  },
  {
    id: 'total-market-cap',
    name: '总市值',
    description: '按总市值区间或上限筛选，金额单位为亿元。',
    example: '--总市值=30-100亿',
    aliases: ['总市值'],
  },
  {
    id: 'circulating-market-cap',
    name: '流通市值',
    description: '按流通市值区间或上限筛选，金额单位为亿元。',
    example: '--流通市值=20-80亿',
    aliases: ['流通市值'],
  },
  {
    id: 'turnover-rate',
    name: '换手率',
    description: '设置最低换手率或换手率区间，数值单位为百分比。',
    example: '--换手率>8%',
    aliases: ['换手率', '换手'],
  },
  {
    id: 'amount',
    name: '成交额',
    description: '设置最低成交额或成交额区间，金额单位为亿元。',
    example: '--成交额>5亿',
    aliases: ['成交额'],
  },
  {
    id: 'volume',
    name: '成交量',
    description: '设置最低成交量，支持手、万手和亿手。',
    example: '--成交量>100万手',
    aliases: ['成交量'],
  },
  {
    id: 'change-percent',
    name: '涨幅',
    description: '设置当日涨跌幅区间，可使用负数，数值单位为百分比。',
    example: '--涨幅=3-8%',
    aliases: ['涨幅', '涨跌幅'],
  },
  {
    id: 'concentration-90',
    name: '筹码 90% 集中度',
    description: '设置 90% 筹码价格区间的最大集中度，数值越小通常越集中。',
    example: '--筹码90%集中度<15%',
    aliases: ['筹码90%集中度', '90%筹码集中度', '筹码集中度'],
  },
  {
    id: 'concentration-70',
    name: '筹码 70% 集中度',
    description: '设置 70% 筹码价格区间的最大集中度，数值单位为百分比。',
    example: '--筹码70%集中度<10%',
    aliases: ['筹码70%集中度', '70%筹码集中度', '筹码集中度'],
  },
  {
    id: 'profit-ratio',
    name: '获利比例',
    description: '设置最低获利盘比例，数值单位为百分比。',
    example: '--获利比例>50%',
    aliases: ['获利比例', '获利盘比例'],
  },
  {
    id: 'leading-boards',
    name: '今日领涨板块',
    description: '只在今日领涨行业和概念板块的真实成分股范围内筛选。',
    example: '--今日领涨板块',
    aliases: ['今日领涨板块', '领涨板块'],
  },
  {
    id: 'sort',
    name: '排序',
    description: '指定排序字段和升降序，支持市值、成交额、成交量、换手率、涨幅和筹码集中度。',
    example: '--排序=换手率降序',
    aliases: ['排序', '排序方式'],
  },
  {
    id: 'limit',
    name: '返回数量',
    description: '限制返回前 N 只股票，最多返回 500 只。',
    example: '--返回前20只',
    aliases: ['返回数量', '返回前', '展示数量'],
  },
];

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
      { key: 'amount', command: '--成交额>5亿', label: '成交额 > 5 亿' },
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
  return criteria.length
    ? `${CONDITION_SCREENER_COMMAND} ${criteria.map((criterion) => criterion.command).join(' ')}`
    : '';
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

export function shouldOpenConditionScreenerParameters(value: string): boolean {
  const text = value.trimEnd();
  if (!text.startsWith(`${CONDITION_SCREENER_COMMAND} `)) return false;
  const argumentsText = text.slice(CONDITION_SCREENER_COMMAND.length).trimStart();
  return argumentsText === '--' || argumentsText.endsWith(' --');
}

export function insertConditionScreenerParameter(value: string, parameter: string): string {
  const command = isConditionScreenerCommand(value) ? value.trimEnd() : CONDITION_SCREENER_COMMAND;
  const commandWithoutTrigger = command.replace(/(?:^|\s)--$/, '').trimEnd();
  return `${commandWithoutTrigger} ${parameter.trim()}`;
}
