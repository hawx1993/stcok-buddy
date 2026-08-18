import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { generateReport } from '../llm/index.js';
import type { IStoreCommandInput, IStoreCommandResult } from './types.js';

const MAX_CONTENT = 12_000;
const USER_AGENT = 'StockBuddy/0.2 URL Reader';

type TPageMethod = 'crawl4ai' | 'direct' | 'github-readme' | 'github-readme-jsdelivr';

interface IWebPage {
  url: string;
  content: string;
  method: TPageMethod;
  title?: string;
  translated?: boolean;
  translationError?: string;
}

interface IPageSummary {
  core: string[];
  value: string[];
}

export async function runWebPageSummaryCommand({ args, llm }: IStoreCommandInput): Promise<IStoreCommandResult> {
  const url = normalizeHttpUrl(args);
  if (!url) return usage();

  let page: IWebPage;
  try {
    page = isGithubRepoUrl(url)
      ? await readGithubReadme(url)
          .catch(() => readWithCrawl4Ai(url))
          .catch(() => readDirectUrl(url))
      : await readWithCrawl4Ai(url).catch(() => readDirectUrl(url));
  } catch (error) {
    return errorResponse(`网页读取失败：${toErrorMessage(error)}`);
  }

  const translated = await translatePageIfNeeded(page, llm);
  return toResponse(translated);
}

async function readWithCrawl4Ai(url: string): Promise<IWebPage> {
  const raw = await runCrawl4Ai(url);
  const content = truncateText(cleanMarkdownText(raw));
  if (!content) throw new Error('Crawl4AI 未返回正文');
  return { url, title: extractMarkdownTitle(raw), content, method: 'crawl4ai' };
}

function runCrawl4Ai(url: string): Promise<string> {
  const python = existsSync(join(process.cwd(), '.venv/bin/python'))
    ? join(process.cwd(), '.venv/bin/python')
    : 'python3';
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
  return new Promise((resolve, reject) => {
    execFile(python, ['-c', script, url], { timeout: 45_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || error.message).trim()));
        return;
      }
      try {
        const parsed: unknown = JSON.parse(stdout);
        resolve(isRecord(parsed) && typeof parsed.content === 'string' ? parsed.content : stdout);
      } catch {
        resolve(stdout);
      }
    });
  });
}

async function readGithubReadme(url: string): Promise<IWebPage> {
  const parsed = new URL(url);
  const match = parsed.hostname === 'github.com' ? parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/) : undefined;
  if (!match) throw new Error('该 URL 不是 GitHub 仓库首页，无法使用 README 读取器');
  const [, owner, repo] = match;
  const repoName = repo.replace(/\.git$/, '');
  const candidates = ['main', 'master'].flatMap((branch) => [
    `https://cdndelivr.net/gh/${owner}/${repoName}@${branch}/README.md`,
    `https://cdndelivr.net/gh/${owner}/${repoName}@${branch}/readme.md`,
    `https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/README.md`,
    `https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/readme.md`,
  ]);

  for (const rawUrl of candidates) {
    try {
      const raw = await curlText(rawUrl);
      const content = truncateText(cleanMarkdownText(raw));
      if (content) {
        return {
          url,
          title: extractMarkdownTitle(raw) ?? `${owner}/${repoName}`,
          content,
          method: rawUrl.includes('jsdelivr') ? 'github-readme-jsdelivr' : 'github-readme',
        };
      }
    } catch {
      continue;
    }
  }
  throw new Error('GitHub README 未返回正文');
}

async function readDirectUrl(url: string): Promise<IWebPage> {
  const response = await fetchWithTimeout(url);
  const text = await response.text();
  const isHtml = /html/i.test(response.headers.get('content-type') ?? '') || /<html|<!doctype html/i.test(text);
  return isHtml
    ? { url, ...cleanHtml(text), method: 'direct' }
    : { url, content: truncateText(text), method: 'direct' };
}

function toResponse(page: IWebPage): IStoreCommandResult {
  const bullets = summarize(page.content);
  const translatedNote = page.translated ? '；非中文网页已先翻译为中文' : '';
  const content = [
    '# 网页内容总结',
    '',
    '## 📰 核心事件',
    `- 📄 ${stripMarkdown(page.title ?? page.url).slice(0, 120)}`,
    ...bullets.core.map((item) => `- ${item}`),
    '',
    '## ✅ 利好因素',
    bullets.value.length
      ? bullets.value.map((item) => `- ${item}`).join('\n')
      : '- 当前页面信息密度有限，建议结合原文上下文判断。',
    '',
    '## ⚠️ 利空因素',
    `- ⚡ 内容由 ${methodLabel(page.method)} 提取；网页可能存在登录墙、动态渲染或反爬导致正文缺失。`,
    ...(page.translationError ? [`- ⚡ 检测到非中文内容，但翻译失败：${page.translationError}`] : []),
    '',
    '## 🎯 综合结论',
    `🟡 中性：该网页主要围绕“${stripMarkdown(page.title ?? page.url)}”展开，上述摘要仅基于可提取正文${translatedNote}。`,
  ].join('\n');
  return {
    content,
    result: {
      title: '网页内容总结',
      subtitle: page.title ?? page.url,
      metrics: [
        { label: '提取方式', value: methodLabel(page.method) },
        { label: '正文长度', value: `${page.content.length}字` },
        ...(page.translated ? [{ label: '翻译', value: '已转中文' }] : []),
      ],
      rows: bullets.core.map((item, index) => ({ 序号: index + 1, 要点: item })),
      narrative: content,
    },
    events: [
      {
        type: 'step_completed',
        step: {
          id: 'store-command',
          agent: 'Crawl4AI',
          description: `执行内置命令：网页内容总结 ${page.url}`,
          status: 'completed',
        },
      },
    ],
  };
}

function summarize(content: string): IPageSummary {
  const items = content
    .split(/\n+|[。！？]+/)
    .map((item) =>
      stripMarkdown(item)
        .replace(/^\|.*\|$/, '')
        .trim(),
    )
    .filter((item) => item.length >= 18 && !item.startsWith('|') && !/^[-:|\s]+$/.test(item));
  const score = (text: string) =>
    (/(功能|产品|数据|结论|风险|优势|问题|原因|影响|适用|价格|成本|增长|下降|发布|更新|新增|修复|支持)/.test(text)
      ? 2
      : 0) + Math.min(text.length / 80, 2);
  const picked = [...items]
    .sort((left, right) => score(right) - score(left))
    .slice(0, 8)
    .map((item) => item.slice(0, 180));
  return { core: picked.slice(0, 4), value: picked.slice(4, 8) };
}

async function translatePageIfNeeded(page: IWebPage, llm?: { generate: typeof generateReport }): Promise<IWebPage> {
  if (isMostlyChinese(page.content)) return page;
  if (!llm) return { ...page, translationError: '未配置模型 API Key，无法自动翻译。' };
  try {
    const translated = await llm.generate([
      {
        role: 'system',
        content:
          '你是专业中文翻译。把用户提供的网页正文翻译成简体中文，保留关键信息、数字、日期、专有名词和 Markdown 列表结构。只输出译文，不要解释。',
      },
      { role: 'user', content: page.content.slice(0, MAX_CONTENT) },
    ]);
    const content = truncateText(cleanMarkdownText(translated));
    return content ? { ...page, content, translated: true } : page;
  } catch (error) {
    return { ...page, translationError: toErrorMessage(error) };
  }
}

function isMostlyChinese(text: string): boolean {
  const sample = text.slice(0, 4_000);
  const chinese = (sample.match(/[一-鿿]/g) ?? []).length;
  const letters = (sample.match(/[A-Za-z]/g) ?? []).length;
  return chinese > 80 || chinese / Math.max(chinese + letters, 1) > 0.25;
}

function usage(): IStoreCommandResult {
  const content = '请输入网页 URL，例如：/网页内容总结 https://nextjs.org/docs';
  return { content, events: [{ type: 'final_answer', message: content }] };
}

function curlText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'curl',
      ['-L', '--max-time', '20', url],
      { timeout: 25_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) reject(new Error((stderr || error.message).trim()));
        else resolve(stdout);
      },
    );
  });
}

function isGithubRepoUrl(url: string): boolean {
  return new URL(url).hostname === 'github.com';
}

function normalizeHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set('User-Agent', USER_AGENT);
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000), headers });
  if (!response.ok) throw new Error(`URL 请求失败：${response.status} ${response.statusText}`);
  return response;
}

function errorResponse(content: string): IStoreCommandResult {
  return { content, events: [{ type: 'final_answer', message: content }] };
}

function extractMarkdownTitle(content: string): string | undefined {
  return (content.match(/^Title:\s*(.+)$/m)?.[1] ?? content.match(/^#\s+(.+)$/m)?.[1])?.trim();
}

function methodLabel(method: TPageMethod): string {
  return {
    crawl4ai: 'Crawl4AI',
    direct: '直接请求',
    'github-readme': 'GitHub README',
    'github-readme-jsdelivr': 'GitHub README',
  }[method];
}

function cleanHtml(html: string): Pick<IWebPage, 'title' | 'content'> {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
  const content = decodeEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  );
  return { title, content: truncateText(content) };
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ');
}

function cleanMarkdownText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^>+\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\*\*|__/g, '');
}

function stripMarkdown(text: string): string {
  return cleanMarkdownText(text).replace(/\s+/g, ' ').trim();
}

function truncateText(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CONTENT);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
