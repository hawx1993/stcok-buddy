import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const MAX_CONTENT = 12000;
const UA = 'StockBuddy/0.2 URL Reader';

export async function run({ args, llm }) {
  const url = normalizeHttpUrl(args);
  if (!url) return usage();
  const page = await (isGithubRepoUrl(url)
    ? readGithubReadme(url).catch(() => readWithCrawl4AI(url)).catch(() => readDirectUrl(url))
    : readWithCrawl4AI(url).catch(() => readDirectUrl(url)))
    .catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
  if (page.error) return errorResponse(`网页读取失败：${page.error}`);
  const translated = await translatePageIfNeeded(page, llm);
  return toResponse(translated);
}

async function readWithCrawl4AI(url) {
  const raw = await runCrawl4AI(url);
  const content = truncateText(cleanMarkdownText(raw));
  if (!content) throw new Error('Crawl4AI 未返回正文');
  return { url, title: extractMarkdownTitle(raw), content, method: 'crawl4ai' };
}

function runCrawl4AI(url) {
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
  return new Promise((resolve, reject) => {
    execFile(python, ['-c', script, url], { timeout: 45_000, maxBuffer: 1024 * 1024 * 8 }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim()));
      else {
        try { resolve(JSON.parse(stdout).content || ''); }
        catch { resolve(stdout); }
      }
    });
  });
}

async function readGithubReadme(url) {
  const parsed = new URL(url);
  const match = parsed.hostname === 'github.com' ? parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/) : undefined;
  if (!match) throw new Error('该 URL 不是 GitHub 仓库首页，无法使用 README 兜底');
  const [, owner, repo] = match;
  const repoName = repo.replace(/\.git$/, '');
  const candidates = ['main', 'master'].flatMap((branch) => [
    `https://cdn.jsdelivr.net/gh/${owner}/${repoName}@${branch}/README.md`,
    `https://cdn.jsdelivr.net/gh/${owner}/${repoName}@${branch}/readme.md`,
    `https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/README.md`,
    `https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/readme.md`,
  ]);
  for (const rawUrl of candidates) {
    try {
      const raw = await curlText(rawUrl);
      const content = truncateText(cleanMarkdownText(raw));
      if (content) return { url, title: extractMarkdownTitle(raw) ?? `${owner}/${repoName}`, content, method: rawUrl.includes('jsdelivr') ? 'github-readme-jsdelivr' : 'github-readme' };
    } catch {
      // try next CDN/raw candidate
    }
  }
  throw new Error('GitHub README 兜底未读取到内容');
}

async function readDirectUrl(url) {
  const response = await fetchWithTimeout(url);
  const text = await response.text();
  const html = /html/i.test(response.headers.get('content-type') ?? '') || /<html|<!doctype html/i.test(text);
  return html ? { url, ...cleanHtml(text), method: 'direct' } : { url, content: truncateText(text), method: 'direct' };
}

function toResponse(page) {
  const bullets = summarize(page.content);
  const translatedNote = page.translated ? '；非中文网页已先翻译为中文' : '';
  const content = [
    `# 网页内容总结`,
    '',
    '## 📰 核心内容',
    `- 📄 ${stripMarkdown(page.title ?? page.url).slice(0, 120)}`,
    ...bullets.core.map((item) => `- ${item}`),
    '',
    '## ✅ 有价值的信息',
    bullets.value.length ? bullets.value.map((item) => `- ${item}`).join('\n') : '- 当前页面信息密度有限，建议结合原文上下文判断。',
    '',
    '## ⚠️ 限制与风险',
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
    },
    events: [{ type: 'step_completed', step: { id: 'store-command', agent: 'Crawl4AI', description: `执行插件命令：网页内容总结 ${page.url}`, status: 'completed' } }],
  };
}

function summarize(content) {
  const items = content
    .split(/\n+|[。！？]+/)
    .map((item) => stripMarkdown(item).replace(/^\|.*\|$/, '').trim())
    .filter((item) => item.length >= 18 && !item.startsWith('|') && !/^[-:|\s]+$/.test(item));
  const score = (text) => (/(功能|产品|数据|结论|风险|优势|问题|原因|影响|适用|价格|成本|增长|下降|发布|更新|新增|修复|支持)/.test(text) ? 2 : 0) + Math.min(text.length / 80, 2);
  const picked = [...items].sort((a, b) => score(b) - score(a)).slice(0, 8).map((item) => item.slice(0, 180));
  return { core: picked.slice(0, 4), value: picked.slice(4, 8) };
}

async function translatePageIfNeeded(page, llm) {
  if (isMostlyChinese(page.content)) return page;
  if (!llm?.generate) return { ...page, translationError: '未配置模型 API Key，无法自动翻译。' };
  try {
    const translated = await llm.generate([
      { role: 'system', content: '你是专业中文翻译。把用户提供的网页正文翻译成简体中文，保留关键信息、数字、日期、专有名词和 Markdown 列表结构。只输出译文，不要解释。' },
      { role: 'user', content: page.content.slice(0, MAX_CONTENT) },
    ]);
    const content = truncateText(cleanMarkdownText(translated));
    return content ? { ...page, content, translated: true } : page;
  } catch (error) {
    return { ...page, translationError: error instanceof Error ? error.message : String(error) };
  }
}

function isMostlyChinese(text) {
  const sample = String(text || '').slice(0, 4000);
  const chinese = (sample.match(/[一-鿿]/g) || []).length;
  const letters = (sample.match(/[A-Za-z]/g) || []).length;
  return chinese > 80 || chinese / Math.max(chinese + letters, 1) > 0.25;
}

function usage() {
  const content = '请输入网页 URL，例如：/网页内容总结 https://nextjs.org/docs';
  return { content, events: [{ type: 'final_answer', message: content }] };
}

function curlText(url) {
  return new Promise((resolve, reject) => {
    execFile('curl', ['-L', '--max-time', '20', url], { timeout: 25_000, maxBuffer: 1024 * 1024 * 4 }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim()));
      else resolve(stdout);
    });
  });
}

function isGithubRepoUrl(url) {
  try {
    return new URL(url).hostname === 'github.com';
  } catch {
    return false;
  }
}

function normalizeHttpUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return (url.protocol === 'http:' || url.protocol === 'https:') ? url.toString() : '';
  } catch {
    return '';
  }
}

async function fetchWithTimeout(url, init) {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': UA, ...init?.headers } });
    if (!response.ok) throw new Error(`URL fetch failed: ${response.status} ${response.statusText}`);
    return response;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}

function errorResponse(content) {
  return { content, events: [{ type: 'final_answer', message: content }] };
}

function extractMarkdownTitle(content) {
  return (content.match(/^Title:\s*(.+)$/m)?.[1] ?? content.match(/^#\s+(.+)$/m)?.[1])?.trim();
}

function methodLabel(method) {
  return ({
    crawl4ai: 'Crawl4AI',
    direct: '直接请求',
    'github-readme': 'GitHub README',
    'github-readme-jsdelivr': 'GitHub README',
  })[method] ?? '网页读取器';
}

function cleanHtml(html) {
  const title = decodeEntities(String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
  const content = decodeEntities(String(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' '));
  return { title, content: truncateText(content) };
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ');
}

function cleanMarkdownText(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^>+\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\*\*|__/g, '');
}

function stripMarkdown(text) {
  return cleanMarkdownText(text).replace(/\s+/g, ' ').trim();
}

function truncateText(text) {
  return String(text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_CONTENT);
}
