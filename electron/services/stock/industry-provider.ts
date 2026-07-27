const SINA_INDUSTRY_NODES_URL =
  'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodes';
const SINA_INDUSTRY_ROWS_URL =
  'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData';

interface ISinaIndustryNode {
  name: string;
  code: string;
}

interface ISinaIndustryRow {
  code?: string;
}

type TSinaNodeValue = string | TSinaNodeValue[];

export async function loadSinaIndustryMap(): Promise<Map<string, string>> {
  const response = await fetch(SINA_INDUSTRY_NODES_URL, {
    signal: AbortSignal.timeout(10_000),
    headers: { 'User-Agent': 'Mozilla/5.0 StockBuddy/0.5' },
  });
  if (!response.ok) throw new Error(`新浪行业节点 HTTP ${response.status}`);
  const payload: TSinaNodeValue = await response.json();
  const nodes = findShenwanLevelTwoNodes(payload);
  if (!nodes.length) throw new Error('新浪申万二级行业节点为空');

  const map = new Map<string, string>();
  for (const batch of chunk(nodes, 8)) {
    const results = await Promise.allSettled(batch.map(loadSinaIndustryRows));
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      const node = batch[index];
      if (result.status !== 'fulfilled' || !node) continue;
      for (const row of result.value) {
        const code = row.code?.trim();
        if (code && !map.has(code)) map.set(code, node.name);
      }
    }
  }
  if (!map.size) throw new Error('新浪申万二级行业映射为空');
  return map;
}

export function findShenwanLevelTwoNodes(payload: TSinaNodeValue): ISinaIndustryNode[] {
  if (!Array.isArray(payload)) return [];
  if (payload[0] === '申万二级' && Array.isArray(payload[1])) {
    return payload[1]
      .map(parseNode)
      .filter((node): node is ISinaIndustryNode => node !== undefined);
  }
  for (const item of payload) {
    const nodes = findShenwanLevelTwoNodes(item);
    if (nodes.length) return nodes;
  }
  return [];
}

async function loadSinaIndustryRows(node: ISinaIndustryNode): Promise<ISinaIndustryRow[]> {
  const url = new URL(SINA_INDUSTRY_ROWS_URL);
  url.search = new URLSearchParams({
    page: '1',
    num: '500',
    sort: 'symbol',
    asc: '1',
    node: node.code,
    symbol: '',
    _s_r_a: 'page',
  }).toString();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      'User-Agent': 'Mozilla/5.0 StockBuddy/0.5',
      Referer: 'https://vip.stock.finance.sina.com.cn/mkt/',
    },
  });
  if (!response.ok) throw new Error(`新浪行业成分 HTTP ${response.status}`);
  const rows: ISinaIndustryRow[] = await response.json();
  return Array.isArray(rows) ? rows : [];
}

function parseNode(value: TSinaNodeValue): ISinaIndustryNode | undefined {
  if (!Array.isArray(value)) return undefined;
  const [name, , code] = value;
  return typeof name === 'string' && typeof code === 'string' && code.startsWith('sw2_') ? { name, code } : undefined;
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}
