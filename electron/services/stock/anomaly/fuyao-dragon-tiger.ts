import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { IDragonTigerDetailRow, IDragonTigerInstitutionRow } from '../../../../src/shared/types.js';
import { listRemoteTradingCalendar } from '../../market-data/providers.js';

const DEFAULT_FUYAO_A_SHARE_MCP_URL = 'https://fuyao.aicubes.cn/mcp/a-share';
const FUYAO_DRAGON_TIGER_TOOL = 'get_a_share_special_data_dragon_tiger_list';
const MCP_TIMEOUT_MS = 25_000;
const REQUEST_CONCURRENCY = 4;
const LATEST_CACHE_TTL_MS = 30_000;
const HISTORICAL_CACHE_TTL_MS = 5 * 60_000;

type TFuyaoDragonTigerBoardType = 'all' | 'org';

type TFuyaoToolEnvelope = {
  code?: number;
  message?: string;
  data?: unknown;
  error?: { message?: string } | string;
};

export interface IFuyaoDragonTigerResult {
  tradeDate: string;
  rows: IDragonTigerDetailRow[];
  institutions: IDragonTigerInstitutionRow[];
  warnings: string[];
}

type TCachedEnvelope = {
  expiresAt: number;
  value: TFuyaoToolEnvelope;
};

type TFuyaoMcpConnection = {
  url: string;
  apiKey: string;
};

type TMcpConfigPathOptions = {
  cwd: string;
  explicitPath?: string;
};

const responseCache = new Map<string, TCachedEnvelope>();
let rpcId = 0;

export async function loadFuyaoDragonTigerRange(options: {
  startDate: string;
  endDate: string;
  latestOnly: boolean;
}): Promise<IFuyaoDragonTigerResult> {
  const warnings: string[] = [];
  const dates = options.latestOnly
    ? [options.endDate]
    : await resolveTradingDates(options.startDate, options.endDate, warnings);
  const envelopes = await loadAllBoards(dates, warnings, options.latestOnly);
  const datedRows = envelopes
    .map((envelope) => toFuyaoDragonTigerRows(envelope))
    .filter((item) => item.tradeDate && item.rows.length);

  if (!datedRows.length) {
    return {
      tradeDate: options.endDate,
      rows: [],
      institutions: [],
      warnings,
    };
  }

  const tradeDate = datedRows.reduce(
    (latest, item) => (item.tradeDate > latest ? item.tradeDate : latest),
    datedRows[0]!.tradeDate,
  );
  const uniqueRows = new Map<string, IDragonTigerDetailRow>();
  for (const item of datedRows) {
    for (const row of item.rows) uniqueRows.set(row.id, row);
  }
  const rows = [...uniqueRows.values()].sort(
    (left, right) =>
      right.date.localeCompare(left.date) ||
      (right.netBuyAmount ?? 0) - (left.netBuyAmount ?? 0) ||
      left.code.localeCompare(right.code),
  );
  let institutions: IDragonTigerInstitutionRow[] = [];
  try {
    institutions = toFuyaoInstitutionRows(await callFuyaoDragonTigerTool('org', tradeDate));
  } catch (error) {
    warnings.push(`扶摇龙虎榜机构榜 ${tradeDate} 加载失败：${errorMessage(error)}`);
  }

  return { tradeDate, rows, institutions, warnings };
}

async function loadAllBoards(
  dates: Array<string | undefined>,
  warnings: string[],
  latestOnly: boolean,
): Promise<TFuyaoToolEnvelope[]> {
  const envelopes: TFuyaoToolEnvelope[] = [];
  let failureCount = 0;
  let firstFailure: unknown;

  for (let start = 0; start < dates.length; start += REQUEST_CONCURRENCY) {
    const batch = dates.slice(start, start + REQUEST_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((date) => callFuyaoDragonTigerTool('all', date, latestOnly)),
    );
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        envelopes.push(result.value);
        return;
      }
      failureCount += 1;
      firstFailure ??= result.reason;
      warnings.push(`扶摇龙虎榜 ${batch[index] ?? '最新交易日'} 加载失败：${errorMessage(result.reason)}`);
    });
  }

  if (!envelopes.length && failureCount) throw firstFailure;
  return envelopes;
}

async function resolveTradingDates(startDate: string, endDate: string, warnings: string[]): Promise<string[]> {
  try {
    const calendar = await listRemoteTradingCalendar();
    const dates = calendar
      .map((item) => normalizeTradeDate(item.tradeDate))
      .filter((date): date is string => Boolean(date && date >= startDate && date <= endDate))
      .sort((left, right) => right.localeCompare(left));
    return dates.length ? dates : [endDate];
  } catch (error) {
    warnings.push(`交易日历加载失败，仅查询区间结束日：${errorMessage(error)}`);
    return [endDate];
  }
}

export async function resolveFuyaoMcpConnection(options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  configPath?: string;
} = {}): Promise<TFuyaoMcpConnection> {
  const env = options.env ?? process.env;
  const envApiKey = env.FUYAO_A_SHARE_API_KEY ?? env.FUYAO_API_KEY ?? env.HITHINK_FINANCE_API_KEY;
  if (envApiKey) {
    return {
      url: env.FUYAO_A_SHARE_MCP_URL ?? DEFAULT_FUYAO_A_SHARE_MCP_URL,
      apiKey: envApiKey,
    };
  }

  const configPaths = resolveMcpConfigPaths({
    cwd: options.cwd ?? process.cwd(),
    explicitPath: options.configPath ?? env.FUYAO_A_SHARE_MCP_CONFIG_PATH ?? env.FUYAO_MCP_CONFIG_PATH,
  });
  for (const configPath of configPaths) {
    let configText: string;
    try {
      configText = await readFile(configPath, 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') continue;
      throw new Error(`读取 MCP 配置失败：${errorMessage(error)}`);
    }

    let configValue: unknown;
    try {
      configValue = JSON.parse(configText);
    } catch (error) {
      throw new Error(`MCP 配置 ${configPath} 格式无效：${errorMessage(error)}`);
    }
    const root = asRecord(configValue);
    const servers = asRecord(root?.mcpServers);
    const server = asRecord(servers?.['fuyao-a-share']);
    const headers = asRecord(server?.headers);
    const apiKey = caseInsensitiveText(headers, 'X-api-key');
    if (apiKey) {
      return {
        url: text(server, ['url']) || DEFAULT_FUYAO_A_SHARE_MCP_URL,
        apiKey,
      };
    }
  }

  throw missingApiKeyError(configPaths);
}

async function callFuyaoDragonTigerTool(
  boardType: TFuyaoDragonTigerBoardType,
  date?: string,
  latestOnly = false,
): Promise<TFuyaoToolEnvelope> {
  const cacheKey = `${latestOnly ? 'latest' : 'historical'}:${boardType}:${date ?? 'latest'}`;
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const connection = await resolveFuyaoMcpConnection();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS);
  try {
    const response = await fetch(connection.url, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2025-06-18',
        'X-api-key': connection.apiKey,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: String(++rpcId),
        method: 'tools/call',
        params: {
          name: FUYAO_DRAGON_TIGER_TOOL,
          arguments: date ? { board_type: boardType, date } : { board_type: boardType },
        },
      }),
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`扶摇 A 股 MCP HTTP ${response.status}: ${body.slice(0, 200)}`);
    const envelope = unwrapMcpEnvelope(parseMcpBody(body));
    const now = Date.now();
    pruneExpiredCache(now);
    responseCache.set(cacheKey, {
      expiresAt: now + (latestOnly ? LATEST_CACHE_TTL_MS : HISTORICAL_CACHE_TTL_MS),
      value: envelope,
    });
    return envelope;
  } finally {
    clearTimeout(timeout);
  }
}

export function toFuyaoDragonTigerRows(envelope: TFuyaoToolEnvelope): {
  tradeDate: string;
  rows: IDragonTigerDetailRow[];
} {
  const data = asRecord(envelope.data);
  const tradeDate = normalizeTradeDate(text(data, ['trade_date'])) ?? '';
  const stockItems = records(data?.stock_items);
  return {
    tradeDate,
    rows: stockItems
      .map((row) => toDetailRow(row, tradeDate))
      .filter((row): row is IDragonTigerDetailRow => Boolean(row)),
  };
}

export function toFuyaoInstitutionRows(envelope: TFuyaoToolEnvelope): IDragonTigerInstitutionRow[] {
  const data = asRecord(envelope.data);
  const tradeDate = normalizeTradeDate(text(data, ['trade_date'])) ?? '';
  return records(data?.stock_items)
    .map((row): IDragonTigerInstitutionRow | undefined => {
      const code = normalizeStockCode(text(row, ['ticker', 'thscode']));
      const name = text(row, ['name']);
      const orgNetAmount = number(row, ['org_net_value']);
      if (!code || !name || !tradeDate || orgNetAmount === null) return undefined;
      return {
        code,
        name,
        date: tradeDate,
        price: null,
        changePercent: ratioPercent(row, ['change']),
        buyOrgCount: number(row, ['org_buy_num']),
        sellOrgCount: number(row, ['org_sell_num']),
        orgBuyAmount: null,
        orgSellAmount: null,
        orgNetAmount,
      };
    })
    .filter((row): row is IDragonTigerInstitutionRow => Boolean(row))
    .sort((left, right) => (right.orgNetAmount ?? 0) - (left.orgNetAmount ?? 0) || left.code.localeCompare(right.code));
}

function toDetailRow(row: Record<string, unknown>, tradeDate: string): IDragonTigerDetailRow | undefined {
  const code = normalizeStockCode(text(row, ['ticker', 'thscode']));
  const name = text(row, ['name']);
  if (!code || !name || !tradeDate) return undefined;
  const rangeDays = number(row, ['range_days']);
  const reason = text(row, ['limit_reason']) || conceptReason(row) || '未披露原因';
  return {
    id: `dragon-tiger-fuyao-${tradeDate}-${code}-${rangeDays ?? 1}-${stableTextKey(reason)}`,
    code,
    name,
    date: tradeDate,
    reason,
    close: null,
    changePercent: ratioPercent(row, ['change']),
    netBuyAmount: number(row, ['net_value']),
    buyAmount: number(row, ['buy_value']),
    sellAmount: number(row, ['sell_value']),
    dealAmount: null,
    totalAmount: null,
    netBuyRatio: ratioPercent(row, ['net_rate']),
    dealAmountRatio: null,
    turnoverRate: null,
    floatMarketValue: null,
    afterChange1d: null,
    afterChange2d: null,
    afterChange5d: null,
    afterChange10d: null,
  };
}

function parseMcpBody(body: string): unknown {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('扶摇 A 股 MCP 返回空响应');
  if (!trimmed.startsWith('event:') && !trimmed.startsWith('data:')) return JSON.parse(trimmed);
  const dataLine = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .find((line) => line && line !== '[DONE]');
  if (!dataLine) throw new Error('扶摇 A 股 MCP SSE 响应缺少 data');
  return JSON.parse(dataLine);
}

function unwrapMcpEnvelope(value: unknown): TFuyaoToolEnvelope {
  const json = asRecord(value);
  if (!json) throw new Error('扶摇 A 股 MCP 返回格式无效');
  const rpcError = asRecord(json.error);
  if (rpcError) throw new Error(text(rpcError, ['message']) || '扶摇 A 股 MCP 请求失败');

  const result = asRecord(json.result) ?? json;
  const structured = asRecord(result.structuredContent);
  if (structured) return validateEnvelope(structured);
  for (const item of records(result.content)) {
    const contentText = text(item, ['text']);
    if (contentText) return validateEnvelope(JSON.parse(contentText));
  }
  return validateEnvelope(result);
}

function validateEnvelope(value: unknown): TFuyaoToolEnvelope {
  const envelope = asRecord(value);
  if (!envelope) throw new Error('扶摇龙虎榜返回格式无效');
  const code = number(envelope, ['code']);
  if (code !== null && code !== 0) {
    const error = asRecord(envelope.error);
    throw new Error(text(error, ['message']) || text(envelope, ['message']) || '扶摇龙虎榜请求失败');
  }
  return {
    code: code ?? undefined,
    message: text(envelope, ['message']) || undefined,
    data: envelope.data,
    error: typeof envelope.error === 'string' ? envelope.error : asRecord(envelope.error),
  };
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    : [];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function text(row: Record<string, unknown> | undefined, keys: string[]): string {
  if (!row) return '';
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function number(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    if (value === undefined || value === null || value === '') continue;
    const parsed = typeof value === 'string' ? Number(value.replace(/[,，%]/g, '').trim()) : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function ratioPercent(row: Record<string, unknown>, keys: string[]): number | null {
  const value = number(row, keys);
  return value === null ? null : value * 100;
}

function conceptReason(row: Record<string, unknown>): string {
  return records(row.concept_list)
    .map((concept) => text(concept, ['name']))
    .filter(Boolean)
    .join('、');
}

function normalizeStockCode(value: string): string {
  return value
    .replace(/^(sh|sz|bj)/i, '')
    .replace(/\.(SH|SZ|BJ)$/i, '')
    .replace(/^\D+/, '');
}

function normalizeTradeDate(value: string): string | undefined {
  const compact = value.replace(/\D/g, '').slice(0, 8);
  if (compact.length !== 8) return undefined;
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

function stableTextKey(value: string): string {
  return value.replace(/\s+/g, '').slice(0, 24) || 'unknown';
}

function caseInsensitiveText(row: Record<string, unknown> | undefined, key: string): string {
  if (!row) return '';
  const matchedKey = Object.keys(row).find((item) => item.toLowerCase() === key.toLowerCase());
  return matchedKey ? text(row, [matchedKey]) : '';
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return '';
  return typeof error.code === 'string' ? error.code : '';
}

function resolveMcpConfigPaths(options: TMcpConfigPathOptions): string[] {
  const paths = [
    options.explicitPath,
    resolve(options.cwd, '.mcp.json'),
    process.resourcesPath ? resolve(process.resourcesPath, '.mcp.json') : undefined,
  ].filter((item): item is string => Boolean(item));
  return [...new Set(paths)];
}

function missingApiKeyError(configPaths: string[] = []): Error {
  const checked = configPaths.length ? `已检查：${configPaths.join('、')}。` : '';
  return new Error(
    `缺少扶摇 A 股 MCP API Key，请配置环境变量 FUYAO_A_SHARE_API_KEY，或在 .mcp.json 的 fuyao-a-share.headers.X-api-key 中配置。${checked}`,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pruneExpiredCache(now: number): void {
  for (const [key, cached] of responseCache) {
    if (cached.expiresAt <= now) responseCache.delete(key);
  }
}
