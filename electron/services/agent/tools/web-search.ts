import type { AgentTool } from '../../tools/types.js';

const MAX_CONTENT = 4000;
const TIMEOUT_MS = 15000;

export interface WebSearchInput {
  query: string;
  maxResults?: number;
}

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOutput {
  query: string;
  results: WebSearchResultItem[];
  source: string;
  warnings: string[];
  isEmpty: boolean;
}

function buildTavilyUrl(query: string, maxResults: number, apiKey: string): { url: string; body: unknown } {
  return {
    url: 'https://api.tavily.com/search',
    body: { api_key: apiKey, query, max_results: maxResults, search_depth: 'basic' },
  };
}

function normalizeSerper(raw: unknown): WebSearchResultItem[] {
  const items = (raw as { organic?: Array<{ title?: string; link?: string; snippet?: string }> })?.organic ?? [];
  return items
    .map((item) => ({ title: item.title ?? '', url: item.link ?? '', snippet: item.snippet ?? '' }))
    .filter((item) => item.url);
}

function normalizeTavily(raw: unknown): WebSearchResultItem[] {
  const items = (raw as { results?: Array<{ title?: string; url?: string; content?: string }> })?.results ?? [];
  return items
    .map((item) => ({ title: item.title ?? '', url: item.url ?? '', snippet: item.content ?? '' }))
    .filter((item) => item.url);
}

/** 联网搜索：需配置 TAVILY_API_KEY 或 SERPER_API_KEY；未配置时返回数据缺口提示而非报错。 */
export const webSearch: AgentTool<WebSearchInput, WebSearchOutput> = {
  name: 'webSearch',
  description: '联网搜索题材/消息催化，返回相关链接与摘要',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' }, maxResults: { type: 'number' } },
    required: ['query'],
  },
  async run(input) {
    const query = String(input?.query ?? '').trim();
    const maxResults = Math.max(1, Math.min(10, Number(input?.maxResults) || 5));
    const warnings: string[] = [];
    if (!query) {
      return { query, results: [], source: 'none', warnings: ['搜索词为空'], isEmpty: true };
    }

    const tavilyKey = process.env.TAVILY_API_KEY;
    const serperKey = process.env.SERPER_API_KEY;
    if (!tavilyKey && !serperKey) {
      return {
        query,
        results: [],
        source: 'unconfigured',
        warnings: [
          '未配置联网搜索 API Key（TAVILY_API_KEY / SERPER_API_KEY），无法联网检索。可改用 getHotConcepts / getMarketReview 等本地数据，或让用户提供链接后用 readUrl 读取。',
        ],
        isEmpty: true,
      };
    }

    try {
      if (tavilyKey) {
        const { url, body } = buildTavilyUrl(query, maxResults, tavilyKey);
        const response = await fetchWithTimeout(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as unknown;
        const results = normalizeTavily(data);
        return {
          query,
          results: results.slice(0, maxResults),
          source: 'tavily',
          warnings,
          isEmpty: results.length === 0,
        };
      }
      const response = await fetchWithTimeout('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': serperKey as string, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: maxResults }),
      });
      const data = (await response.json()) as unknown;
      const results = normalizeSerper(data);
      return {
        query,
        results: results.slice(0, maxResults),
        source: 'serper',
        warnings,
        isEmpty: results.length === 0,
      };
    } catch (error) {
      warnings.push(`联网搜索失败：${error instanceof Error ? error.message : String(error)}`);
      return { query, results: [], source: 'error', warnings, isEmpty: true };
    }
  },
};

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { 'User-Agent': 'StockBuddy/0.2 WebSearch', ...init?.headers },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

void MAX_CONTENT;
