import { marked } from 'marked';
import type { StockDetail } from '../../../shared/types';

const standardDisclaimer = '以上内容基于公开数据自动生成，仅供研究参考，不构成投资建议。';
const disclaimerPatterns = [
  /以上内容基于(?:当前可用)?公开数据自动生成，仅供研究参考，不构成投资建议。/g,
  /以上内容基于当前可用公开数据自动生成，仅供研究参考，不构成投资建议。/g,
  /仅供研究参考，不构成投资建议。/g,
];

export const stockAliases: Array<[string, string]> = [
  ['贵州茅台', '600519'],
  ['茅台', '600519'],
  ['五粮液', '000858'],
  ['泸州老窖', '000568'],
  ['洋河股份', '002304'],
  ['招商银行', '600036'],
  ['招行', '600036'],
  ['宁德时代', '300750'],
  ['宁王', '300750'],
  ['比亚迪', '002594'],
  ['中信证券', '600030'],
  ['引力传媒', '603598'],
];

type TMsgTextIconName =
  | 'activity'
  | 'alert-triangle'
  | 'bank'
  | 'bar-chart'
  | 'bell'
  | 'calendar'
  | 'check-circle'
  | 'circle'
  | 'compass'
  | 'document'
  | 'globe'
  | 'handshake'
  | 'line-down'
  | 'line-up'
  | 'money'
  | 'package'
  | 'target'
  | 'thermometer'
  | 'x-circle';

type TMsgTextIconTone = 'accent' | 'danger' | 'down' | 'muted' | 'success' | 'up' | 'warning';

interface IEmojiIconDefinition {
  icon: TMsgTextIconName;
  label: string;
  tone?: TMsgTextIconTone;
}

const msgTextIconPaths: Record<TMsgTextIconName, string> = {
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />',
  'alert-triangle': '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><line x1="12" x2="12" y1="9" y2="13" /><line x1="12" x2="12.01" y1="17" y2="17" />',
  bank: '<path d="M3 10h18" /><path d="M5 10v9" /><path d="M9 10v9" /><path d="M15 10v9" /><path d="M19 10v9" /><path d="M2 19h20" /><path d="m12 3 9 5H3l9-5Z" />',
  'bar-chart': '<line x1="4" x2="4" y1="19" y2="10" /><line x1="10" x2="10" y1="19" y2="5" /><line x1="16" x2="16" y1="19" y2="13" /><line x1="22" x2="22" y1="19" y2="8" />',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" x2="16" y1="2" y2="6" /><line x1="8" x2="8" y1="2" y2="6" /><line x1="3" x2="21" y1="10" y2="10" />',
  'check-circle': '<path d="M22 11.1V12a10 10 0 1 1-5.9-9.1" /><polyline points="22 4 12 14.01 9 11.01" />',
  circle: '<circle cx="12" cy="12" r="9" />',
  compass: '<circle cx="12" cy="12" r="10" /><polygon points="16.2 7.8 14 14 7.8 16.2 10 10 16.2 7.8" />',
  document: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><polyline points="14 2 14 8 20 8" /><line x1="8" x2="16" y1="13" y2="13" /><line x1="8" x2="16" y1="17" y2="17" />',
  globe: '<circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />',
  handshake: '<path d="m11 17 2 2a2.8 2.8 0 0 0 4 0l3-3a2.8 2.8 0 0 0 0-4l-4.5-4.5a2 2 0 0 0-2.8 0L12 8.2" /><path d="m13 9-2.5-2.5a2 2 0 0 0-2.8 0L3.5 10.7a2.8 2.8 0 0 0 0 4L8 19" /><path d="m8 12 4 4" /><path d="m6 14 4 4" />',
  'line-down': '<polyline points="3 7 9 13 13 9 21 17" /><polyline points="21 11 21 17 15 17" />',
  'line-up': '<polyline points="3 17 9 11 13 15 21 7" /><polyline points="15 7 21 7 21 13" />',
  money: '<circle cx="12" cy="12" r="9" /><path d="M8 12h8" /><path d="M12 7v10" /><path d="M9 9.5c.7-1 5.3-1 6 0" /><path d="M9 14.5c.7 1 5.3 1 6 0" />',
  package: '<path d="m21 8-9-5-9 5 9 5 9-5Z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" />',
  target: '<circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />',
  thermometer: '<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0Z" /><path d="M12 9v7" />',
  'x-circle': '<circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" />',
};

const emojiIconDefinitions: Array<[string, IEmojiIconDefinition]> = [
  ['📰', { icon: 'document', label: '新闻', tone: 'accent' }],
  ['✅', { icon: 'check-circle', label: '利好', tone: 'success' }],
  ['⚠️', { icon: 'alert-triangle', label: '利空', tone: 'warning' }],
  ['⚠', { icon: 'alert-triangle', label: '利空', tone: 'warning' }],
  ['📈', { icon: 'line-up', label: '上涨', tone: 'up' }],
  ['🏛️', { icon: 'bank', label: '中长期', tone: 'accent' }],
  ['🏛', { icon: 'bank', label: '中长期', tone: 'accent' }],
  ['🚨', { icon: 'alert-triangle', label: '风险提示', tone: 'danger' }],
  ['🎯', { icon: 'target', label: '结论', tone: 'accent' }],
  ['💰', { icon: 'money', label: '资金', tone: 'success' }],
  ['📉', { icon: 'line-down', label: '下跌', tone: 'down' }],
  ['🏢', { icon: 'bank', label: '公司治理', tone: 'accent' }],
  ['🤝', { icon: 'handshake', label: '合作', tone: 'accent' }],
  ['🌐', { icon: 'globe', label: '行业景气', tone: 'accent' }],
  ['🚀', { icon: 'line-up', label: '业绩增长', tone: 'up' }],
  ['❌', { icon: 'x-circle', label: '亏损', tone: 'danger' }],
  ['⚡', { icon: 'activity', label: '风险', tone: 'warning' }],
  ['📜', { icon: 'document', label: '政策', tone: 'accent' }],
  ['📄', { icon: 'document', label: '公告', tone: 'accent' }],
  ['📅', { icon: 'calendar', label: '时间周期', tone: 'accent' }],
  ['🗓️', { icon: 'calendar', label: '长期展望', tone: 'accent' }],
  ['🗓', { icon: 'calendar', label: '长期展望', tone: 'accent' }],
  ['🟢', { icon: 'circle', label: '偏利好', tone: 'success' }],
  ['🟡', { icon: 'circle', label: '中性', tone: 'warning' }],
  ['🔴', { icon: 'circle', label: '偏利空', tone: 'danger' }],
  ['📊', { icon: 'bar-chart', label: '数据分析', tone: 'accent' }],
  ['🧩', { icon: 'package', label: '筹码', tone: 'accent' }],
  ['📐', { icon: 'target', label: '关键价位', tone: 'accent' }],
  ['🧭', { icon: 'compass', label: '观察框架', tone: 'muted' }],
  ['🌡️', { icon: 'thermometer', label: '热度', tone: 'warning' }],
  ['🌡', { icon: 'thermometer', label: '热度', tone: 'warning' }],
  ['💎', { icon: 'target', label: '优质', tone: 'accent' }],
  ['🌙', { icon: 'calendar', label: '长期', tone: 'accent' }],
  ['🤑', { icon: 'money', label: '收益', tone: 'success' }],
  ['🎉', { icon: 'bell', label: '提示', tone: 'accent' }],
  ['💵', { icon: 'money', label: '大单资金', tone: 'success' }],
  ['🐉', { icon: 'bar-chart', label: '龙虎榜', tone: 'accent' }],
  ['🤖', { icon: 'activity', label: 'AI 信号', tone: 'accent' }],
];

const emojiIconMap = new Map(emojiIconDefinitions);
const knownEmojiPattern = new RegExp(
  emojiIconDefinitions
    .map(([emoji]) => escapeRegExp(emoji))
    .sort((current, next) => next.length - current.length)
    .join('|'),
  'gu',
);
const fallbackEmojiPattern =
  /[\u{1F1E6}-\u{1F1FF}]{2}|(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:️|︎)?(?:\p{Emoji_Modifier})?(?:‍(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:️|︎)?(?:\p{Emoji_Modifier})?)*|[#*0-9](?:️)?⃣/gu;

export function renderCommandInText(content: string, slashItems: { command: string; description: string }[]) {
  const item = slashItems.find((command) => content.startsWith(command.command));
  if (!item) return content;
  return `<button class="command-chip msg-command-chip" title="${item.description}" type="button"><span class="slash-icon">/</span>${item.command}</button>${content.slice(item.command.length)}`;
}

interface IRenderMarkdownOptions {
  disclaimer?: boolean;
  stocks?: Array<Pick<StockDetail, 'code' | 'name'>>;
  emojiIcons?: boolean;
}

export function renderMarkdownContent(content: string, options: IRenderMarkdownOptions = {}) {
  const normalized = normalizeAnalysisContent(content, options.disclaimer !== false);
  const html = marked.parse(normalized, { async: false, breaks: true }) as string;
  const renderedHtml = colorMarketTableCells(linkStockNamesInTables(linkMarkets(html, options.stocks), options.stocks));
  return options.emojiIcons ? replaceEmojiWithIcons(renderedHtml) : renderedHtml;
}

function normalizeAnalysisContent(content: string, showDisclaimer = true) {
  const withoutDisclaimer = disclaimerPatterns.reduce((text, pattern) => text.replace(pattern, ''), content).trim();
  return showDisclaimer && withoutDisclaimer
    ? `${colorScoreTable(withoutDisclaimer)}\n\n${renderDisclaimerLine()}`
    : colorScoreTable(withoutDisclaimer);
}

function renderDisclaimerLine() {
  return `<div class="disclaimer-line">${standardDisclaimer}</div>`;
}

function colorScoreTable(content: string) {
  const lines = content.split('\n');
  let inScoreTable = false;
  return lines
    .map((line) => {
      if (/^\|.*评分\(0-100\).*\|/.test(line)) {
        inScoreTable = true;
        return line;
      }
      if (inScoreTable && !line.trim().startsWith('|')) inScoreTable = false;
      if (!inScoreTable || /^\|\s*-+/.test(line)) return line;
      const cells = line.split('|');
      cells[3] = colorScoreCell(cells[3]);
      cells[4] = colorScoreCell(cells[4]);
      return cells.join('|');
    })
    .join('\n');
}

function colorScoreCell(cell = '') {
  return cell.replace(/(?<![\w"'>-])(\d{1,3}(?:\.\d+)?)(?![\w"'<-])/g, (match) => {
    const value = Number(match);
    if (!Number.isFinite(value) || value > 100) return match;
    const cls = value >= 80 ? 'score-high' : value >= 60 ? 'score-mid' : 'score-low';
    return `<span class="${cls}">${match}</span>`;
  });
}

function isBoardCode(code: string) {
  return /^BK\d{3,6}$/i.test(code) || /^(sh|sz|bj)\d{6}$/i.test(code);
}

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function linkMarkets(html: string, stocks: Array<Pick<StockDetail, 'code' | 'name'>> = []) {
  const stockNameMap = buildStockNameMap(stocks);
  const stockNames = [...stockNameMap.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|');
  const stockPattern = new RegExp(
    `(${stockNames})（(\\d{6})）|(?<![\\w/.-])(BK\\d{3,6}|\\d{6})(?![\\w/.-])`,
    'gi',
  );
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => {
      if (part.startsWith('<')) return part;
      return part.replace(
        stockPattern,
        (match, pairedName: string | undefined, pairedCode: string | undefined, codeOnly: string | undefined) => {
          const matchedName = pairedName;
          const code = pairedCode ?? codeOnly ?? (matchedName ? stockNameMap.get(matchedName) : undefined) ?? '';
          if (!code) return match;
          if (isBoardCode(code))
            return `<a href="#" class="stock-link" data-board-code="${code.toUpperCase()}" data-board-name="${code.toUpperCase()}">${match}</a>`;
          const stockName = matchedName ?? [...stockNameMap.entries()].find(([, aliasCode]) => aliasCode === code)?.[0] ?? code;
          return `<a href="#" class="stock-link" data-stock-code="${escapeHtmlAttribute(code)}" data-stock-name="${escapeHtmlAttribute(stockName)}">${match}</a>`;
        },
      );
    })
    .join('');
}

function buildStockNameMap(stocks: Array<Pick<StockDetail, 'code' | 'name'>>) {
  const stockNameMap = new Map<string, string>();
  for (const [name, code] of stockAliases) stockNameMap.set(name, code);
  for (const stock of stocks) {
    if (stock.name && stock.code) stockNameMap.set(stock.name, stock.code);
  }
  return stockNameMap;
}

function linkStockNamesInTables(html: string, stocks: Array<Pick<StockDetail, 'code' | 'name'>> = []) {
  const stockNameMap = buildStockNameMap(stocks);
  const stockNames = [...stockNameMap.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|');
  const stockNamePattern = new RegExp(stockNames, 'g');
  return html.replace(/<table\b[\s\S]*?<\/table>/gi, (table) => {
    const tableWithRowLinks = linkStockWithChangeCells(linkStockNameCellsFromRowCode(table));
    let insideLink = false;
    return tableWithRowLinks
      .split(/(<[^>]+>)/g)
      .map((part) => {
        if (part.startsWith('<')) {
          if (/^<a\b/i.test(part)) insideLink = true;
          if (/^<\/a>/i.test(part)) insideLink = false;
          return part;
        }
        if (insideLink) return part;
        return part.replace(stockNamePattern, (name) => {
          const code = stockNameMap.get(name);
          if (!code) return name;
          return `<a href="#" class="stock-link" data-stock-code="${escapeHtmlAttribute(code)}" data-stock-name="${escapeHtmlAttribute(name)}">${name}</a>`;
        });
      })
      .join('');
  });
}

function linkStockNameCellsFromRowCode(table: string) {
  let headers: string[] = [];
  return table.replace(/<tr\b[\s\S]*?<\/tr>/gi, (row) => {
    const headerMatches = [...row.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)];
    if (headerMatches.length) {
      headers = headerMatches.map((match) => stripHtml(match[1]));
      return row;
    }
    const codeIndex = headers.findIndex(isStockCodeHeader);
    const nameIndex = headers.findIndex(isStockNameHeader);
    if (codeIndex < 0 || nameIndex < 0) return row;
    const cellMatches = [...row.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)];
    const code = extractStockCode(cellMatches[codeIndex]?.[2] ?? '');
    if (!code) return row;
    let cellIndex = 0;
    return row.replace(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi, (cell, attributes: string, cellContent: string) => {
      const shouldLinkName = cellIndex === nameIndex && !/<a\b/i.test(cellContent);
      cellIndex += 1;
      if (!shouldLinkName) return cell;
      const name = stripHtml(cellContent);
      if (!name) return cell;
      return `<td${attributes}><a href="#" class="stock-link" data-stock-code="${escapeHtmlAttribute(code)}" data-stock-name="${escapeHtmlAttribute(name)}">${cellContent}</a></td>`;
    });
  });
}

function linkStockWithChangeCells(table: string) {
  let headers: string[] = [];
  return table.replace(/<tr\b[\s\S]*?<\/tr>/gi, (row) => {
    const headerMatches = [...row.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)];
    if (headerMatches.length) {
      headers = headerMatches.map((match) => stripHtml(match[1]));
      return row;
    }
    if (!headers.some(isStockWithChangeHeader)) return row;
    let cellIndex = 0;
    return row.replace(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi, (cell, attributes: string, cellContent: string) => {
      const header = headers[cellIndex] ?? '';
      cellIndex += 1;
      if (!isStockWithChangeHeader(header) || /<a\b/i.test(cellContent)) return cell;
      const linkedContent = linkStockWithChangeCellContent(cellContent);
      return linkedContent === cellContent ? cell : `<td${attributes}>${linkedContent}</td>`;
    });
  });
}

function linkStockWithChangeCellContent(cellContent: string) {
  const text = stripHtml(cellContent);
  const match = text.match(/^(.+?)\s+([+＋\-−]\s*\d+(?:\.\d+)?%?)$/);
  if (!match) return cellContent;
  const name = match[1].trim();
  const change = match[2].trim();
  const tone = getMarketValueTone('涨跌幅', change);
  if (!name || !tone) return cellContent;
  return cellContent.replace(
    text,
    `<a href="#" class="stock-link" data-stock-name="${escapeHtmlAttribute(name)}">${name}</a> <span class="${tone}">${change}</span>`,
  );
}

function isStockWithChangeHeader(header: string) {
  return /领涨个股|领跌个股|强势个股|核心个股|代表个股|个股/i.test(header.trim());
}

function isStockCodeHeader(header: string) {
  return /^(代码|证券代码|股票代码|code|symbol)$/i.test(header.trim());
}

function isStockNameHeader(header: string) {
  return /^(名称|股票名称|证券名称|name)$/i.test(header.trim());
}

function extractStockCode(content: string) {
  const match = stripHtml(content).match(/(?<![\w/.-])\d{6}(?![\w/.-])/);
  return match?.[0];
}

function colorMarketTableCells(html: string) {
  return html.replace(/<table\b[\s\S]*?<\/table>/gi, (table) => {
    let headers: string[] = [];
    return table.replace(/<tr\b[\s\S]*?<\/tr>/gi, (row) => {
      const headerMatches = [...row.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)];
      if (headerMatches.length) {
        headers = headerMatches.map((match) => stripHtml(match[1]));
        return row;
      }
      if (!headers.length) return row;
      let cellIndex = 0;
      return row.replace(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi, (cell, attributes: string, cellContent: string) => {
        const header = headers[cellIndex] ?? '';
        cellIndex += 1;
        const tone = isMarketChangeHeader(header) ? getMarketValueTone(header, cellContent) : undefined;
        if (!tone || /class=["'][^"']*\b(?:up|down)\b/.test(cellContent)) return cell;
        return `<td${attributes}><span class="${tone}">${cellContent}</span></td>`;
      });
    });
  });
}

function isMarketChangeHeader(header: string) {
  return /涨跌幅|涨跌额|涨跌|涨幅|跌幅|change|chg|pct|percent/i.test(header);
}

function getMarketValueTone(header: string, cellContent: string) {
  const text = stripHtml(cellContent).replace(/[,，]/g, '').replace(/％/g, '%').trim();
  const match = text.match(/[+＋\-−]?\s*\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const normalized = match[0].replace(/\s/g, '').replace('＋', '+').replace('−', '-');
  const value = Number(normalized.replace(/^\+/, ''));
  if (!Number.isFinite(value) || value === 0) return undefined;
  if (value > 0 && /跌幅/.test(header) && !/涨跌/.test(header)) return 'down';
  return value > 0 ? 'up' : 'down';
}

export function replaceEmojiWithIcons(html: string) {
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => (part.startsWith('<') ? part : replaceEmojiInText(part)))
    .join('');
}

function replaceEmojiInText(text: string) {
  return text
    .replace(knownEmojiPattern, (emoji) => {
      const definition = emojiIconMap.get(emoji);
      return definition ? renderMsgTextIcon(definition) : emoji;
    })
    .replace(fallbackEmojiPattern, () => renderMsgTextIcon({ icon: 'circle', label: '图标', tone: 'muted' }));
}

function renderMsgTextIcon(definition: IEmojiIconDefinition) {
  const toneClass = definition.tone ? ` msg-icon-tone-${definition.tone}` : '';
  return `<svg class="msg-inline-icon msg-icon-${definition.icon}${toneClass}" viewBox="0 0 24 24" aria-label="${escapeHtmlAttribute(definition.label)}" role="img" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${msgTextIconPaths[definition.icon]}</svg>`;
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function escapeHtmlAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
