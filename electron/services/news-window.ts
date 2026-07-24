import { BrowserWindow } from 'electron';
import type { MarketNewsItem, ThemeMode } from '../../src/shared/types.js';

let newsWindow: BrowserWindow | undefined;

export function openMarketNewsWindow(item: MarketNewsItem, theme: ThemeMode) {
  if (newsWindow?.isDestroyed()) newsWindow = undefined;
  if (!newsWindow) {
    newsWindow = new BrowserWindow({
      width: 760,
      height: 680,
      minWidth: 560,
      minHeight: 480,
      title: '新闻详情',
      backgroundColor: theme === 'light' ? '#F7F9FC' : '#0B1426',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    newsWindow.on('closed', () => {
      newsWindow = undefined;
    });
  }
  newsWindow.setTitle(item.title);
  void newsWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderNewsDocument(item, theme))}`);
  newsWindow.show();
  newsWindow.focus();
}

function renderNewsDocument(item: MarketNewsItem, theme: ThemeMode) {
  const content = item.content?.trim() || '当前数据源仅提供新闻标题和摘要，暂无可展示的原文正文。';
  const source = item.source ? ` · ${item.source}` : '';
  const paragraphs = content.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const article = paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('');
  const palette = theme === 'light'
    ? { background: '#f7f9fc', foreground: '#172033', muted: '#64748b', border: '#dbe3ef', content: '#334155', accent: '#2563eb' }
    : { background: '#0b1426', foreground: '#e5edf9', muted: '#93a4be', border: '#253552', content: '#d2dcea', accent: '#8fb5f6' };
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(item.title)}</title><style>body{margin:0;background:${palette.background};color:${palette.foreground};font:16px/1.9 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}main{max-width:680px;margin:0 auto;padding:38px 28px 52px}h1{font-size:24px;line-height:1.4;margin:0 0 12px}.meta{color:${palette.muted};font-size:13px;border-bottom:1px solid ${palette.border};padding-bottom:16px;margin-bottom:24px}.content{color:${palette.content};word-break:break-word}.content p{margin:0 0 1.15em;text-indent:2em}.tags{margin-top:28px;padding-top:14px;border-top:1px solid ${palette.border};color:${palette.accent};font-size:13px}</style></head><body><main><h1>${escapeHtml(item.title)}</h1><div class="meta">${escapeHtml(item.time)}${escapeHtml(source)}</div><article class="content">${article}</article><div class="tags">${item.tags.map(escapeHtml).join(' · ')}</div></main></body></html>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char] ?? char);
}
