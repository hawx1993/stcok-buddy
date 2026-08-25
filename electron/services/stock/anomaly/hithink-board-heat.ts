import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import type { BoardConstituent, IBoardHeatSnapshot, MarketBoardRow } from '../../../../src/shared/types.js';

const execFile = promisify(execFileCallback);
const CACHE_TTL_MS = 15_000;
const SNAPSHOT_BATCH_SIZE = 100;
const MCP_TIMEOUT_MS = 25_000;
const DEFAULT_FUYAO_INDEX_MCP_URL = 'https://fuyao.aicubes.cn/mcp/a-share-index';

let cached: { expiresAt: number; value: IBoardHeatSnapshot } | undefined;
let rpcId = 0;

type TBoardKind = 'industry' | 'concept';
type TCatalogTag = 'industry' | 'cn_concept';

type TToolName =
  | 'get_a_share_index_catalog_ths_index_list'
  | 'get_a_share_index_prices_snapshot'
  | 'get_a_share_index_constituents_ths_stock_list';

interface IFuyaoToolEnvelope {
  code?: number;
  message?: string;
  data?: unknown;
  error?: { message?: string } | string;
}

interface IBoardCatalogItem {
  code: string;
  name: string;
  boardKind: TBoardKind;
}

/** Loads THS industry/concept index catalogues and live quotes from Fuyao's Tonghuashun index data source. */
export async function getHithinkBoardHeatSnapshot(): Promise<IBoardHeatSnapshot> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const [industries, concepts] = await Promise.all([loadCatalog('industry'), loadCatalog('cn_concept')]);
  const boards = await loadSnapshots([...industries, ...concepts]);
  const value: IBoardHeatSnapshot = {
    updatedAt: new Date().toISOString(),
    source: 'fuyao-a-share-index',
    boards,
  };
  cached = { expiresAt: Date.now() + CACHE_TTL_MS, value };
  return value;
}

async function loadCatalog(tag: TCatalogTag): Promise<IBoardCatalogItem[]> {
  const envelope = await runFuyaoIndexTool('get_a_share_index_catalog_ths_index_list', { tag });
  return toBoardCatalogItems(extractRecords(envelope.data), tag);
}

async function loadSnapshots(catalog: IBoardCatalogItem[]): Promise<MarketBoardRow[]> {
  if (!catalog.length) return [];

  const quotes = new Map<string, Record<string, unknown>>();
  for (let start = 0; start < catalog.length; start += SNAPSHOT_BATCH_SIZE) {
    const codes = catalog.slice(start, start + SNAPSHOT_BATCH_SIZE).map((item) => item.code);
    const envelope = await runFuyaoIndexTool('get_a_share_index_prices_snapshot', { thscodes: codes.join(',') });
    for (const row of extractRecords(envelope.data)) {
      const code = text(row, ['thscode', 'ths_code', 'index_code', 'code']);
      if (code) quotes.set(code, row);
    }
  }

  if (!quotes.size) throw new Error('同花顺板块快照为空');
  return toMarketBoardRows(catalog, quotes);
}

export function toBoardCatalogItems(rows: Array<Record<string, unknown>>, tag: TCatalogTag): IBoardCatalogItem[] {
  const boardKind: TBoardKind = tag === 'industry' ? 'industry' : 'concept';
  return rows
    .map((row) => ({
      code: text(row, ['thscode', 'ths_code', 'index_code', 'code']),
      name: text(row, ['name', 'ths_name', 'index_name']),
      boardKind,
    }))
    .filter((row): row is IBoardCatalogItem => Boolean(row.code && row.name))
    .filter((row) => row.boardKind !== 'industry' || isPrimaryIndustryCode(row.code));
}

export function toMarketBoardRows(
  catalog: IBoardCatalogItem[],
  quotes: Map<string, Record<string, unknown>>,
): MarketBoardRow[] {
  return catalog
    .map((item): MarketBoardRow | undefined => {
      const row = quotes.get(item.code);
      if (!row) return undefined;
      return {
        code: item.code,
        name: text(row, ['name', 'ths_name', 'index_name']) || item.name,
        boardKind: item.boardKind,
        price: number(row, ['last_price', 'latest', 'price', 'close']),
        changePercent: number(row, ['price_change_ratio_pct', 'change_ratio', 'change_percent', 'pct_chg', 'changePercent']),
        amount: number(row, ['turnover', 'amount', 'trade_amount']),
        volume: number(row, ['volume', 'vol', 'trade_volume']),
        minutes: [],
      };
    })
    .filter((row): row is MarketBoardRow => Boolean(row))
    .sort(compareBoardActivity);
}

export async function getHithinkBoardConstituents(thscode: string): Promise<BoardConstituent[]> {
  const normalized = thscode.trim().toUpperCase();
  if (!/^\d{6}\.TI$/.test(normalized)) return [];
  const envelope = await runFuyaoIndexTool('get_a_share_index_constituents_ths_stock_list', { thscode: normalized });
  return toBoardConstituentRows(extractRecords(envelope.data));
}

export function toBoardConstituentRows(rows: Array<Record<string, unknown>>): BoardConstituent[] {
  return rows
    .map((row) => {
      const code = normalizeStockCode(text(row, ['ticker', 'thscode', 'ths_code', 'code']));
      const name = text(row, ['name', 'stock_name', 'ths_name']);
      return code && name ? { code, name } : undefined;
    })
    .filter((row): row is BoardConstituent => Boolean(row));
}

async function runFuyaoIndexTool(name: TToolName, args: Record<string, string>): Promise<IFuyaoToolEnvelope> {
  const apiKey = process.env.FUYAO_A_SHARE_INDEX_API_KEY ?? process.env.FUYAO_API_KEY ?? process.env.HITHINK_FINANCE_API_KEY;
  if (apiKey) return runFuyaoMcpTool(name, args, apiKey);
  return runHithinkFinanceCli(name, args);
}

async function runFuyaoMcpTool(
  name: TToolName,
  args: Record<string, string>,
  apiKey: string,
): Promise<IFuyaoToolEnvelope> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS);
  try {
    const response = await fetch(process.env.FUYAO_A_SHARE_INDEX_MCP_URL ?? DEFAULT_FUYAO_INDEX_MCP_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2025-06-18',
        'X-api-key': apiKey,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: String(++rpcId),
        method: 'tools/call',
        params: { name, arguments: args },
      }),
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Fuyao MCP HTTP ${response.status}: ${body.slice(0, 200)}`);
    return unwrapMcpToolEnvelope(parseMcpBody(body));
  } finally {
    clearTimeout(timeout);
  }
}

async function runHithinkFinanceCli(name: TToolName, args: Record<string, string>): Promise<IFuyaoToolEnvelope> {
  const cliArgs = toCliArgs(name, args);
  const { stdout } = await execFile('hithink-finance', cliArgs, { maxBuffer: 20 * 1024 * 1024, timeout: MCP_TIMEOUT_MS });
  return validateEnvelope(JSON.parse(stdout) as IFuyaoToolEnvelope);
}

function toCliArgs(name: TToolName, args: Record<string, string>): string[] {
  if (name === 'get_a_share_index_catalog_ths_index_list') return ['index', 'catalog', '--tag', args.tag, '--format', 'json'];
  if (name === 'get_a_share_index_constituents_ths_stock_list')
    return ['index', 'constituents', '--thscode', args.thscode];
  return ['index', 'snapshot', '--thscodes', args.thscodes, '--format', 'json'];
}

function parseMcpBody(body: string): unknown {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Fuyao MCP 返回空响应');
  if (!trimmed.startsWith('event:') && !trimmed.startsWith('data:')) return JSON.parse(trimmed);

  const dataLine = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .find((line) => line && line !== '[DONE]');
  if (!dataLine) throw new Error('Fuyao MCP SSE 响应缺少 data');
  return JSON.parse(dataLine);
}

function unwrapMcpToolEnvelope(value: unknown): IFuyaoToolEnvelope {
  const json = asRecord(value);
  if (!json) throw new Error('Fuyao MCP 返回格式无效');

  const error = asRecord(json.error);
  if (error) throw new Error(text(error, ['message']) || 'Fuyao MCP 请求失败');

  const result = asRecord(json.result) ?? json;
  const structured = asRecord(result.structuredContent);
  if (structured) return validateEnvelope(structured);

  const content = Array.isArray(result.content) ? result.content : [];
  for (const item of content) {
    const record = asRecord(item);
    const itemText = record ? text(record, ['text']) : '';
    if (!itemText) continue;
    return validateEnvelope(JSON.parse(itemText) as IFuyaoToolEnvelope);
  }

  return validateEnvelope(result);
}

function validateEnvelope(envelope: IFuyaoToolEnvelope): IFuyaoToolEnvelope {
  if (envelope.code !== undefined && envelope.code !== 0) {
    const message = typeof envelope.error === 'string' ? envelope.error : envelope.error?.message;
    throw new Error(message ?? envelope.message ?? '同花顺板块数据服务请求失败');
  }
  return envelope;
}

export function extractRecords(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
  const object = asRecord(value);
  if (!object) return [];
  for (const key of ['item', 'items', 'list', 'rows', 'data']) {
    if (key in object) return extractRecords(object[key]);
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function normalizeStockCode(value: string) {
  return value
    .replace(/^(sh|sz|bj)/i, '')
    .replace(/\.(SH|SZ|BJ)$/i, '')
    .replace(/^\D+/, '');
}

function isPrimaryIndustryCode(code: string) {
  return /^881\d{3}\.TI$/.test(code);
}

function compareBoardActivity(left: MarketBoardRow, right: MarketBoardRow) {
  return (
    compareDesc(toMarketNumber(left.changePercent), toMarketNumber(right.changePercent)) ||
    compareDesc(toMarketNumber(left.amount), toMarketNumber(right.amount)) ||
    compareDesc(toMarketNumber(left.volume), toMarketNumber(right.volume))
  );
}

function compareDesc(left: number | undefined, right: number | undefined) {
  return (right ?? -Infinity) - (left ?? -Infinity);
}

function toMarketNumber(value: number | string | undefined) {
  if (value === undefined) return undefined;
  const parsed = typeof value === 'string' ? Number(value.replace(/[,，%]/g, '').trim()) : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function text(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function number(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    const parsed = typeof value === 'string' ? Number(value.replace(/[,，%]/g, '').trim()) : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}
