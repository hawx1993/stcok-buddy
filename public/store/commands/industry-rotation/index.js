const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 StockBuddy/0.2';
let lastEastmoneyCall = 0;

export async function run() {
  const [industry, flow] = await Promise.all([
    industryComparison(20).catch(() => ({ top: [], total: 0 })),
    sectorFundFlow(20).catch(() => []),
  ]);
  return toResponse(industry.top, flow);
}

async function industryComparison(topN = 20) {
  const url = new URL('https://push2.eastmoney.com/api/qt/clist/get');
  url.search = new URLSearchParams({
    pn: '1', pz: '100', po: '1', np: '1', fltt: '2', invt: '2', fs: 'm:90+t:2',
    fields: 'f2,f3,f4,f12,f13,f14,f104,f105,f128,f136,f140,f141,f207',
  }).toString();
  const response = await emFetch(String(url), { Referer: 'https://quote.eastmoney.com/' });
  if (!response.ok) return { top: [], total: 0 };
  const data = await response.json().catch(() => undefined);
  const raw = data?.data?.diff || [];
  const items = Array.isArray(raw) ? raw : Object.values(raw);
  const rows = items.map((item, index) => ({
    rank: index + 1,
    name: item.f14 || '',
    code: item.f12 || '',
    change_pct: item.f3,
    up_count: item.f104,
    down_count: item.f105,
    leader: item.f140 || item.f128 || '',
    leader_change: item.f136,
  })).filter((item) => item.name);
  return { top: rows.slice(0, topN), total: rows.length };
}

async function sectorFundFlow(topN = 20) {
  const url = new URL('https://push2.eastmoney.com/api/qt/clist/get');
  url.search = new URLSearchParams({
    pn: '1', pz: '100', po: '1', np: '1', fltt: '2', invt: '2', fs: 'm:90+t:2',
    fid: 'f62', fields: 'f12,f14,f3,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f204,f205,f206',
  }).toString();
  const response = await emFetch(String(url), { Referer: 'https://quote.eastmoney.com/' });
  if (!response.ok) return [];
  const data = await response.json().catch(() => undefined);
  const raw = data?.data?.diff || [];
  const items = Array.isArray(raw) ? raw : Object.values(raw);
  return items
    .map((item) => ({
      code: item.f12 || '',
      name: item.f14 || '',
      change_pct: item.f3,
      main_net: item.f62,
      main_ratio: item.f184,
      top_stock: item.f204 || item.f205 || item.f206 || '',
    }))
    .filter((item) => item.name && Number(item.main_net || 0) > 0)
    .sort((a, b) => Number(b.main_net || 0) - Number(a.main_net || 0))
    .slice(0, topN);
}

async function emFetch(url, headers = {}) {
  const wait = 1100 - (Date.now() - lastEastmoneyCall);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  try {
    return await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': UA, ...headers } });
  } finally {
    lastEastmoneyCall = Date.now();
  }
}

function toResponse(boards, flows) {
  const themes = [...new Set([...boards.slice(0, 5).map((item) => item.name), ...flows.slice(0, 5).map((item) => item.name)].filter(Boolean))].slice(0, 6);
  const conclusion = boards.length >= 5 || flows.length >= 5 ? '🟢 偏利好' : '🟡 中性';
  const content = [
    '# 行业轮动',
    '',
    '## 📰 核心事件',
    boards.length ? boards.slice(0, 8).map((item) => `- 📈 ${item.rank}. ${item.name}：涨幅 ${formatPercent(item.change_pct)}，涨${item.up_count ?? '--'}跌${item.down_count ?? '--'}${item.leader ? `，领涨 ${item.leader}` : ''}。`).join('\n') : '- 📄 暂未获取到行业涨幅榜。',
    '',
    '## ✅ 利好因素',
    flows.length ? flows.slice(0, 6).map((item) => `- 💰 ${item.name}：主力净流入 ${formatMoney(item.main_net)}，净流入占比 ${formatPercent(item.main_ratio)}${item.top_stock ? `，代表个股 ${item.top_stock}` : ''}。`).join('\n') : '- 🟡 暂未看到明确板块资金净流入。',
    '',
    '## ⚠️ 利空因素',
    '- ⚡ 行业轮动可能受短线消息和资金切换影响，持续性需看成交额与龙头股承接。',
    '',
    '## 📈 短期影响',
    themes.length ? `- 📅 今日短线重点关注 ${themes.slice(0, 4).join('、')} 是否继续扩散。` : '- 📅 短期行业主线不清晰，适合等待资金重新聚焦。',
    '',
    '## 🏛️ 中长期影响',
    '- 🗓️ 行业轮动若要演化为中期主线，需要政策、订单、业绩与资金连续性共同验证。',
    '',
    '## 🚨 风险提示',
    '- ⚡ 数据来自 a-stock-data 东财行业板块排名与资金流直连接口，存在延迟和口径调整风险。',
    '- 📜 本结果仅供研究参考，不构成投资建议。',
    '',
    '## 🎯 综合结论',
    `${conclusion}：今日行业涨幅和资金流入主要集中在 ${themes.join('、') || '局部板块'}。`,
  ].join('\n');

  return {
    content,
    result: {
      title: '行业轮动',
      subtitle: `涨幅榜 ${boards.length} 个 · 资金流入 ${flows.length} 个`,
      metrics: [
        { label: '涨幅行业', value: `${boards.length}个`, tone: boards.length ? 'up' : 'neutral' },
        { label: '资金流入', value: `${flows.length}个`, tone: flows.length ? 'up' : 'neutral' },
        { label: 'TOP流入', value: flows[0] ? formatMoney(flows[0].main_net) : '--', tone: flows[0] ? 'up' : 'neutral' },
      ],
      rows: [
        ...boards.slice(0, 10).map((item) => ({ 类型: '涨幅榜', 板块: item.name, 代码: item.code, 涨幅: formatPercent(item.change_pct), 涨家数: item.up_count, 跌家数: item.down_count, 领涨: item.leader })),
        ...flows.slice(0, 10).map((item) => ({ 类型: '资金流', 板块: item.name, 代码: item.code, 涨幅: formatPercent(item.change_pct), 主力净流入: formatMoney(item.main_net), 净占比: formatPercent(item.main_ratio), 代表个股: item.top_stock })),
      ],
      narrative: content,
    },
    events: [{ type: 'step_completed', step: { id: 'store-command', agent: 'a-stock-data', description: '执行插件命令：行业轮动', status: 'completed' } }],
  };
}

function formatPercent(value) {
  const num = Number(value);
  return Number.isFinite(num) ? `${num >= 0 ? '+' : ''}${num.toFixed(2)}%` : '--';
}

function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  const sign = num > 0 ? '+' : num < 0 ? '-' : '';
  const abs = Math.abs(num);
  if (abs >= 100000000) return `${sign}${(abs / 100000000).toFixed(2)}亿`;
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(2)}万`;
  return `${sign}${abs.toFixed(0)}`;
}
