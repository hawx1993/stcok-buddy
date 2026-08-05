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

export function renderCommandInText(content: string, slashItems: { command: string; description: string }[]) {
  const item = slashItems.find((command) => content.startsWith(command.command));
  if (!item) return content;
  return `<button class="command-chip msg-command-chip" title="${item.description}" type="button"><span class="slash-icon">/</span>${item.command}</button>${content.slice(item.command.length)}`;
}

interface IRenderMarkdownOptions {
  disclaimer?: boolean;
  stocks?: Array<Pick<StockDetail, 'code' | 'name'>>;
}

export function renderMarkdownContent(content: string, options: IRenderMarkdownOptions = {}) {
  const normalized = normalizeAnalysisContent(content, options.disclaimer !== false);
  const html = marked.parse(normalized, { async: false, breaks: true }) as string;
  return colorMarketTableCells(linkStockNamesInTables(linkMarkets(html, options.stocks), options.stocks));
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

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function escapeHtmlAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
