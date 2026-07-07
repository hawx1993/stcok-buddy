const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 StockBuddy/0.2';
const DATACENTER_URL = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
let lastEastmoneyCall = 0;

export async function run({ args, query }) {
  const symbol = await resolveSymbol(args || query);
  if (!symbol) return usage();
  const name = await resolveName(symbol, args);
  const result = await dragonTigerBoard(symbol);
  return toResponse(symbol, name, result);
}

async function resolveSymbol(input) {
  const text = String(input || '').trim();
  const code = text.match(/\b\d{6}\b/)?.[0];
  if (code) return code;
  const response = await fetch(`https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(text)}&type=14&token=D43BF722C8C1D9CD6988B777F064EB81`, { headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' } }).catch(() => undefined);
  const data = response?.ok ? await response.json().catch(() => undefined) : undefined;
  return data?.QuotationCodeTable?.Data?.find((item) => /^\d{6}$/.test(item.Code))?.Code;
}

async function resolveName(symbol, fallback) {
  const secid = `${symbol.startsWith('6') ? '1' : '0'}.${symbol}`;
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f58`;
  const response = await emFetch(url, { Referer: 'https://quote.eastmoney.com/' }).catch(() => undefined);
  const data = response?.ok ? await response.json().catch(() => undefined) : undefined;
  return data?.data?.f58 || fallback || symbol;
}

async function dragonTigerBoard(code, lookBack = 30) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - lookBack);
  const startStr = iso(start);
  const endStr = iso(end);
  const records = await eastmoneyDatacenter({
    reportName: 'RPT_DAILYBILLBOARD_DETAILSNEW',
    filter: `(TRADE_DATE>='${startStr}')(TRADE_DATE<='${endStr}')(SECURITY_CODE="${code}")`,
    pageSize: 50,
    sortColumns: 'TRADE_DATE',
    sortTypes: '-1',
  });
  const latest = records[0];
  if (!latest) return { records: [], buy: [], sell: [] };
  const latestDate = String(latest.TRADE_DATE || '').slice(0, 10);
  const [buy, sell] = await Promise.all([
    eastmoneyDatacenter({ reportName: 'RPT_BILLBOARD_DAILYDETAILSBUY', filter: `(TRADE_DATE='${latestDate}')(SECURITY_CODE="${code}")`, pageSize: 10, sortColumns: 'BUY', sortTypes: '-1' }),
    eastmoneyDatacenter({ reportName: 'RPT_BILLBOARD_DAILYDETAILSSELL', filter: `(TRADE_DATE='${latestDate}')(SECURITY_CODE="${code}")`, pageSize: 10, sortColumns: 'SELL', sortTypes: '-1' }),
  ]);
  return { records, buy, sell };
}

async function eastmoneyDatacenter({ reportName, filter, pageSize = 50, sortColumns = '', sortTypes = '-1' }) {
  const params = new URLSearchParams({ reportName, columns: 'ALL', filter, pageNumber: '1', pageSize: String(pageSize), sortColumns, sortTypes, source: 'WEB', client: 'WEB' });
  const response = await emFetch(`${DATACENTER_URL}?${params.toString()}`, { Referer: 'https://data.eastmoney.com/' });
  if (!response.ok) return [];
  const data = await response.json().catch(() => undefined);
  return data?.result?.data || [];
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

function usage() {
  const content = '请输入股票代码或股票名称，例如：/龙虎榜 000858';
  return { content, events: [{ type: 'final_answer', message: content }] };
}

function toResponse(symbol, name, data) {
  const records = data.records;
  const latest = records[0];
  const buySeats = data.buy.slice(0, 5).map(toSeat);
  const sellSeats = data.sell.slice(0, 5).map(toSeat);
  const conclusion = latest ? (Number(latest.BILLBOARD_NET_AMT || 0) > 0 ? '🟢 偏利好' : '🟡 中性') : '🟡 中性';
  const content = [
    `# ${name}（${symbol}）龙虎榜`,
    '',
    '## 📰 核心事件',
    latest ? `- 📄 ${name} 最近上榜日为 ${String(latest.TRADE_DATE || '').slice(0, 10)}，近30日上榜 ${records.length} 次。` : `- 📄 近30日暂未检索到 ${name}（${symbol}）的龙虎榜上榜记录。`,
    latest ? `- 💰 最新上榜净买入 ${formatMoney(latest.BILLBOARD_NET_AMT)}，买入 ${formatMoney(latest.BILLBOARD_BUY_AMT)}，卖出 ${formatMoney(latest.BILLBOARD_SELL_AMT)}。` : '',
    '',
    '## ✅ 利好因素',
    buySeats.length ? buySeats.map((item) => `- 💰 ${item.name}：买入 ${formatMoney(item.buy)}，净额 ${formatMoney(item.net)}。`).join('\n') : '- 🟡 暂未拿到明确买方营业部席位。',
    '',
    '## ⚠️ 利空因素',
    sellSeats.length ? sellSeats.slice(0, 3).map((item) => `- 📉 ${item.name}：卖出 ${formatMoney(item.sell)}，净额 ${formatMoney(item.net)}。`).join('\n') : '- ⚡ 龙虎榜席位偏短线，单次买入不代表趋势确认。',
    '',
    '## 📈 短期影响',
    latest ? `- 📅 短线重点看 ${name} 次日承接、成交额延续，以及买方营业部是否回流。` : '- 📅 未上榜时，短期更适合结合成交额、换手率和异动公告继续观察。',
    '',
    '## 🏛️ 中长期影响',
    '- 🗓️ 龙虎榜主要反映交易结构，中长期仍需回到基本面、行业景气和公告验证。',
    '',
    '## 🚨 风险提示',
    '- ⚡ 龙虎榜数据来自 a-stock-data 东财 datacenter 直连接口，存在盘后更新延迟和席位口径调整风险。',
    '- 📜 本结果仅供研究参考，不构成投资建议。',
    '',
    '## 🎯 综合结论',
    `${conclusion}：${latest ? `${name} 近30日有龙虎榜记录，买方重点关注 ${buySeats.map((item) => item.name).join('、') || '席位明细待补充'}。` : `${name} 近30日暂未确认上榜。`}`,
  ].filter(Boolean).join('\n');
  const seats = [...buySeats.map((item) => ({ ...item, side: '买入' })), ...sellSeats.map((item) => ({ ...item, side: '卖出' }))];
  return {
    content,
    result: {
      title: `${name}（${symbol}）龙虎榜`,
      subtitle: latest ? `${String(latest.TRADE_DATE || '').slice(0, 10)} · 近30日 ${records.length} 次` : '近30日未确认上榜',
      metrics: [
        { label: '上榜次数', value: String(records.length), tone: records.length ? 'up' : 'neutral' },
        { label: '最新净额', value: formatMoney(latest?.BILLBOARD_NET_AMT), tone: Number(latest?.BILLBOARD_NET_AMT ?? 0) > 0 ? 'up' : 'neutral' },
        { label: '买方席位', value: `${buySeats.length}个` },
      ],
      rows: seats.map((item) => ({ 类型: item.side, 营业部: item.name, 买入: formatMoney(item.buy), 卖出: formatMoney(item.sell), 净额: formatMoney(item.net) })),
      narrative: content,
      stocks: [{ code: symbol, name }],
    },
    events: [{ type: 'step_completed', step: { id: 'store-command', agent: 'a-stock-data', description: `执行插件命令：龙虎榜 ${symbol}`, status: 'completed' } }],
  };
}

function toSeat(row) {
  return { name: row.OPERATEDEPT_NAME || '', buy: row.BUY || 0, sell: row.SELL || 0, net: row.NET || 0 };
}

function iso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
