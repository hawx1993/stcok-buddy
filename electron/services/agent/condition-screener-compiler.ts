import type {
  IConditionScreenerInput,
  TConditionScreenerMarketScope,
  TConditionScreenerSortBy,
  TConditionScreenerSortOrder,
} from '../market-data/condition-screener-service.js';

const YI_YUAN = 100_000_000;
const WAN = 10_000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const orderedCriterionKeys = [
  'market-scope',
  'exclude-st',
  'total-market-cap',
  'circulating-market-cap',
  'turnover-rate',
  'amount',
  'volume',
  'change-percent',
  'concentration-90',
  'concentration-70',
  'profit-ratio',
  'leading-boards',
  'sort',
  'limit',
] as const;

type TCriterionKey = typeof orderedCriterionKeys[number];
type TCriteriaByKey = Partial<Record<TCriterionKey, string>>;

export interface IConditionScreenerState {
  input: IConditionScreenerInput;
  criteriaByKey: TCriteriaByKey;
}

export interface IConditionScreenerCompileSuccess {
  valid: true;
  input: IConditionScreenerInput;
  criteria: string[];
  warnings: string[];
  dataRequirements: string[];
  dataGaps: string[];
  state: IConditionScreenerState;
}

export interface IConditionScreenerCompileFailure {
  valid: false;
  errors: string[];
}

export type TConditionScreenerCompileResult = IConditionScreenerCompileSuccess | IConditionScreenerCompileFailure;

interface IWorkingState {
  input: IConditionScreenerInput;
  criteriaByKey: TCriteriaByKey;
  touchedKeys: Set<TCriterionKey>;
  warnings: string[];
  errors: string[];
  lastKey?: TCriterionKey;
}

export function compileConditionScreenerQuery(
  rawArguments: string,
  previousState?: IConditionScreenerState,
): TConditionScreenerCompileResult {
  const text = normalizeText(rawArguments);
  const shouldUsePrevious = Boolean(previousState) && isContinuationText(text);
  const state = createWorkingState(shouldUsePrevious ? previousState : undefined);

  if (isResetText(text)) {
    state.input = {};
    state.criteriaByKey = {};
  }

  applyDeleteCommands(text, state);
  const parsedAnything = parseCommandSegments(text, state) || parseNaturalText(text, state);
  const criteria = formatCriteria(state.criteriaByKey);

  if (state.errors.length) return { valid: false, errors: state.errors };

  if (!parsedAnything && !criteria.length) {
    return {
      valid: false,
      errors: ['未识别到可执行筛选条件。请补充市值、成交额、换手率、筹码集中度、市场范围、排序或返回数量。'],
    };
  }

  if (!parsedAnything && state.touchedKeys.size === 0 && shouldUsePrevious && criteria.length) {
    state.warnings.push('未识别到新的筛选条件，继续沿用上一轮条件。');
  }

  return {
    valid: true,
    input: pruneInput(state.input),
    criteria,
    warnings: state.warnings,
    dataRequirements: dataRequirementsForInput(state.input),
    dataGaps: [],
    state: {
      input: pruneInput(state.input),
      criteriaByKey: state.criteriaByKey,
    },
  };
}

export function formatConditionScreenerCriteria(state: IConditionScreenerState): string[] {
  return formatCriteria(state.criteriaByKey);
}

function createWorkingState(previousState?: IConditionScreenerState): IWorkingState {
  return {
    input: previousState ? { ...previousState.input, marketScopes: previousState.input.marketScopes ? [...previousState.input.marketScopes] : undefined } : {},
    criteriaByKey: previousState ? { ...previousState.criteriaByKey } : {},
    touchedKeys: new Set<TCriterionKey>(),
    warnings: [],
    errors: [],
  };
}

function parseCommandSegments(text: string, state: IWorkingState): boolean {
  const segments = text
    .split(/--/)
    .map((segment) => trimPunctuation(segment))
    .filter(Boolean);
  if (segments.length <= 1 && !text.trim().startsWith('--')) return false;

  let parsed = false;
  const commandKeys = new Set<TCriterionKey>();
  for (const segment of segments) {
    state.lastKey = undefined;
    if (applyCommandSegment(segment, state)) {
      parsed = true;
      const key = state.lastKey;
      if (key && commandKeys.has(key)) state.errors.push(`参数重复：--${segment}。请只保留一个同类条件。`);
      if (key) commandKeys.add(key);
    } else if (segment) {
      state.errors.push(`未识别参数：--${segment}`);
    }
  }
  return parsed;
}

function applyCommandSegment(segment: string, state: IWorkingState): boolean {
  const normalized = segment
    .replace(/\s+/g, '')
    .replaceAll('％', '%')
    .replaceAll('＝', '=')
    .replaceAll('＜', '<')
    .replaceAll('＞', '>')
    .replace(/[—–~至]/g, '-');

  if (normalized === '排除ST' || normalized === '非ST' || normalized === '不要ST') {
    setExcludeST(state);
    return true;
  }
  if (normalized === '今日领涨板块') {
    state.input.leadingBoards = true;
    setCriterion(state, 'leading-boards', '今日领涨板块');
    return true;
  }

  const marketCapRange = /^总市值=(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)亿$/.exec(normalized);
  if (marketCapRange) return setTotalMarketCapRange(state, marketCapRange[1], marketCapRange[2]);

  const marketCapMax = /^总市值<(\d+(?:\.\d+)?)亿$/.exec(normalized);
  if (marketCapMax) return setTotalMarketCapMaxExclusive(state, marketCapMax[1]);

  const circulatingRange = /^流通市值=(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)亿$/.exec(normalized);
  if (circulatingRange) return setCirculatingMarketCapRange(state, circulatingRange[1], circulatingRange[2]);

  const circulatingMax = /^流通市值<(\d+(?:\.\d+)?)亿$/.exec(normalized);
  if (circulatingMax) return setCirculatingMarketCapMaxExclusive(state, circulatingMax[1]);

  const turnoverMin = /^换手率>(\d+(?:\.\d+)?)%$/.exec(normalized);
  if (turnoverMin) return setTurnoverRateMinExclusive(state, turnoverMin[1]);

  const turnoverRange = /^换手率?=(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)%$/.exec(normalized);
  if (turnoverRange) return setTurnoverRateRange(state, turnoverRange[1], turnoverRange[2]);

  const amountMin = /^成交额>(\d+(?:\.\d+)?)亿$/.exec(normalized);
  if (amountMin) return setAmountMinExclusive(state, amountMin[1]);

  const amountRange = /^成交额=(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)亿$/.exec(normalized);
  if (amountRange) return setAmountRange(state, amountRange[1], amountRange[2]);

  const volumeMin = /^成交量>(\d+(?:\.\d+)?)(万手|亿手|手)?$/.exec(normalized);
  if (volumeMin) return setVolumeMinExclusive(state, volumeMin[1], volumeMin[2]);

  const changeRange = /^涨幅=(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)%$/.exec(normalized);
  if (changeRange) return setChangePercentRange(state, changeRange[1], changeRange[2]);

  const concentration90 = /^筹码90%集中度<(\d+(?:\.\d+)?)%$/.exec(normalized);
  if (concentration90) return setConcentration90MaxExclusive(state, concentration90[1]);

  const concentration70 = /^筹码70%集中度<(\d+(?:\.\d+)?)%$/.exec(normalized);
  if (concentration70) return setConcentration70MaxExclusive(state, concentration70[1]);

  const profitRatio = /^获利比例>(\d+(?:\.\d+)?)%$/.exec(normalized);
  if (profitRatio) return setProfitRatioMinExclusive(state, profitRatio[1]);

  const sort = /^排序=(.+)$/.exec(normalized);
  if (sort) return applySortText(sort[1], state);

  const limit = /^返回前?(\d+)只?$/.exec(normalized);
  if (limit) return setLimit(state, limit[1]);

  return false;
}

function parseNaturalText(rawText: string, state: IWorkingState): boolean {
  const text = normalizeNaturalText(rawText);
  let parsed = false;

  parsed = applyMarketScopes(text, state) || parsed;
  if (/排除\s*ST|不要\s*ST|非\s*ST/i.test(text)) {
    setExcludeST(state);
    parsed = true;
  }
  if (/今日?领涨板块/.test(text)) {
    state.input.leadingBoards = true;
    setCriterion(state, 'leading-boards', '今日领涨板块');
    parsed = true;
  }

  parsed = applyCapText(text, state, '流通市值', 'circulating-market-cap') || parsed;
  parsed = applyCapText(text, state, '总市值', 'total-market-cap') || parsed;
  if (!/总市值|流通市值/.test(text)) {
    parsed = applyCapText(text, state, '市值', 'total-market-cap') || parsed;
  }

  parsed = applyAmountText(text, state) || parsed;
  parsed = applyVolumeText(text, state) || parsed;
  parsed = applyTurnoverRateText(text, state) || parsed;
  parsed = applyChangePercentText(text, state) || parsed;
  parsed = applyChipText(text, state) || parsed;
  parsed = applySortFromText(text, state) || parsed;
  parsed = applyLimitFromText(text, state) || parsed;

  return parsed;
}

function applyDeleteCommands(text: string, state: IWorkingState): void {
  if (!/(去掉|取消|删除|不要).*(条件|限制|筛选)?/.test(text)) return;
  if (/筹码|集中度|获利比例/.test(text)) {
    clearKeys(state, ['concentration-90', 'concentration-70', 'profit-ratio']);
  }
  if (/总市值|市值/.test(text)) clearKeys(state, ['total-market-cap']);
  if (/流通市值/.test(text)) clearKeys(state, ['circulating-market-cap']);
  if (/成交额/.test(text)) clearKeys(state, ['amount']);
  if (/成交量/.test(text)) clearKeys(state, ['volume']);
  if (/换手/.test(text)) clearKeys(state, ['turnover-rate']);
  if (/涨幅|涨跌幅/.test(text)) clearKeys(state, ['change-percent']);
  if (/ST/i.test(text)) clearKeys(state, ['exclude-st']);
  if (/市场|沪市|深市|创业板|科创板|北交所|主板/.test(text)) clearKeys(state, ['market-scope']);
}

function clearKeys(state: IWorkingState, keys: TCriterionKey[]): void {
  for (const key of keys) {
    clearCriterionInput(state.input, key);
    delete state.criteriaByKey[key];
    state.touchedKeys.add(key);
  }
}

function clearCriterionInput(input: IConditionScreenerInput, key: TCriterionKey): void {
  switch (key) {
    case 'market-scope':
      delete input.marketScopes;
      break;
    case 'exclude-st':
      delete input.excludeST;
      break;
    case 'total-market-cap':
      delete input.minTotalMarketCapYuan;
      delete input.maxTotalMarketCapYuan;
      delete input.maxTotalMarketCapYuanExclusive;
      break;
    case 'circulating-market-cap':
      delete input.minCirculatingMarketCapYuan;
      delete input.maxCirculatingMarketCapYuan;
      delete input.maxCirculatingMarketCapYuanExclusive;
      break;
    case 'amount':
      delete input.minAmountYuan;
      delete input.maxAmountYuan;
      delete input.amountMinYuanExclusive;
      break;
    case 'volume':
      delete input.minVolume;
      delete input.maxVolume;
      delete input.volumeMinExclusive;
      break;
    case 'turnover-rate':
      delete input.turnoverRateMin;
      delete input.turnoverRateMax;
      delete input.turnoverRateMinExclusive;
      break;
    case 'change-percent':
      delete input.changePercentMin;
      delete input.changePercentMax;
      break;
    case 'concentration-90':
      delete input.concentration90Min;
      delete input.concentration90Max;
      delete input.concentration90MaxExclusive;
      break;
    case 'concentration-70':
      delete input.concentration70Min;
      delete input.concentration70Max;
      delete input.concentration70MaxExclusive;
      break;
    case 'profit-ratio':
      delete input.profitRatioMin;
      delete input.profitRatioMax;
      delete input.profitRatioMinExclusive;
      break;
    case 'leading-boards':
      delete input.leadingBoards;
      break;
    case 'sort':
      delete input.sortBy;
      delete input.sortOrder;
      break;
    case 'limit':
      delete input.limit;
      break;
  }
}

function applyCapText(text: string, state: IWorkingState, label: '市值' | '总市值' | '流通市值', key: 'total-market-cap' | 'circulating-market-cap'): boolean {
  const range = new RegExp(`${label}(?:改成|放宽到|设为|为|在|是)?(\\d+(?:\\.\\d+)?)(?:到|-|~|至)(\\d+(?:\\.\\d+)?)亿`).exec(text);
  if (range) {
    return key === 'circulating-market-cap'
      ? setCirculatingMarketCapRange(state, range[1], range[2])
      : setTotalMarketCapRange(state, range[1], range[2]);
  }

  const max = new RegExp(`${label}(?:小于|低于|不超过|不高于|以内|少于|<)(\\d+(?:\\.\\d+)?)亿`).exec(text)
    ?? new RegExp(`${label}(?:改成|放宽到|设为|为)?(\\d+(?:\\.\\d+)?)亿(?:以下|以内)`).exec(text);
  if (max) {
    return key === 'circulating-market-cap'
      ? setCirculatingMarketCapMaxExclusive(state, max[1])
      : setTotalMarketCapMaxExclusive(state, max[1]);
  }

  const min = new RegExp(`${label}(?:大于|高于|超过|不少于|不低于|>)(\\d+(?:\\.\\d+)?)亿`).exec(text)
    ?? new RegExp(`${label}(?:改成|放宽到|设为|为)?(\\d+(?:\\.\\d+)?)亿(?:以上)`).exec(text);
  if (min) {
    return key === 'circulating-market-cap'
      ? setCirculatingMarketCapMin(state, min[1])
      : setTotalMarketCapMin(state, min[1]);
  }
  return false;
}

function applyAmountText(text: string, state: IWorkingState): boolean {
  const range = /成交额(?:为|在|是)?(\d+(?:\.\d+)?)(?:到|-|~|至)(\d+(?:\.\d+)?)亿/.exec(text);
  if (range) return setAmountRange(state, range[1], range[2]);
  const min = /成交额(?:大于|高于|超过|不少于|不低于|>)(\d+(?:\.\d+)?)亿/.exec(text)
    ?? /成交额(\d+(?:\.\d+)?)亿(?:以上)/.exec(text);
  if (min) return setAmountMinExclusive(state, min[1]);
  const max = /成交额(?:小于|低于|不超过|不高于|以内|<)(\d+(?:\.\d+)?)亿/.exec(text)
    ?? /成交额(\d+(?:\.\d+)?)亿(?:以下|以内)/.exec(text);
  if (max) return setAmountMax(state, max[1]);
  return false;
}

function applyVolumeText(text: string, state: IWorkingState): boolean {
  const range = /成交量(?:为|在|是)?(\d+(?:\.\d+)?)(万手|亿手|手)?(?:到|-|~|至)(\d+(?:\.\d+)?)(万手|亿手|手)?/.exec(text);
  if (range) return setVolumeRange(state, range[1], range[3], range[2] ?? range[4], range[4] ?? range[2]);
  const min = /成交量(?:大于|高于|超过|不少于|不低于|>)(\d+(?:\.\d+)?)(万手|亿手|手)?/.exec(text)
    ?? /成交量(\d+(?:\.\d+)?)(万手|亿手|手)?(?:以上)/.exec(text);
  if (min) return setVolumeMinExclusive(state, min[1], min[2]);
  const max = /成交量(?:小于|低于|不超过|不高于|以内|<)(\d+(?:\.\d+)?)(万手|亿手|手)?/.exec(text)
    ?? /成交量(\d+(?:\.\d+)?)(万手|亿手|手)?(?:以下|以内)/.exec(text);
  if (max) return setVolumeMax(state, max[1], max[2]);
  return false;
}

function applyTurnoverRateText(text: string, state: IWorkingState): boolean {
  const range = /换手率?(?:为|在|是)?(\d+(?:\.\d+)?)%?(?:到|-|~|至)(\d+(?:\.\d+)?)%/.exec(text);
  if (range) return setTurnoverRateRange(state, range[1], range[2]);
  const min = /换手率?(?:大于|高于|超过|不少于|不低于|>)(\d+(?:\.\d+)?)%?/.exec(text)
    ?? /换手率?(\d+(?:\.\d+)?)%?(?:以上)/.exec(text);
  if (min) return setTurnoverRateMinExclusive(state, min[1]);
  const max = /换手率?(?:小于|低于|不超过|不高于|以内|<)(\d+(?:\.\d+)?)%?/.exec(text)
    ?? /换手率?(\d+(?:\.\d+)?)%?(?:以下|以内)/.exec(text);
  if (max) return setTurnoverRateMax(state, max[1]);
  return false;
}

function applyChangePercentText(text: string, state: IWorkingState): boolean {
  const range = /(?:涨幅|涨跌幅)(?:为|在|是)?(-?\d+(?:\.\d+)?)%?(?:到|-|~|至)(-?\d+(?:\.\d+)?)%/.exec(text);
  if (range) return setChangePercentRange(state, range[1], range[2]);
  const min = /(?:涨幅|涨跌幅)(?:大于|高于|超过|不少于|不低于|>)(-?\d+(?:\.\d+)?)%?/.exec(text);
  if (min) return setChangePercentMin(state, min[1]);
  const max = /(?:涨幅|涨跌幅)(?:小于|低于|不超过|不高于|以内|<)(-?\d+(?:\.\d+)?)%?/.exec(text);
  if (max) return setChangePercentMax(state, max[1]);
  return false;
}

function applyChipText(text: string, state: IWorkingState): boolean {
  let parsed = false;
  const concentration90Max = /(?:90%筹码集中度|筹码90%集中度)(?:小于|低于|不超过|不高于|<)(\d+(?:\.\d+)?)%?/.exec(text);
  if (concentration90Max) parsed = setConcentration90MaxExclusive(state, concentration90Max[1]) || parsed;
  const concentration90Range = /(?:90%筹码集中度|筹码90%集中度)(?:为|在|是)?(\d+(?:\.\d+)?)%?(?:到|-|~|至)(\d+(?:\.\d+)?)%/.exec(text);
  if (concentration90Range) parsed = setConcentration90Range(state, concentration90Range[1], concentration90Range[2]) || parsed;
  const concentration70Max = /(?:70%筹码集中度|筹码70%集中度)(?:小于|低于|不超过|不高于|<)(\d+(?:\.\d+)?)%?/.exec(text);
  if (concentration70Max) parsed = setConcentration70MaxExclusive(state, concentration70Max[1]) || parsed;
  const concentration70Range = /(?:70%筹码集中度|筹码70%集中度)(?:为|在|是)?(\d+(?:\.\d+)?)%?(?:到|-|~|至)(\d+(?:\.\d+)?)%/.exec(text);
  if (concentration70Range) parsed = setConcentration70Range(state, concentration70Range[1], concentration70Range[2]) || parsed;
  const profitRatio = /获利比例(?:大于|高于|超过|不少于|不低于|>)(\d+(?:\.\d+)?)%?/.exec(text);
  if (profitRatio) parsed = setProfitRatioMinExclusive(state, profitRatio[1]) || parsed;
  return parsed;
}

function applyMarketScopes(text: string, state: IWorkingState): boolean {
  const scopes: TConditionScreenerMarketScope[] = [];
  if (/沪市|上证|沪股|沪A/i.test(text)) scopes.push('sh');
  if (/深市|深证|深股|深A/i.test(text)) scopes.push('sz');
  if (/创业板/.test(text)) scopes.push('cy');
  if (/科创板/.test(text)) scopes.push('kc');
  if (/北交所|北证/.test(text)) scopes.push('bj');
  if (/主板/.test(text)) scopes.push('main');
  const uniqueScopes = unique(scopes);
  if (!uniqueScopes.length) return false;
  state.input.marketScopes = uniqueScopes;
  setCriterion(state, 'market-scope', `市场范围：${uniqueScopes.map(marketScopeLabel).join('、')}`);
  return true;
}

function applySortText(text: string, state: IWorkingState): boolean {
  return applySortFromText(text, state);
}

function applySortFromText(text: string, state: IWorkingState): boolean {
  const sortBy = sortByFromText(text);
  if (!sortBy) return false;
  const sortOrder = sortOrderFromText(text, sortBy);
  state.input.sortBy = sortBy;
  state.input.sortOrder = sortOrder;
  setCriterion(state, 'sort', `按${sortLabel(sortBy)}${sortOrder === 'desc' ? '降序' : '升序'}`);
  return true;
}

function applyLimitFromText(text: string, state: IWorkingState): boolean {
  const match = /(?:返回|展示|取)?前\s*(\d+)\s*只/.exec(text);
  if (!match) return false;
  return setLimit(state, match[1]);
}

function sortByFromText(text: string): TConditionScreenerSortBy | undefined {
  if (!/(排序|按|最高|最低|从高到低|从低到高|降序|升序)/.test(text)) return undefined;
  if (/流通市值/.test(text)) return 'circulatingMarketCap';
  if (/总市值|市值/.test(text)) return 'totalMarketCap';
  if (/成交额/.test(text)) return 'amount';
  if (/成交量/.test(text)) return 'volume';
  if (/换手/.test(text)) return 'turnoverRate';
  if (/涨幅|涨跌幅/.test(text)) return 'changePercent';
  if (/70%筹码集中度|筹码70%集中度/.test(text)) return 'concentration70';
  if (/90%筹码集中度|筹码90%集中度|筹码集中度/.test(text)) return 'concentration90';
  if (/代码/.test(text)) return 'code';
  return undefined;
}

function sortOrderFromText(text: string, sortBy: TConditionScreenerSortBy): TConditionScreenerSortOrder {
  if (/升序|从低到高|最小|最低|从小到大/.test(text)) return 'asc';
  if (/降序|从高到低|最大|最高|从大到小/.test(text)) return 'desc';
  return sortBy === 'code' || sortBy === 'totalMarketCap' || sortBy === 'circulatingMarketCap' ? 'asc' : 'desc';
}

function setTotalMarketCapRange(state: IWorkingState, rawMin: string, rawMax: string): boolean {
  const min = toYuan(rawMin);
  const max = toYuan(rawMax);
  if (!isValidRange(min, max)) return false;
  clearCriterionInput(state.input, 'total-market-cap');
  state.input.minTotalMarketCapYuan = min;
  state.input.maxTotalMarketCapYuan = max;
  setCriterion(state, 'total-market-cap', `总市值 ${rawMin}–${rawMax} 亿`);
  return true;
}

function setTotalMarketCapMin(state: IWorkingState, rawMin: string): boolean {
  const min = toYuan(rawMin);
  if (min === undefined) return false;
  clearCriterionInput(state.input, 'total-market-cap');
  state.input.minTotalMarketCapYuan = min;
  setCriterion(state, 'total-market-cap', `总市值 ≥ ${rawMin} 亿`);
  return true;
}

function setTotalMarketCapMaxExclusive(state: IWorkingState, rawMax: string): boolean {
  const max = toYuan(rawMax);
  if (max === undefined) return false;
  clearCriterionInput(state.input, 'total-market-cap');
  state.input.maxTotalMarketCapYuanExclusive = max;
  setCriterion(state, 'total-market-cap', `总市值 < ${rawMax} 亿`);
  return true;
}

function setCirculatingMarketCapRange(state: IWorkingState, rawMin: string, rawMax: string): boolean {
  const min = toYuan(rawMin);
  const max = toYuan(rawMax);
  if (!isValidRange(min, max)) return false;
  clearCriterionInput(state.input, 'circulating-market-cap');
  state.input.minCirculatingMarketCapYuan = min;
  state.input.maxCirculatingMarketCapYuan = max;
  setCriterion(state, 'circulating-market-cap', `流通市值 ${rawMin}–${rawMax} 亿`);
  return true;
}

function setCirculatingMarketCapMin(state: IWorkingState, rawMin: string): boolean {
  const min = toYuan(rawMin);
  if (min === undefined) return false;
  clearCriterionInput(state.input, 'circulating-market-cap');
  state.input.minCirculatingMarketCapYuan = min;
  setCriterion(state, 'circulating-market-cap', `流通市值 ≥ ${rawMin} 亿`);
  return true;
}

function setCirculatingMarketCapMaxExclusive(state: IWorkingState, rawMax: string): boolean {
  const max = toYuan(rawMax);
  if (max === undefined) return false;
  clearCriterionInput(state.input, 'circulating-market-cap');
  state.input.maxCirculatingMarketCapYuanExclusive = max;
  setCriterion(state, 'circulating-market-cap', `流通市值 < ${rawMax} 亿`);
  return true;
}

function setAmountRange(state: IWorkingState, rawMin: string, rawMax: string): boolean {
  const min = toYuan(rawMin);
  const max = toYuan(rawMax);
  if (!isValidRange(min, max)) return false;
  clearCriterionInput(state.input, 'amount');
  state.input.minAmountYuan = min;
  state.input.maxAmountYuan = max;
  setCriterion(state, 'amount', `成交额 ${rawMin}–${rawMax} 亿`);
  return true;
}

function setAmountMinExclusive(state: IWorkingState, rawMin: string): boolean {
  const min = toYuan(rawMin);
  if (min === undefined) return false;
  clearCriterionInput(state.input, 'amount');
  state.input.amountMinYuanExclusive = min;
  setCriterion(state, 'amount', `成交额 > ${rawMin} 亿`);
  return true;
}

function setAmountMax(state: IWorkingState, rawMax: string): boolean {
  const max = toYuan(rawMax);
  if (max === undefined) return false;
  clearCriterionInput(state.input, 'amount');
  state.input.maxAmountYuan = max;
  setCriterion(state, 'amount', `成交额 ≤ ${rawMax} 亿`);
  return true;
}

function setVolumeRange(state: IWorkingState, rawMin: string, rawMax: string, minUnit?: string, maxUnit?: string): boolean {
  const min = toVolume(rawMin, minUnit);
  const max = toVolume(rawMax, maxUnit);
  if (!isValidRange(min, max)) return false;
  clearCriterionInput(state.input, 'volume');
  state.input.minVolume = min;
  state.input.maxVolume = max;
  setCriterion(state, 'volume', `成交量 ${formatVolumeValue(min)}–${formatVolumeValue(max)}`);
  return true;
}

function setVolumeMinExclusive(state: IWorkingState, rawMin: string, unit?: string): boolean {
  const min = toVolume(rawMin, unit);
  if (min === undefined) return false;
  clearCriterionInput(state.input, 'volume');
  state.input.volumeMinExclusive = min;
  setCriterion(state, 'volume', `成交量 > ${formatVolumeValue(min)}`);
  return true;
}

function setVolumeMax(state: IWorkingState, rawMax: string, unit?: string): boolean {
  const max = toVolume(rawMax, unit);
  if (max === undefined) return false;
  clearCriterionInput(state.input, 'volume');
  state.input.maxVolume = max;
  setCriterion(state, 'volume', `成交量 ≤ ${formatVolumeValue(max)}`);
  return true;
}

function setTurnoverRateRange(state: IWorkingState, rawMin: string, rawMax: string): boolean {
  const min = toPercent(rawMin);
  const max = toPercent(rawMax);
  if (!isValidRange(min, max)) return false;
  clearCriterionInput(state.input, 'turnover-rate');
  state.input.turnoverRateMin = min;
  state.input.turnoverRateMax = max;
  setCriterion(state, 'turnover-rate', `换手率 ${rawMin}–${rawMax}%`);
  return true;
}

function setTurnoverRateMinExclusive(state: IWorkingState, rawMin: string): boolean {
  const min = toPercent(rawMin);
  if (min === undefined) return false;
  clearCriterionInput(state.input, 'turnover-rate');
  state.input.turnoverRateMinExclusive = min;
  setCriterion(state, 'turnover-rate', `换手率 > ${rawMin}%`);
  return true;
}

function setTurnoverRateMax(state: IWorkingState, rawMax: string): boolean {
  const max = toPercent(rawMax);
  if (max === undefined) return false;
  clearCriterionInput(state.input, 'turnover-rate');
  state.input.turnoverRateMax = max;
  setCriterion(state, 'turnover-rate', `换手率 ≤ ${rawMax}%`);
  return true;
}

function setChangePercentRange(state: IWorkingState, rawMin: string, rawMax: string): boolean {
  const min = toPercent(rawMin);
  const max = toPercent(rawMax);
  if (!isValidRange(min, max)) return false;
  clearCriterionInput(state.input, 'change-percent');
  state.input.changePercentMin = min;
  state.input.changePercentMax = max;
  setCriterion(state, 'change-percent', `涨幅 ${rawMin}–${rawMax}%`);
  return true;
}

function setChangePercentMin(state: IWorkingState, rawMin: string): boolean {
  const min = toPercent(rawMin);
  if (min === undefined) return false;
  clearCriterionInput(state.input, 'change-percent');
  state.input.changePercentMin = min;
  setCriterion(state, 'change-percent', `涨幅 ≥ ${rawMin}%`);
  return true;
}

function setChangePercentMax(state: IWorkingState, rawMax: string): boolean {
  const max = toPercent(rawMax);
  if (max === undefined) return false;
  clearCriterionInput(state.input, 'change-percent');
  state.input.changePercentMax = max;
  setCriterion(state, 'change-percent', `涨幅 ≤ ${rawMax}%`);
  return true;
}

function setConcentration90Range(state: IWorkingState, rawMin: string, rawMax: string): boolean {
  const min = toPercent(rawMin);
  const max = toPercent(rawMax);
  if (!isValidRange(min, max)) return false;
  clearCriterionInput(state.input, 'concentration-90');
  state.input.concentration90Min = min;
  state.input.concentration90Max = max;
  setCriterion(state, 'concentration-90', `筹码 90% 集中度 ${rawMin}–${rawMax}%`);
  return true;
}

function setConcentration90MaxExclusive(state: IWorkingState, rawMax: string): boolean {
  const max = toPercent(rawMax);
  if (max === undefined) return false;
  clearCriterionInput(state.input, 'concentration-90');
  state.input.concentration90MaxExclusive = max;
  setCriterion(state, 'concentration-90', `筹码 90% 集中度 < ${rawMax}%`);
  return true;
}

function setConcentration70Range(state: IWorkingState, rawMin: string, rawMax: string): boolean {
  const min = toPercent(rawMin);
  const max = toPercent(rawMax);
  if (!isValidRange(min, max)) return false;
  clearCriterionInput(state.input, 'concentration-70');
  state.input.concentration70Min = min;
  state.input.concentration70Max = max;
  setCriterion(state, 'concentration-70', `筹码 70% 集中度 ${rawMin}–${rawMax}%`);
  return true;
}

function setConcentration70MaxExclusive(state: IWorkingState, rawMax: string): boolean {
  const max = toPercent(rawMax);
  if (max === undefined) return false;
  clearCriterionInput(state.input, 'concentration-70');
  state.input.concentration70MaxExclusive = max;
  setCriterion(state, 'concentration-70', `筹码 70% 集中度 < ${rawMax}%`);
  return true;
}

function setProfitRatioMinExclusive(state: IWorkingState, rawMin: string): boolean {
  const min = toPercent(rawMin);
  if (min === undefined) return false;
  clearCriterionInput(state.input, 'profit-ratio');
  state.input.profitRatioMinExclusive = min;
  setCriterion(state, 'profit-ratio', `获利比例 > ${rawMin}%`);
  return true;
}

function setExcludeST(state: IWorkingState): void {
  state.input.excludeST = true;
  setCriterion(state, 'exclude-st', '排除 ST');
}

function setLimit(state: IWorkingState, rawLimit: string): boolean {
  const value = Number(rawLimit);
  if (!Number.isFinite(value) || value <= 0) return false;
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)));
  state.input.limit = limit;
  setCriterion(state, 'limit', `返回前 ${limit} 只`);
  if (value > MAX_LIMIT) state.warnings.push(`返回数量已限制为最多 ${MAX_LIMIT} 只。`);
  return true;
}

function setCriterion(state: IWorkingState, key: TCriterionKey, label: string): void {
  state.criteriaByKey[key] = label;
  state.touchedKeys.add(key);
  state.lastKey = key;
}

function toYuan(rawValue: string): number | undefined {
  const value = Number(rawValue);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * YI_YUAN) : undefined;
}

function toPercent(rawValue: string): number | undefined {
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : undefined;
}

function toVolume(rawValue: string, unit?: string): number | undefined {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) return undefined;
  const multiplier = unit === '亿手' ? YI_YUAN : unit === '万手' ? WAN : 1;
  return Math.round(value * multiplier);
}

function isValidRange(min: number | undefined, max: number | undefined): min is number {
  return min !== undefined && max !== undefined && min <= max;
}

function formatCriteria(criteriaByKey: TCriteriaByKey): string[] {
  return orderedCriterionKeys.map((key) => criteriaByKey[key]).filter((item): item is string => Boolean(item));
}

function dataRequirementsForInput(input: IConditionScreenerInput): string[] {
  const requirements: string[] = [];
  if (input.marketScopes?.length || input.excludeST) requirements.push('证券基础信息');
  if (
    input.minTotalMarketCapYuan !== undefined ||
    input.maxTotalMarketCapYuan !== undefined ||
    input.maxTotalMarketCapYuanExclusive !== undefined ||
    input.sortBy === 'totalMarketCap'
  ) requirements.push('总市值');
  if (
    input.minCirculatingMarketCapYuan !== undefined ||
    input.maxCirculatingMarketCapYuan !== undefined ||
    input.maxCirculatingMarketCapYuanExclusive !== undefined ||
    input.sortBy === 'circulatingMarketCap'
  ) requirements.push('流通市值');
  if (input.minAmountYuan !== undefined || input.maxAmountYuan !== undefined || input.amountMinYuanExclusive !== undefined || input.sortBy === 'amount') requirements.push('成交额');
  if (input.minVolume !== undefined || input.maxVolume !== undefined || input.volumeMinExclusive !== undefined || input.sortBy === 'volume') requirements.push('成交量');
  if (input.turnoverRateMin !== undefined || input.turnoverRateMax !== undefined || input.turnoverRateMinExclusive !== undefined || input.sortBy === 'turnoverRate') requirements.push('换手率');
  if (input.changePercentMin !== undefined || input.changePercentMax !== undefined || input.sortBy === 'changePercent') requirements.push('涨跌幅');
  if (
    input.concentration90Min !== undefined ||
    input.concentration90Max !== undefined ||
    input.concentration90MaxExclusive !== undefined ||
    input.concentration70Min !== undefined ||
    input.concentration70Max !== undefined ||
    input.concentration70MaxExclusive !== undefined ||
    input.profitRatioMin !== undefined ||
    input.profitRatioMax !== undefined ||
    input.profitRatioMinExclusive !== undefined ||
    input.sortBy === 'concentration90' ||
    input.sortBy === 'concentration70'
  ) requirements.push('筹码分布');
  if (input.leadingBoards) requirements.push('板块成分股');
  return unique(requirements);
}

function pruneInput(input: IConditionScreenerInput): IConditionScreenerInput {
  const next: IConditionScreenerInput = { ...input };
  if (next.limit === DEFAULT_LIMIT) delete next.limit;
  if (next.marketScopes && !next.marketScopes.length) delete next.marketScopes;
  return next;
}

function normalizeText(text: string): string {
  return text.trim().replace(/^\/条件选股\s*/, '').trim();
}

function normalizeNaturalText(text: string): string {
  return normalizeText(text)
    .replaceAll('％', '%')
    .replaceAll('，', ',')
    .replaceAll('、', ',')
    .replaceAll('—', '-')
    .replaceAll('–', '-')
    .replace(/\s+/g, '');
}

function trimPunctuation(text: string): string {
  return text.trim().replace(/[，,。；;]+$/g, '').trim();
}

function isContinuationText(text: string): boolean {
  return /^(再|继续|同时|并且|加上|追加|把|将|去掉|取消|删除|改成|放宽|收窄|按|返回|展示)/.test(text.trim());
}

function isResetText(text: string): boolean {
  return /重新筛|重置条件|清空条件|从头筛|重新开始/.test(text);
}

function marketScopeLabel(scope: TConditionScreenerMarketScope): string {
  return {
    sh: '沪市',
    sz: '深市',
    bj: '北交所',
    kc: '科创板',
    cy: '创业板',
    main: '主板',
  }[scope];
}

function sortLabel(sortBy: TConditionScreenerSortBy): string {
  return {
    code: '代码',
    totalMarketCap: '总市值',
    circulatingMarketCap: '流通市值',
    amount: '成交额',
    volume: '成交量',
    turnoverRate: '换手率',
    changePercent: '涨幅',
    concentration90: '筹码 90% 集中度',
    concentration70: '筹码 70% 集中度',
  }[sortBy];
}

function formatVolumeValue(value: number | undefined): string {
  if (value === undefined) return '--';
  if (value >= YI_YUAN) return `${(value / YI_YUAN).toFixed(2)} 亿手`;
  if (value >= WAN) return `${(value / WAN).toFixed(2)} 万手`;
  return `${value} 手`;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
