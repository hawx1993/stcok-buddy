import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentTool } from './types.js';

const MAX_CONTENT = 12000;
const TIMEOUT_MS = 15000;

export interface ReadUrlInput {
  url: string;
}

export interface ReadUrlOutput {
  url: string;
  title?: string;
  content: string;
  method?: 'firecrawl' | 'github-readme' | 'crawl4ai' | 'direct';
}

export const readUrl: AgentTool<ReadUrlInput, ReadUrlOutput> = {
  name: 'readUrl',
  description: '读取 URL 内容并提取标题与正文',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string' },
    },
    required: ['url'],
  },
  async run(input) {
    const url = normalizeHttpUrl(input.url);
    const errors: string[] = [];

    for (const reader of [readWithFirecrawl, readGithubReadme, readWithCrawl4AI, readDirectUrl]) {
      try {
        const result = await reader(url);
        if (result.content) return result;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    throw new Error(`URL 读取失败：${errors.filter(Boolean).slice(0, 3).join('；') || '未获取到正文'}`);
  },
};

async function readWithFirecrawl(url: string): Promise<ReadUrlOutput> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error('Firecrawl 未配置 FIRECRAWL_API_KEY');

  const response = await fetchWithTimeout('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url, formats: ['markdown'] }),
  });
  const data = await response.json() as { data?: { markdown?: string; title?: string; metadata?: { title?: string } }; markdown?: string; title?: string };
  const content = truncateText(data.data?.markdown ?? data.markdown ?? '');
  if (!content) throw new Error('Firecrawl 未返回正文');
  return { url, title: data.data?.metadata?.title ?? data.data?.title ?? data.title ?? extractMarkdownTitle(content), content, method: 'firecrawl' };
}

async function readGithubReadme(url: string): Promise<ReadUrlOutput> {
  const parsed = new URL(url);
  const match = parsed.hostname === 'github.com' ? parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/) : undefined;
  if (!match) throw new Error('不是 GitHub 仓库首页');

  const [, owner, repo] = match;
  const repoName = repo.replace(/\.git$/, '');
  const candidates = ['main', 'master'].flatMap((branch) => [
    `https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/README.md`,
    `https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/readme.md`,
  ]);

  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      const response = await fetchWithTimeout(candidate);
      const content = truncateText(await response.text());
      if (content) return { url, title: extractMarkdownTitle(content) ?? `${owner}/${repoName}`, content, method: 'github-readme' };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`GitHub README 读取失败：${errors[0] ?? '未找到 README'}`);
}

async function readWithCrawl4AI(url: string): Promise<ReadUrlOutput> {
  const content = truncateText(await runCrawl4AI(url));
  if (!content) throw new Error('Crawl4AI 未返回正文');
  return { url, title: extractMarkdownTitle(content), content, method: 'crawl4ai' };
}

function runCrawl4AI(url: string) {
  const python = existsSync(join(process.cwd(), '.venv/bin/python')) ? join(process.cwd(), '.venv/bin/python') : 'python3';
  const script = `
import asyncio, json, sys
from crawl4ai import AsyncWebCrawler

async def main():
    async with AsyncWebCrawler() as crawler:
        result = await crawler.arun(url=sys.argv[1])
        text = getattr(result, 'markdown', '') or getattr(result, 'cleaned_html', '') or ''
        if hasattr(text, 'raw_markdown'):
            text = text.raw_markdown
        print(json.dumps({'content': str(text)}, ensure_ascii=False))

asyncio.run(main())
`;
  return new Promise<string>((resolve, reject) => {
    execFile(python, ['-c', script, url], { timeout: 45_000, maxBuffer: 1024 * 1024 * 8 }, (error, stdout, stderr) => {
      if (error) return reject(new Error((stderr || error.message).trim()));
      try {
        resolve((JSON.parse(stdout) as { content?: string }).content ?? '');
      } catch {
        resolve(stdout);
      }
    });
  });
}

async function readDirectUrl(url: string): Promise<ReadUrlOutput> {
  const response = await fetchWithTimeout(url);
  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();
  if (/html/i.test(contentType) || /<html|<!doctype html/i.test(text)) {
    return { url, ...cleanHtml(text), method: 'direct' };
  }
  return { url, content: truncateText(text), method: 'direct' };
}

export function cleanHtml(html: string) {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
  const content = decodeEntities(html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' '));
  return { title, content: truncateText(content) };
}

function normalizeHttpUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https URLs are supported');
  return url.toString();
}

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent': 'StockBuddy/0.2 URL Reader',
        ...init?.headers,
      },
    });
    if (!response.ok) throw new Error(`URL fetch failed: ${response.status} ${response.statusText}`);
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('URL fetch timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function extractMarkdownTitle(content: string) {
  const title = content.match(/^Title:\s*(.+)$/m)?.[1] ?? content.match(/^#\s+(.+)$/m)?.[1];
  return title?.trim();
}

function decodeEntities(text: string) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ');
}

function truncateText(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_CONTENT);
}
