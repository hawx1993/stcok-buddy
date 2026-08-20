import { getDragonTigerSeatDetails } from '../stock/dragon-tiger-seat-detail.js';
import { getDragonTigerSnapshot, searchStocks } from '../stock/stock-client.js';
import type { IDragonTigerSeatDetail } from '../stock/dragon-tiger-seat-detail.js';
import type { IStoreCommandInput, IStoreCommandResult } from './types.js';

interface IResolvedStock {
  code: string;
  name: string;
}

interface ISeatLookup {
  seats: IDragonTigerSeatDetail[];
  warning?: string;
}

export async function runDragonTigerCommand({ args }: IStoreCommandInput): Promise<IStoreCommandResult> {
  const input = args.trim();
  if (!input) return usage();

  const stock = await resolveStock(input);
  const snapshot = await getDragonTigerSnapshot('30d');
  const records = snapshot.rows.filter((row) => row.code === stock.code);
  const latest = records[0];
  const seatLookup = latest ? await loadSeatDetails(stock.code, latest.date) : { seats: [] };
  const buySeats = seatLookup.seats.filter((seat) => seat.side === 'buy').slice(0, 5);
  const sellSeats = seatLookup.seats.filter((seat) => seat.side === 'sell').slice(0, 5);
  const warnings = [...snapshot.warnings, ...(seatLookup.warning ? [seatLookup.warning] : [])];
  const conclusion = latest && (latest.netBuyAmount ?? 0) > 0 ? '🟢 偏利好' : '🟡 中性';
  const content = [
    `# ${stock.name}（${stock.code}）龙虎榜`,
    '',
    '## 📰 核心事件',
    latest
      ? `- 📄 ${stock.name} 最近上榜日为 ${latest.date}，近30日上榜 ${records.length} 次。`
      : `- 📄 近30日暂未检索到 ${stock.name}（${stock.code}）的龙虎榜上榜记录。`,
    ...(latest
      ? [
          `- 💰 最新上榜净买入 ${formatMoney(latest.netBuyAmount)}，买入 ${formatMoney(latest.buyAmount)}，卖出 ${formatMoney(latest.sellAmount)}。`,
        ]
      : []),
    '',
    '## ✅ 利好因素',
    buySeats.length
      ? buySeats
          .map(
            (seat) =>
              `- 💰 ${seat.branchName}：买入 ${formatMoney(seat.buyAmount)}，净额 ${formatMoney(seat.netAmount)}。`,
          )
          .join('\n')
      : '- 🟡 暂未拿到明确买方营业部席位。',
    '',
    '## ⚠️ 利空因素',
    sellSeats.length
      ? sellSeats
          .map(
            (seat) =>
              `- 📉 ${seat.branchName}：卖出 ${formatMoney(seat.sellAmount)}，净额 ${formatMoney(seat.netAmount)}。`,
          )
          .join('\n')
      : '- ⚡ 龙虎榜席位偏短线，单次买入不代表趋势确认。',
    '',
    '## 📈 短期影响',
    latest
      ? `- 📅 短线重点看 ${stock.name} 次日承接、成交额延续，以及买方营业部是否回流。`
      : '- 📅 未上榜时，短期更适合结合成交额、换手率和异动公告继续观察。',
    '',
    '## 🏛️ 中长期影响',
    '- 🗓️ 龙虎榜主要反映交易结构，中长期仍需回到基本面、行业景气和公告验证。',
    '',
    '## 🚨 风险提示',
    ...warnings.map((warning) => `- ⚡ ${warning}`),
    '- 📜 本结果仅供研究参考，不构成投资建议。',
    '',
    '## 🎯 综合结论',
    `${conclusion}：${latest ? `${stock.name} 近30日存在龙虎榜记录，买方重点关注 ${buySeats.map((seat) => seat.branchName).join('、') || '营业部席位数据暂不可用'}。` : `${stock.name} 近30日暂未确认上榜。`}`,
  ].join('\n');

  return {
    content,
    result: {
      title: `${stock.name}（${stock.code}）龙虎榜`,
      subtitle: latest ? `${latest.date} · 近30日 ${records.length} 次` : '近30日未确认上榜',
      metrics: [
        { label: '上榜次数', value: String(records.length), tone: records.length ? 'up' : 'neutral' },
        {
          label: '最新净额',
          value: formatMoney(latest?.netBuyAmount),
          tone: (latest?.netBuyAmount ?? 0) > 0 ? 'up' : 'neutral',
        },
        { label: '买方席位', value: `${buySeats.length}个`, tone: buySeats.length ? 'up' : 'neutral' },
      ],
      rows: [...buySeats, ...sellSeats].map((seat) => ({
        类型: seat.side === 'buy' ? '买入' : '卖出',
        营业部: seat.branchName,
        买入: formatMoney(seat.buyAmount),
        卖出: formatMoney(seat.sellAmount),
        净额: formatMoney(seat.netAmount),
      })),
      narrative: content,
    },
    events: [
      {
        type: 'step_completed',
        step: {
          id: 'store-command',
          agent: 'stock-sdk',
          description: `执行内置命令：龙虎榜 ${stock.code}`,
          status: 'completed',
        },
      },
    ],
  };
}

async function loadSeatDetails(code: string, date: string): Promise<ISeatLookup> {
  try {
    return { seats: await getDragonTigerSeatDetails(code, date) };
  } catch (error) {
    return { seats: [], warning: `stock-sdk 龙虎榜营业部席位数据暂不可用：${toErrorMessage(error)}` };
  }
}

async function resolveStock(value: string): Promise<IResolvedStock> {
  const code = value.match(/\b\d{6}\b/)?.[0];
  if (code) {
    const matches = await searchStocks(code);
    const matched = matches.find((item) => item.kind === 'stock' && item.code === code);
    return { code, name: matched?.name ?? code };
  }

  const matched = (await searchStocks(value)).find((item) => item.kind === 'stock');
  if (!matched) throw new Error(`未找到股票：${value}`);
  return { code: matched.code, name: matched.name };
}

function usage(): IStoreCommandResult {
  const content = '请输入股票代码或股票名称，例如：/龙虎榜 000858';
  return { content, events: [{ type: 'final_answer', message: content }] };
}

function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return '--';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  if (absolute >= 100_000_000) return `${sign}${(absolute / 100_000_000).toFixed(2)}亿`;
  if (absolute >= 10_000) return `${sign}${(absolute / 10_000).toFixed(2)}万`;
  return `${sign}${absolute.toFixed(0)}`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
