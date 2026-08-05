import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * a-stock-data 运行时执行器。
 * 运行 electron/python/a-stock-data.py（从 .claude/skills/a-stock-data/SKILL.md 移植的真实数据函数），
 * stdout 输出 JSON；python 缺失 / 超时 / 非零退出 / JSON 解析失败一律 reject，由上层走空状态，禁止返回假数据。
 */

export type AStockDataFnName =
  | 'holder_num_change'
  | 'dividend_history'
  | 'tencent_quote'
  | 'baidu_kline_with_ma'
  | 'eastmoney_fund_flow_minute'
  | 'tdx_transactions'
  | 'industry_comparison'
  | 'board_fund_flow'
  | 'ths_hot_list'
  | 'em_hot_rank';

// 股东户数变化（季度级）
export interface IHolderNumberChangeRow {
  date: string;
  holder_num: number;
  change_num: number;
  change_ratio: number;
  avg_shares: number;
}

// 分红送转历史
export interface IDividendHistoryRow {
  date: string;
  bonus_rmb: number;
  transfer_ratio: number;
  bonus_ratio: number | null;
  plan: string;
}

// 腾讯财经实时行情
export interface ITencentQuote {
  name: string;
  price: number;
  last_close: number;
  open: number;
  change_amt: number;
  change_pct: number;
  high: number;
  low: number;
  amount_wan: number;
  turnover_pct: number;
  pe_ttm: number;
  amplitude_pct: number;
  float_mcap_yi: number;
  mcap_yi: number;
  pb: number;
  limit_up: number;
  limit_down: number;
  vol_ratio: number;
  pe_static: number;
  is_stale: boolean;
  stale_reason?: string;
}

// 百度股市通 K线（keys + 逗号分隔行）
export interface IBaiduKline {
  keys: string[];
  rows: string[];
}

// 东财个股资金流（分钟级）
export interface IEMFundFlowMinuteRow {
  time: string;
  main_net: number;
  small_net: number;
  mid_net: number;
  large_net: number;
  super_net: number;
}

// 通达信逐笔成交（a-stock-data 兜底）
export interface ITdxTransactionRow {
  time: string;
  price: number | null;
  vol: number | null;
  num: number | null;
  buyorsell: number | null;
}

// 行业涨跌幅排名
export interface IIndustryRankingRow {
  rank: number;
  name: string;
  change_pct: number;
  code: string;
  up_count: number;
  down_count: number;
  leader: string;
  leader_change: number;
}

export interface IIndustryRanking {
  top: IIndustryRankingRow[];
  bottom: IIndustryRankingRow[];
  total: number;
}

// 板块资金流
export interface IBoardFundFlowRow {
  rank: number;
  name: string;
  code: string;
  change_pct: number;
  main_net: number;
  main_pct: number;
  leader: string;
  super_large_net?: number;
  large_net?: number;
  medium_net?: number;
  small_net?: number;
}

export interface IBoardFundFlow {
  board_type: string;
  period: string;
  total: number;
  rows: IBoardFundFlowRow[];
}

// 同花顺热榜
export interface IThsHotStock {
  rank?: number;
  code?: string;
  name?: string;
  heat?: string;
  pct?: number;
  rank_chg?: number;
  concepts?: string[];
  tag?: string;
}

// 东财人气榜
export interface IEmHotRankItem {
  rank?: number;
  code?: string;
  name?: string;
  price?: number | null;
  pct?: number | null;
  rank_chg?: number;
}

const SCRIPT_PATH = join(process.cwd(), 'electron', 'python', 'a-stock-data.py');

function pythonExecutable(): string {
  return existsSync(join(process.cwd(), '.venv/bin/python'))
    ? join(process.cwd(), '.venv/bin/python')
    : 'python3';
}

export async function runAStockDataFn<T>(
  fnName: AStockDataFnName,
  args: Record<string, string | number>,
): Promise<T> {
  const argv = [SCRIPT_PATH, fnName];
  for (const [key, value] of Object.entries(args)) {
    argv.push(`--${key}`, String(value));
  }
  return new Promise<T>((resolve, reject) => {
    execFile(
      pythonExecutable(),
      argv,
      { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`a-stock-data ${fnName} 运行失败: ${(stderr || error.message).trim()}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as T);
        } catch {
          reject(
            new Error(`a-stock-data ${fnName} 输出非 JSON: ${stderr.trim() || stdout.slice(0, 300)}`),
          );
        }
      },
    );
  });
}
