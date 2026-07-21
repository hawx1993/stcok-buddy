import { marked } from 'marked';

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

export function renderMarkdownContent(content: string, options: { disclaimer?: boolean } = {}) {
  const normalized = normalizeAnalysisContent(content, options.disclaimer !== false);
  const html = marked.parse(normalized, { async: false, breaks: true }) as string;
  return linkMarkets(html);
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

function linkMarkets(html: string) {
  const stockPattern = new RegExp(
    `(${stockAliases.map(([name]) => escapeRegExp(name)).join('|')})（(\\d{6})）|(?<![\\w/.-])(BK\\d{3,6}|\\d{6})(?![\\w/.-])`,
    'gi',
  );
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => {
      if (part.startsWith('<')) return part;
      return part.replace(
        stockPattern,
        (match, name: string | undefined, pairedCode: string | undefined, codeOnly: string | undefined) => {
          const code = pairedCode ?? codeOnly ?? stockAliases.find(([alias]) => alias === name)?.[1] ?? '';
          if (isBoardCode(code))
            return `<a href="#" class="stock-link" data-board-code="${code.toUpperCase()}" data-board-name="${code.toUpperCase()}">${match}</a>`;
          const stockName = name ?? stockAliases.find(([, aliasCode]) => aliasCode === code)?.[0] ?? code;
          return `<a href="#" class="stock-link" data-stock-code="${code}" data-stock-name="${stockName}">${match}</a>`;
        },
      );
    })
    .join('');
}
