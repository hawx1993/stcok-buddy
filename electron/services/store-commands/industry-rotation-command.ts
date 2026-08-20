import { getIndustryRanking } from '../agents/tools/get-industry-ranking.js';
import type { IStoreCommandResult } from './types.js';

export async function runIndustryRotationCommand(): Promise<IStoreCommandResult> {
  const { ranking, flow, gaps } = await getIndustryRanking.run({});
  const boards = ranking?.top ?? [];
  const flows = flow?.rows ?? [];
  const themes = [
    ...new Set([...boards.slice(0, 5).map((item) => item.name), ...flows.slice(0, 5).map((item) => item.name)]),
  ].slice(0, 6);
  const conclusion = boards.length >= 5 || flows.length >= 5 ? '🟢 偏利好' : '🟡 中性';
  const content = [
    '# 行业轮动',
    '',
    '## 📰 核心事件',
    boards.length
      ? boards
          .slice(0, 8)
          .map(
            (item) =>
              `- 📈 ${item.rank}. ${item.name}：涨幅 ${formatPercent(item.change_pct)}，涨${item.up_count}跌${item.down_count}${item.leader ? `，领涨 ${item.leader}` : ''}。`,
          )
          .join('\n')
      : '- 📄 行业涨幅榜数据源暂不可用。',
    '',
    '## ✅ 利好因素',
    flows.length
      ? flows
          .slice(0, 6)
          .map(
            (item) =>
              `- 💰 ${item.name}：主力净流入 ${formatMoney(item.main_net)}，净流入占比 ${formatPercent(item.main_pct)}${item.leader ? `，代表个股 ${item.leader}` : ''}。`,
          )
          .join('\n')
      : '- 🟡 行业资金流数据源暂不可用。',
    '',
    '## ⚠️ 利空因素',
    '- ⚡ 行业轮动可能受短线消息和资金切换影响，持续性需看成交额与龙头股承接。',
    '',
    '## 📈 短期影响',
    themes.length
      ? `- 📅 今日短线重点关注 ${themes.slice(0, 4).join('、')} 是否继续扩散。`
      : '- 📅 短期行业主线数据暂不完整，适合等待数据源恢复。',
    '',
    '## 🏛️ 中长期影响',
    '- 🗓️ 行业轮动若要演化为中期主线，需要政策、订单、业绩与资金连续性共同验证。',
    '',
    '## 🚨 风险提示',
    ...(gaps.ranking ? ['- ⚡ 行业涨幅排名暂不可用。'] : []),
    ...(gaps.flow ? ['- ⚡ 行业资金流暂不可用。'] : []),
    '- 📜 本结果仅供研究参考，不构成投资建议。',
    '',
    '## 🎯 综合结论',
    `${conclusion}：今日行业涨幅和资金流入主要集中在 ${themes.join('、') || '数据源已返回的局部板块'}。`,
  ].join('\n');

  return {
    content,
    result: {
      title: '行业轮动',
      subtitle: `涨幅行业 ${boards.length} 个 · 资金流入 ${flows.length} 个`,
      metrics: [
        { label: '涨幅行业', value: `${boards.length}个`, tone: boards.length ? 'up' : 'neutral' },
        { label: '资金流入', value: `${flows.length}个`, tone: flows.length ? 'up' : 'neutral' },
        {
          label: 'TOP流入',
          value: flows[0] ? formatMoney(flows[0].main_net) : '--',
          tone: flows[0] ? 'up' : 'neutral',
        },
      ],
      rows: [
        ...boards.slice(0, 10).map((item) => ({
          类型: '涨幅榜',
          板块: item.name,
          代码: item.code,
          涨幅: formatPercent(item.change_pct),
          涨家数: item.up_count,
          跌家数: item.down_count,
          领涨: item.leader,
        })),
        ...flows.slice(0, 10).map((item) => ({
          类型: '资金流',
          板块: item.name,
          代码: item.code,
          涨幅: formatPercent(item.change_pct),
          主力净流入: formatMoney(item.main_net),
          净占比: formatPercent(item.main_pct),
          代表个股: item.leader,
        })),
      ],
      narrative: content,
    },
    events: [
      {
        type: 'step_completed',
        step: {
          id: 'store-command',
          agent: 'a-stock-data',
          description: '执行内置命令：行业轮动',
          status: 'completed',
        },
      },
    ],
  };
}

function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatMoney(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  if (absolute >= 100_000_000) return `${sign}${(absolute / 100_000_000).toFixed(2)}亿`;
  if (absolute >= 10_000) return `${sign}${(absolute / 10_000).toFixed(2)}万`;
  return `${sign}${absolute.toFixed(0)}`;
}
