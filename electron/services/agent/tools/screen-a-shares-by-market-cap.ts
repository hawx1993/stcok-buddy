import {
  screenASharesByConditions,
  type IConditionScreenerInput,
  type IConditionScreenerRow,
} from '../../market-data/condition-screener-service.js';
import type {
  IMarketCapScreenInput,
  IMarketCapScreenResult,
  IMarketCapScreenRow,
  TMarketCapField,
} from '../../market-data/market-cap-screener.js';
import type { AgentTool } from '../../tools/types.js';
import { asRecord, num, optionalNum, text } from './input.js';

const YI_YUAN = 100_000_000;
const WAN_YUAN = 10_000;

/** 模型可调用：按市值范围筛选全市场股票，数据遵循 DuckDB → stock-sdk → a-stock-data。 */
export const screenASharesByMarketCap: AgentTool<IMarketCapScreenInput, IMarketCapScreenResult> = {
  name: 'screenASharesByMarketCap',
  description:
    '全市场 A 股市值筛选工具，用真实数据按 DuckDB → stock-sdk → a-stock-data 获取个股总市值/流通市值，支持按换手率区间二次过滤。用于“市值在30亿到100亿”“总市值小于50亿”“流通市值30亿到100亿”“市值100亿到500亿且换手率大于10%”等查询。全市场筛选请传大 limit（如 500）避免只返回部分结果。输入示例 {minMarketCap:100,maxMarketCap:500,unit:"yi",marketCapField:"total",turnoverRateMin:10,limit:500}。',
  inputSchema: {
    type: 'object',
    properties: {
      minMarketCap: { type: 'number' },
      maxMarketCap: { type: 'number' },
      turnoverRateMin: { type: 'number' },
      turnoverRateMax: { type: 'number' },
      unit: { type: 'string', enum: ['yuan', 'yi'] },
      marketCapField: { type: 'string', enum: ['total', 'circulating'] },
      limit: { type: 'number' },
      includeST: { type: 'boolean' },
      sortOrder: { type: 'string', enum: ['asc', 'desc'] },
    },
  },
  async run(input) {
    const record = asRecord(input);
    const unit = text(record, 'unit', 'yi') === 'yuan' ? 'yuan' : 'yi';
    const marketCapField: TMarketCapField =
      text(record, 'marketCapField', 'total') === 'circulating' ? 'circulating' : 'total';
    const sortOrder = text(record, 'sortOrder', 'asc') === 'desc' ? 'desc' : 'asc';
    const minMarketCap = record.minMarketCap === undefined ? undefined : num(record, 'minMarketCap', 0);
    const maxMarketCap = record.maxMarketCap === undefined ? undefined : num(record, 'maxMarketCap', 0);
    const conditionInput = buildConditionInput({
      minMarketCap,
      maxMarketCap,
      turnoverRateMin: optionalNum(record, 'turnoverRateMin'),
      turnoverRateMax: optionalNum(record, 'turnoverRateMax'),
      unit,
      marketCapField,
      limit: num(record, 'limit', 50),
      includeST: record.includeST === true,
      sortOrder,
    });
    const result = await screenASharesByConditions(conditionInput);
    const rows = result.rows
      .map((row) => mapMarketCapRow(row, marketCapField))
      .filter((row): row is IMarketCapScreenRow => row !== undefined);
    return {
      source: result.source,
      storage: result.storage,
      marketCapField,
      minMarketCap: normalizeMarketCapBound(minMarketCap, unit),
      maxMarketCap: normalizeMarketCapBound(maxMarketCap, unit),
      turnoverRateMin: conditionInput.turnoverRateMin,
      turnoverRateMax: conditionInput.turnoverRateMax,
      unit: 'yuan',
      rows,
      matchedCount: result.matchedCount,
      returnedCount: rows.length,
      totalCandidates: result.totalCandidates,
      sourceStats: {
        duckdbMatched: result.sourceStats.duckdbMatched,
        stockSdkMatched: result.sourceStats.stockSdkMatched,
        aStockDataMatched: result.sourceStats.aStockDataMatched,
        missingMarketCap: result.sourceStats.missingQuoteFields,
      },
      warnings: result.warnings,
      isEmpty: rows.length === 0,
    };
  },
};

function buildConditionInput(
  input: Required<Pick<IMarketCapScreenInput, 'marketCapField' | 'limit' | 'includeST' | 'sortOrder' | 'unit'>> &
    Pick<IMarketCapScreenInput, 'minMarketCap' | 'maxMarketCap' | 'turnoverRateMin' | 'turnoverRateMax'>,
): IConditionScreenerInput {
  const minMarketCap = normalizeMarketCapBound(input.minMarketCap, input.unit);
  const maxMarketCap = normalizeMarketCapBound(input.maxMarketCap, input.unit);
  return {
    ...(input.marketCapField === 'circulating'
      ? { minCirculatingMarketCapYuan: minMarketCap, maxCirculatingMarketCapYuan: maxMarketCap }
      : { minTotalMarketCapYuan: minMarketCap, maxTotalMarketCapYuan: maxMarketCap }),
    turnoverRateMin: normalizeTurnoverBound(input.turnoverRateMin),
    turnoverRateMax: normalizeTurnoverBound(input.turnoverRateMax),
    excludeST: !input.includeST,
    sortBy: input.marketCapField === 'circulating' ? 'circulatingMarketCap' : 'totalMarketCap',
    sortOrder: input.sortOrder,
    limit: input.limit,
  };
}

function mapMarketCapRow(row: IConditionScreenerRow, field: TMarketCapField): IMarketCapScreenRow | undefined {
  const marketCap = field === 'circulating' ? row.circulatingMarketCapYuan : row.totalMarketCapYuan;
  if (marketCap === undefined) return undefined;
  return {
    code: row.code,
    name: row.name,
    exchange: row.exchange,
    industry: row.industry,
    price: row.price,
    changePercent: row.changePercent,
    turnoverRate: row.turnoverRate,
    amount: row.amountYuan === undefined ? undefined : row.amountYuan / WAN_YUAN,
    totalMarketCap: row.totalMarketCapYuan,
    circulatingMarketCap: row.circulatingMarketCapYuan,
    marketCap,
    marketCapYi: marketCap / YI_YUAN,
    marketCapText: formatMarketCapText(marketCap),
    dataSource: row.dataSource,
    fetchedAt: row.fetchedAt,
  };
}

function normalizeMarketCapBound(value: number | undefined, unit: 'yuan' | 'yi') {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.round(unit === 'yi' ? value * YI_YUAN : value));
}

function normalizeTurnoverBound(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, value);
}

function formatMarketCapText(value: number) {
  return `${(value / YI_YUAN).toFixed(2)}亿`;
}
