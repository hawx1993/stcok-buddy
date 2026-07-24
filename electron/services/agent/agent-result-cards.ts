import type { AgentResultCard, AnnouncementItem, HotFocusItem, MarketNewsItem, StockDetail } from '../../../src/shared/types.js';
import type { DailyDragonTigerItem } from '../stock/stock-client.js';

export function quoteToCard(quote?: StockDetail): AgentResultCard | undefined {
  if (!quote) return undefined;
  return {
    title: `${quote.name}（${quote.code}）行情`,
    subtitle: `${quote.exchange ?? 'A股'} · ${quote.changePercent ?? '--'}`,
    metrics: [
      { label: '现价', value: String(quote.price ?? '--') },
      {
        label: '涨跌幅',
        value: quote.changePercent ?? '--',
        tone: quote.changePercent?.startsWith('-') ? 'down' : 'up',
      },
      { label: 'PE', value: String(quote.pe ?? '--') },
      { label: '成交额', value: quote.turnover ?? '--' },
    ],
    narrative: quote.summary,
    stocks: [quote],
  };
}

export function themeAttributionToCard(
  surge: HotFocusItem[],
  sectors: HotFocusItem[],
  flows: HotFocusItem[],
): AgentResultCard {
  const strong = surge.filter((item) => item.type !== 'plummet').slice(0, 12);
  const weak = surge.filter((item) => item.type === 'plummet').slice(0, 5);
  const hotSectors = sectors.slice(0, 8);
  const flowLeaders = flows.slice(0, 6);
  const themes = [...new Set([...hotSectors.map(themeName), ...flowLeaders.map(themeName)].filter(Boolean))].slice(
    0,
    6,
  );
  const conclusion =
    strong.length >= 8 && hotSectors.length >= 3 ? '🟢 偏利好' : strong.length ? '🟡 中性' : '🔴 偏利空';
  const narrative = [
    '# 题材归因',
    '',
    '## 📰 核心事件',
    strong.length
      ? strong
          .slice(0, 8)
          .map(
            (item) =>
              `- 📈 ${item.name ?? item.title}${item.code ? `（${item.code}）` : ''}：${[item.changePercent, item.description || item.tag].filter(Boolean).join('，') || '今日表现较强。'}`,
          )
          .join('\n')
      : '- 今日暂未检索到明确强势股样本。',
    '',
    '## ✅ 利好因素',
    themes.length
      ? themes.map((name) => `- 🌐 ${name}：在热点板块或资金流榜单中靠前，说明题材关注度较高。`).join('\n')
      : '- 🟡 暂未形成清晰题材共振，更多是个股层面的短线异动。',
    flowLeaders.length
      ? `- 💰 资金线索：${flowLeaders
          .slice(0, 3)
          .map((item) => `${themeName(item)}${item.amount ? ` ${item.amount}` : ''}`)
          .join('、')}。`
      : '',
    '',
    '## ⚠️ 利空因素',
    weak.length
      ? weak
          .map(
            (item) =>
              `- 📉 ${item.name ?? item.title}：${item.description || item.tag || '出现走弱或负反馈，需要警惕题材分化。'}`,
          )
          .join('\n')
      : '- ⚡ 若强势股主要来自涨停池或异动池，持续性仍需看封单、换手和次日承接。',
    '',
    '## 📈 短期影响',
    strong.length
      ? `- 📅 今日强势样本集中在 ${themes.slice(0, 3).join('、') || '局部热点'}，短线交易重点看龙头股是否继续扩散到后排。`
      : '- 📅 热点强度不足，短期更适合观察资金是否重新聚焦。',
    '',
    '## 🏛️ 中长期影响',
    themes.length
      ? `- 🗓️ 只有同时具备产业逻辑、业绩兑现和资金持续流入的方向，才可能从短线题材演化为中期主线；当前重点跟踪 ${themes.slice(0, 3).join('、')}。`
      : '- 🗓️ 当前数据不足以支持中长期主线判断，需继续跟踪板块资金和公告验证。',
    '',
    '## 🚨 风险提示',
    '- ⚡ 题材归因基于盘中/当日公开行情与资金榜单，可能受数据源延迟、停牌、复牌和涨跌停制度影响。',
    '- 📜 若题材依赖政策、订单或公告催化，需等待正式公告和后续业绩验证。',
    '',
    '## 🎯 综合结论',
    `${conclusion}：今日走强股票主要围绕 ${themes.join('、') || '局部热点'} 展开。以上内容来自 a-stock-data 行情、热点和资金流公开接口，仅供研究参考。`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    title: '题材归因',
    subtitle: `强势股 ${strong.length} 只 · 热点题材 ${themes.length} 个`,
    metrics: [
      { label: '强势股', value: `${strong.length}只`, tone: strong.length ? 'up' : 'neutral' },
      { label: '热点题材', value: `${themes.length}个`, tone: themes.length ? 'up' : 'neutral' },
      { label: '资金榜', value: `${flowLeaders.length}条` },
    ],
    rows: [
      ...strong.slice(0, 10).map((item) => ({
        类型: '强势股',
        名称: item.name ?? item.title,
        代码: item.code ?? '',
        涨跌幅: item.changePercent ?? '',
        归因: item.description || item.tag || '',
      })),
      ...hotSectors.slice(0, 6).map((item) => ({
        类型: '热点题材',
        名称: themeName(item),
        代码: item.tag ?? item.code ?? '',
        涨跌幅: item.changePercent ?? '',
        归因: item.description || '',
      })),
    ],
    narrative,
  };
}

export function dailyDragonTigerToCard(items: DailyDragonTigerItem[]): AgentResultCard {
  const date = items[0]?.date ?? new Date().toISOString().slice(0, 10);
  const leaders = items.filter((item) => item.netBuy > 0).slice(0, 10);
  const top = leaders.slice(0, 5);
  const conclusion = leaders.length ? '🟢 偏利好' : items.length ? '🟡 中性' : '🟡 中性';
  const narrative = [
    '# 全市场龙虎榜',
    '',
    '## 📰 核心事件',
    items.length
      ? `- 📄 ${date} 龙虎榜共检索到 ${items.length} 条上榜记录，按净买入额降序展示。`
      : '- 📄 暂未检索到今日龙虎榜数据，可能是非交易日或盘后数据尚未更新。',
    leaders.length
      ? top
          .map(
            (item, index) =>
              `- 💰 ${index + 1}. ${item.name}（${item.code}）：净买入 ${formatMoney(item.netBuy)}，${item.reason || '上榜原因待补充'}。`,
          )
          .join('\n')
      : '',
    '',
    '## ✅ 利好因素',
    leaders.length
      ? `- 💰 前 ${Math.min(leaders.length, 10)} 只净买入个股合计 ${formatMoney(leaders.reduce((sum, item) => sum + item.netBuy, 0))}，说明部分短线资金集中度较高。`
      : '- 🟡 当前未看到明确净买入领先样本，资金方向偏观望。',
    top.length
      ? `- 📈 涨跌幅靠前样本：${top.map((item) => `${item.name}${item.changePercent === undefined ? '' : ` ${formatSignedPercent(item.changePercent)}`}`).join('、')}。`
      : '',
    '',
    '## ⚠️ 利空因素',
    items.some((item) => item.netBuy < 0)
      ? `- 📉 仍有 ${items.filter((item) => item.netBuy < 0).length} 条记录为净卖出，龙虎榜内部资金分歧不能忽视。`
      : '- ⚡ 龙虎榜资金通常偏短线，净买入不等于趋势确认。',
    '- ⚡ 高换手上榜个股波动较大，次日承接比当日净买入更关键。',
    '',
    '## 📈 短期影响',
    leaders.length
      ? `- 📅 短线重点观察 ${top.map((item) => item.name).join('、')} 的开盘溢价、成交额延续和席位回流情况。`
      : '- 📅 数据不足时，短期更适合等待盘后龙虎榜更新后再判断。',
    '',
    '## 🏛️ 中长期影响',
    '- 🗓️ 龙虎榜反映交易结构而非基本面趋势，中长期判断仍需结合公告、行业景气和业绩兑现。',
    '',
    '## 🚨 风险提示',
    '- ⚡ 龙虎榜数据来自东财数据中心公开接口，存在盘后更新延迟、非交易日为空、字段调整等风险。',
    '- 📜 本结果仅用于投研线索筛选，不构成投资建议。',
    '',
    '## 🎯 综合结论',
    `${conclusion}：${leaders.length ? `今日龙虎榜净买入主要集中在 ${top.map((item) => item.name).join('、')}。` : '当前未形成清晰的龙虎榜净买入主线。'}后续重点看资金是否连续回流。`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    title: '全市场龙虎榜',
    subtitle: `${date} · 净买入前 ${leaders.length || 0} 条`,
    metrics: [
      { label: '上榜记录', value: `${items.length}条` },
      { label: '净买入', value: `${leaders.length}条`, tone: leaders.length ? 'up' : 'neutral' },
      {
        label: 'TOP净买',
        value: leaders[0] ? formatMoney(leaders[0].netBuy) : '--',
        tone: leaders[0] ? 'up' : 'neutral',
      },
    ],
    rows: items.slice(0, 20).map((item, index) => ({
      排名: index + 1,
      代码: item.code,
      名称: item.name,
      上榜原因: item.reason,
      收盘价: item.close ?? '--',
      涨跌幅: item.changePercent === undefined ? '--' : formatSignedPercent(item.changePercent),
      净买入: formatMoney(item.netBuy),
      买入: formatMoney(item.buy),
      卖出: formatMoney(item.sell),
      换手率: item.turnover === undefined ? '--' : `${item.turnover.toFixed(2)}%`,
    })),
    narrative,
  };
}

function formatMoney(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  const sign = num > 0 ? '+' : num < 0 ? '-' : '';
  const abs = Math.abs(num);
  if (abs >= 100000000) return `${sign}${(abs / 100000000).toFixed(2)}亿`;
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(2)}万`;
  return `${sign}${abs.toFixed(0)}`;
}

function formatSignedPercent(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function themeName(item: HotFocusItem) {
  return item.name ?? item.title.replace(/\s+\d{6}$/, '');
}

export function newsAnnouncementsToCard(
  quote: StockDetail | undefined,
  news: MarketNewsItem[],
  announcements: AnnouncementItem[],
): AgentResultCard {
  const title = quote ? `${quote.name}（${quote.code}）新闻公告` : '新闻公告';
  return {
    title,
    subtitle: `新闻 ${news.length} 条 · 公告 ${announcements.length} 条`,
    metrics: [
      { label: '新闻', value: `${news.length}条` },
      { label: '公告', value: `${announcements.length}条` },
    ],
    rows: [
      ...news.map((item) => ({
        类型: '新闻',
        时间: item.time,
        来源: item.source ?? '',
        标题: item.title,
        链接: item.url ?? '',
      })),
      ...announcements.map((item) => ({
        类型: '公告',
        时间: item.date,
        来源: item.type,
        标题: item.title,
        链接: item.url,
      })),
    ],
    narrative: [
      `### ${title}`,
      '',
      '#### 近期新闻',
      news.length
        ? news
            .map(
              (item) =>
                `- ${item.time || '--'}｜${item.source || '东方财富'}｜${item.title}${item.content ? `：${item.content}` : ''}${item.url ? ` [查看](${item.url})` : ''}`,
            )
            .join('\n')
        : '- 暂无可用新闻。',
      '',
      '#### 近期公告',
      announcements.length
        ? announcements
            .map(
              (item) =>
                `- ${item.date || '--'}｜${item.type || '公告'}｜${item.title}${item.url ? ` [查看](${item.url})` : ''}`,
            )
            .join('\n')
        : '- 暂无可用公告。',
      '',
      '以上内容来自 a-stock-data 指定的东财个股新闻与巨潮公告公开接口，仅供研究参考，不构成投资建议。',
    ].join('\n'),
    stocks: quote ? [quote] : undefined,
  };
}
